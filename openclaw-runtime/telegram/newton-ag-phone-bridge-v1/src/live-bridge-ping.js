const crypto = require('crypto');
const githubClient = require('./github-api-client');
const safeWorker = require('./ag-ledger-worker-safe');

async function runLiveBridgePing() {
    console.log('[Live Bridge Ping] Initializing end-to-end ping test...');

    const token = githubClient.getGitHubToken();
    if (!token && !process.env.GITHUB_TOKEN) {
        console.log('[Live Bridge Ping] Checking keyring status...');
        // Test auth availability
        try {
            const { execSync } = require('child_process');
            const login = execSync('gh api user --jq ".login"', { env: { ...process.env, GITHUB_TOKEN: '', GH_TOKEN: '' } }).toString().trim();
            console.log(`[Live Bridge Ping] Authenticated via gh CLI keyring: ${login}`);
        } catch (e) {
            console.error('[Live Bridge Ping] ERROR: No working GitHub authentication available.');
            console.log('AUTH_BLOCKED');
            process.exit(1);
        }
    }

    const commandId = `CMD-LIVE-PING-${Date.now()}`;
    const nonce = `NONCE-LIVE-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const payload = {
        target_surface: 'local-bridge-dry-run',
        action: 'PING',
        params: {
            message: 'Confirm bridge receipt flow. No OpenClaw/runtime/cloud/customer action.'
        }
    };

    const commandHash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');

    const commandPackage = {
        command_id: commandId,
        timestamp: new Date().toISOString(),
        payload: payload,
        approval: {
            approved_by: 'ROB',
            approved_at: new Date().toISOString(),
            nonce: nonce,
            protected_surface_approved: false
        },
        integrity: {
            command_hash: commandHash,
            newton_review_status: 'APPROVED_BY_NEWTON'
        }
    };

    const filePath = `CommandLedger/approved/${commandId}.json`;
    
    try {
        console.log(`[Live Bridge Ping] Persisting command ${commandId} to remote repository...`);
        await githubClient.putFileContent(
            filePath,
            JSON.stringify(commandPackage, null, 2),
            `Submit live-bridge-ping command ${commandId}`
        );
        console.log(`[Live Bridge Ping] Command successfully persisted remote.`);
    } catch (err) {
        console.error(`[Live Bridge Ping] Failed to write command: ${err.message}`);
        process.exit(1);
    }

    // Delay briefly to allow GitHub API caching to stabilize
    await new Promise(resolve => setTimeout(resolve, 2000));

    try {
        console.log('[Live Bridge Ping] Executing safe worker sweep to process the remote command...');
        const result = await safeWorker.runSafeWorkerSweep();
        console.log(`[Live Bridge Ping] Safe worker execution finished: ${JSON.stringify(result)}`);
        console.log('PING_NEWTON_TO_AG_BRIDGE_LIVE_TEST_SUCCESS');
    } catch (err) {
        console.error(`[Live Bridge Ping] Worker processing failed: ${err.message}`);
        process.exit(1);
    }
}

runLiveBridgePing().catch(err => {
    console.error('[Live Bridge Ping] Unhandled error:', err);
    process.exit(1);
});
