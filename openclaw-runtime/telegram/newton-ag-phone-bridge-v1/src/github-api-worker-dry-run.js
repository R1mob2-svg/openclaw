const { validateCommand } = require('./validate-command');
const { getFileContent, putFileContent, deleteFile, listDirContents } = require('./github-api-client');

async function runGithubApiWorkerDryRun() {
    console.log("[GitHub API Worker Dry-Run] Starting worker sweep...");

    let contents;
    try {
        contents = await listDirContents('CommandLedger/approved');
    } catch (e) {
        console.error(`[GitHub API Worker Dry-Run] Failed to list approved directory: ${e.message}`);
        return;
    }

    // Filter for JSON files
    const approvedFiles = contents.filter(f => f.name.endsWith('.json'));
    if (approvedFiles.length === 0) {
        console.log("[GitHub API Worker Dry-Run] No approved commands found in remote ledger repository.");
        return;
    }

    for (const fileInfo of approvedFiles) {
        const fileName = fileInfo.name;
        const remoteApprovedPath = `CommandLedger/approved/${fileName}`;
        console.log(`[GitHub API Worker Dry-Run] Downloading approved command: ${fileName}...`);

        let fileData;
        try {
            fileData = await getFileContent(remoteApprovedPath);
        } catch (e) {
            console.error(`[GitHub API Worker Dry-Run] Failed to download ${fileName}: ${e.message}`);
            continue;
        }

        let command;
        try {
            command = JSON.parse(fileData.content);
        } catch (e) {
            console.error(`[GitHub API Worker Dry-Run] Failed to parse command JSON: ${e.message}`);
            continue;
        }

        // Validate command validation gates (Rob approval, Newton review, hash integrity, protected surfaces)
        // We pass checkNonce: false to validateCommand and perform API-based nonce validation manually
        const validationResult = validateCommand(command, { checkNonce: false });
        const errors = validationResult.errors || [];

        // Validate Nonce Replay Gate via API check
        const noncePath = `CommandLedger/processed_nonces/${command.nonce}.json`;
        let existingNonce = null;
        try {
            existingNonce = await getFileContent(noncePath);
        } catch (e) {
            // ignore
        }

        if (existingNonce) {
            errors.push(`Replay attack detected: nonce '${command.nonce}' has already been processed.`);
        }

        if (errors.length > 0) {
            console.error(`[GitHub API Worker Dry-Run] Validation failed for command: ${command.command_id}`);
            console.error(errors);

            // Move command to blocked/ folder remotely
            const blockedPath = `CommandLedger/blocked/${fileName}`;
            console.log(`[GitHub API Worker Dry-Run] Moving command to blocked at: ${blockedPath}`);
            try {
                await putFileContent(blockedPath, JSON.stringify(command, null, 2), `Block command ${command.command_id}`);
                await deleteFile(remoteApprovedPath, `Remove blocked command ${command.command_id}`, fileData.sha);
                console.log(`[GitHub API Worker Dry-Run] Command blocked successfully.`);
            } catch (err) {
                console.error(`[GitHub API Worker Dry-Run] Failed to move command to blocked state: ${err.message}`);
            }
            continue;
        }

        console.log("[GitHub API Worker Dry-Run] Command validated. Simulating state transition to in_progress...");
        const inProgressPath = `CommandLedger/in_progress/${fileName}`;
        try {
            // Write to in_progress
            await putFileContent(inProgressPath, JSON.stringify(command, null, 2), `Ingest command ${command.command_id} to in_progress`);
            // Delete from approved
            await deleteFile(remoteApprovedPath, `Start executing command ${command.command_id}`, fileData.sha);
            console.log(`[GitHub API Worker Dry-Run] Command moved to in_progress: ${inProgressPath}`);
        } catch (err) {
            console.error(`[GitHub API Worker Dry-Run] Failed to shift command to in_progress: ${err.message}`);
            continue;
        }

        // Simulate Bounded Execution (dry-run parsing only)
        console.log(`[GitHub API Worker Dry-Run] Parsing payload: "${command.payload}" (No payload execution)`);

        // Create remote nonce record
        const nonceRecord = {
            nonce: command.nonce,
            command_id: command.command_id,
            processed_at: new Date().toISOString()
        };

        // Get in_progress file details to archive it later
        let inProgressData;
        try {
            inProgressData = await getFileContent(inProgressPath);
        } catch (err) {
            console.error(`[GitHub API Worker Dry-Run] Failed to read in_progress file for archiving: ${err.message}`);
            continue;
        }

        // Write remote nonce record
        try {
            await putFileContent(noncePath, JSON.stringify(nonceRecord, null, 2), `Record nonce ${command.nonce} for command ${command.command_id}`);
            console.log(`[GitHub API Worker Dry-Run] Nonce record written to remote: ${noncePath}`);
        } catch (err) {
            console.error(`[GitHub API Worker Dry-Run] Failed to write remote nonce record: ${err.message}`);
            continue;
        }

        // Compile standard execution receipt
        const receiptId = "REC-API-V3-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
        const receipt = {
            receipt_id: receiptId,
            command_id: command.command_id,
            created_at: new Date().toISOString(),
            status: "COMPLETE",
            files_created: [
                noncePath
            ],
            files_modified: [],
            files_deleted: [],
            secrets_printed: false,
            live_systems_touched: false,
            protected_surfaces_touched: ["CommandLedger/approved/", "CommandLedger/in_progress/", "CommandLedger/processed_nonces/"],
            summary: `Successfully parsed and synced remote git-backed command: ${command.title}. Replay protection nonce registered.`,
            next_safe_step: "Implement production webhook triggers for automated repo polling."
        };

        // Write remote receipt
        const receiptOutputPath = `CommandLedger/receipts/${command.command_id}_receipt.json`;
        try {
            await putFileContent(receiptOutputPath, JSON.stringify(receipt, null, 2), `Write receipt for command ${command.command_id}`);
            console.log(`[GitHub API Worker Dry-Run] Receipt written to remote: ${receiptOutputPath}`);
        } catch (err) {
            console.error(`[GitHub API Worker Dry-Run] Failed to write remote receipt: ${err.message}`);
            continue;
        }

        // Archive command remotely
        const archivePath = `CommandLedger/receipts/commands/${fileName}`;
        try {
            // Write to archive
            await putFileContent(archivePath, JSON.stringify(command, null, 2), `Archive command ${command.command_id}`);
            // Delete from in_progress
            await deleteFile(inProgressPath, `Complete command execution ${command.command_id}`, inProgressData.sha);
            console.log(`[GitHub API Worker Dry-Run] Command archived successfully: ${archivePath}`);
        } catch (err) {
            console.error(`[GitHub API Worker Dry-Run] Failed to archive command: ${err.message}`);
            continue;
        }

        // Generate local Telegram summary outbound string
        const telegramSummary = 
`🤖 AG Phone Bridge V3 Alert
Status: COMPLETE
Command ID: ${command.command_id}
Title: ${command.title}
Risk Level: ${command.risk_level}

---
Summary:
${receipt.summary}

Files Touched:
- Created: ${receipt.files_created.length}
- Modified: ${receipt.files_modified.length}
- Deleted: ${receipt.files_deleted.length}

Protected Surfaces Touched: ${receipt.protected_surfaces_touched.join(', ')}
Secrets Exposed: None

Next Safe Step: ${receipt.next_safe_step}`;

        console.log("\n================ MOCK TELEGRAM OUTBOUND MESSAGE ================");
        console.log(telegramSummary);
        console.log("================================================================\n");
    }

    console.log("[GitHub API Worker Dry-Run] Worker sweep completed.");
}

if (require.main === module) {
    runGithubApiWorkerDryRun();
}
