const fs = require('fs');
const path = require('path');
const { calculateCommandHash, validateCommand } = require('./validate-command');

function runRelayDryRun() {
    console.log("[Relay Dry-Run] Starting relay generation...");

    const commandId = "CMD-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
    const nonce = "NONCE-" + Math.floor(Math.random() * 100000000);

    const command = {
        command_id: commandId,
        created_at: new Date().toISOString(),
        created_by: "Newton/ChatGPT",
        source_channel: "Telegram Phone Lane",
        target_agent: "AG the Sentinel",
        title: "PING_AG_FROM_NEWTON_DRY_RUN",
        risk_level: 2,
        allowed_actions: ["ping", "verify_receipt_path"],
        forbidden_actions: ["delete", "rm", "format", "reboot", "shutdown"],
        payload: "Confirm bridge receipt path. No live execution.",
        rob_approval_status: "APPROVED",
        newton_review_status: "REVIEWED",
        nonce: nonce,
        command_hash: "",
        receipt_requirements: {
            notify_channel: "Telegram",
            retention_policy: "15d"
        }
    };

    // Calculate cryptographic signature
    command.command_hash = calculateCommandHash(command);

    console.log(`[Relay Dry-Run] Command ID: ${commandId}`);
    console.log(`[Relay Dry-Run] Nonce: ${nonce}`);
    console.log(`[Relay Dry-Run] Hash: ${command.command_hash}`);

    // Validate command prior to persistence
    const validationResult = validateCommand(command);
    if (!validationResult.valid) {
        console.error("[Relay Dry-Run] ERROR: Command validation failed!");
        console.error(validationResult.errors);
        process.exit(1);
    }

    console.log("[Relay Dry-Run] Command validation PASSED. Saving to ledger...");

    // Save to approved ledger directory
    const approvedDir = path.join(__dirname, '..', 'CommandLedger', 'approved');
    fs.mkdirSync(approvedDir, { recursive: true });

    const outputPath = path.join(approvedDir, `${commandId}.json`);
    fs.writeFileSync(outputPath, JSON.stringify(command, null, 2), 'utf-8');

    console.log(`[Relay Dry-Run] SUCCESS: Command persisted to: ${outputPath}`);
}

if (require.main === module) {
    runRelayDryRun();
}
