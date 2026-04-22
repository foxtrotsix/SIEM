const { io } = require('socket.io-client');
const fs = require('fs');
const chokidar = require('chokidar');
const si = require('systeminformation');
const os = require('os');
const path = require('path');

const CONFIG = {
    managerUrl: process.env.MANAGER_URL || 'http://localhost:3000',
    agentName: os.hostname(),
    agentId: os.hostname() + '_' + os.platform(),
    logs: [
        '/var/log/auth.log',
        '/var/log/syslog',
        './test.log'
    ],
    fim: [
        '/etc/passwd',
        '/etc/shadow',
        './' // Current directory for demo
    ],
    inventoryInterval: 60000 // 1 minute
};

const socket = io(CONFIG.managerUrl);

socket.on('connect', async () => {
    console.log('Connected to Abinara-SOC Manager');
    
    // Registration
    const osInfo = await si.osInfo();
    socket.emit('register', {
        id: CONFIG.agentId,
        name: CONFIG.agentName,
        ip: await getIPAddress(),
        os: `${osInfo.distro} ${osInfo.release}`,
        version: '1.0.0'
    });

    // Start Subsystems
    startLogHarvester();
    startFIM();
    startInventoryCollection();
});

async function getIPAddress() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '127.0.0.1';
}

function startLogHarvester() {
    CONFIG.logs.forEach(logPath => {
        const fullPath = path.resolve(logPath);
        if (fs.existsSync(fullPath)) {
            console.log(`Monitoring log: ${fullPath}`);
            const watcher = chokidar.watch(fullPath, {
                persistent: true,
                usePolling: true,
                interval: 100
            });

            let fileSize = fs.statSync(fullPath).size;

            watcher.on('change', (path) => {
                const newSize = fs.statSync(path).size;
                if (newSize > fileSize) {
                    const stream = fs.createReadStream(path, {
                        start: fileSize,
                        end: newSize
                    });
                    stream.on('data', (chunk) => {
                        const lines = chunk.toString().split('\n');
                        lines.forEach(line => {
                            if (line.trim()) {
                                console.log(`[LOG] Sending line: ${line.substring(0, 50)}...`);
                                socket.emit('log', { log: line, source: 'syslog' });
                            }
                        });
                    });
                    fileSize = newSize;
                } else if (newSize < fileSize) {
                    fileSize = newSize; // File truncated
                }
            });
        } else {
            console.warn(`Log not found: ${fullPath}`);
        }
    });
}

function startFIM() {
    const watcher = chokidar.watch(CONFIG.fim, {
        persistent: true,
        ignoreInitial: true
    });

    watcher.on('all', (event, filePath) => {
        console.log(`FIM Alert: ${event} on ${filePath}`);
        socket.emit('log', {
            log: `FIM Alert: ${event} on ${filePath}`,
            source: 'fim',
            data: { event, path: filePath }
        });
    });
}

async function startInventoryCollection() {
    const collect = async () => {
        console.log('Collecting inventory...');
        
        // Software
        // This is platform specific, but for demo we can mock or use systeminformation
        const packages = await si.services(); // Just as an example of running services
        socket.emit('inventory', { type: 'services', payload: packages });

        // Network
        const net = await si.networkInterfaces();
        socket.emit('inventory', { type: 'network', payload: net });

        // Hardware
        const cpu = await si.cpu();
        const mem = await si.mem();
        socket.emit('inventory', { type: 'hardware', payload: { cpu, mem } });
    };

    collect();
    setInterval(collect, CONFIG.inventoryInterval);
}

socket.on('disconnect', () => {
    console.log('Disconnected from Manager');
});
