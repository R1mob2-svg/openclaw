const crypto = require('crypto');

/**
 * Verifies a GitHub webhook HMAC SHA-256 signature.
 * Uses crypto.timingSafeEqual for constant-time comparison.
 * 
 * @param {string} rawBody - The raw request body text.
 * @param {string} signatureHeader - The value of the X-Hub-Signature-256 header.
 * @param {string} secret - The pre-shared webhook secret.
 * @returns {boolean} - True if signature is valid, false otherwise.
 */
function verifySignature(rawBody, signatureHeader, secret) {
    if (!signatureHeader || !secret) {
        return false;
    }
    const parts = signatureHeader.split('=');
    if (parts.length !== 2 || parts[0] !== 'sha256') {
        return false;
    }
    const providedHex = parts[1];
    
    const computedHex = crypto.createHmac('sha256', secret)
        .update(rawBody)
        .digest('hex');
        
    const providedBuffer = Buffer.from(providedHex, 'hex');
    const computedBuffer = Buffer.from(computedHex, 'hex');
    
    if (providedBuffer.length !== computedBuffer.length) {
        return false;
    }
    
    return crypto.timingSafeEqual(providedBuffer, computedBuffer);
}

module.exports = { verifySignature };
