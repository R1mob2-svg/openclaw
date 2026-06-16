const fs = require('fs');
const path = require('path');
const { getGitHubToken, redactSensitive, getSafeAuthStatus } = require('./github-api-client');

console.log("[Secret Hygiene Self-Test] Starting V3.1 audit checks...");

let failures = 0;

function assert(condition, message) {
    if (!condition) {
        console.error(`❌ FAIL: ${message}`);
        failures++;
    } else {
        console.log(`✅ PASS: ${message}`);
    }
}

// 1. "gh auth token" string is not present in project scripts except self-test/receipts
const files = [
    'src/validate-command.js',
    'src/relay-dry-run.js',
    'src/simulate-ag-worker.js',
    'src/github-ledger-dry-run.js',
    'src/github-ledger-worker-dry-run.js',
    'src/github-api-client.js',
    'src/github-api-ledger-dry-run.js',
    'src/github-api-worker-dry-run.js',
    'package.json'
];

for (const file of files) {
    const filePath = path.join(__dirname, '..', file);
    if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        assert(!content.includes("gh auth token"), 
            `Forbidden command 'gh auth token' must not exist in: ${file}`);
    }
}

// 2. No token-like values exist in bridge project files (ghp_ or github_pat_)
const tokenRegexes = [
    /ghp_[a-zA-Z0-9]{36,40}/i,
    /github_pat_[a-zA-Z0-9_]{30,}/i
];

for (const file of files) {
    const filePath = path.join(__dirname, '..', file);
    if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        // Check for ghp_
        assert(!/ghp_[a-zA-Z0-9]{36,40}/i.test(content), 
            `Forbidden active token pattern 'ghp_' must not exist in: ${file}`);
        // Check for github_pat_ that is NOT the dummy token
        const match = content.match(/github_pat_[a-zA-Z0-9_]+/i);
        if (match) {
            assert(match[0] === 'github_pat_antigravitydummytoken', 
                `Found unexpected token pattern '${match[0]}' in: ${file}`);
        }
    }
}

// 3. github-api-client does not print Authorization header
const clientSrc = fs.readFileSync(path.join(__dirname, 'github-api-client.js'), 'utf-8');
assert(!clientSrc.includes("console.log") || !clientSrc.includes("Authorization"),
    "Safety check: github-api-client must never console.log headers or authorization details.");

// 4. redactSensitive test
const testHeader = "Authorization: token gho_antigravitydummyexposedtokenredacted";
const redacted = redactSensitive(testHeader);
assert(redacted.includes("[REDACTED_AUTH_TOKEN]") && !redacted.includes("gho_"),
    "Safety check: redactSensitive correctly masks authorization tokens.");

// 5. getSafeAuthStatus reports present/missing only
const authStatus = getSafeAuthStatus();
assert(authStatus.GITHUB_TOKEN === "present" || authStatus.GITHUB_TOKEN === "missing",
    "Safety check: getSafeAuthStatus GITHUB_TOKEN output contains only present/missing label.");
assert(authStatus.GH_TOKEN === "present" || authStatus.GH_TOKEN === "missing",
    "Safety check: getSafeAuthStatus GH_TOKEN output contains only present/missing label.");

// 6. Missing token fails closed
const originalToken = process.env.GITHUB_TOKEN;
const originalGhToken = process.env.GH_TOKEN;

delete process.env.GITHUB_TOKEN;
delete process.env.GH_TOKEN;

const resolvedToken = getGitHubToken();
assert(resolvedToken === null, "Safety check: getGitHubToken returns null and fails closed when environment is empty.");

// Restore env
if (originalToken) process.env.GITHUB_TOKEN = originalToken;
if (originalGhToken) process.env.GH_TOKEN = originalGhToken;

// 7. Verification that receipts don't contain active token values
const receiptsDir = path.join(__dirname, '..', 'receipts');
if (fs.existsSync(receiptsDir)) {
    const rFiles = fs.readdirSync(receiptsDir).filter(f => f.endsWith('.md'));
    for (const rFile of rFiles) {
        const content = fs.readFileSync(path.join(receiptsDir, rFile), 'utf-8');
        assert(!/ghp_[a-zA-Z0-9]{36,40}/i.test(content), 
            `Receipt ${rFile} must never contain active ghp_ token values.`);
        assert(!/gho_[a-zA-Z0-9]{36,40}/i.test(content), 
            `Receipt ${rFile} must never contain active gho_ token values.`);
    }
}

console.log(`\n[Secret Hygiene Self-Test] Completed. Failures: ${failures}`);
if (failures > 0) {
    process.exit(1);
} else {
    console.log("ALL SECRET HYGIENE CHECKS PASSED.");
    process.exit(0);
}
