const fs = require('fs');
const path = require('path');
const { validateCommand } = require('./validate-command');

function runGithubLedgerWorkerDryRun() {
    console.log("[GitHub Ledger Worker Dry-Run] Starting worker sweep...");

    const globalAgentBrainRoot = path.join('C:', 'Users', 'tauru', '.gemini', 'antigravity', 'scratch', 'global-agent-brain');
    const approvedDir = path.join(globalAgentBrainRoot, 'CommandLedger', 'approved');
    const inProgressDir = path.join(globalAgentBrainRoot, 'CommandLedger', 'in_progress');
    const receiptsDir = path.join(globalAgentBrainRoot, 'CommandLedger', 'receipts');
    const noncesDir = path.join(globalAgentBrainRoot, 'CommandLedger', 'processed_nonces');

    fs.mkdirSync(inProgressDir, { recursive: true });
    fs.mkdirSync(receiptsDir, { recursive: true });
    fs.mkdirSync(noncesDir, { recursive: true });

    if (!fs.existsSync(approvedDir)) {
        console.log("[GitHub Ledger Worker Dry-Run] Approved directory does not exist in ledger repo. Halting.");
        return;
    }

    const files = fs.readdirSync(approvedDir).filter(f => f.endsWith('.json'));
    if (files.length === 0) {
        console.log("[GitHub Ledger Worker Dry-Run] No approved commands found in ledger repo.");
        return;
    }

    for (const file of files) {
        const commandPath = path.join(approvedDir, file);
        console.log(`[GitHub Ledger Worker Dry-Run] Ingesting command file: ${file}`);

        let command;
        try {
            const content = fs.readFileSync(commandPath, 'utf-8');
            command = JSON.parse(content);
        } catch (e) {
            console.error(`[GitHub Ledger Worker Dry-Run] Failed to parse JSON: ${file}: ${e}`);
            continue;
        }

        // Validate command packet (with nonce reuse scanning pointed to global-agent-brain)
        const validationResult = validateCommand(command, { projectRoot: globalAgentBrainRoot });
        if (!validationResult.valid) {
            console.error(`[GitHub Ledger Worker Dry-Run] Validation failed for command: ${command.command_id}`);
            console.error(validationResult.errors);

            const blockedPath = path.join(globalAgentBrainRoot, 'CommandLedger', 'blocked', file);
            fs.mkdirSync(path.dirname(blockedPath), { recursive: true });
            fs.renameSync(commandPath, blockedPath);
            console.log(`[GitHub Ledger Worker Dry-Run] Command blocked and moved to: ${blockedPath}`);
            continue;
        }

        console.log("[GitHub Ledger Worker Dry-Run] Command validated. Moving command to in_progress/...");
        const inProgressPath = path.join(inProgressDir, file);
        fs.renameSync(commandPath, inProgressPath);

        // Dry-run execution simulation (No real execution!)
        console.log(`[GitHub Ledger Worker Dry-Run] Dry-run parsing payload: "${command.payload}" (No payload execution)`);

        // Create nonce record
        const nonceRecordPath = path.join(noncesDir, `${command.nonce}.json`);
        const nonceRecord = {
            nonce: command.nonce,
            command_id: command.command_id,
            processed_at: new Date().toISOString()
        };
        fs.writeFileSync(nonceRecordPath, JSON.stringify(nonceRecord, null, 2), 'utf-8');
        console.log(`[GitHub Ledger Worker Dry-Run] Nonce record written to: ${nonceRecordPath}`);

        // Compile standard execution receipt
        const receiptId = "REC-V2-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
        const receipt = {
            receipt_id: receiptId,
            command_id: command.command_id,
            created_at: new Date().toISOString(),
            status: "COMPLETE",
            files_created: [
                path.relative(globalAgentBrainRoot, nonceRecordPath)
            ],
            files_modified: [],
            files_deleted: [],
            secrets_printed: false,
            live_systems_touched: false,
            protected_surfaces_touched: ["CommandLedger/approved/", "CommandLedger/in_progress/", "CommandLedger/processed_nonces/"],
            summary: `Successfully parsed and recorded remote git-backed command: ${command.title}. Replay protection nonce registered.`,
            next_safe_step: "Implement push/commit workflow logic in local AG daemon loop."
        };

        const receiptOutputPath = path.join(receiptsDir, `${command.command_id}_receipt.json`);
        fs.writeFileSync(receiptOutputPath, JSON.stringify(receipt, null, 2), 'utf-8');
        console.log(`[GitHub Ledger Worker Dry-Run] Receipt written to: ${receiptOutputPath}`);

        // Generate local Telegram summary outbound string
        const telegramSummary = 
`🤖 AG Phone Bridge V2 Alert
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

        // Clean up from in_progress to receipts commands folder
        const archiveDir = path.join(receiptsDir, 'commands');
        fs.mkdirSync(archiveDir, { recursive: true });
        fs.renameSync(inProgressPath, path.join(archiveDir, file));
        console.log(`[GitHub Ledger Worker Dry-Run] Command file archived to: ${archiveDir}`);
    }

    console.log("[GitHub Ledger Worker Dry-Run] Worker sweep completed.");
}

if (require.main === module) {
    runGithubLedgerWorkerDryRun();
}
