const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PROTECTED_SURFACES = [
    "cloud_billing",
    "vm_lifecycle",
    "secrets",
    "openclaw_core",
    "routing",
    "tools",
    "approvals",
    "memory_state",
    "orchestration",
    "telegram",
    "twilio",
    "email",
    "customer_systems",
    "dns",
    "vercel",
    "github_webhooks",
    "public_apis"
];

/**
 * Stateful function to check if a nonce has been used previously.
 */
function isNonceReused(nonce, commandId, projectRoot) {
    const checkDirs = [
        path.join(projectRoot, 'CommandLedger', 'approved'),
        path.join(projectRoot, 'CommandLedger', 'in_progress'),
        path.join(projectRoot, 'CommandLedger', 'receipts', 'commands')
    ];
    for (const dir of checkDirs) {
        if (!fs.existsSync(dir)) continue;
        let files;
        try {
            files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
        } catch (e) {
            continue;
        }
        for (const file of files) {
            try {
                const filePath = path.join(dir, file);
                const content = fs.readFileSync(filePath, 'utf-8');
                const cmd = JSON.parse(content);
                if (cmd.nonce === nonce && cmd.command_id !== commandId) {
                    return true;
                }
            } catch (e) {
                // ignore
            }
        }
    }
    return false;
}

/**
 * Deterministically calculates the SHA-256 hash of a command packet.
 * Serializes specific fields in alphabetical order.
 */
function calculateCommandHash(command) {
    const dataToHash = {
        command_id: command.command_id,
        nonce: command.nonce,
        payload: command.payload,
        title: command.title,
        target_agent: command.target_agent,
        risk_level: command.risk_level
    };
    // Deterministic JSON serialization
    const serialized = JSON.stringify(dataToHash, Object.keys(dataToHash).sort());
    return crypto.createHash('sha256').update(serialized).digest('hex');
}

/**
 * Validates a command packet against all V1 security rules.
 * Returns { valid: boolean, errors: string[] }
 */
function validateCommand(command, options = {}) {
    const errors = [];
    const checkNonce = options.checkNonce !== false;
    const projectRoot = options.projectRoot || path.join(__dirname, '..');

    // 1. Required fields checks
    const requiredFields = [
        "command_id", "created_at", "created_by", "source_channel", "target_agent",
        "title", "risk_level", "allowed_actions", "forbidden_actions", "payload",
        "rob_approval_status", "newton_review_status", "command_hash", "nonce", "receipt_requirements"
    ];
    for (const field of requiredFields) {
        if (command[field] === undefined || command[field] === null) {
            errors.push(`Missing required field: ${field}`);
        }
    }

    if (errors.length > 0) {
        return { valid: false, errors };
    }

    // 2. Approval Status checks
    if (command.rob_approval_status !== "APPROVED") {
        errors.push(`Rob approval status must be APPROVED. Found: ${command.rob_approval_status}`);
    }
    if (command.newton_review_status !== "REVIEWED") {
        errors.push(`Newton review status must be REVIEWED. Found: ${command.newton_review_status}`);
    }

    // 3. Cryptographic hash integrity check
    const computedHash = calculateCommandHash(command);
    if (command.command_hash !== computedHash) {
        errors.push(`Cryptographic integrity mismatch! Expected: ${computedHash}, Found: ${command.command_hash}`);
    }

    // 4. Nonce format
    if (typeof command.nonce !== "string" || command.nonce.trim().length === 0) {
        errors.push("Invalid or empty nonce value.");
    } else if (checkNonce && isNonceReused(command.nonce, command.command_id, projectRoot)) {
        errors.push(`Replay attack detected: nonce '${command.nonce}' has already been used.`);
    }

    // 5. Risk level validation
    if (typeof command.risk_level !== "number" || command.risk_level < 1 || command.risk_level > 10) {
        errors.push(`Risk level must be an integer between 1 and 10. Found: ${command.risk_level}`);
    }

    // 6. Forbidden actions and payload safety check
    const payloadLower = command.payload.toLowerCase();
    for (const action of command.forbidden_actions) {
        const escapedAction = action.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        const boundaryRegex = new RegExp(`\\b${escapedAction}\\b`, 'i');
        if (boundaryRegex.test(payloadLower)) {
            errors.push(`Payload violates forbidden action constraint: '${action}'`);
        }
    }

    // Reject obvious dangerous shell commands in payload
    const dangerousPatterns = [/rm\s+-rf/, /format\s+[a-z]:/i, /eval\(/, /exec\(/, /spawn\(/];
    for (const pattern of dangerousPatterns) {
        if (pattern.test(command.payload)) {
            errors.push(`Payload contains forbidden shell patterns matching: ${pattern}`);
        }
    }

    // 7. Anti-Credential Scan (Secret Trust Law)
    const secretPatterns = [
        /ghp_[a-zA-Z0-9]{36,40}/,
        /sk-[a-zA-Z0-9]{32,48}/,
        /AIzaSy[a-zA-Z0-9_-]{33}/,
        /eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/ // JWT Token
    ];
    for (const pattern of secretPatterns) {
        if (pattern.test(payloadLower) || pattern.test(JSON.stringify(command).toLowerCase())) {
            errors.push("Security block: Placed credentials/secrets detected in command data.");
        }
    }

    // 8. Protected Surface Gate
    const titleLower = (command.title || "").toLowerCase();
    const actionsLower = (command.allowed_actions || []).map(a => a.toLowerCase());

    for (const surface of PROTECTED_SURFACES) {
        const surfaceLower = surface.toLowerCase();
        
        const touchesPayload = payloadLower.includes(surfaceLower);
        const touchesTitle = titleLower.includes(surfaceLower);
        const touchesActions = actionsLower.includes(surfaceLower);

        if (touchesPayload || touchesTitle || touchesActions) {
            const approvals = command.explicit_approvals || [];
            const isApproved = approvals.map(a => a.toLowerCase()).includes(surfaceLower);
            if (!isApproved) {
                errors.push(`Security block: Command touches protected surface '${surface}' without explicit approval in 'explicit_approvals'.`);
            }
        }
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

module.exports = {
    calculateCommandHash,
    validateCommand,
    isNonceReused,
    PROTECTED_SURFACES
};

if (require.main === module) {
    // Basic test
    console.log("[validate-command.js] Compiled successfully.");
}
