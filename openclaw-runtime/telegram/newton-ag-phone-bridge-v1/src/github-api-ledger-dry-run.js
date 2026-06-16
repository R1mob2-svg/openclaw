const { calculateCommandHash, validateCommand } = require('./validate-command');
const { putFileContent } = require('./github-api-client');

async function runGithubApiLedgerDryRun() {
    console.log("[GitHub API Ledger Dry-Run] Starting Newton command generation...");

    const commandId = "CMD-API-V3-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
    const nonce = "NONCE-API-V3-" + Math.floor(Math.random() * 100000000);

    const command = {
        command_id: commandId,
        created_at: new Date().toISOString(),
        created_by: "Newton/ChatGPT",
        source_channel: "Telegram Phone Lane",
        target_agent: "AG the Sentinel",
        title: "PING_AG_FROM_NEWTON_API_LEDGER_DRY_RUN",
        risk_level: 2,
        allowed_actions: ["ping", "verify_api_receipt_path"],
        forbidden_actions: ["delete", "rm", "format", "reboot", "shutdown"],
        payload: "Confirm remote API bridge receipt path. No live execution.",
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

    // Calculate hash/integrity validation
    command.command_hash = calculateCommandHash(command);

    console.log(`[GitHub API Ledger Dry-Run] Command ID: ${commandId}`);
    console.log(`[GitHub API Ledger Dry-Run] Nonce: ${nonce}`);
    console.log(`[GitHub API Ledger Dry-Run] Hash: ${command.command_hash}`);

    // Validate command prior to persistence (do not check nonce check yet during creation)
    const validationResult = validateCommand(command, { checkNonce: false });
    if (!validationResult.valid) {
        console.error("[GitHub API Ledger Dry-Run] ERROR: Command validation failed!");
        console.error(validationResult.errors);
        process.exit(1);
    }

    console.log("[GitHub API Ledger Dry-Run] Command validation PASSED. Saving to remote GitHub CommandLedger...");

    const remotePath = `CommandLedger/approved/${commandId}.json`;
    try {
        await putFileContent(remotePath, JSON.stringify(command, null, 2), `Add approved Newton command ${commandId}`);
        console.log(`[GitHub API Ledger Dry-Run] SUCCESS: Command persisted to remote path: ${remotePath}`);
    } catch (e) {
        console.error(`[GitHub API Ledger Dry-Run] ERROR: Failed to write to remote GitHub: ${e.message}`);
        process.exit(1);
    }
}

if (require.main === module) {
    runGithubApiLedgerDryRun();
}
