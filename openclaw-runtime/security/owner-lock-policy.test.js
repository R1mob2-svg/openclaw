import assert from 'assert';
import { evaluateRequest } from './owner-lock-policy.js';

const DUMMY_OWNER = 'mock_owner_id';
const DUMMY_NON_OWNER = 'mock_attacker_id';

const MOCK_CONFIG = {
    gateway: {
        exec: {
            requireExecApproval: true
        }
    },
    channels: {
        telegram: {
            allowFrom: [DUMMY_OWNER]
        },
        browser: {
            allowFrom: [DUMMY_OWNER]
        },
        webhook: {
            allowFrom: [DUMMY_OWNER]
        },
        no_allowlist: {}
    }
};

function runTests() {
    console.log("Starting owner lock policy tests...");

    // 1. owner test ID allowed
    const t1 = evaluateRequest({
        channel: 'telegram',
        userId: DUMMY_OWNER,
        command: '/status',
        hasExecApproval: false
    }, MOCK_CONFIG);
    assert.strictEqual(t1.allowed, true, "Owner test ID should be allowed for non-protected commands");
    console.log("Test 1 Passed: owner test ID allowed");

    // 2. non-owner test ID rejected
    const t2 = evaluateRequest({
        channel: 'telegram',
        userId: DUMMY_NON_OWNER,
        command: '/status',
        hasExecApproval: false
    }, MOCK_CONFIG);
    assert.strictEqual(t2.allowed, false, "Non-owner test ID should be rejected");
    assert.strictEqual(t2.reason, 'non_owner_rejected');
    console.log("Test 2 Passed: non-owner test ID rejected");

    // 3. protected command from owner requires exec approval
    const t3 = evaluateRequest({
        channel: 'telegram',
        userId: DUMMY_OWNER,
        command: '/exec format c:',
        hasExecApproval: true
    }, MOCK_CONFIG);
    assert.strictEqual(t3.allowed, true, "Protected command from owner with exec approval should be allowed");
    console.log("Test 3 Passed: protected command from owner requires exec approval");

    // 4. protected command without approval rejected
    const t4 = evaluateRequest({
        channel: 'telegram',
        userId: DUMMY_OWNER,
        command: '/exec format c:',
        hasExecApproval: false
    }, MOCK_CONFIG);
    assert.strictEqual(t4.allowed, false, "Protected command without approval should be rejected");
    assert.strictEqual(t4.reason, 'protected_command_requires_approval');
    console.log("Test 4 Passed: protected command without approval rejected");

    // 5. webhook command rejected unless route-level owner-gate is proven
    const t5_unproven = evaluateRequest({
        channel: 'webhook',
        userId: DUMMY_OWNER,
        command: '/status',
        hasExecApproval: false,
        routeData: { isSignatureVerified: false, hasExplicitOwnerGate: false }
    }, MOCK_CONFIG);
    assert.strictEqual(t5_unproven.allowed, false, "Webhook command should be rejected if not explicitly owner gated");
    assert.strictEqual(t5_unproven.reason, 'webhook_not_owner_gated');

    const t5_proven = evaluateRequest({
        channel: 'webhook',
        userId: DUMMY_OWNER,
        command: '/status',
        hasExecApproval: false,
        routeData: { isSignatureVerified: true, hasExplicitOwnerGate: false }
    }, MOCK_CONFIG);
    assert.strictEqual(t5_proven.allowed, true, "Webhook command should be allowed if explicitly owner gated (signature)");
    console.log("Test 5 Passed: webhook command rejected unless route-level owner-gate is proven");

    // 6. missing allowlist fails closed
    const t6 = evaluateRequest({
        channel: 'no_allowlist',
        userId: DUMMY_OWNER,
        command: '/status',
        hasExecApproval: false
    }, MOCK_CONFIG);
    assert.strictEqual(t6.allowed, false, "Missing allowlist must fail closed");
    assert.strictEqual(t6.reason, 'non_owner_rejected');
    console.log("Test 6 Passed: missing allowlist fails closed");

    // 7. unknown channel fails closed
    const t7 = evaluateRequest({
        channel: 'unknown_channel',
        userId: DUMMY_OWNER,
        command: '/status',
        hasExecApproval: false
    }, MOCK_CONFIG);
    assert.strictEqual(t7.allowed, false, "Unknown channel must fail closed");
    assert.strictEqual(t7.reason, 'non_owner_rejected');
    console.log("Test 7 Passed: unknown channel fails closed");

    console.log("All offline owner lock tests passed.");
}

runTests();
