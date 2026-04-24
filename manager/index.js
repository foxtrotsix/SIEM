const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { setupDatabase } = require('./database');
const fs = require('fs');
const path = require('path');
const _ = require('lodash');
const { triggerActiveResponse } = require('./active_response');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(cors());
app.use(express.json());

// --- AI Chat Assistant Endpoint ---
app.post('/api/chat', async (req, res) => {
    const { message, history } = req.body;
    console.log(`[CHAT] Request received: ${message}`);
    
    try {
        const events = await db.all('SELECT * FROM events ORDER BY timestamp DESC LIMIT 20');
        const eventSummary = events.map(e => `[${e.level}] ${e.description} at ${e.timestamp} source: ${e.source}`).join('\n');
        
        const systemPrompt = `You are the Abinara SOC AI Assistant. 
        Your goal is to help security analysts understand incidents in their SIEM.
        
        CURRENT SIEM CONTEXT (Last 20 events):
        ${eventSummary}
        
        Instructions:
        1. Be technical and concise.
        2. If asked about recent attacks, refer to the context above.
        3. Provide actionable security recommendations.
        4. Use a helpful, professional robotic persona.`;

        const chat = model.startChat({
            history: [
                { role: "user", parts: [{ text: systemPrompt }] },
                { role: "model", parts: [{ text: "Understood. I am now the Abinara SOC Assistant, synchronized with your current security landscape. How can I help you today?" }] },
                ...history.map(h => ({
                    role: h.role === 'user' ? 'user' : 'model',
                    parts: [{ text: h.text }]
                }))
            ],
        });

        const result = await chat.sendMessage(message);
        const response = await result.response;
        res.json({ text: response.text() });
    } catch (error) {
        console.error('Chat Error:', error);
        res.status(500).json({ error: 'AI Assistant currently offline' });
    }
});

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*' }
});

// --- Gemini AI Configuration ---
const genAI = new GoogleGenerativeAI('AIzaSyCW9vNQZ4_IRp71Vxu5UEUFTPAu8aMDoEE');
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
const intelCache = new Map(); // Billing saver: Cache intelligence by Rule ID

async function getAIIntelligence(event) {
    const cacheKey = event.rule_id + (event.description || '');
    if (intelCache.has(cacheKey)) return intelCache.get(cacheKey);

    try {
        const prompt = `You are a SOC Senior Analyst. Analyze this security event:
        Alert: ${event.description}
        Severity: ${event.level}
        Agent: ${event.agent_id}
        Raw Log Snippet: ${event.full_log.substring(0, 500)}

        Provide "Actionable Intelligence" in 2-3 short, technical bullet points for a security engineer. 
        Focus on mitigation and investigation. Keep it extremely concise.`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        
        intelCache.set(cacheKey, text);
        return text;
    } catch (error) {
        console.error('Gemini Error:', error.message);
        return `AI Analysis Failure: ${error.message}`;
    }
}




let db;
let rules = [];
const eventCounts = {}; // For correlation
let healthStatus = {
    webapp: { status: 'checking', last_checked: null },
    dns: { status: 'checking', last_checked: null },
    network: { status: 'checking', last_checked: null }
};

// --- Availability Monitoring ---
async function checkAvailability() {
    // Check WebApp (Nginx)
    try {
        const res = await fetch('http://localhost:81').catch(() => ({ ok: false }));
        healthStatus.webapp = { status: res.ok ? 'up' : 'down', last_checked: new Date() };
    } catch (e) { healthStatus.webapp.status = 'down'; }

    // Check DNS (Standard Google DNS for demo)
    require('dns').lookup('google.com', (err) => {
        healthStatus.dns = { status: err ? 'down' : 'up', last_checked: new Date() };
    });

    // Check Network (Internal Gateway)
    healthStatus.network = { status: 'up', last_checked: new Date() }; // Simplified for host mode
}

setInterval(checkAvailability, 30000); // Check every 30s
checkAvailability();


// Load rules
try {
    rules = JSON.parse(fs.readFileSync(path.join(__dirname, 'rules.json'), 'utf8'));
} catch (err) {
    console.error('Failed to load rules:', err);
}

// Rule Engine Logic
async function processLog(agentId, logData, source) {
    const timestamp = new Date();
    // Debug: Lihat apa yang masuk ke Manager
    console.log(`[DEBUG] Incoming log from ${agentId}: ${logData.substring(0, 100)}...`);

    // Decode URI encoding (convert %3C to <) to catch encoded attacks
    let decodedLog = logData;
    try {
        decodedLog = decodeURIComponent(logData);
        if (decodedLog !== logData) console.log(`[DEBUG] Decoded log: ${decodedLog.substring(0, 100)}...`);
    } catch (e) {}
    
    // Check basic rules
    for (const rule of rules.filter(r => r.type !== 'correlation')) {
        if (rule.source && rule.source !== source) continue;
        
        const match = decodedLog.match(new RegExp(rule.regex, 'i')); 
        if (match) {
            console.log(`[!!! MATCH !!!] Rule ${rule.id} found!`);
            const event = {
                agent_id: agentId,
                timestamp,
                level: rule.level,
                rule_id: rule.id,
                description: rule.description,
                full_log: logData,
                source,
                data: JSON.stringify({ matches: match.slice(1) })
            };

            // --- AI Analysis Logic (HEMAT BILLING) ---
            if (event.level >= 7) {
                console.log(`[AI] Analyzing security event (Level ${event.level}): ${event.description}`);
                event.ai_intel = await getAIIntelligence(event);
            }

            await db.run(
                'INSERT INTO events (agent_id, timestamp, level, rule_id, description, full_log, source, data, ai_intel) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [event.agent_id, event.timestamp, event.level, event.rule_id, event.description, event.full_log, event.source, event.data, event.ai_intel]
            );

            // Emit to dashboard
            io.emit('new_event', event);
            io.emit('stats_updated'); // Trigger stats refresh

            // Trigger Active Response
            triggerActiveResponse(event);

            // Correlation check
            await checkCorrelation(agentId, rule.id);
            return;
        }
    }
}

async function checkCorrelation(agentId, triggerRuleId) {
    const correlationRules = rules.filter(r => r.type === 'correlation' && r.trigger_rule_id === triggerRuleId);
    
    for (const rule of correlationRules) {
        const key = `${agentId}_${rule.id}`;
        if (!eventCounts[key]) {
            eventCounts[key] = { count: 0, start: Date.now() };
        }

        const now = Date.now();
        if (now - eventCounts[key].start > rule.timeframe * 1000) {
            eventCounts[key] = { count: 1, start: now };
        } else {
            eventCounts[key].count++;
        }

        if (eventCounts[key].count >= rule.frequency) {
            const correlatedEvent = {
                agent_id: agentId,
                timestamp: new Date(),
                level: rule.level,
                rule_id: rule.id,
                description: rule.description,
                full_log: `Correlated event triggered by rule ${triggerRuleId} occurring ${rule.frequency} times in ${rule.timeframe}s`,
                source: 'correlation',
                data: JSON.stringify({ trigger_rule: triggerRuleId, frequency: rule.frequency })
            };

            // AI analysis for correlated events
            if (correlatedEvent.level >= 10) {
                 correlatedEvent.ai_intel = await getAIIntelligence(correlatedEvent);
            }

            await db.run(
                'INSERT INTO events (agent_id, timestamp, level, rule_id, description, full_log, source, data, ai_intel) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [correlatedEvent.agent_id, correlatedEvent.timestamp, correlatedEvent.level, correlatedEvent.rule_id, correlatedEvent.description, correlatedEvent.full_log, correlatedEvent.source, correlatedEvent.data, correlatedEvent.ai_intel]
            );

            io.emit('new_event', correlatedEvent);
            
            // Trigger Active Response for correlated events
            triggerActiveResponse(correlatedEvent);

            eventCounts[key].count = 0; // Reset after trigger
        }
    }
}

// Socket communication with Agents
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    socket.on('register', async (data) => {
        const { id, name, ip, port, os, version } = data;
        console.log(`Agent registering: ${name} (${id})`);
        
        await db.run(
            'INSERT OR REPLACE INTO agents (id, name, ip, port, status, os, version, last_keepalive, registered_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [id, name, ip, port, 'active', os, version, new Date(), new Date()]
        );
        
        
        io.emit('agent_updated'); // Notify dashboard of new agent
        socket.join('agents');
        socket.agentId = id;
    });

    socket.on('log', async (data) => {
        const { log, source } = data;
        await processLog(socket.agentId, log, source);
    });

    socket.on('inventory', async (data) => {
        const { type, payload } = data;
        await db.run(
            'INSERT INTO inventory (agent_id, type, data, last_updated) VALUES (?, ?, ?, ?)',
            [socket.agentId, type, JSON.stringify(payload), new Date()]
        );
    });

    socket.on('disconnect', async () => {
        if (socket.agentId) {
            await db.run('UPDATE agents SET status = ? WHERE id = ?', ['disconnected', socket.agentId]);
            io.emit('agent_updated'); // Notify dashboard of disconnection
        }
    });
});

// API Routes for Dashboard
app.get('/api/agents', async (req, res) => {
    const agents = await db.all('SELECT * FROM agents');
    res.json(agents);
});

app.get('/api/events', async (req, res) => {
    const events = await db.all('SELECT * FROM events ORDER BY timestamp DESC LIMIT 100');
    res.json(events);
});

app.get('/api/stats', async (req, res) => {
    const eventCount = await db.get('SELECT COUNT(*) as count FROM events');
    const agentCount = await db.get('SELECT COUNT(*) as count FROM agents');
    const alertsByLevel = await db.all('SELECT level, COUNT(*) as count FROM events GROUP BY level');
    res.json({ eventCount: eventCount.count, agentCount: agentCount.count, alertsByLevel });
});

app.get('/api/health', (req, res) => {
    res.json(healthStatus);
});


// Start Server
const PORT = process.env.PORT || 3000;
setupDatabase().then(database => {
    db = database;
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`Abinara-SOC Manager running on http://0.0.0.0:${PORT}`);
    });
});
