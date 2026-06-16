const fs = require('fs');
const path = require('path');
const { validateCommand } = require('./validate-command');

function runSimulateAGWorker() {
    console.log("[AG Worker Simulation] Starting worker sweep...");

    const approvedDir = path.join(__dirname, '..', 'CommandLedger', 'approved');
    const inProgressDir = path.join(__dirname, '..', 'CommandLedger', 'in_progress');
    const receiptsDir = path.join(__dirname, '..', 'CommandLedger', 'receipts');

    fs.mkdirSync(inProgressDir, { recursive: true });
    fs.mkdirSync(receiptsDir, { recursive: true });

    // Read all JSON files under approved/
    if (!fs.existsSync(approvedDir)) {
        console.log("[AG Worker Simulation] Approved directory does not exist. Halting.");
        return;
    }

    const files = fs.readdirSync(approvedDir).filter(f => f.endsWith('.json'));
    if (files.length === 0) {
        console.log("[AG Worker Simulation] No approved commands found in ledger.");
        return;
    }

    for (const file of files) {
        const commandPath = path.join(approvedDir, file);
        console.log(`[AG Worker Simulation] Ingesting approved command file: ${file}`);

        // Read and parse
        let command;
        try {
            const content = fs.readFileSync(commandPath, 'utf-8');
            command = JSON.parse(content);
        } catch (e) {
            console.error(`[AG Worker Simulation] Failed to parse JSON command file: ${file}: ${e}`);
            continue;
        }

        // Validate command packet again prior to execution
        const validationResult = validateCommand(command);
        if (!validationResult.valid) {
            console.error(`[AG Worker Simulation] Validation failed for: ${command.command_id}`);
            console.error(validationResult.errors);
            
            // Move to failed/blocked ledger folder
            const blockedPath = path.join(__dirname, '..', 'CommandLedger', 'blocked', file);
            fs.mkdirSync(path.dirname(blockedPath), { recursive: true });
            fs.renameSync(commandPath, blockedPath);
            console.log(`[AG Worker Simulation] Command blocked and moved to: ${blockedPath}`);
            continue;
        }

        console.log(`[AG Worker Simulation] Command validated. Moving command to in_progress/ state...`);
        const inProgressPath = path.join(inProgressDir, file);
        fs.renameSync(commandPath, inProgressPath);

        // Simulate Bounded Execution (Dry-Run Ping only)
        console.log(`[AG Worker Simulation] Running payload: "${command.payload}"`);
        
        // Simulating the creation of a dry-run execution file locally inside the project folder
        const dryRunOutDir = path.join(__dirname, '..', 'CommandLedger', 'dry_run');
        fs.mkdirSync(dryRunOutDir, { recursive: true });
        const dummyOutput = path.join(dryRunOutDir, `${command.command_id}_run.txt`);
        fs.writeFileSync(dummyOutput, `Executed payload at ${new Date().toISOString()}\nResult: SUCCESS\n`, 'utf-8');

        // Compile standard Execution Receipt
        const receiptId = "REC-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
        const receipt = {
            receipt_id: receiptId,
            command_id: command.command_id,
            created_at: new Date().toISOString(),
            status: "COMPLETE",
            files_created: [path.relative(path.join(__dirname, '..'), dummyOutput)],
            files_modified: [],
            files_deleted: [],
            secrets_printed: false,
            live_systems_touched: false,
            protected_surfaces_touched: ["CommandLedger/approved/", "CommandLedger/in_progress/"],
            summary: `Successfully executed dry-run ping command: ${command.title}. Output file generated.`,
            next_safe_step: "Implement GitHub API connection hook for remote repository ledger synchronization."
        };

        // Write receipt file
        const receiptOutputPath = path.join(receiptsDir, `${command.command_id}_receipt.json`);
        fs.writeFileSync(receiptOutputPath, JSON.stringify(receipt, null, 2), 'utf-8');
        console.log(`[AG Worker Simulation] Receipt written to: ${receiptOutputPath}`);

        // Generate local mock Telegram Summary alert string
        const telegramSummary = 
`🤖 AG Phone Bridge Alert

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

        // Clean up from in_progress/ folder to complete lifecycle (move command to archive/receipts)
        const archiveDir = path.join(__dirname, '..', 'CommandLedger', 'receipts', 'commands');
        fs.mkdirSync(archiveDir, { recursive: true });
        fs.renameSync(inProgressPath, path.join(archiveDir, file));
        console.log(`[AG Worker Simulation] Command archived to: ${archiveDir}`);
    }

    console.log("[AG Worker Simulation] Worker sweep finished.");
}

if (require.main === module) {
    runSimulateAGWorker();
}
