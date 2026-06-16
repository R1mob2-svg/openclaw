const githubClient = require('./github-api-client');

// Memory store fallback for local testing
const localNonceCache = new Set();

/**
 * Checks if the nonce has already been processed to prevent replay attacks.
 * In local/test mode, checks the memory cache.
 * In remote/production mode, queries the GitHub repository directly for the nonce file.
 */
async function isReplayedNonce(nonce, useRemote = false) {
    if (!nonce || typeof nonce !== 'string') {
        throw new Error('Invalid nonce format');
    }

    if (!useRemote) {
        if (localNonceCache.has(nonce)) {
            return true;
        }
        localNonceCache.add(nonce);
        return false;
    }

    try {
        // Query the repository to see if this nonce has been processed
        const filePath = `CommandLedger/processed_nonces/${nonce}.json`;
        const file = await githubClient.getFileContent(filePath);
        return file !== null; // If file exists, nonce is replayed
    } catch (e) {
        // If query fails, fail safe and reject
        console.error(`Nonce verification error: ${e.message}`);
        return true;
    }
}

/**
 * Persists the nonce to the store.
 */
async function recordNonce(nonce, useRemote = false) {
    if (!useRemote) {
        localNonceCache.add(nonce);
        return true;
    }

    const filePath = `CommandLedger/processed_nonces/${nonce}.json`;
    const nonceData = {
        nonce: nonce,
        registered_at: new Date().toISOString()
    };
    
    await githubClient.putFileContent(
        filePath,
        JSON.stringify(nonceData, null, 2),
        `Register nonce ${nonce}`
    );
    return true;
}

function clearLocalNonceCache() {
    localNonceCache.clear();
}

module.exports = {
    isReplayedNonce,
    recordNonce,
    clearLocalNonceCache
};
