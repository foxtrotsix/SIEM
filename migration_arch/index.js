const { io } = require('socket.io-client');
const fs = require('fs');
const chokidar = require('chokidar');
const si = require('systeminformation');
const os = require('os');
const path = require('path');

const args = process.argv.slice(2);
const argMap = {};
for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
        argMap[args[i].slice(2)] = args[i + 1];
        i++;
    } else if (args[i].startsWith('-')) {
        argMap[args[i].slice(1)] = args[i + 1];
        i++;
    }
}

const CONFIG = {
    managerUrl: argMap.manager || argMap.m || process.env.MANAGER_URL || 'http://localhost:3000',
    agentName: argMap.name || argMap.n || os.hostname(),
    agentId: argMap.id || argMap.i || (os.hostname() + '_' + os.platform()),
    logs: [
        '/var/log/auth.log',
        '/var/log/syslog',
        './test.log',
        '/home/juanz/Documents/KULIAH/SOC/mini-soc-new/logs/access.log'
    ],
    fim: [
        '/etc/passwd',
        '/etc/shadow',
        './' // Current directory for demo
    ],
    inventoryInterval: 60000 // 1 minute
};

console.log(`[INIT] Agent Starting...`);
console.log(`[INIT] Manager: ${CONFIG.managerUrl}`);
console.log(`[INIT] Agent ID: ${CONFIG.agentId}`);

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
        
        // Initial check for file existence and readability
        try {
            fs.accessSync(fullPath, fs.constants.R_OK);
        } catch (err) {
            console.warn(`[WARNING] Skipping log ${fullPath}: Permission denied or file not found.`);
            return;
        }

        console.log(`Monitoring log: ${fullPath}`);
        const watcher = chokidar.watch(fullPath, {
            persistent: true,
            usePolling: true,
            interval: 500 // Increased for stability
        });

        watcher.on('error', error => console.error(`Watcher error for ${fullPath}: ${error}`));

        let fileSize = fs.statSync(fullPath).size;
        let isProcessing = false;

        watcher.on('change', (p) => {
            if (isProcessing) return;
            try {
                const stats = fs.statSync(p);
                const newSize = stats.size;
                
                if (newSize > fileSize) {
                    isProcessing = true;
                    // Important: Store current fileSize to use as start
                    const startByte = fileSize;
                    fileSize = newSize; // Update immediately to prevent duplicate triggers

                    const stream = fs.createReadStream(p, {
                        start: startByte,
                        end: newSize - 1
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

                    stream.on('end', () => {
                        isProcessing = false;
                    });

                    stream.on('error', () => {
                        isProcessing = false;
                    });

                } else if (newSize < fileSize) {
                    fileSize = newSize; 
                }
            } catch (err) {
                console.error(`Error reading ${p}:`, err.message);
                isProcessing = false;
            }
        });
    });
}

function startFIM() {
    console.log(`Starting FIM on: ${CONFIG.fim.join(', ')}`);
    const watcher = chokidar.watch(CONFIG.fim, {
        persistent: true,
        ignoreInitial: true,
        ignorePermissionErrors: true // Tells chokidar to ignore EACCES internally
    });

    watcher.on('error', error => {
        if (error.code === 'EACCES') {
            console.warn(`[WARNING] FIM: Permission denied for some requested paths. Run as root for full monitoring.`);
        } else {
            console.error(`FIM Watcher error: ${error}`);
        }
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
