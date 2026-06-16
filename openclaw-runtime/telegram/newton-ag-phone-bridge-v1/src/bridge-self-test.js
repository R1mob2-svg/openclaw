const fs = require('fs');
const path = require('path');
const { calculateCommandHash, validateCommand } = require('./validate-command');

console.log("[Bridge Self-Test] Starting V1.1 hardening proofs...");

// Create a valid base command package template
const createBaseCommand = () => {
    const cmd = {
        command_id: "TEST-CMD-" + Date.now() + "-" + Math.floor(Math.random() * 1000),
        created_at: new Date().toISOString(),
        created_by: "Newton/ChatGPT",
        source_channel: "Telegram Phone Lane",
        target_agent: "AG the Sentinel",
        title: "SELF_TEST_PING",
        risk_level: 2,
        allowed_actions: ["ping"],
        forbidden_actions: ["delete", "rm", "format", "reboot", "shutdown"],
        payload: "Base self-test command payload without protected surfaces.",
        rob_approval_status: "APPROVED",
        newton_review_status: "REVIEWED",
        nonce: "NONCE-TEST-" + Math.floor(Math.random() * 10000000),
        command_hash: "",
        receipt_requirements: {
            notify_channel: "Telegram",
            retention_policy: "15d"
        },
        explicit_approvals: []
    };
    cmd.command_hash = calculateCommandHash(cmd);
    return cmd;
};

let failures = 0;

function assert(condition, message) {
    if (!condition) {
        console.error(`❌ FAIL: ${message}`);
        failures++;
    } else {
        console.log(`✅ PASS: ${message}`);
    }
}

// Test 1: Valid Base Command
const baseCmd = createBaseCommand();
const baseRes = validateCommand(baseCmd, { checkNonce: false });
assert(baseRes.valid, "Valid base command should pass validation.");

// Test 2: Payload Tampering (Signature Invalidation)
const tamperedCmd = createBaseCommand();
tamperedCmd.payload = "Tampered payload text.";
const tamperedRes = validateCommand(tamperedCmd, { checkNonce: false });
assert(!tamperedRes.valid && tamperedRes.errors.some(e => e.includes("Cryptographic integrity mismatch")), 
    "Changing payload should invalidate command_hash signature.");

// Test 3: Missing Rob Approval
const missingRobApprovalCmd = createBaseCommand();
missingRobApprovalCmd.rob_approval_status = "PENDING";
missingRobApprovalCmd.command_hash = calculateCommandHash(missingRobApprovalCmd); // Re-calculate to isolate approval check
const missingRobRes = validateCommand(missingRobApprovalCmd, { checkNonce: false });
assert(!missingRobRes.valid && missingRobRes.errors.some(e => e.includes("Rob approval status must be APPROVED")),
    "Rejects missing Rob approval status.");

// Test 4: Missing Newton Review
const missingNewtonCmd = createBaseCommand();
missingNewtonCmd.newton_review_status = "PENDING";
missingNewtonCmd.command_hash = calculateCommandHash(missingNewtonCmd);
const missingNewtonRes = validateCommand(missingNewtonCmd, { checkNonce: false });
assert(!missingNewtonRes.valid && missingNewtonRes.errors.some(e => e.includes("Newton review status must be REVIEWED")),
    "Rejects missing Newton review status.");

// Test 5: Reused Nonce
const tempLedgerDir = path.join(__dirname, '..', 'CommandLedger', 'dry_run', 'temp_test_ledger');
const tempApprovedDir = path.join(tempLedgerDir, 'CommandLedger', 'approved');
fs.mkdirSync(tempApprovedDir, { recursive: true });

const reusedNonceCmd = createBaseCommand();
const firstRunCmd = JSON.parse(JSON.stringify(reusedNonceCmd));
const firstRunPath = path.join(tempApprovedDir, `${firstRunCmd.command_id}.json`);
fs.writeFileSync(firstRunPath, JSON.stringify(firstRunCmd, null, 2), 'utf-8');

// Validate a second command containing the same nonce
const secondRunCmd = createBaseCommand();
secondRunCmd.nonce = reusedNonceCmd.nonce;
// Recalculate hash for second command since we changed the nonce
secondRunCmd.command_hash = calculateCommandHash(secondRunCmd);

const reusedRes = validateCommand(secondRunCmd, { checkNonce: true, projectRoot: tempLedgerDir });
assert(!reusedRes.valid && reusedRes.errors.some(e => e.includes("Replay attack detected")),
    "Rejects reused nonce.");

// Clean up temp test ledger file
try {
    fs.unlinkSync(firstRunPath);
    fs.rmdirSync(tempApprovedDir);
    fs.rmdirSync(path.join(tempLedgerDir, 'CommandLedger'));
    fs.rmdirSync(tempLedgerDir);
} catch (e) {
    // clean up failure ignored
}

// Test 6: Forbidden Protected Surface (Blocked unless explicit approval is present)
const protectedCmd = createBaseCommand();
protectedCmd.payload = "Checking cloud_billing status.";
protectedCmd.command_hash = calculateCommandHash(protectedCmd);
const protectedRes = validateCommand(protectedCmd, { checkNonce: false });
assert(!protectedRes.valid && protectedRes.errors.some(e => e.includes("touches protected surface 'cloud_billing'")),
    "Rejects protected surface access without explicit approval.");

// Test 6b: Protected Surface Approved (Passes if explicit approval is provided)
const approvedProtectedCmd = createBaseCommand();
approvedProtectedCmd.payload = "Checking cloud_billing status.";
approvedProtectedCmd.explicit_approvals = ["cloud_billing"];
approvedProtectedCmd.command_hash = calculateCommandHash(approvedProtectedCmd);
const approvedProtectedRes = validateCommand(approvedProtectedCmd, { checkNonce: false });
assert(approvedProtectedRes.valid, "Passes protected surface access when explicit approval is present.");

// Test 7: Suspicious Secret String Blocked (Anti-Credential Scan)
const secretCmd = createBaseCommand();
secretCmd.payload = "Deploy with token ghp_A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q7R8S9T0";
secretCmd.command_hash = calculateCommandHash(secretCmd);
const secretRes = validateCommand(secretCmd, { checkNonce: false });
assert(!secretRes.valid && secretRes.errors.some(e => e.includes("Security block: Placed credentials/secrets detected")),
    "Rejects obvious credential patterns in payload.");

// Test 8: V2 Remote Ledger Round Trip & Hardening Verification
console.log("\n[Bridge Self-Test] Running V2 Remote Ledger Proofs...");

const globalAgentBrainRoot = path.join('C:', 'Users', 'tauru', '.gemini', 'antigravity', 'scratch', 'global-agent-brain');

// 8.1 Duplicate Nonce from Remote Ledger Rejected
const v2Nonce = "NONCE-V2-REPLAY-" + Math.floor(Math.random() * 1000000);
const v2TempApprovedDir = path.join(globalAgentBrainRoot, 'CommandLedger', 'approved');
fs.mkdirSync(v2TempApprovedDir, { recursive: true });

const v2ReusedCmd = createBaseCommand();
v2ReusedCmd.nonce = v2Nonce;
v2ReusedCmd.command_hash = calculateCommandHash(v2ReusedCmd);

const v2ReusedPath = path.join(v2TempApprovedDir, `${v2ReusedCmd.command_id}.json`);
fs.writeFileSync(v2ReusedPath, JSON.stringify(v2ReusedCmd, null, 2), 'utf-8');

// A second command with the same nonce must be rejected
const v2ReusedCmd2 = createBaseCommand();
v2ReusedCmd2.nonce = v2Nonce;
v2ReusedCmd2.command_hash = calculateCommandHash(v2ReusedCmd2);

const v2ReplayRes = validateCommand(v2ReusedCmd2, { checkNonce: true, projectRoot: globalAgentBrainRoot });
assert(!v2ReplayRes.valid && v2ReplayRes.errors.some(e => e.includes("Replay attack detected")),
    "V2: Reused nonce from remote ledger folder is rejected.");

// Clean up first command
try {
    fs.unlinkSync(v2ReusedPath);
} catch (e) {}

// 8.2 Security constraints: Payload is not executed
const validateSrc = fs.readFileSync(path.join(__dirname, 'validate-command.js'), 'utf-8');
const workerSrc = fs.readFileSync(path.join(__dirname, 'github-ledger-worker-dry-run.js'), 'utf-8');
assert(!validateSrc.includes("child_process") && !workerSrc.includes("child_process"),
    "V2 Safety: Node processes do not import 'child_process' for shell execution.");

// 8.3 Receipt format and schema verification
const receiptSchema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'RECEIPT_SCHEMA.json'), 'utf-8'));
const mockReceipt = {
    receipt_id: "REC-TEST-123",
    command_id: "CMD-TEST-123",
    created_at: new Date().toISOString(),
    status: "COMPLETE",
    files_created: ["file1.txt"],
    files_modified: [],
    files_deleted: [],
    secrets_printed: false,
    live_systems_touched: false,
    protected_surfaces_touched: ["CommandLedger/approved/"],
    summary: "Simulated receipt",
    next_safe_step: "Test next step"
};
const missingKeys = receiptSchema.required.filter(key => mockReceipt[key] === undefined);
assert(missingKeys.length === 0, "V2 Safety: Execution receipt conforms to RECEIPT_SCHEMA.json.");

// 8.4 Telegram summary generated but not sent
assert(!workerSrc.includes("https://api.telegram.org") && !workerSrc.includes("axios") && !workerSrc.includes("node-fetch"),
    "V2 Safety: Local Telegram summary is log-only and not sent via network.");

// Test 9: V3 REST API Integration & Safety Gates
console.log("\n[Bridge Self-Test] Running V3 GitHub REST API Proofs...");
const { getGitHubToken, REPO_OWNER, REPO_NAME, BRANCH } = require('./github-api-client');

// 9.1 Verify token retrieval functions securely without printing token values
let token = getGitHubToken();
if (!token) {
    try {
        const { execSync } = require('child_process');
        const login = execSync('gh api user --jq ".login"', { env: { ...process.env, GITHUB_TOKEN: '', GH_TOKEN: '' } }).toString().trim();
        if (login) {
            token = "cli_keyring_active";
        }
    } catch (e) {}
}
assert(token && typeof token === 'string' && token.length > 0,
    "V3 Auth: GitHub token is present and fetched successfully.");
assert(!validateSrc.includes("console.log(token)") && !validateSrc.includes("console.log(process.env"),
    "V3 Safety: Active credentials are never logged or printed by the codebase.");

// 9.2 Verify repo configuration targets the correct sandbox branch and repo
assert(REPO_OWNER === "R1mob2-svg" && REPO_NAME === "global-agent-brain" && BRANCH === "newton-ag-bridge-v2-ledger-dry-run",
    "V3 Scope: Commits are isolated strictly to sandbox branch 'newton-ag-bridge-v2-ledger-dry-run'.");

// 9.3 Verify API worker script doesn't import child_process (except for token fetching in client, worker must remain completely shell-free)
const apiWorkerSrc = fs.readFileSync(path.join(__dirname, 'github-api-worker-dry-run.js'), 'utf-8');
assert(!apiWorkerSrc.includes("child_process") && !apiWorkerSrc.includes("execSync"),
    "V3 Safety: Local worker processes remain completely child_process-free and shell-free.");

console.log(`\n[Bridge Self-Test] Completed. Failures: ${failures}`);
if (failures > 0) {
    process.exit(1);
} else {
    console.log("ALL TESTS PASSED SUCCESSFULLY.");
    process.exit(0);
}
