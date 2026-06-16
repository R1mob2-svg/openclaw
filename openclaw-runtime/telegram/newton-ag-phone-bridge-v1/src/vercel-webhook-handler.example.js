const crypto = require('crypto');

// Webhook secret must be set as environment variable in Vercel Dashboard
const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET;
const TARGET_BRANCH = 'newton-ag-bridge-v2-ledger-dry-run';
const TARGET_PATH_PREFIX = 'CommandLedger/approved/';

/**
 * Example Vercel serverless function endpoint handler.
 * Deployed under api/webhook.js
 */
module.exports = async (req, res) => {
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

    // Capture raw body for verification
    // Vercel routes sometimes automatically parse JSON. We need the raw body.
    let rawBody = req.body;
    if (typeof rawBody !== 'string') {
        rawBody = JSON.stringify(rawBody);
    }

    // Validate Signature
    const parts = signature.split('=');
    if (parts.length !== 2 || parts[0] !== 'sha256') {
        return res.status(401).json({ error: 'Invalid signature format' });
    }
    
    const computedHex = crypto.createHmac('sha256', WEBHOOK_SECRET)
        .update(rawBody)
        .digest('hex');

    const providedBuffer = Buffer.from(parts[1], 'hex');
    const computedBuffer = Buffer.from(computedHex, 'hex');

    if (providedBuffer.length !== computedBuffer.length || !crypto.timingSafeEqual(providedBuffer, computedBuffer)) {
        return res.status(401).json({ error: 'Signature verification failed' });
    }

    // Replay Prevention & Payload Parsing
    const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    
    // Validate target branch
    const ref = payload.ref || '';
    if (ref !== `refs/heads/${TARGET_BRANCH}`) {
        return res.status(200).json({ status: 'ignored', reason: 'Ref branch does not match target sandbox branch.' });
    }

    // Validate changed files paths
    const commits = payload.commits || [];
    const filesToIngest = [];
    let hasInvalidPaths = false;

    for (const commit of commits) {
        const paths = [...(commit.added || []), ...(commit.modified || [])];
        for (const p of paths) {
            if (p.startsWith(TARGET_PATH_PREFIX)) {
                filesToIngest.push(p);
            } else {
                hasInvalidPaths = true;
            }
        }
    }

    if (hasInvalidPaths) {
        return res.status(403).json({ error: 'Forbidden: Commit contains changes outside the CommandLedger/approved/ directory.' });
    }

    if (filesToIngest.length === 0) {
        return res.status(200).json({ status: 'ignored', reason: 'No new approved command files detected in this push.' });
    }

    // At this stage, the webhook is fully validated.
    // In a live setup, the relay would forward this event to an outbound message broker or store
    // it in a secure database queue for the AG worker to poll.
    // Payloads are never executed on the public relay.
    
    console.log(`Verified push containing ${filesToIngest.length} command file(s). Delivery ID: ${deliveryId}`);

    return res.status(200).json({
        status: 'queued',
        delivery_id: deliveryId,
        ingested_files: filesToIngest
    });
};
