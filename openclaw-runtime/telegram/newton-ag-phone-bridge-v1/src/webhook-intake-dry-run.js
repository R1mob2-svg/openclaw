const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { verifySignature } = require('./webhook-signature');

const DELIVERIES_DIR = path.join(__dirname, '..', 'CommandLedger', 'webhook_deliveries');
const RECEIPTS_DIR = path.join(__dirname, '..', 'CommandLedger', 'webhook_receipts');
const TARGET_BRANCH = 'newton-ag-bridge-v2-ledger-dry-run';
const TARGET_PATH_PREFIX = 'CommandLedger/approved/';

// Ensure directories exist
if (!fs.existsSync(DELIVERIES_DIR)) fs.mkdirSync(DELIVERIES_DIR, { recursive: true });
if (!fs.existsSync(RECEIPTS_DIR)) fs.mkdirSync(RECEIPTS_DIR, { recursive: true });

/**
 * Main webhook processor.
 * Returns an object indicating success or rejection reason.
 */
function processWebhook(headers, rawBody, secret) {
    const deliveryId = headers['x-github-delivery'];
    const signature = headers['x-hub-signature-256'];
    
    // 1. Fail closed on missing delivery ID
    if (!deliveryId) {
        return { statusCode: 400, success: false, reason: "Missing X-GitHub-Delivery header." };
    }

    // 2. Fail closed on missing signature
    if (!signature) {
        return { statusCode: 401, success: false, reason: "Missing signature header." };
    }

    // 3. Fail closed on invalid signature
    if (!verifySignature(rawBody, signature, secret)) {
        return { statusCode: 401, success: false, reason: "Invalid HMAC signature." };
    }

    // 4. Reject replayed delivery ID
    const deliveryFile = path.join(DELIVERIES_DIR, `${deliveryId}.json`);
    if (fs.existsSync(deliveryFile)) {
        return { statusCode: 409, success: false, reason: `Replay detected: delivery ID '${deliveryId}' has already been processed.` };
    }

    // Parse payload
    let payload;
    try {
        payload = JSON.parse(rawBody);
    } catch (e) {
        return { statusCode: 400, success: false, reason: "Invalid request payload format." };
    }

    // 5. Accept only target branch
    // GitHub pushes send ref like "refs/heads/branch-name"
    const ref = payload.ref || '';
    const expectedRef = `refs/heads/${TARGET_BRANCH}`;
    if (ref !== expectedRef) {
        return { statusCode: 400, success: false, reason: `Ignored branch: '${ref}'. Target branch is '${expectedRef}'.` };
    }

    // 6. Validate path under CommandLedger/approved/
    // Checks all added/modified files in commits
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
        // Safe check: log warning but still queue valid files, or reject?
        // Prompt says: "reject wrong path" - meaning reject if commits contain files outside path
        return { statusCode: 403, success: false, reason: "Forbidden: Commit contains file modifications outside target directory path." };
    }

    if (filesToIngest.length === 0) {
        return { statusCode: 200, success: true, reason: "No relevant files updated under target path prefix.", files: [] };
    }

    // Save delivery ID record for replay prevention
    const deliveryRecord = {
        delivery_id: deliveryId,
        processed_at: new Date().toISOString(),
        files: filesToIngest
    };
    fs.writeFileSync(deliveryFile, JSON.stringify(deliveryRecord, null, 2));

    // Save webhook receipt
    const receiptId = `WREC-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const webhookReceipt = {
        webhook_receipt_id: receiptId,
        delivery_id: deliveryId,
        received_at: new Date().toISOString(),
        status: "QUEUED",
        ingested_files: filesToIngest,
        summary: `Webhook delivery processed and validated. Ingested ${filesToIngest.length} command file(s).`,
        next_safe_step: "Poll the approved directory in AG worker loop to execute."
    };
    
    const receiptFile = path.join(RECEIPTS_DIR, `${deliveryId}_receipt.json`);
    fs.writeFileSync(receiptFile, JSON.stringify(webhookReceipt, null, 2));

    return {
        statusCode: 200,
        success: true,
        receipt: webhookReceipt
    };
}

// Dry-run execution demonstration
if (require.main === module) {
    console.log("[Webhook Intake Dry-Run] Starting mock webhook simulation...");
    const secret = "webhook_secret_key_123456";
    const deliveryId = "7a5b3c2e-" + crypto.randomBytes(4).toString('hex') + "-abcd-ef0123456789";

    const mockPayload = {
        ref: "refs/heads/newton-ag-bridge-v2-ledger-dry-run",
        commits: [
            {
                id: "mock_commit_1",
                added: ["CommandLedger/approved/CMD-1781465608091-54.json"],
                modified: []
            }
        ]
    };

    const rawBody = JSON.stringify(mockPayload);
    const signature = "sha256=" + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

    const headers = {
        'x-github-delivery': deliveryId,
        'x-hub-signature-256': signature
    };

    console.log(`[Webhook Intake Dry-Run] Delivery ID: ${deliveryId}`);
    console.log(`[Webhook Intake Dry-Run] Signature: ${signature}`);

    const result = processWebhook(headers, rawBody, secret);
    console.log("[Webhook Intake Dry-Run] Result:", JSON.stringify(result, null, 2));
}

module.exports = { processWebhook };
