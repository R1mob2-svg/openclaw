/**
 * Miyagi Worker — Keyword-Based Preflight Classifier
 * ====================================================
 * Polls the Cloudmaker Agent Intercom API for miyagi tasks.
 * Classifies tasks using keyword analysis — NO LLM needed.
 * ZERO Google Sheets dependency.
 *
 * Classifications:
 *   BLOCKED_PROTECTED_SURFACE — delete/bypass/secret/env/live deploy/dns/ads/stripe/twilio/customer
 *   NEEDS_NEWTON              — architecture/system mutation
 *   ALLOW_DRY_RUN             — read-only/dry-run/health check
 *   NEEDS_ROB                 — everything else
 *
 * Env vars:
 *   INTERCOM_API_URL    — Base URL of the Intercom API (default: http://localhost:4444)
 *   INTERCOM_API_KEY    — x-api-key header value
 *   MIYAGI_MEMORY_PATH  — Path to local memory files for context
 */

'use strict';

require('dotenv').config({ override: true });

const fs = require('fs');
const path = require('path');

// ─── Configuration ──────────────────────────────────────────────────────────────

const AGENT_NAME = 'miyagi';
const INTERCOM_API_URL = (process.env.INTERCOM_API_URL || 'http://localhost:4444').replace(/\/+$/, '');
const INTERCOM_API_KEY = process.env.INTERCOM_API_KEY;
const MIYAGI_MEMORY_PATH = process.env.MIYAGI_MEMORY_PATH || path.join(__dirname, '..', 'miyagi_memory');

const BASE_POLL_MS = 3000;
const HEARTBEAT_MS = 10000;
const MAX_BACKOFF_MS = 60000;

const HEADERS = {
  'Content-Type': 'application/json',
  'x-api-key': INTERCOM_API_KEY,
};

let running = true;
let consecutiveErrors = 0;

// ─── Logging ────────────────────────────────────────────────────────────────────

function log(msg) {
  console.log(`[${new Date().toISOString()}] [Miyagi Worker] ${msg}`);
}

function logError(msg) {
  console.error(`[${new Date().toISOString()}] [Miyagi Worker] ERROR: ${msg}`);
}

// ─── Sanitizer ──────────────────────────────────────────────────────────────────

function sanitizeOutput(text) {
  if (typeof text !== 'string') return String(text);
  let s = text;
  if (INTERCOM_API_KEY && INTERCOM_API_KEY.length > 10) {
    s = s.split(INTERCOM_API_KEY).join('[REDACTED]');
  }
  s = s.replace(/\b(sk-[A-Za-z0-9]{20,})\b/g, '[REDACTED_API_KEY]');
  s = s.replace(/\b(AIza[A-Za-z0-9_-]{30,})\b/g, '[REDACTED_GOOGLE_KEY]');
  s = s.replace(/\b(ghp_[A-Za-z0-9]{36,})\b/g, '[REDACTED_GH_PAT]');
  s = s.replace(/(\+44\s?7\d{3}\s?\d{6})/g, '[REDACTED_PHONE]');
  return s;
}

// ─── Jitter & Backoff ───────────────────────────────────────────────────────────

function jitter(baseMs) {
  const variance = baseMs * 0.2;
  return baseMs + Math.floor(Math.random() * variance * 2 - variance);
}

function backoffDelay() {
  const delay = Math.min(BASE_POLL_MS * Math.pow(2, consecutiveErrors), MAX_BACKOFF_MS);
  return jitter(delay);
}

// ─── HTTP Helper ────────────────────────────────────────────────────────────────

async function intercomFetch(urlPath, options = {}) {
  const url = `${INTERCOM_API_URL}${urlPath}`;
  return fetch(url, {
    ...options,
    headers: { ...HEADERS, ...(options.headers || {}) },
  });
}

// ─── Kill Switch ────────────────────────────────────────────────────────────────

async function checkKillSwitch() {
  try {
    const res = await intercomFetch('/health');
    if (!res.ok) return false;
    const data = await res.json();
    return data.status === 'ok';
  } catch {
    return false;
  }
}

// ─── Keyword Classification ─────────────────────────────────────────────────────

const BLOCKED_KEYWORDS = [
  'delete', 'bypass', 'secret', 'env', 'live deploy', 'dns',
  'ads', 'stripe', 'twilio', 'customer', 'whatsapp', 'sms send',
  'gmail', 'email send', 'purchase', 'payment',
];

const NEWTON_KEYWORDS = [
  'architecture', 'system mutation', 'schema change', 'database migration',
  'infrastructure', 'terraform', 'deploy pipeline', 'ci/cd',
  'service mesh', 'load balancer', 'firewall rule',
];

const DRY_RUN_KEYWORDS = [
  'read-only', 'dry-run', 'dry_run', 'health check', 'healthcheck',
  'status check', 'audit', 'report', 'list', 'describe', 'get',
  'fetch', 'query', 'search', 'inspect', 'verify', 'validate',
];

/**
 * Classifies a task payload into one of four categories.
 * Priority: BLOCKED > NEEDS_NEWTON > ALLOW_DRY_RUN > NEEDS_ROB
 */
function classifyTask(payloadStr) {
  const lower = payloadStr.toLowerCase();

  // Check BLOCKED first (highest priority)
  for (const keyword of BLOCKED_KEYWORDS) {
    if (lower.includes(keyword)) {
      return {
        classification: 'BLOCKED_PROTECTED_SURFACE',
        matched_keyword: keyword,
        reason: `Payload contains protected surface keyword: "${keyword}"`,
      };
    }
  }

  // Check NEEDS_NEWTON
  for (const keyword of NEWTON_KEYWORDS) {
    if (lower.includes(keyword)) {
      return {
        classification: 'NEEDS_NEWTON',
        matched_keyword: keyword,
        reason: `Architecture/system mutation detected: "${keyword}"`,
      };
    }
  }

  // Check ALLOW_DRY_RUN
  for (const keyword of DRY_RUN_KEYWORDS) {
    if (lower.includes(keyword)) {
      return {
        classification: 'ALLOW_DRY_RUN',
        matched_keyword: keyword,
        reason: `Read-only/dry-run operation detected: "${keyword}"`,
      };
    }
  }

  // Default: NEEDS_ROB
  return {
    classification: 'NEEDS_ROB',
    matched_keyword: null,
    reason: 'No safe pattern matched. Requires Rob approval.',
  };
}

// ─── Local Memory ───────────────────────────────────────────────────────────────

function loadMemoryContext() {
  if (!fs.existsSync(MIYAGI_MEMORY_PATH)) return null;

  let context = '';
  try {
    const files = fs.readdirSync(MIYAGI_MEMORY_PATH);
    for (const f of files) {
      if (f.endsWith('.md') || f.endsWith('.json') || f.endsWith('.txt')) {
        const filePath = path.join(MIYAGI_MEMORY_PATH, f);
        const stat = fs.statSync(filePath);
        if (stat.size < 50000) { // Skip files larger than 50KB
          context += `\n--- ${f} ---\n${fs.readFileSync(filePath, 'utf8')}`;
        }
      }
    }
  } catch (err) {
    logError(`Failed to load memory: ${err.message}`);
  }

  return context || null;
}

// ─── Core Task Execution ────────────────────────────────────────────────────────

async function claimTask(taskId) {
  const res = await intercomFetch(`/tasks/${taskId}/claim`, {
    method: 'POST',
    body: JSON.stringify({ agent: AGENT_NAME }),
  });
  if (!res.ok) throw new Error(`Claim failed (${res.status}): ${sanitizeOutput(await res.text())}`);
  const data = await res.json();
  return data.lock_token;
}

function startHeartbeat(taskId, lockToken) {
  return setInterval(async () => {
    try {
      await intercomFetch(`/tasks/${taskId}/heartbeat`, {
        method: 'POST',
        body: JSON.stringify({
          lock_token: lockToken,
          agent_id: AGENT_NAME,
          status_note: 'Classifying task...',
        }),
      });
    } catch { /* non-fatal */ }
  }, HEARTBEAT_MS);
}

async function submitReceipt(taskId, lockToken, receipt) {
  const receiptStr = sanitizeOutput(typeof receipt === 'string' ? receipt : JSON.stringify(receipt));
  const res = await intercomFetch(`/tasks/${taskId}/receipt`, {
    method: 'POST',
    body: JSON.stringify({
      lock_token: lockToken,
      agent_id: AGENT_NAME,
      receipt: receiptStr,
    }),
  });
  if (!res.ok) throw new Error(`Receipt failed (${res.status}): ${sanitizeOutput(await res.text())}`);
  log(`Submitted receipt for ${taskId}`);
}

async function executeTask(task) {
  let lockToken = null;
  let heartbeatTimer = null;

  try {
    // 1. Claim
    lockToken = await claimTask(task.id);
    log(`Claimed task ${task.id}`);

    // 2. Heartbeat
    heartbeatTimer = startHeartbeat(task.id, lockToken);

    // 3. Build the full payload string for classification
    const payload = task.description || '';
    const title = task.title || '';
    const fullPayloadStr = `${title} ${payload}`;

    // 4. Classify
    const result = classifyTask(fullPayloadStr);
    log(`Classified ${task.id} → ${result.classification} (keyword: ${result.matched_keyword || 'none'})`);

    // 5. Load optional memory context
    const memoryContext = loadMemoryContext();

    // 6. Build receipt
    const receipt = {
      task_id: task.id,
      classification: result.classification,
      matched_keyword: result.matched_keyword,
      reason: result.reason,
      classifier: 'miyagi-keyword-v1',
      memory_context_loaded: !!memoryContext,
      classified_at: new Date().toISOString(),
      no_secret_leak: true,
    };

    // 7. Submit
    await submitReceipt(task.id, lockToken, receipt);

  } catch (err) {
    logError(`Processing ${task.id}: ${sanitizeOutput(err.message)}`);
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
  }
}

// ─── Poll Loop ──────────────────────────────────────────────────────────────────

async function poll() {
  if (!running) return;

  try {
    // Kill switch
    const healthy = await checkKillSwitch();
    if (!healthy) {
      log('Kill switch active — Intercom health check failed. Skipping poll cycle.');
      consecutiveErrors++;
      return;
    }

    const res = await intercomFetch(`/tasks?agent=${AGENT_NAME}&status=NEW`);
    if (!res.ok) throw new Error(`Poll HTTP ${res.status}`);

    const data = await res.json();
    const tasks = Array.isArray(data) ? data : (data.tasks || []);

    // Filter for MIYAGI_PREFLIGHT tasks assigned to miyagi
    const preflightTasks = tasks.filter(t =>
      t.status === 'NEW' &&
      t.target_agent === AGENT_NAME &&
      (t.title?.includes('MIYAGI_PREFLIGHT') || t.title?.includes('miyagi_preflight'))
    );

    for (const task of preflightTasks) {
      if (!running) break;
      await executeTask(task);
    }

    consecutiveErrors = 0;
  } catch (err) {
    consecutiveErrors++;
    logError(`Poll error (attempt ${consecutiveErrors}): ${sanitizeOutput(err.message)}`);
  }
}

// ─── Graceful Shutdown ──────────────────────────────────────────────────────────

function shutdown(signal) {
  log(`Received ${signal}. Shutting down gracefully...`);
  running = false;
  setTimeout(() => {
    log('Shutdown complete.');
    process.exit(0);
  }, 2000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ─── Startup ────────────────────────────────────────────────────────────────────

async function main() {
  log('═══════════════════════════════════════════════════════');
  log(`  Miyagi Worker — Keyword Preflight Classifier`);
  log(`  Intercom URL:    ${INTERCOM_API_URL}`);
  log(`  Poll interval:   ${BASE_POLL_MS}ms (±20% jitter)`);
  log(`  Heartbeat:       ${HEARTBEAT_MS}ms`);
  log(`  Memory path:     ${MIYAGI_MEMORY_PATH}`);
  log(`  Sheets:          NONE (zero dependency)`);
  log('═══════════════════════════════════════════════════════');

  if (!INTERCOM_API_KEY) {
    logError('INTERCOM_API_KEY is not set. Exiting.');
    process.exit(1);
  }

  // Initial poll
  await poll();

  // Recurring poll with jitter
  const schedulePoll = () => {
    if (!running) return;
    const delay = consecutiveErrors > 0 ? backoffDelay() : jitter(BASE_POLL_MS);
    setTimeout(async () => {
      await poll();
      schedulePoll();
    }, delay);
  };

  schedulePoll();
}

main().catch(err => {
  logError(`Fatal startup error: ${sanitizeOutput(err.message)}`);
  process.exit(1);
});
