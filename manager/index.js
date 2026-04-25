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
    const { message, agentId } = req.body;
    console.log(`[CHAT] Request received: ${message} (Filter: ${agentId || 'Global'})`);
    
    try {
        const query = agentId 
            ? ['SELECT * FROM events WHERE agent_id = ? ORDER BY timestamp DESC LIMIT 20', [agentId]]
            : ['SELECT * FROM events ORDER BY timestamp DESC LIMIT 20', []];
            
        const events = await db.all(query[0], query[1]);
        const eventSummary = events.map(e => `[${e.level}] ${e.description} at ${e.timestamp} source: ${e.source}`).join('\n');
        
        const fullPrompt = `You are the arch SOC AI Assistant.
        
CURRENT ${agentId ? `AGENT [${agentId}]` : 'GLOBAL SIEM'} CONTEXT (Last 20 events):
${eventSummary}

User question: ${message}

Instructions:
1. Be technical, concise, and professional.
2. Provide actionable security recommendations.`;

        const modelsToTry = ["gemini-2.5-flash", "gemini-2.0-flash"];
        let reply = null;

        for (const mName of modelsToTry) {
            try {
                const response = await fetch(`https://generativelanguage.googleapis.com/v1/models/${mName}:generateContent?key=${GEMINI_API_KEY}`, {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'X-goog-api-key': GEMINI_API_KEY 
                    },
                    body: JSON.stringify({ contents: [{ parts: [{ text: fullPrompt }] }] })
                });

                const data = await response.json();
                if (response.ok) {
                    reply = data.candidates[0].content.parts[0].text;
                    console.log(`[AI] Chat Success using: ${mName}`);
                    break;
                }
                console.warn(`[AI] ${mName} failed: ${data.error?.message}`);
            } catch (e) {
                console.error(`[AI] ${mName} error:`, e.message);
            }
        }

        if (!reply) throw new Error('All Gemini models failed. Check your API key or Region.');
        res.json({ text: reply });
    } catch (error) {
        console.error('Final AI Error:', error.message);
        res.status(500).json({ error: 'AI Assistant currently offline', details: error.message });
    }
});

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*' }
});

// --- Gemini AI Configuration ---
const GEMINI_API_KEY = 'AIzaSyCQRDJ6Fqq751o5HN6EnSG5JJ3iSiGf-dU';
const intelCache = new Map(); // Billing saver: Cache intelligence by Rule ID

function getTechnicalIntelligence(event) {
    const category = event.category || 'general';
    
    // Default Forensic Extraction
    let ip = "Unknown";
    let user = "N/A";
    let path = "Unknown";
    
    try {
        const ipRegex = /\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/;
        const foundIp = event.full_log.match(ipRegex);
        if (foundIp) ip = foundIp[0];

        const userRegex = /(?:username["']?\s*:\s*["']?|user\s+)(\w+)/i;
        const foundUser = event.full_log.match(userRegex);
        if (foundUser) user = foundUser[1];

        const pathRegex = /(?:path["']?\s*:\s*["']?|url["']?\s*:\s*["']?)([\/\w\.-]+)/i;
        const foundPath = event.full_log.match(pathRegex);
        if (foundPath) path = foundPath[1];
    } catch (e) {}

    const intelligence = {
        data_collection: `Log Analysis (${event.source.toUpperCase()}) | Pattern: ${event.description}`,
        correlation: `Target: ${user} | Path: ${path} | Source: ${ip}`,
        manual_analysis: `Anomalous activity detected. Initial assessment: Potential ${category} vector via rule ${event.rule_id}.`,
        actionable: `Check system logs immediately.`
    };

    if (category === 'authentication') {
        intelligence.data_collection = `Auth Payload Discovery | Target: [${user}]`;
        intelligence.correlation = `Consecutive Failures at [${path}] from IP [${ip}]`;
        intelligence.manual_analysis = `Pattern match: Sequential login failures suggest an automated/scripted Brute Force bot.`;
        intelligence.actionable = `BLOCK IP: iptables -I INPUT -s ${ip} -j REJECT | LOCK USER: usermod -L ${user}`;
    } else if (category === 'attack') {
        intelligence.data_collection = `Exploit Payload Discovery | Vector: ${event.description}`;
        intelligence.correlation = `Inbound Attack at URI [${path}] from IP [${ip}]`;
        intelligence.manual_analysis = `The payload matches ${event.description} signatures. Suspect attempt to compromise backend data or session.`;
        intelligence.actionable = `QUARANTINE IP: ufw insert 1 deny from ${ip} | NGINX FIX: add_header Content-Security-Policy "default-src 'self'";`;
    }

    // Special handling for correlation alerts
    if (event.source === 'correlation') {
        intelligence.data_collection = `Correlated Threat Cluster | Total Attempts Identified: ${event.rule_id}`;
        intelligence.correlation = `CRITICAL ATTACK: ${ip} targeting sensitive endpoint [${path}] for user [${user}]`;
        intelligence.manual_analysis = `High-confidence automated attack chain identified. Multiple low-level events aggregated into a confirmed Brute Force incidence.`;
        intelligence.actionable = `IP BAN: iptables -A INPUT -s ${ip} -j DROP\nLOG ANALYSIS: grep "${ip}" /var/log/nginx/access.log`;
    }

    // Stringify for database but the UI will parse this
    return JSON.stringify(intelligence);
}

async function extractAndRecordSuspect(event) {
    let ip = null;
    const logData = event.full_log;

    // Try to parse JSON first for better accuracy
    try {
        const parsed = JSON.parse(logData);
        // Prioritize X-Forwarded-For for Docker/Proxy setups
        ip = parsed.x_forwarded_for || parsed['x-forwarded-for'] || parsed.ip || parsed.client_ip || parsed.remote_addr;
        
        // If it's a comma-separated list (X-Forwarded-For usually is), take the first one
        if (ip && ip.includes(',')) ip = ip.split(',')[0].trim();
    } catch (e) {}

    // Fallback to regex - look for multiple IPs and try to find a non-docker one
    if (!ip) {
        const ipRegex = /\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/g;
        const matches = logData.match(ipRegex) || [];
        // If multiple IPs, the client is usually the first one in Nginx logs with proxy_set_header
        if (matches.length > 0) {
            // Filter out common Docker gateway IPs if possible, or just take the first
            ip = matches[0];
        }
    }
    
    if (ip) {
        // Handle local IPs without API call
        const isLocal = ip.startsWith('127.') || ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.');
        
        let geo = { status: 'success', country: isLocal ? 'Private Network' : 'Unknown', city: isLocal ? 'Internal' : 'Unknown' };
        
        if (!isLocal) {
            try {
                const geoRes = await fetch(`http://ip-api.com/json/${ip}`);
                geo = await geoRes.json();
            } catch (e) {
                console.error('[SUSPECT] GeoIP Error:', e.message);
            }
        }

        const threatLevel = event.level >= 10 ? 'CRITICAL' : (event.level >= 5 ? 'SUSPICIOUS' : 'INFO');

        await db.run(`
            INSERT INTO suspects (ip, country, city, threat_level) 
            VALUES (?, ?, ?, ?)
            ON CONFLICT(ip) DO UPDATE SET 
                count = count + 1,
                threat_level = CASE WHEN ? = 'CRITICAL' THEN 'CRITICAL' ELSE threat_level END,
                last_seen = CURRENT_TIMESTAMP
        `, [ip, geo.country || 'Unknown', geo.city || 'Unknown', threatLevel, threatLevel]);
        
        console.log(`\x1b[35m[SUSPECT]\x1b[0m ${ip} recorded as ${threatLevel} (${geo.country})`);
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

// --- Log Deduplication Cache ---
const dedupeCache = new Map(); // AgentId:LogData -> Timestamp

function isDuplicate(agentId, logData) {
    const key = `${agentId}:${logData}`;
    const now = Date.now();
    if (dedupeCache.has(key) && (now - dedupeCache.get(key) < 2000)) {
        return true;
    }
    dedupeCache.set(key, now);
    
    // Cleanup old cache entries (keep it small)
    if (dedupeCache.size > 100) {
        const fiveSecsAgo = now - 5000;
        for (const [k, time] of dedupeCache.entries()) {
            if (time < fiveSecsAgo) dedupeCache.delete(k);
        }
    }
    return false;
}

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


// Rule Engine Logic
async function processLog(agentId, logData, source) {
    if (isDuplicate(agentId, logData)) return; // Flood Protection
    
    // --- Forensic identity recovery ---
    let effectiveAgentId = agentId;
    if (effectiveAgentId === 'Unknown-Agent') {
        const hostnameMatch = logData.match(/^[A-Z][a-z]{2}\s+\d+\s+[\d:]+\s+([a-zA-Z0-9_-]+)\s+/);
        if (hostnameMatch) effectiveAgentId = hostnameMatch[1];
    }
    
    const contextId = effectiveAgentId;

    // LIVE RELOAD RULES (Dev friendly)
    try {
        rules = JSON.parse(fs.readFileSync(path.join(__dirname, 'rules.json'), 'utf8'));
    } catch (e) {
        console.error('[MANAGER] Rules reload failed:', e.message);
    }

    const timestamp = new Date();
    // Decode URI, JSON-escapes, and Unicode to catch XSS in many forms
    let decodedLog = logData;
    try {
        // Deep unmasking: Handle common obfuscations
        decodedLog = decodeURIComponent(logData)
            .replace(/\\"/g, '"')
            .replace(/\\u003c/g, '<')
            .replace(/\\u003e/g, '>')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>');
    } catch (e) {}
    
    // Check basic rules
    for (const rule of rules.filter(r => r.type !== 'correlation')) {
        if (!rule.regex) continue;

        const regex = new RegExp(rule.regex, 'i');
        if (regex.test(decodedLog)) {
            console.log(`\x1b[31m[ALERT]\x1b[0m \x1b[1mRule ${rule.id} (${rule.description})\x1b[0m for ${effectiveAgentId}`);
            
            const event = {
                id: Date.now() + Math.random().toString(36).substr(2, 5),
                agent_id: effectiveAgentId,
                timestamp: timestamp.toISOString(),
                level: rule.level,
                rule_id: rule.id,
                description: rule.description,
                full_log: decodedLog,
                source: source || 'syslog',
                count: 1
            };
            
            event.category = rule.category || 'general';
            event.ai_intel = getTechnicalIntelligence(event);
            
            // Record everything (Raw Logs)
            db.data.events.unshift(event);
            if (db.data.events.length > 1000) db.data.events.pop();
            db.save();
            
            io.emit('new_event', event);
            io.emit('stats_updated');
            
            // Forensic processing
            extractAndRecordSuspect(event);
            triggerActiveResponse(event);
            checkCorrelation(effectiveAgentId, rule.id, event);
            return;
        }
    }
}

async function checkCorrelation(agentId, triggerRuleId, triggerEvent) {
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
            // Extract IP if possible from trigger event
            const ipRegex = /\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/;
            const foundIp = triggerEvent.full_log.match(ipRegex);
            const attackerIp = foundIp ? foundIp[0] : 'Unknown source';

            const correlatedEvent = {
                agent_id: agentId,
                timestamp: new Date(),
                level: rule.level,
                rule_id: rule.id,
                description: rule.description,
                full_log: `CRITICAL: Brute Force detected from ${attackerIp}. Triggered by rule ${triggerRuleId} occurring ${rule.frequency} times in ${rule.timeframe}s`,
                source: 'correlation',
                data: JSON.stringify({ trigger_rule: triggerRuleId, frequency: rule.frequency, attacker_ip: attackerIp })
            };

            // Intelligence for correlated events
            correlatedEvent.category = rule.category || 'attack';
            correlatedEvent.ai_intel = getTechnicalIntelligence(correlatedEvent);

            await db.run(
                'INSERT INTO events (agent_id, timestamp, level, rule_id, description, full_log, source, data, ai_intel) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [correlatedEvent.agent_id, correlatedEvent.timestamp, correlatedEvent.level, correlatedEvent.rule_id, correlatedEvent.description, correlatedEvent.full_log, correlatedEvent.source, correlatedEvent.data, correlatedEvent.ai_intel]
            );

            // Professional Logging for Correlated Event
            const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
            console.log(`\x1b[31m[${ts}]\x1b[0m \x1b[41m[KORELASI]\x1b[0m \x1b[1m[${correlatedEvent.description}]\x1b[0m Source: ${attackerIp}`);

            io.emit('new_event', correlatedEvent);
            
            // --- RECORD AS SUSPECT ---
            extractAndRecordSuspect(correlatedEvent);
            
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
        const { log, source, id: reportedId } = data;
        const finalId = socket.agentId || reportedId || 'Unknown-Agent';
        await processLog(finalId, log, source);
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
    // For each agent, check if they have recent alerts
    const enhancedAgents = await Promise.all(agents.map(async (a) => {
        const alert = await db.get('SELECT MAX(level) as maxLevel FROM events WHERE agent_id = ? AND timestamp > datetime("now", "-1 hour")', [a.id]);
        return { ...a, last_high_level: alert?.maxLevel || 0 };
    }));
    res.json(enhancedAgents);
});

app.get('/api/suspects', async (req, res) => {
    try {
        const suspects = await db.all('SELECT * FROM suspects ORDER BY last_seen DESC');
        res.json(suspects);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/events', async (req, res) => {
    const events = await db.all('SELECT * FROM events ORDER BY timestamp DESC LIMIT 100');
    res.json(events);
});

// --- DEVELOPMENT ONLY: Clear all logs ---
app.delete('/api/events', async (req, res) => {
    try {
        await db.run('DELETE FROM events');
        await db.run('DELETE FROM suspects');
        
        // Also clear correlation memory
        Object.keys(eventCounts).forEach(key => delete eventCounts[key]);
        
        console.log('\x1b[35m[DEVELOPMENT]\x1b[0m Purged all events, suspects, and correlation memory.');
        
        // Notify all clients to refresh
        io.emit('new_event', { action: 'reload' }); // Signal for UI refresh
        io.emit('stats_updated');
        
        res.json({ message: 'Database cleared' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/stats', async (req, res) => {
    const { agentId } = req.query;
    
    let eventQuery = 'SELECT COUNT(*) as count FROM events';
    let agentQuery = 'SELECT COUNT(*) as count FROM agents';
    let levelQuery = 'SELECT level, COUNT(*) as count FROM events GROUP BY level';
    let params = [];

    if (agentId) {
        eventQuery = 'SELECT COUNT(*) as count FROM events WHERE agent_id = ?';
        levelQuery = 'SELECT level, COUNT(*) as count FROM events WHERE agent_id = ? GROUP BY level';
        params = [agentId];
    }

    const eventCount = await db.get(eventQuery, params);
    const agentCount = await db.get(agentQuery);
    const alertsByLevel = await db.all(levelQuery, params);
    
    res.json({ eventCount: eventCount.count, agentCount: agentCount.count, alertsByLevel });
});

app.get('/api/health', (req, res) => {
    res.json(healthStatus);
});


// Start Server
const PORT = process.env.PORT || 3000;
setupDatabase().then(async (database) => {
    db = database;
    
    // Ensure tables exist
    await db.run(`CREATE TABLE IF NOT EXISTS suspects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ip TEXT UNIQUE,
        country TEXT,
        city TEXT,
        threat_level TEXT,
        last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
        count INTEGER DEFAULT 1
    )`);

    server.listen(PORT, '0.0.0.0', () => {
        console.log(`arch-SOC Manager running on http://0.0.0.0:${PORT}`);
    });
});
