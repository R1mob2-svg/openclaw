const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO_URL = 'https://github.com/R1mob2-svg/global-agent-brain.git';
const SYNC_DIR = path.join(__dirname, '../../.miyagi-memory');
const SYNC_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours
const MIYAGI_SYNC_ENABLED = (process.env.MIYAGI_SYNC_ENABLED || 'false').toLowerCase() === 'true';

const log = (msg) => console.log(`[Miyagi-External-Sync] ${msg}`);
const logErr = (msg, err) => console.error(`[Miyagi-External-Sync] ${msg}`, err);

const executeSync = () => {
    try {
        if (!fs.existsSync(SYNC_DIR)) {
            log(`Initializing Miyagi Memory Lane from remote repo...`);
            execSync(`git clone ${REPO_URL} "${SYNC_DIR}"`, { stdio: 'pipe', timeout: 60000, windowsHide: true });
        } else {
            log('Pulling latest updates for Miyagi Memory Lane...');
            execSync('git pull', { cwd: SYNC_DIR, stdio: 'pipe', timeout: 30000, windowsHide: true });
        }
        
        // Verify critical files
        const miyagiDir = path.join(SYNC_DIR, 'Agents/miyagi');
        if (fs.existsSync(path.join(miyagiDir, 'BOOT_HERE.md'))) {
            log('BOOT_HERE.md validated. External Miyagi Brain synchronized.');
        } else {
            logErr('BOOT_HERE.md missing after sync!');
        }
    } catch (error) {
        // Git sync failure must NEVER block server startup or crash the process.
        logErr('Miyagi sync failed (non-blocking). Server continues without fresh sync.', error.message);
    }
};

const startMiyagiSync = () => {
    if (!MIYAGI_SYNC_ENABLED) {
        log('Miyagi sync DISABLED (set MIYAGI_SYNC_ENABLED=true to enable).');
        return;
    }

    // Run async on cold start — never block the server
    setTimeout(() => executeSync(), 5000);
    
    // Set 6-hour polling
    setInterval(executeSync, SYNC_INTERVAL);
};

module.exports = { startMiyagiSync };

