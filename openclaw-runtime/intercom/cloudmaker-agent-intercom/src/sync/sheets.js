const config = require('../config');

// Sheets is PASSIVE MIRROR ONLY — never machine truth.
// Controlled by SHEETS_MIRROR_ENABLED env var (default: false/disabled).
const SHEETS_MIRROR_ENABLED = (process.env.SHEETS_MIRROR_ENABLED || 'false').toLowerCase() === 'true';

const syncTaskToSheets = async (task) => {
    // If Sheets mirror is disabled, return immediately.
    // This is the default — Sheets is NOT machine truth.
    if (!SHEETS_MIRROR_ENABLED) {
        return true;
    }

    try {
        if (config.NODE_ENV === 'test' || config.NODE_ENV === 'development') {
            const safeTask = { ...task };
            delete safeTask.lock_token_hash;
            console.log(`[SHEETS MIRROR] (dev/test mock) Task ${task.id} status: ${task.status}`);
            return true;
        }

        // Live passive mirror implementation would use googleapis here.
        // This is write-only — Sheets is NEVER read as a command source.
        console.log(`[SHEETS MIRROR] Task ${task.id} status: ${task.status}`);
        return true;
    } catch (error) {
        // Sheets mirror failure must NEVER block or corrupt Intercom/Firestore task truth.
        console.warn('[SHEETS MIRROR WARNING] Passive sync failed (non-blocking):', error.message);
        return false;
    }
};

module.exports = {
    syncTaskToSheets
};
