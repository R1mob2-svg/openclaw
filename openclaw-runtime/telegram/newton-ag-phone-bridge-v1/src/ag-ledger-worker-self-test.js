const assert = require('assert');
const crypto = require('crypto');
const githubClient = require('./github-api-client');

// Mock githubClient methods
const originalList = githubClient.listDirContents;
const originalGet = githubClient.getFileContent;
const originalPut = githubClient.putFileContent;
const originalDelete = githubClient.deleteFile;

let mockFiles = {};
let putCalls = [];
let deleteCalls = [];

function setupMocks(filesConfig) {
    mockFiles = filesConfig;
    putCalls = [];
    deleteCalls = [];

    githubClient.listDirContents = async (dir) => {
        if (dir === 'CommandLedger/approved') {
            return Object.keys(mockFiles)
                .filter(p => p.startsWith('CommandLedger/approved/'))
                .map(p => ({ name: p.split('/').pop() }));
        }
        return [];
    };

    githubClient.getFileContent = async (filePath) => {
        if (mockFiles[filePath]) {
            return {
                content: typeof mockFiles[filePath] === 'string' ? mockFiles[filePath] : JSON.stringify(mockFiles[filePath]),
                sha: `sha_${filePath.replace(/\//g, '_')}`
            };
        }
        return null;
    };

    githubClient.putFileContent = async (filePath, content, message) => {
        putCalls.push({ filePath, content, message });
        mockFiles[filePath] = content;
        return { commit: { sha: `sha_put_${Date.now()}` } };
    };

    githubClient.deleteFile = async (filePath, message, sha) => {
        deleteCalls.push({ filePath, message, sha });
        delete mockFiles[filePath];
        return { content: null };
    };
}

function restoreMocks() {
    githubClient.listDirContents = originalList;
    githubClient.getFileContent = originalGet;
    githubClient.putFileContent = originalPut;
    githubClient.deleteFile = originalDelete;
}

const safeWorker = require('./ag-ledger-worker-safe');

async function testWorkerSweep() {
    console.log('[AG Worker Self-Test] Starting tests...');

    // Test 1: Handle empty directory
    {
        setupMocks({});
        const result = await safeWorker.runSafeWorkerSweep();
        assert.strictEqual(result.status, 'idle', 'Worker should be idle when directory is empty');
        console.log('✅ PASS: Idle sweep handled correctly');
    }

    // Test 2: Ingest and execute valid PING command
    const testCommandId = `CMD-PING-${Date.now()}`;
    const testNonce = `nonce_ping_${Date.now()}`;
    const pingPayload = {
        target_surface: 'local-bridge-dry-run',
        action: 'PING',
        params: { message: 'Harmless Live test' }
    };
    const pingHash = crypto.createHash('sha256').update(JSON.stringify(pingPayload)).digest('hex');
    const validCommand = {
        command_id: testCommandId,
        timestamp: new Date().toISOString(),
        payload: pingPayload,
        approval: {
            approved_by: 'ROB',
            approved_at: new Date().toISOString(),
            nonce: testNonce,
            protected_surface_approved: false
        },
        integrity: {
            command_hash: pingHash,
            newton_review_status: 'APPROVED_BY_NEWTON'
        }
    };

    {
        setupMocks({
            [`CommandLedger/approved/${testCommandId}.json`]: validCommand
        });

        // Mock Telegram sending to prevent API hits during self-test
        const originalSendTelegram = safeWorker.sendTelegramMessage;
        let tgSentText = null;
        safeWorker.sendTelegramMessage = async (text) => {
            tgSentText = text;
            return true;
        };

        const result = await safeWorker.runSafeWorkerSweep();
        
        safeWorker.sendTelegramMessage = originalSendTelegram;

        assert.strictEqual(result.status, 'completed', 'Worker sweep should complete');
        
        // Nonce registered
        const noncePath = `CommandLedger/processed_nonces/${testNonce}.json`;
        assert.ok(putCalls.some(c => c.filePath === noncePath), 'Should write nonce record');
        
        // Receipt created
        const receiptPath = `CommandLedger/receipts/${testCommandId}_receipt.json`;
        const receiptCall = putCalls.find(c => c.filePath === receiptPath);
        assert.ok(receiptCall, 'Should write command execution receipt');
        const receiptData = JSON.parse(receiptCall.content);
        assert.strictEqual(receiptData.status, 'COMPLETE', 'Receipt status should be COMPLETE');
        assert.ok(receiptData.summary.includes('ping'), 'Receipt summary should mention ping');
        
        // Command archived
        const archivePath = `CommandLedger/receipts/commands/${testCommandId}.json`;
        assert.ok(putCalls.some(c => c.filePath === archivePath), 'Should write to command archive');
        
        // Approved command removed
        const approvedPath = `CommandLedger/approved/${testCommandId}.json`;
        assert.ok(deleteCalls.some(c => c.filePath === approvedPath), 'Should delete approved file');
        
        // Telegram message verification
        assert.ok(tgSentText, 'Telegram message should be dispatched');
        assert.ok(tgSentText.includes('COMPLETE'), 'Telegram message should contain COMPLETE');
        
        console.log('✅ PASS: Ingestion, execution, receipts, archiving, and Telegram dispatch checked');
    }

    // Test 3: Reject invalid command to blocked/
    {
        const invalidCommand = {
            command_id: 'CMD-INVALID-999',
            timestamp: new Date().toISOString(),
            payload: { target_surface: 'google-cloud-vm', action: 'DESTROY', params: {} },
            approval: {
                approved_by: 'KERRY', // Not Rob!
                approved_at: new Date().toISOString(),
                nonce: 'nonce_bad_123',
                protected_surface_approved: false
            },
            integrity: {
                command_hash: 'badhash',
                newton_review_status: 'REJECTED_BY_NEWTON'
            }
        };

        setupMocks({
            'CommandLedger/approved/CMD-INVALID-999.json': invalidCommand
        });

        const result = await safeWorker.runSafeWorkerSweep();
        
        // Should delete file from approved
        assert.ok(deleteCalls.some(c => c.filePath === 'CommandLedger/approved/CMD-INVALID-999.json'), 'Should remove from approved');
        
        // Should write to blocked
        assert.ok(putCalls.some(c => c.filePath === 'CommandLedger/blocked/CMD-INVALID-999.json'), 'Should move to blocked');
        
        console.log('✅ PASS: Invalid command filtered and moved to blocked/');
    }

    restoreMocks();
    console.log('[AG Worker Self-Test] All tests completed successfully.');
}

testWorkerSweep().catch(err => {
    console.error('❌ FAIL: AG Worker Self-Test failed with error:', err);
    process.exit(1);
});
