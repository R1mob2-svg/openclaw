const fs = require('fs');
const path = require('path');
const { calculateCommandHash, validateCommand } = require('./validate-command');

function runGithubLedgerDryRun() {
    console.log("[GitHub Ledger Dry-Run] Starting relay command generation...");

    const commandId = "CMD-V2-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
    const nonce = "NONCE-V2-" + Math.floor(Math.random() * 100000000);

    const command = {
        command_id: commandId,
        created_at: new Date().toISOString(),
        created_by: "Newton/ChatGPT",
        source_channel: "Telegram Phone Lane",
        target_agent: "AG the Sentinel",
        title: "PING_AG_FROM_NEWTON_REMOTE_LEDGER_DRY_RUN",
        risk_level: 2,
        allowed_actions: ["ping", "verify_remote_receipt_path"],
        forbidden_actions: ["delete", "rm", "format", "reboot", "shutdown"],
        payload: "Confirm remote bridge receipt path. No live execution.",
        rob_approval_status: "APPROVED",
        newton_review_status: "REVIEWED",
        nonce: nonce,
        command_hash: "",
        receipt_requirements: {
            notify_channel: "Telegram",
            retention_policy: "15d"
        },
        explicit_approvals: []
    };

    // Calculate cryptographic integrity hash (excluding command_hash itself)
    command.command_hash = calculateCommandHash(command);

    console.log(`[GitHub Ledger Dry-Run] Command ID: ${commandId}`);
    console.log(`[GitHub Ledger Dry-Run] Nonce: ${nonce}`);
    console.log(`[GitHub Ledger Dry-Run] Hash: ${command.command_hash}`);

    const globalAgentBrainRoot = path.join('C:', 'Users', 'tauru', '.gemini', 'antigravity', 'scratch', 'global-agent-brain');
    const ledgerApprovedDir = path.join(globalAgentBrainRoot, 'CommandLedger', 'approved');

    // Validate command prior to persistence
    const validationResult = validateCommand(command, { projectRoot: globalAgentBrainRoot });
    if (!validationResult.valid) {
        console.error("[GitHub Ledger Dry-Run] ERROR: Command validation failed!");
        console.error(validationResult.errors);
        process.exit(1);
    }

    console.log("[GitHub Ledger Dry-Run] Command validation PASSED. Saving to remote ledger repository...");

    fs.mkdirSync(ledgerApprovedDir, { recursive: true });
    const outputPath = path.join(ledgerApprovedDir, `${commandId}.json`);
    fs.writeFileSync(outputPath, JSON.stringify(command, null, 2), 'utf-8');

    console.log(`[GitHub Ledger Dry-Run] SUCCESS: Command persisted to ledger repo: ${outputPath}`);
}

if (require.main === module) {
    runGithubLedgerDryRun();
}
