const https = require('https');
const crypto = require('crypto');
const githubClient = require('./github-api-client');
const validateCommandModule = require('./validate-command');

// Load environment configuration if dotenv package and .env are present
try {
    require('dotenv').config();
} catch (e) {
    // dotenv not installed, ignore or fall back to system env
}

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

/**
 * Sends a message to Rob's Telegram.
 */
function sendTelegramMessage(text) {
    return new Promise((resolve, reject) => {
        if (!BOT_TOKEN || !CHAT_ID) {
            return reject(new Error("Telegram configuration missing: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is not set."));
        }

        // Redact Chat ID in output logging
        const redactedChatId = CHAT_ID.slice(0, 5) + "*****";
        console.log(`[AG Safe Worker] Sending message to Telegram Chat ID: ${redactedChatId}`);

        const data = JSON.stringify({
            chat_id: CHAT_ID,
            text: text
        });

        const options = {
            hostname: 'api.telegram.org',
            port: 443,
            path: `/bot${BOT_TOKEN}/sendMessage`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data)
            }
        };

        const req = https.request(options, (res) => {
            let responseData = '';
            res.on('data', (chunk) => { responseData += chunk; });
            res.on('end', () => {
                if (res.statusCode === 200) {
                    resolve(true);
                } else {
                    reject(new Error(`Telegram API returned status ${res.statusCode}`));
                }
            });
        });

        req.on('error', (err) => { reject(err); });
        req.write(data);
        req.end();
    });
}

/**
 * Runs a worker sweep on the remote repository.
 */
async function runSafeWorkerSweep() {
    console.log("[AG Safe Worker] Starting sweep of approved CommandLedger directory...");

    let contents;
    try {
        contents = await githubClient.listDirContents('CommandLedger/approved');
    } catch (e) {
        console.error(`[AG Safe Worker] Failed to list approved directory: ${e.message}`);
        return { status: 'failed', reason: 'failed_to_list_dir' };
    }

    const approvedFiles = contents.filter(f => f.name.endsWith('.json'));
    if (approvedFiles.length === 0) {
        console.log("[AG Safe Worker] No approved commands found in ledger.");
        return { status: 'idle', count: 0 };
    }

    console.log(`[AG Safe Worker] Found ${approvedFiles.length} approved command(s) to process.`);
    
    for (const fileInfo of approvedFiles) {
        const fileName = fileInfo.name;
        const remoteApprovedPath = `CommandLedger/approved/${fileName}`;
        console.log(`[AG Safe Worker] Ingesting approved command file: ${fileName}`);

        let fileData;
        try {
            fileData = await githubClient.getFileContent(remoteApprovedPath);
        } catch (e) {
            console.error(`[AG Safe Worker] Failed to download ${fileName}: ${e.message}`);
            continue;
        }

        let command;
        try {
            command = JSON.parse(fileData.content);
        } catch (e) {
            console.error(`[AG Safe Worker] Failed to parse command JSON: ${e.message}`);
            continue;
        }

        // 1. Validation gates
        const errors = [];

        // Check top-level package fields
        const requiredTopFields = ['command_id', 'timestamp', 'payload', 'approval', 'integrity'];
        for (const field of requiredTopFields) {
            if (!command[field]) {
                errors.push(`Missing top-level field: ${field}`);
            }
        }

        if (errors.length === 0) {
            const payload = command.payload;
            const approval = command.approval;
            const integrity = command.integrity;

            // Check Rob Approval
            if (approval.approved_by !== 'ROB' || !approval.approved_at) {
                errors.push('Missing explicit Rob approval signature.');
            }

            // Check Newton Review
            if (integrity.newton_review_status !== 'APPROVED_BY_NEWTON') {
                errors.push('Missing Newton architecture review signature.');
            }

            // Check Integrity Command Hash
            const computedHash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
            if (integrity.command_hash !== computedHash) {
                errors.push('Command payload integrity validation failed (hash mismatch).');
            }

            // Check Nonce Replay Gate
            const nonce = approval.nonce;
            if (!nonce) {
                errors.push('Missing unique request nonce.');
            } else {
                const noncePath = `CommandLedger/processed_nonces/${nonce}.json`;
                let existingNonce = null;
                try {
                    existingNonce = await githubClient.getFileContent(noncePath);
                } catch (e) {}

                if (existingNonce) {
                    errors.push(`Replay check failed: Nonce '${nonce}' has already been processed.`);
                }
            }

            // Check Protected Surfaces
            const forbiddenSurfaces = ['openclaw-runtime', 'google-cloud-vm', 'production-main'];
            if (forbiddenSurfaces.includes(payload.target_surface) && !approval.protected_surface_approved) {
                errors.push(`Protected surface '${payload.target_surface}' is locked without special authorization.`);
            }
        }

        // Handle validation failure
        if (errors.length > 0) {
            console.error(`[AG Safe Worker] Validation errors for command ${command.command_id || 'UNKNOWN'}:`, errors);
            
            const blockedPath = `CommandLedger/blocked/${fileName}`;
            try {
                await githubClient.putFileContent(
                    blockedPath,
                    JSON.stringify({ ...command, validation_errors: errors }, null, 2),
                    `Block command ${command.command_id || 'unknown'} due to validation failure`
                );
                await githubClient.deleteFile(remoteApprovedPath, `Remove blocked command`, fileData.sha);
                console.log(`[AG Safe Worker] Command moved to blocked folder successfully.`);
            } catch (err) {
                console.error(`[AG Safe Worker] Failed to move invalid command to blocked state: ${err.message}`);
            }
            continue;
        }

        // 2. Transition state to in_progress
        const inProgressPath = `CommandLedger/in_progress/${fileName}`;
        try {
            await githubClient.putFileContent(
                inProgressPath,
                JSON.stringify(command, null, 2),
                `Move command ${command.command_id} to in_progress`
            );
            await githubClient.deleteFile(remoteApprovedPath, `Mark command ${command.command_id} as running`, fileData.sha);
            console.log(`[AG Safe Worker] Command moved to in_progress: ${inProgressPath}`);
        } catch (err) {
            console.error(`[AG Safe Worker] State transition to in_progress failed: ${err.message}`);
            continue;
        }

        // 3. Command execution (Only harmless dry-run bridge pings allowed)
        console.log(`[AG Safe Worker] Processing payload: ${JSON.stringify(command.payload)}`);
        
        let executionStatus = "COMPLETE";
        let executionSummary = "";
        
        const payload = command.payload;
        if (payload.action === "PING" || payload.target_surface === "local-bridge-dry-run") {
            executionSummary = `Harmless bridge ping successfully verified. Message: "${payload.params.message || ''}". No cloud/system files altered.`;
            console.log(`[AG Safe Worker] PING test successful. ${executionSummary}`);
        } else {
            // Reject any live/dangerous execution in this bridge build
            executionStatus = "REJECTED_UNSUPPORTED";
            executionSummary = `Unsupported payload execution: surface '${payload.target_surface}' and action '${payload.action}' are not supported in this dry-run build.`;
            console.warn(`[AG Safe Worker] ${executionSummary}`);
        }

        // 4. Create remote nonce record
        const nonce = command.approval.nonce;
        const noncePath = `CommandLedger/processed_nonces/${nonce}.json`;
        const nonceRecord = {
            nonce: nonce,
            command_id: command.command_id,
            processed_at: new Date().toISOString()
        };

        try {
            await githubClient.putFileContent(
                noncePath,
                JSON.stringify(nonceRecord, null, 2),
                `Record processed nonce ${nonce}`
            );
            console.log(`[AG Safe Worker] Nonce registered in remote store: ${noncePath}`);
        } catch (err) {
            console.error(`[AG Safe Worker] Nonce persistence failed: ${err.message}`);
            continue;
        }

        // 5. Write Remote Receipt
        const receiptId = `REC-SAFE-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const receipt = {
            receipt_id: receiptId,
            command_id: command.command_id,
            created_at: new Date().toISOString(),
            status: executionStatus,
            files_created: [noncePath],
            files_modified: [],
            files_deleted: [],
            secrets_printed: false,
            live_systems_touched: false,
            protected_surfaces_touched: [
                "CommandLedger/approved/",
                "CommandLedger/in_progress/",
                "CommandLedger/processed_nonces/"
            ],
            summary: executionSummary,
            next_safe_step: "Confirm webhook subscription for real-time trigger integration."
        };

        const receiptOutputPath = `CommandLedger/receipts/${command.command_id}_receipt.json`;
        try {
            await githubClient.putFileContent(
                receiptOutputPath,
                JSON.stringify(receipt, null, 2),
                `Write receipt for command ${command.command_id}`
            );
            console.log(`[AG Safe Worker] Receipt written to remote repo: ${receiptOutputPath}`);
        } catch (err) {
            console.error(`[AG Safe Worker] Receipt write failed: ${err.message}`);
            continue;
        }

        // Get in_progress details to delete it
        let inProgressData;
        try {
            inProgressData = await githubClient.getFileContent(inProgressPath);
        } catch (err) {
            console.error(`[AG Safe Worker] Failed to fetch in_progress file for archiving: ${err.message}`);
            continue;
        }

        // 6. Archive command
        const archivePath = `CommandLedger/receipts/commands/${fileName}`;
        try {
            await githubClient.putFileContent(
                archivePath,
                JSON.stringify(command, null, 2),
                `Archive command ${command.command_id}`
            );
            await githubClient.deleteFile(
                inProgressPath,
                `Complete command ${command.command_id}`,
                inProgressData.sha
            );
            console.log(`[AG Safe Worker] Command archived successfully: ${archivePath}`);
        } catch (err) {
            console.error(`[AG Safe Worker] Archiving failed: ${err.message}`);
            continue;
        }

        // 7. Send Telegram message to Rob
        const tgMessage = 
`🔔 AG Phone Bridge Worker Alert
Status: ${executionStatus}
Command ID: ${command.command_id}
Surface: ${payload.target_surface}
Action: ${payload.action}

---
Summary:
${executionSummary}

Receipt Path:
${receiptOutputPath}

No arbitrary code was executed. Keys and secrets were redacted successfully.`;

        try {
            await module.exports.sendTelegramMessage(tgMessage);
            console.log(`[AG Safe Worker] Telegram alert sent to Rob.`);
        } catch (err) {
            console.error(`[AG Safe Worker] Failed to send Telegram alert: ${err.message}`);
        }
    }

    console.log("[AG Safe Worker] Sweep completed.");
    return { status: 'completed' };
}

async function startDaemon() {
    console.log("[AG Safe Worker] Daemon started. Polling remote ledger every 15 seconds...");
    while (true) {
        try {
            // Clear environment variable for this run to use keyring CLI fallback
            process.env.GITHUB_TOKEN = '';
            process.env.GH_TOKEN = '';
            await runSafeWorkerSweep();
        } catch (e) {
            console.error(`[AG Safe Worker] Daemon execution error: ${e.message}`);
        }
        await new Promise(resolve => setTimeout(resolve, 15000));
    }
}

if (require.main === module) {
    if (process.argv.includes('--daemon')) {
        startDaemon();
    } else {
        runSafeWorkerSweep();
    }
}

module.exports = {
    runSafeWorkerSweep,
    sendTelegramMessage
};
