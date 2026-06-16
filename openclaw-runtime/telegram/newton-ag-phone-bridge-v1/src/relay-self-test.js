const assert = require('assert');
const crypto = require('crypto');
const relayAuth = require('./relay-auth');
const replayStore = require('./relay-replay-store');
const newtonHandler = require('./vercel-newton-command-handler');
const webhookHandler = require('./vercel-webhook-handler');

// Helper Mock Request & Response objects
function createMockRequest(method, headers, body) {
    return {
        method: method,
        headers: headers || {},
        body: body || {}
    };
}

function createMockResponse() {
    const res = {
        statusCode: 200,
        headers: {},
        body: null,
        setHeader: (name, value) => { res.headers[name] = value; },
        status: (code) => { res.statusCode = code; return res; },
        json: (data) => { res.body = data; return res; }
    };
    return res;
}

async function runSelfTests() {
    console.log('[Relay Self-Test] Starting tests...');

    // Test 1: Reject unauthorized Newton Command
    {
        const req = createMockRequest('POST', {}, { command_id: '123' });
        const res = createMockResponse();
        await newtonHandler.handleNewtonCommand(req, res, false);
        assert.strictEqual(res.statusCode, 401, 'Should block unauthorized command request');
        console.log('✅ PASS: Unauthorized request blocked with 401');
    }

    // Test 2: Accept valid authenticated Newton Command
    const testNonce = `nonce_test_${Date.now()}`;
    const testCommandId = `CMD-TEST-${Date.now()}`;
    const validPayload = {
        target_surface: 'local-bridge-dry-run',
        action: 'PING',
        params: { message: 'Hello' }
    };
    const validHash = crypto.createHash('sha256').update(JSON.stringify(validPayload)).digest('hex');
    const validCommandPackage = {
        command_id: testCommandId,
        timestamp: new Date().toISOString(),
        payload: validPayload,
        approval: {
            approved_by: 'ROB',
            approved_at: new Date().toISOString(),
            nonce: testNonce,
            protected_surface_approved: false
        },
        integrity: {
            command_hash: validHash,
            newton_review_status: 'APPROVED_BY_NEWTON'
        }
    };

    {
        const req = createMockRequest(
            'POST',
            { 'authorization': `Bearer ${relayAuth.RELAY_AUTH_TOKEN}` },
            validCommandPackage
        );
        const res = createMockResponse();
        await newtonHandler.handleNewtonCommand(req, res, false);
        assert.strictEqual(res.statusCode, 200, 'Should accept valid command request');
        assert.strictEqual(res.body.status, 'queued', 'Response body status should be queued');
        assert.strictEqual(res.body.dry_run, true, 'Dry run flag should be true');
        console.log('✅ PASS: Valid command accepted and queued');
    }

    // Test 3: Reject replayed nonce
    {
        const req = createMockRequest(
            'POST',
            { 'authorization': `Bearer ${relayAuth.RELAY_AUTH_TOKEN}` },
            validCommandPackage
        );
        const res = createMockResponse();
        await newtonHandler.handleNewtonCommand(req, res, false);
        assert.strictEqual(res.statusCode, 403, 'Should reject replayed nonce');
        assert.strictEqual(res.body.error.includes('replay'), true, 'Error message should mention replay');
        console.log('✅ PASS: Replay attack blocked with 403');
    }

    // Test 4: Reject protected surface command without explicit authorization
    {
        replayStore.clearLocalNonceCache();
        const protectedPayload = {
            target_surface: 'openclaw-runtime',
            action: 'RESTART',
            params: {}
        };
        const protectedHash = crypto.createHash('sha256').update(JSON.stringify(protectedPayload)).digest('hex');
        const protectedPackage = {
            command_id: `CMD-PROTECTED-${Date.now()}`,
            timestamp: new Date().toISOString(),
            payload: protectedPayload,
            approval: {
                approved_by: 'ROB',
                approved_at: new Date().toISOString(),
                nonce: `nonce_prot_${Date.now()}`,
                protected_surface_approved: false
            },
            integrity: {
                command_hash: protectedHash,
                newton_review_status: 'APPROVED_BY_NEWTON'
            }
        };

        const req = createMockRequest(
            'POST',
            { 'authorization': `Bearer ${relayAuth.RELAY_AUTH_TOKEN}` },
            protectedPackage
        );
        const res = createMockResponse();
        await newtonHandler.handleNewtonCommand(req, res, false);
        assert.strictEqual(res.statusCode, 403, 'Should reject unauthorized protected surface');
        assert.strictEqual(res.body.error.includes('Touch of protected surface'), true, 'Error message should mention protected surface');
        console.log('✅ PASS: Touch of protected surface without approval blocked with 403');
    }

    // Test 5: Webhook signature verification failure
    {
        const webhookPayload = { ref: 'refs/heads/newton-ag-bridge-v2-ledger-dry-run', commits: [] };
        const req = createMockRequest(
            'POST',
            {
                'x-github-delivery': `delivery_fail_${Date.now()}`,
                'x-hub-signature-256': 'sha256=invalidsignaturehere'
            },
            webhookPayload
        );
        const res = createMockResponse();
        await webhookHandler.handleWebhook(req, res, false);
        assert.strictEqual(res.statusCode, 401, 'Should fail webhook signature verification');
        console.log('✅ PASS: Webhook invalid signature blocked with 401');
    }

    // Test 6: Valid webhook parsing & path validation
    {
        webhookHandler.clearProcessedDeliveries();
        const webhookPayload = {
            ref: 'refs/heads/newton-ag-bridge-v2-ledger-dry-run',
            commits: [
                {
                    added: ['CommandLedger/approved/CMD-123.json'],
                    modified: []
                }
            ]
        };
        const rawBody = JSON.stringify(webhookPayload);
        const webhookSecret = 'newton_secure_webhook_secret_dry_run_bypass';
        const signature = 'sha256=' + crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');

        const req = createMockRequest(
            'POST',
            {
                'x-github-delivery': `delivery_ok_${Date.now()}`,
                'x-hub-signature-256': signature
            },
            webhookPayload
        );
        req.body = rawBody; // Ensure raw body is populated for parser
        
        const res = createMockResponse();
        await webhookHandler.handleWebhook(req, res, false);
        assert.strictEqual(res.statusCode, 200, 'Should accept valid webhook push');
        assert.strictEqual(res.body.status, 'queued', 'Webhook status should be queued');
        console.log('✅ PASS: Webhook signature and sandbox branch push accepted');
    }

    // Test 7: Block webhook containing unauthorized file changes
    {
        webhookHandler.clearProcessedDeliveries();
        const badWebhookPayload = {
            ref: 'refs/heads/newton-ag-bridge-v2-ledger-dry-run',
            commits: [
                {
                    added: ['src/validate-command.js'], // Outside approved path!
                    modified: []
                }
            ]
        };
        const rawBody = JSON.stringify(badWebhookPayload);
        const webhookSecret = 'newton_secure_webhook_secret_dry_run_bypass';
        const signature = 'sha256=' + crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');

        const req = createMockRequest(
            'POST',
            {
                'x-github-delivery': `delivery_bad_${Date.now()}`,
                'x-hub-signature-256': signature
            },
            badWebhookPayload
        );
        req.body = rawBody;
        
        const res = createMockResponse();
        await webhookHandler.handleWebhook(req, res, false);
        assert.strictEqual(res.statusCode, 403, 'Should reject push with file changes outside approved path');
        console.log('✅ PASS: Push containing file changes outside approved path blocked with 403');
    }

    console.log('[Relay Self-Test] All tests completed successfully.');
}

runSelfTests().catch(err => {
    console.error('❌ FAIL: Relay Self-Test failed with error:', err);
    process.exit(1);
});
