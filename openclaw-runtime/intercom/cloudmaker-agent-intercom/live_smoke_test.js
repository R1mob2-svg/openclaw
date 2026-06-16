const fetch = require('node-fetch');
const assert = require('assert');

const API_URL = process.argv[2];
const API_KEY = process.argv[3];

if (!API_URL || !API_KEY) {
    console.error('Usage: node live_smoke_test.js <CLOUD_URL> <API_KEY>');
    process.exit(1);
}

const makeRequest = async (method, path, body = null, headers = {}) => {
    const res = await fetch(`${API_URL}${path}`, {
        method,
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': API_KEY,
            ...headers
        },
        body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
};

const runTests = async () => {
    let passed = 0;
    let failed = 0;

    const test = async (name, fn) => {
        try {
            await fn();
            console.log(`✅ PASS: ${name}`);
            passed++;
        } catch (err) {
            console.error(`❌ FAIL: ${name}`);
            console.error(err.stack);
            failed++;
        }
    };

    console.log(`--- Starting Live Cloudmaker Agent Intercom Tests on ${API_URL} ---\n`);

    // 15. auth blocks unauthorised requests
    await test('15. Auth blocks unauthorised requests', async () => {
        const res = await makeRequest('GET', '/tasks', null, { 'x-api-key': 'wrong' });
        assert.strictEqual(res.status, 401);
    });

    // 1. create task succeeds
    let taskId;
    await test('1. Create task succeeds', async () => {
        const res = await makeRequest('POST', '/tasks', {
            title: 'Test Task 1',
            target_agent: 'NEO'
        });
        assert.strictEqual(res.status, 201);
        assert.ok(res.data.id);
        assert.strictEqual(res.data.status, 'NEW');
        taskId = res.data.id;
    });

    // 2. idempotency key prevents duplicate create
    await test('2. Idempotency key prevents duplicate create', async () => {
        const idempKey = 'idemp-live-123-' + Date.now();
        const res1 = await makeRequest('POST', '/tasks', { title: 'Idemp Task', target_agent: 'NEO', idempotency_key: idempKey });
        const res2 = await makeRequest('POST', '/tasks', { title: 'Idemp Task', target_agent: 'NEO', idempotency_key: idempKey });
        assert.strictEqual(res1.status, 201);
        assert.strictEqual(res2.status, 200); // our API returns 200 for existing idempotent return
        assert.strictEqual(res1.data.id, res2.data.id);
    });

    // 3. list by target agent/status works
    await test('3. List by target agent/status works', async () => {
        const res = await makeRequest('GET', '/tasks?agent=NEO&status=NEW');
        assert.strictEqual(res.status, 200);
        assert.ok(res.data.length >= 1);
        assert.strictEqual(res.data[0].target_agent, 'NEO');
    });

    // 4. first claim succeeds
    let lockToken;
    await test('4. First claim succeeds', async () => {
        const res = await makeRequest('POST', `/tasks/${taskId}/claim`, { agent: 'NEO' });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.data.task.status, 'CLAIMED');
        assert.ok(res.data.lock_token);
        lockToken = res.data.lock_token;
    });

    // 5. ten parallel claim attempts: exactly one succeeds, rest fail
    await test('5. Ten parallel claim attempts: exactly one succeeds, rest fail', async () => {
        const taskRes = await makeRequest('POST', '/tasks', { title: 'Race Task Live', target_agent: 'NEO' });
        const raceTaskId = taskRes.data.id;

        const claims = Array(10).fill(null).map(() => makeRequest('POST', `/tasks/${raceTaskId}/claim`, { agent: 'NEO' }));
        const results = await Promise.all(claims);

        const successes = results.filter(r => r.status === 200);
        const conflicts = results.filter(r => r.status === 409);
        assert.strictEqual(successes.length, 1);
        assert.strictEqual(conflicts.length, 9);
    });

    // 6. update without token fails
    await test('6. Update without token fails', async () => {
        const res = await makeRequest('PATCH', `/tasks/${taskId}`, { details: 'Update' });
        assert.strictEqual(res.status, 401);
    });

    // 7. update with wrong token fails
    await test('7. Update with wrong token fails', async () => {
        const res = await makeRequest('PATCH', `/tasks/${taskId}`, { details: 'Update', lock_token: 'wrong-token' });
        assert.strictEqual(res.status, 401);
    });

    // 8. legal transition succeeds
    await test('8. Legal transition succeeds', async () => {
        const res = await makeRequest('PATCH', `/tasks/${taskId}`, { status: 'IN_PROGRESS', lock_token: lockToken });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.data.status, 'IN_PROGRESS');
    });

    // 9. illegal transition fails
    await test('9. Illegal transition fails', async () => {
        const res = await makeRequest('PATCH', `/tasks/${taskId}`, { status: 'NEW', lock_token: lockToken });
        assert.strictEqual(res.status, 400);
    });

    // 10. worker cannot self-approve
    await test('10. Worker cannot self-approve', async () => {
        const res = await makeRequest('PATCH', `/tasks/${taskId}`, { status: 'DONE_WITH_RECEIPT', lock_token: lockToken });
        assert.strictEqual(res.status, 403);
    });

    // 12. heartbeat updates task
    await test('12. Heartbeat updates task', async () => {
        const res = await makeRequest('POST', `/tasks/${taskId}/heartbeat`, { lock_token: lockToken });
        assert.strictEqual(res.status, 200);
    });

    // 11. receipt moves task to READY_FOR_AUDIT
    await test('11. Receipt moves task to READY_FOR_AUDIT', async () => {
        const res = await makeRequest('POST', `/tasks/${taskId}/receipt`, { receipt: { proof: 'test' }, lock_token: lockToken });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.data.status, 'READY_FOR_AUDIT');
    });

    // 20. health remains public under auth configuration
    await test('20. Health check endpoint /health remains public', async () => {
        const res = await fetch(`${API_URL}/health`);
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.status, 'ok');
    });

    // 21. tasks remains protected
    await test('21. Tasks endpoint /tasks remains protected', async () => {
        const res = await fetch(`${API_URL}/tasks`);
        assert.strictEqual(res.status, 401);
    });

    console.log(`\nTests Completed. Passed: ${passed}, Failed: ${failed}`);
    process.exit(failed > 0 ? 1 : 0);
};

runTests();
