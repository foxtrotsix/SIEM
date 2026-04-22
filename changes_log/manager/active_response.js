const { exec } = require('child_process');
const path = require('path');

/**
 * Active Response Module
 * This module executes automated scripts when critical threats are detected.
 */
function triggerActiveResponse(event) {
    if (event.level >= 10) {
        console.log(`[ACTIVE RESPONSE] Critical threat detected (Level ${event.level}). Executing response...`);
        
        // Example: If it's a brute force attack, we could block the IP
        if (event.rule_id === 100003) {
            const data = JSON.parse(event.data);
            const ipToBlock = '192.168.1.100'; // In a real scenario, extract from event logs
            
            console.log(`[ACTION] Blocking suspicious IP: ${ipToBlock}`);
            
            // Mock firewall command
            // exec(`iptables -A INPUT -s ${ipToBlock} -j DROP`, (err) => { ... });
            
            // For this demo, we'll just log it to a security ledger
             require('fs').appendFileSync(path.join(__dirname, 'response_log.txt'), 
                `[${new Date().toISOString()}] BLOCKED IP ${ipToBlock} due to Brute Force (Rule 100003)\n`
            );
        }

        // Example: Kill malicious process if detected (placeholder)
        if (event.description.includes('malware')) {
             console.log('[ACTION] Killing suspicious process tree...');
        }
    }
}

module.exports = { triggerActiveResponse };
