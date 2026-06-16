const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { processWebhook } = require('./webhook-intake-dry-run');

console.log("[Webhook Self-Test] Starting webhook intake safety tests...");

let failures = 0;

function assert(condition, message) {
    if (!condition) {
        console.error(`❌ FAIL: ${message}`);
        failures++;
    } else {
        console.log(`✅ PASS: ${message}`);
    }
}

const secret = "webhook_secret_key_123456";

// Helper to clean up test delivery files
const DELIVERIES_DIR = path.join(__dirname, '..', 'CommandLedger', 'webhook_deliveries');
const RECEIPTS_DIR = path.join(__dirname, '..', 'CommandLedger', 'webhook_receipts');

function cleanup(deliveryId) {
    try {
        const dFile = path.join(DELIVERIES_DIR, `${deliveryId}.json`);
        const rFile = path.join(RECEIPTS_DIR, `${deliveryId}_receipt.json`);
        if (fs.existsSync(dFile)) fs.unlinkSync(dFile);
        if (fs.existsSync(rFile)) fs.unlinkSync(rFile);
    } catch (e) {}
}

// 1. Missing signature fails closed
const deliveryId1 = "TEST-W-DEL-1";
const payload1 = JSON.stringify({ ref: "refs/heads/newton-ag-bridge-v2-ledger-dry-run", commits: [] });
const headers1 = { 'x-github-delivery': deliveryId1 };
const res1 = processWebhook(headers1, payload1, secret);
assert(res1.success === false && res1.statusCode === 401 && res1.reason.includes("Missing signature"),
    "Safety: Fails closed when signature header is missing.");

// 2. Invalid signature fails closed
const headers2 = {
    'x-github-delivery': deliveryId1,
    'x-hub-signature-256': "sha256=invalidsignaturehex1234567890"
};
const res2 = processWebhook(headers2, payload1, secret);
assert(res2.success === false && res2.statusCode === 401 && res2.reason.includes("Invalid HMAC signature"),
    "Safety: Fails closed when HMAC signature is invalid.");

// 3. Reject wrong branch
const deliveryId3 = "TEST-W-DEL-3";
const payload3 = JSON.stringify({
    ref: "refs/heads/main", // Wrong branch!
    commits: [
        { added: ["CommandLedger/approved/CMD-1.json"] }
    ]
});
const sig3 = "sha256=" + crypto.createHmac('sha256', secret).update(payload3).digest('hex');
const headers3 = {
    'x-github-delivery': deliveryId3,
    'x-hub-signature-256': sig3
};
const res3 = processWebhook(headers3, payload3, secret);
assert(res3.success === false && res3.statusCode === 400 && res3.reason.includes("Ignored branch"),
    "Safety: Rejects push webhooks from branches other than sandbox branch.");

// 4. Reject wrong paths
const deliveryId4 = "TEST-W-DEL-4";
const payload4 = JSON.stringify({
    ref: "refs/heads/newton-ag-bridge-v2-ledger-dry-run",
    commits: [
        { added: ["package.json"] } // Forbidden path!
    ]
});
const sig4 = "sha256=" + crypto.createHmac('sha256', secret).update(payload4).digest('hex');
const headers4 = {
    'x-github-delivery': deliveryId4,
    'x-hub-signature-256': sig4
};
const res4 = processWebhook(headers4, payload4, secret);
assert(res4.success === false && res4.statusCode === 403 && res4.reason.includes("outside target directory path"),
    "Safety: Rejects commits containing changes outside the approved ledger folder.");

// 5. Valid webhook ingestion succeeds
const deliveryId5 = "TEST-W-DEL-5";
const payload5 = JSON.stringify({
    ref: "refs/heads/newton-ag-bridge-v2-ledger-dry-run",
    commits: [
        { added: ["CommandLedger/approved/CMD-TEST-OK.json"] }
    ]
});
const sig5 = "sha256=" + crypto.createHmac('sha256', secret).update(payload5).digest('hex');
const headers5 = {
    'x-github-delivery': deliveryId5,
    'x-hub-signature-256': sig5
};
const res5 = processWebhook(headers5, payload5, secret);
assert(res5.success === true && res5.statusCode === 200 && res5.receipt.status === "QUEUED",
    "Functional: Ingests push webhook containing valid files on the correct branch.");

// 6. Replay prevention blocks duplicate delivery
const res6 = processWebhook(headers5, payload5, secret);
assert(res6.success === false && res6.statusCode === 409 && res6.reason.includes("Replay detected"),
    "Safety: Rejects webhook deliveries with duplicate X-GitHub-Delivery IDs.");

// Clean up test outputs
cleanup(deliveryId3);
cleanup(deliveryId4);
cleanup(deliveryId5);

console.log(`\n[Webhook Self-Test] Completed. Failures: ${failures}`);
if (failures > 0) {
    process.exit(1);
} else {
    console.log("ALL WEBHOOK SAFETY TESTS PASSED.");
    process.exit(0);
}
