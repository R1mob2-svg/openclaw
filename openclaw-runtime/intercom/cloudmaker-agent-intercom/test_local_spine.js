#!/usr/bin/env node
/**
 * test_local_spine.js — Smoke test for the Cloudmaker Agent Intercom spine.
 *
 * Exercises the full task lifecycle:
 *   health → create → list → claim → heartbeat → status update → receipt → double-claim blocked
 *
 * Usage:
 *   node test_local_spine.js
 *
 * Environment variables:
 *   INTERCOM_API_KEY  — API key for auth (default: uses the dev fallback)
 *   INTERCOM_API_URL  — Base URL          (default: http://localhost:4444)
 */

const http = require('http');
const https = require('https');
require('dotenv').config({ override: true });

// ── Config ──────────────────────────────────────────────────────────
const API_URL = (process.env.INTERCOM_API_URL || 'http://localhost:4444').replace(/\/+$/, '');
const API_KEY = process.env.INTERCOM_API_KEY || 'default-test-key-do-not-use-in-prod';
const REDACTED_KEY = API_KEY.slice(0, 4) + '****' + API_KEY.slice(-4);

// ── Helpers ─────────────────────────────────────────────────────────
const results = [];

function log(label, pass, detail) {
  const icon = pass ? '✅' : '❌';
  const line = `${icon}  ${label}${detail ? ' — ' + detail : ''}`;
  console.log(line);
  results.push({ label, pass });
}

/**
 * Minimal HTTP request helper — zero external deps.
 * Returns { status, body (parsed JSON or raw string), headers }.
 */
function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_URL);
    const transport = url.protocol === 'https:' ? https : http;

    const headers = { 'Content-Type': 'application/json' };
    // Don't send the key for /health (it doesn't need it)
    if (!path.startsWith('/health')) {
      headers['x-api-key'] = API_KEY;
    }

    const payload = body ? JSON.stringify(body) : null;
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);

    const opts = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers
    };

    const req = transport.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        let parsed;
        try { parsed = JSON.parse(raw); } catch { parsed = raw; }
        resolve({ status: res.statusCode, body: parsed, headers: res.headers });
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ── Test Steps ──────────────────────────────────────────────────────
async function run() {
  console.log('');
  console.log('═══════════════════════════════════════════════');
  console.log('  Cloudmaker Intercom Spine — Local Smoke Test ');
  console.log('═══════════════════════════════════════════════');
  console.log(`  URL : ${API_URL}`);
  console.log(`  Key : ${REDACTED_KEY}`);
  console.log('');

  let taskId, lockToken;

  // ── Step 1: Health check ────────────────────────────────────────
  try {
    const r = await request('GET', '/health');
    log('Health check (GET /health)',
      r.status === 200 && r.body && r.body.status === 'ok',
      `status=${r.status} body.status=${r.body?.status}`);
  } catch (e) {
    log('Health check (GET /health)', false, e.message);
    console.log('\n⛔  Intercom server unreachable. Is it running on ' + API_URL + '?\n');
    process.exit(1);
  }

  // ── Step 2: Create a test task ──────────────────────────────────
  try {
    const r = await request('POST', '/tasks', {
      title: `Smoke test task ${Date.now()}`,
      description: 'Automated smoke test — safe to delete.',
      target_agent: 'AG'
    });
    taskId = r.body?.id;
    log('Create task (POST /tasks)',
      r.status === 201 && !!taskId,
      `status=${r.status} id=${taskId}`);
  } catch (e) {
    log('Create task (POST /tasks)', false, e.message);
  }

  if (!taskId) {
    console.log('\n⛔  Cannot continue without a task ID.\n');
    printSummary();
    return;
  }

  // ── Step 3: List tasks filtered by agent + status ───────────────
  try {
    const r = await request('GET', '/tasks?agent=AG&status=NEW');
    const found = Array.isArray(r.body) && r.body.some(t => t.id === taskId);
    log('List tasks (GET /tasks?agent=AG&status=NEW)',
      r.status === 200 && found,
      `status=${r.status} found=${found} count=${Array.isArray(r.body) ? r.body.length : '?'}`);
  } catch (e) {
    log('List tasks (GET /tasks?agent=AG&status=NEW)', false, e.message);
  }

  // ── Step 4: Claim the task ──────────────────────────────────────
  try {
    const r = await request('POST', `/tasks/${taskId}/claim`, { agent: 'AG' });
    lockToken = r.body?.lock_token;
    log('Claim task (POST /tasks/:id/claim)',
      r.status === 200 && !!lockToken,
      `status=${r.status} lock_token=${'****'}`);
  } catch (e) {
    log('Claim task (POST /tasks/:id/claim)', false, e.message);
  }

  if (!lockToken) {
    console.log('\n⛔  Cannot continue without a lock token.\n');
    printSummary();
    return;
  }

  // ── Step 5: Send heartbeat ──────────────────────────────────────
  try {
    const r = await request('POST', `/tasks/${taskId}/heartbeat`, { lock_token: lockToken });
    log('Heartbeat (POST /tasks/:id/heartbeat)',
      r.status === 200 && r.body?.success === true,
      `status=${r.status}`);
  } catch (e) {
    log('Heartbeat (POST /tasks/:id/heartbeat)', false, e.message);
  }

  // ── Step 6: Update status to IN_PROGRESS ────────────────────────
  try {
    const r = await request('PATCH', `/tasks/${taskId}`, {
      lock_token: lockToken,
      status: 'IN_PROGRESS',
      details: 'Smoke test moving to IN_PROGRESS'
    });
    log('Update status (PATCH /tasks/:id → IN_PROGRESS)',
      r.status === 200 && r.body?.status === 'IN_PROGRESS',
      `status=${r.status} task.status=${r.body?.status}`);
  } catch (e) {
    log('Update status (PATCH /tasks/:id → IN_PROGRESS)', false, e.message);
  }

  // ── Step 7: Submit receipt ──────────────────────────────────────
  try {
    const r = await request('POST', `/tasks/${taskId}/receipt`, {
      lock_token: lockToken,
      receipt: {
        summary: 'Smoke test completed successfully.',
        result: 'PASS',
        timestamp: new Date().toISOString()
      }
    });
    log('Submit receipt (POST /tasks/:id/receipt)',
      r.status === 200 && r.body?.status === 'READY_FOR_AUDIT',
      `status=${r.status} task.status=${r.body?.status}`);
  } catch (e) {
    log('Submit receipt (POST /tasks/:id/receipt)', false, e.message);
  }

  // ── Step 8: Double-claim should be blocked (409/400) ────────────
  try {
    const r = await request('POST', `/tasks/${taskId}/claim`, { agent: 'NEO' });
    log('Double-claim blocked (POST /tasks/:id/claim → 409/400)',
      r.status === 409 || r.status === 400,
      `status=${r.status} error=${r.body?.error || 'none'}`);
  } catch (e) {
    log('Double-claim blocked (POST /tasks/:id/claim → 409/400)', false, e.message);
  }

  // ── Summary ─────────────────────────────────────────────────────
  printSummary();
}

function printSummary() {
  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  const total = results.length;

  console.log('');
  console.log('───────────────────────────────────────────────');
  console.log(`  Results: ${passed}/${total} passed, ${failed} failed`);
  console.log('───────────────────────────────────────────────');

  if (failed > 0) {
    console.log('');
    console.log('  Failed steps:');
    results.filter(r => !r.pass).forEach(r => console.log(`    ❌  ${r.label}`));
  }

  console.log('');
  process.exit(failed > 0 ? 1 : 0);
}

// ── Go ──────────────────────────────────────────────────────────────
run().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
