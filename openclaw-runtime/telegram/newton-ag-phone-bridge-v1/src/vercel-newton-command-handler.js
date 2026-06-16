const crypto = require('crypto');
const githubClient = require('./github-api-client');
const relayAuth = require('./relay-auth');
const replayStore = require('./relay-replay-store');
const validateCommandModule = require('./validate-command'); // Uses our schema rules

/**
 * Serverless function handler for POST /api/newton-command
 */
async function handleNewtonCommand(req, res, useRemote = false) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    // 1. Validate auth token
    const authHeader = req.headers['authorization'];
    if (!relayAuth.validateAuthHeader(authHeader)) {
        return res.status(401).json({ error: 'Unauthorized: Invalid relay auth token' });
    }

    const body = req.body;
    if (!body || typeof body !== 'object') {
        return res.status(400).json({ error: 'Missing or invalid JSON body' });
    }

    // 2. Validate Command Package Structure & Schema
    const requiredTopFields = ['command_id', 'timestamp', 'payload', 'approval', 'integrity'];
    for (const field of requiredTopFields) {
        if (!body[field]) {
            return res.status(400).json({ error: `Missing required field: ${field}` });
        }
    }

    // 3. Schema checks on payload and approval
    const payload = body.payload;
    const approval = body.approval;
    const integrity = body.integrity;

    if (!payload.target_surface || !payload.action || !payload.params) {
        return res.status(400).json({ error: 'Invalid payload structure. Requires target_surface, action, params.' });
    }

    // 4. Require Rob Approval
    if (approval.approved_by !== 'ROB' || !approval.approved_at) {
        return res.status(403).json({ error: 'Forbidden: Missing Rob approval verification.' });
    }

    // 5. Require Newton Review
    if (integrity.newton_review_status !== 'APPROVED_BY_NEWTON') {
        return res.status(403).json({ error: 'Forbidden: Missing Newton architectural review verification.' });
    }

    // 6. Verify command_hash integrity
    const computedHash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    if (integrity.command_hash !== computedHash) {
        return res.status(400).json({ error: 'Integrity validation failed: Payload hash mismatch.' });
    }

    // 7. Verify Nonce / Replay Check
    const nonce = approval.nonce;
    if (!nonce) {
        return res.status(400).json({ error: 'Missing nonce.' });
    }
    const isReplayed = await replayStore.isReplayedNonce(nonce, useRemote);
    if (isReplayed) {
        return res.status(403).json({ error: 'Forbidden: Nonce replay attack detected.' });
    }

    // 8. Reject protected surfaces without explicit approval
    const forbiddenSurfaces = ['openclaw-runtime', 'google-cloud-vm', 'production-main'];
    if (forbiddenSurfaces.includes(payload.target_surface) && !approval.protected_surface_approved) {
        return res.status(403).json({ error: `Forbidden: Touch of protected surface '${payload.target_surface}' is unauthorized.` });
    }

    // 9. Write approved command to GitHub CommandLedger on sandbox branch
    const commandId = body.command_id;
    const filePath = `CommandLedger/approved/${commandId}.json`;
    
    let result;
    if (useRemote) {
        try {
            // Write to remote GitHub
            const writeResult = await githubClient.putFileContent(
                filePath,
                JSON.stringify(body, null, 2),
                `Submit approved command ${commandId} via Phone Bridge`
            );
            result = {
                status: 'queued',
                file_path: filePath,
                commit_sha: writeResult.commit.sha
            };
        } catch (e) {
            console.error(`Ledger write error: ${e.message}`);
            return res.status(500).json({ error: 'Failed to write command to remote ledger.', details: e.message });
        }
    } else {
        // Local simulation / dry-run
        // We write to memory cache only
        await replayStore.recordNonce(nonce, false);
        result = {
            status: 'queued',
            file_path: filePath,
            dry_run: true
        };
    }

    return res.status(200).json(result);
}

// Wrapper for Vercel Serverless Function entry point
module.exports = async (req, res) => {
    // Determine whether to use remote GitHub API based on config availability
    const token = githubClient.getGitHubToken();
    const useRemote = !!token;
    
    // Express-like mock res functions if not already present
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
        await handleNewtonCommand(req, res, useRemote);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal Server Error', message: err.message });
    }
};

module.exports.handleNewtonCommand = handleNewtonCommand;
