const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { setupDatabase } = require('./database');
const fs = require('fs');
const path = require('path');
const _ = require('lodash');
const { triggerActiveResponse } = require('./active_response');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*' }
});

app.use(cors());
app.use(express.json());

let db;
let rules = [];
const eventCounts = {}; // For correlation

// Load rules
try {
    rules = JSON.parse(fs.readFileSync(path.join(__dirname, 'rules.json'), 'utf8'));
} catch (err) {
    console.error('Failed to load rules:', err);
}

// Rule Engine Logic
async function processLog(agentId, logData, source) {
    const timestamp = new Date();
    
    // Check basic rules
    for (const rule of rules.filter(r => r.type !== 'correlation')) {
        if (rule.source && rule.source !== source) continue;
        
        const match = logData.match(new RegExp(rule.regex));
        if (match) {
            console.log(`[MATCH] Rule ${rule.id}: ${rule.description}`);
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

            await db.run(
                'INSERT INTO events (agent_id, timestamp, level, rule_id, description, full_log, source, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [event.agent_id, event.timestamp, event.level, event.rule_id, event.description, event.full_log, event.source, event.data]
            );

            // Emit to dashboard
            io.emit('new_event', event);

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

            await db.run(
                'INSERT INTO events (agent_id, timestamp, level, rule_id, description, full_log, source, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [correlatedEvent.agent_id, correlatedEvent.timestamp, correlatedEvent.level, correlatedEvent.rule_id, correlatedEvent.description, correlatedEvent.full_log, correlatedEvent.source, correlatedEvent.data]
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

// Start Server
const PORT = process.env.PORT || 3000;
setupDatabase().then(database => {
    db = database;
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`Abinara-SOC Manager running on http://0.0.0.0:${PORT}`);
    });
});
