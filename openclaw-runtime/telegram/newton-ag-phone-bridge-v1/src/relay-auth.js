const crypto = require('crypto');

// The authorization token for Newton ChatGPT Action
const RELAY_AUTH_TOKEN = process.env.RELAY_AUTH_TOKEN || 'newton_secure_bypass_key_for_dry_run_testing';

/**
 * Validates the Authorization header.
 * Expects format: "Bearer <token>"
 */
function validateAuthHeader(authorizationHeader) {
    if (!authorizationHeader) {
        return false;
    }
    const parts = authorizationHeader.split(' ');
    if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
        return false;
    }
    const token = parts[1];
    
    // Constant-time comparison to prevent timing attacks
    const providedBuffer = Buffer.from(token);
    const expectedBuffer = Buffer.from(RELAY_AUTH_TOKEN);
    
    if (providedBuffer.length !== expectedBuffer.length) {
        return false;
    }
    return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

module.exports = {
    validateAuthHeader,
    RELAY_AUTH_TOKEN
};
