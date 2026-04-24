const fs = require('fs');
const path = require('path');

class JSONDatabase {
    constructor(filename) {
        this.filepath = path.join(__dirname, filename);
        this.data = { agents: [], events: [], inventory: [] };
        this.load();
    }

    load() {
        if (fs.existsSync(this.filepath)) {
            try {
                this.data = JSON.parse(fs.readFileSync(this.filepath, 'utf8'));
            } catch (err) {
                console.error('Failed to parse DB file:', err);
            }
        }
    }

    save() {
        fs.writeFileSync(this.filepath, JSON.stringify(this.data, null, 2));
    }

    async run(query, params) {
        // Simple simulation of 'INSERT' or 'UPDATE'
        if (query.includes('INSERT INTO events')) {
            const event = {
                id: this.data.events.length + 1,
                agent_id: params[0],
                timestamp: params[1],
                level: params[2],
                rule_id: params[3],
                description: params[4],
                full_log: params[5],
                source: params[6],
                data: params[7],
                ai_intel: params[8]
            };
            this.data.events.push(event);
        } else if (query.includes('INSERT OR REPLACE INTO agents')) {
            const index = this.data.agents.findIndex(a => a.id === params[0]);
            const agent = {
                id: params[0], name: params[1], ip: params[2], port: params[3],
                status: params[4], os: params[5], version: params[6],
                last_keepalive: params[7], registered_at: params[8] || new Date()
            };
            if (index !== -1) this.data.agents[index] = agent;
            else this.data.agents.push(agent);
        } else if (query.includes('UPDATE agents SET status')) {
            const agent = this.data.agents.find(a => a.id === params[1]);
            if (agent) agent.status = params[0];
        } else if (query.includes('INSERT INTO inventory')) {
            this.data.inventory.push({
                agent_id: params[0], type: params[1], data: params[2], last_updated: params[3]
            });
        }
        this.save();
    }

    async all(query) {
        if (query.includes('FROM agents')) return this.data.agents;
        if (query.includes('FROM events')) return [...this.data.events].reverse().slice(0, 100);
        if (query.includes('GROUP BY level')) {
            const counts = {};
            this.data.events.forEach(e => counts[e.level] = (counts[e.level] || 0) + 1);
            return Object.entries(counts).map(([level, count]) => ({ level: parseInt(level), count }));
        }
        return [];
    }

    async get(query) {
        if (query.includes('COUNT(*) as count FROM events')) return { count: this.data.events.length };
        if (query.includes('COUNT(*) as count FROM agents')) return { count: this.data.agents.length };
        return null;
    }

    async exec(query) {
        // Schema creation - ignored for JSON
    }
}

async function setupDatabase() {
    return new JSONDatabase('abinara_siem.json');
}

module.exports = { setupDatabase };
