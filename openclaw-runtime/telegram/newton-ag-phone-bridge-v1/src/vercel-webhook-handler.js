const crypto = require('crypto');
const githubClient = require('./github-api-client');

// The Webhook secret configured on GitHub
const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || 'newton_secure_webhook_secret_dry_run_bypass';
const TARGET_BRANCH = githubClient.BRANCH; // newton-ag-bridge-v2-ledger-dry-run
const TARGET_PATH_PREFIX = 'CommandLedger/approved/';

// In-memory cache of processed delivery IDs for replay prevention
const processedDeliveries = new Set();

/**
 * Handles incoming GitHub webhook POST requests.
 */
async function handleWebhook(req, res, useRemote = false) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const signature = req.headers['x-hub-signature-256'];
    const deliveryId = req.headers['x-github-delivery'];

    if (!deliveryId) {
        return res.status(400).json({ error: 'Missing X-GitHub-Delivery header' });
    }

    if (!signature) {
        return res.status(401).json({ error: 'Missing signature header' });
    }

    // 1. Replay Prevention on delivery ID
    if (processedDeliveries.has(deliveryId)) {
        return res.status(403).json({ error: 'Replay error: Webhook delivery has already been processed.' });
    }
    processedDeliveries.add(deliveryId);

    // 2. Validate Signature
    const parts = signature.split('=');
    if (parts.length !== 2 || parts[0] !== 'sha256') {
        return res.status(401).json({ error: 'Invalid signature format' });
    }

    let rawBody = req.body;
    if (typeof rawBody !== 'string') {
        rawBody = JSON.stringify(rawBody);
    }

    const computedHex = crypto.createHmac('sha256', WEBHOOK_SECRET)
        .update(rawBody)
        .digest('hex');

    const providedBuffer = Buffer.from(parts[1], 'hex');
    const computedBuffer = Buffer.from(computedHex, 'hex');

    if (providedBuffer.length !== computedBuffer.length || !crypto.timingSafeEqual(providedBuffer, computedBuffer)) {
        return res.status(401).json({ error: 'Signature verification failed' });
    }

    const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    
    // 3. Validate target branch
    const ref = payload.ref || '';
    if (ref !== `refs/heads/${TARGET_BRANCH}`) {
        return res.status(200).json({ status: 'ignored', reason: `Ref branch '${ref}' does not match target sandbox branch '${TARGET_BRANCH}'.` });
    }

    // 4. Validate paths (reject forbidden paths first)
    const commits = payload.commits || [];
    const filesToIngest = [];
    let hasForbiddenPaths = false;

    for (const commit of commits) {
        const paths = [...(commit.added || []), ...(commit.modified || [])];
        for (const p of paths) {
            if (p.startsWith(TARGET_PATH_PREFIX)) {
                filesToIngest.push(p);
            } else {
                hasForbiddenPaths = true;
            }
        }
    }

    // Reject immediately if any modified path is outside approved directory
    if (hasForbiddenPaths) {
        return res.status(403).json({ error: 'Forbidden: Push contains file changes outside the CommandLedger/approved/ directory.' });
    }

    // Check if there are actual files to ingest
    if (filesToIngest.length === 0) {
        return res.status(200).json({ status: 'ignored', reason: 'No command files detected in this push.' });
    }

    // 5. Write webhook receipt (Dry-Run / No execution)
    const receiptData = {
        delivery_id: deliveryId,
        timestamp: new Date().toISOString(),
        branch: TARGET_BRANCH,
        ingested_files: filesToIngest,
        status: 'received_and_verified'
    };

    if (useRemote) {
        try {
            const receiptPath = `CommandLedger/receipts/webhook_${deliveryId}_receipt.json`;
            await githubClient.putFileContent(
                receiptPath,
                JSON.stringify(receiptData, null, 2),
                `Write webhook receipt for delivery ${deliveryId}`
            );
        } catch (e) {
            console.error(`Failed to write webhook receipt to repository: ${e.message}`);
        }
    }

    console.log(`Verified push containing ${filesToIngest.length} command file(s). Delivery ID: ${deliveryId}`);

    return res.status(200).json({
        status: 'queued',
        delivery_id: deliveryId,
        ingested_files: filesToIngest
    });
}

module.exports = async (req, res) => {
    const token = githubClient.getGitHubToken();
    const useRemote = !!token;

    // Express-like mock functions if not present
    if (!res.status) {
        res.status = (code) => {
            res.statusCode = code;
            return res;
        };
    }
    if (!res.json) {
        res.json = (data) => {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(data));
            return res;
        };
    }

    try {
        await handleWebhook(req, res, useRemote);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal Server Error', message: err.message });
    }
};

module.exports.handleWebhook = handleWebhook;
module.exports.clearProcessedDeliveries = () => processedDeliveries.clear();
