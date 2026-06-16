require('dotenv').config({ override: true });

module.exports = {
    PORT: process.env.PORT || 3000,
    NODE_ENV: process.env.NODE_ENV || 'development',
    STORAGE_TYPE: process.env.STORAGE_TYPE || 'memory',
    INTERCOM_API_KEY: process.env.INTERCOM_API_KEY || 'default-test-key-do-not-use-in-prod',
    HEARTBEAT_TIMEOUT_MS: parseInt(process.env.HEARTBEAT_TIMEOUT_MS, 10) || 30000, // 30 seconds default
};
