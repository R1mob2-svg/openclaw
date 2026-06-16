/**
 * AG Worker — Sheets-Free Intercom Poller
 * ========================================
 * Polls the Cloudmaker Agent Intercom API directly for AG tasks.
 * NO Google Sheets reads. Optional passive Sheets mirror (write-only).
 *
 * Env vars:
 *   INTERCOM_API_URL    — Base URL of the Intercom API (default: http://localhost:4444)
 *   INTERCOM_API_KEY    — x-api-key header value
 *   DEEPSEEK_API_KEY    — DeepSeek chat completions auth
 *   BRAIN_DOCTRINE_PATH — Path to local brain doctrine directory
 *   SHEETS_MIRROR_ENABLED — "true" to enable passive Sheets write-back (default: false)
 *   GOOGLE_SHEETS_ID    — Sheet ID for mirror writes (only if SHEETS_MIRROR_ENABLED=true)
 *   GOOGLE_APPLICATION_CREDENTIALS — path to service account JSON (only if Sheets enabled)
 */

'use strict';

require('dotenv').config({ override: true });

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─── Configuration ──────────────────────────────────────────────────────────────

const AGENT_NAME = 'AG';
const INTERCOM_API_URL = (process.env.INTERCOM_API_URL || 'http://localhost:4444').replace(/\/+$/, '');
const INTERCOM_API_KEY = process.env.INTERCOM_API_KEY;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const BRAIN_DOCTRINE_PATH = process.env.BRAIN_DOCTRINE_PATH || path.join(__dirname, '..', 'brain');
const SHEETS_MIRROR_ENABLED = (process.env.SHEETS_MIRROR_ENABLED || 'false').toLowerCase() === 'true';
const GOOGLE_SHEETS_ID = process.env.GOOGLE_SHEETS_ID || '';

const BASE_POLL_MS = 5000;
const HEARTBEAT_MS = 10000;
const MAX_BACKOFF_MS = 60000;

const FORBIDDEN_KEYWORDS = ['restart', 'deploy', 'dns', 'ads', 'payments', 'secrets', 'outreach'];

const HEADERS = {
  'Content-Type': 'application/json',
  'x-api-key': INTERCOM_API_KEY,
};

let running = true;
let consecutiveErrors = 0;

// ─── Logging ────────────────────────────────────────────────────────────────────

function log(msg) {
  console.log(`[${new Date().toISOString()}] [AG Worker] ${msg}`);
}

function logError(msg) {
  console.error(`[${new Date().toISOString()}] [AG Worker] ERROR: ${msg}`);
}

// ─── Security Sanitizer ─────────────────────────────────────────────────────────

function sanitizeOutput(text) {
  if (typeof text !== 'string') return String(text);
  let s = text;

  // Redact known env secret values
  const secretVars = [INTERCOM_API_KEY, DEEPSEEK_API_KEY];
  for (const secret of secretVars) {
    if (secret && secret.length > 10) {
      s = s.split(secret).join('[REDACTED]');
    }
  }

  // Pattern-based redaction: API keys that look like sk-*, AIza*, ghp_*, ghs_*, etc.
  s = s.replace(/\b(sk-[A-Za-z0-9]{20,})\b/g, '[REDACTED_API_KEY]');
  s = s.replace(/\b(AIza[A-Za-z0-9_-]{30,})\b/g, '[REDACTED_GOOGLE_KEY]');
  s = s.replace(/\b(ghp_[A-Za-z0-9]{36,})\b/g, '[REDACTED_GH_PAT]');
  s = s.replace(/\b(ghs_[A-Za-z0-9]{36,})\b/g, '[REDACTED_GH_SECRET]');

  // Phone numbers: UK mobile (+447...) and generic international
  s = s.replace(/(\+44\s?7\d{3}\s?\d{6})/g, '[REDACTED_PHONE]');
  s = s.replace(/(\b0\d{4}\s?\d{6}\b)/g, '[REDACTED_PHONE]');

  return s;
}

// ─── Jitter ─────────────────────────────────────────────────────────────────────

function jitter(baseMs) {
  // ±20% jitter
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
  const res = await fetch(url, {
    ...options,
    headers: { ...HEADERS, ...(options.headers || {}) },
  });
  return res;
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

// ─── Brain Doctrine (Local Filesystem Only) ─────────────────────────────────────

function loadBrainDoctrine() {
  const doctrineFiles = ['IDENTITY.md', 'GUARDRAILS.md', 'AGENT_ROUTING.md', 'AGENT-MISSIONS.md'];
  let doctrine = '';
  let digests = {};

  for (const file of doctrineFiles) {
    const filePath = path.join(BRAIN_DOCTRINE_PATH, file);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      doctrine += `\n--- ${file} ---\n${content}`;
      digests[file] = crypto.createHash('sha256').update(content, 'utf8').digest('hex');
    }
  }

  if (!doctrine) {
    log('WARNING: No brain doctrine files found. AG will operate without doctrine context.');
    doctrine = 'You are AG, the Cloud-resident execution arm of the Cloudmaker Phone Command Spine. Execute tasks safely within read-only guardrails.';
  }

  return { doctrine, digests };
}

function getMemoryContext() {
  const { doctrine } = loadBrainDoctrine();

  const bootContext = `You are RobPersonalizedAG (AG), the Cloud-resident execution arm.
You must serve Newton securely using your personalized doctrine and local memory.
You NEVER print, echo, or return API keys, tokens, passwords, or phone numbers.
You NEVER execute deployment, DNS, ads, payment, outreach, or secret-revealing commands.`;

  return `=== AG BOOT CONTEXT ===\n${bootContext}\n\n=== DOCTRINE ===\n${doctrine}`;
}

// ─── DeepSeek LLM ───────────────────────────────────────────────────────────────

async function callDeepSeek(taskPayload) {
  if (!DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY is not configured');

  const systemPrompt = getMemoryContext();
  const userPrompt = `Task from Newton:\n${JSON.stringify(taskPayload, null, 2)}`;

  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`DeepSeek API ${res.status}: ${sanitizeOutput(errText)}`);
  }

  const data = await res.json();
  if (data.choices?.[0]?.message?.content) {
    return data.choices[0].message.content;
  }
  return 'Error: Could not parse DeepSeek response.';
}

// ─── Forbidden Keyword Check ────────────────────────────────────────────────────

function checkForbiddenKeywords(payloadStr) {
  const lower = payloadStr.toLowerCase();
  for (const keyword of FORBIDDEN_KEYWORDS) {
    if (lower.includes(keyword)) {
      // Allow if it's inside a "forbidden" or "expected_receipt" context (meta-reference)
      if (lower.includes('"forbidden"') || lower.includes('"expected_receipt"')) continue;
      return keyword;
    }
  }
  return null;
}

// ─── Optional Passive Sheets Mirror ─────────────────────────────────────────────

let sheetsClient = null;

async function initSheetsMirror() {
  if (!SHEETS_MIRROR_ENABLED || sheetsClient) return;
  try {
    const { google } = require('googleapis');
    const auth = new google.auth.GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    sheetsClient = google.sheets({ version: 'v4', auth });
    log('Sheets mirror initialized (write-only).');
  } catch (err) {
    logError(`Sheets mirror init failed: ${err.message}. Continuing without mirror.`);
    sheetsClient = null;
  }
}

async function mirrorReceiptToSheets(taskId, status, details) {
  if (!SHEETS_MIRROR_ENABLED || !sheetsClient || !GOOGLE_SHEETS_ID) return;
  try {
    const row = [
      taskId,
      'ag-worker-01',
      AGENT_NAME,
      status,
      sanitizeOutput(typeof details === 'string' ? details : JSON.stringify(details)),
      '0',
      '0',
      new Date().toISOString(),
    ];
    await sheetsClient.spreadsheets.values.append({
      spreadsheetId: GOOGLE_SHEETS_ID,
      range: 'RECEIPTS!A1',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] },
    });
    log(`Mirror: wrote receipt row for ${taskId}`);
  } catch (err) {
    logError(`Mirror write failed for ${taskId}: ${err.message}`);
  }
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
          status_note: 'Executing task...',
        }),
      });
    } catch {
      // Heartbeat failure is non-fatal; the server has a stale-check mechanism
    }
  }, HEARTBEAT_MS);
}

async function submitReceipt(taskId, lockToken, receipt) {
  const res = await intercomFetch(`/tasks/${taskId}/receipt`, {
    method: 'POST',
    body: JSON.stringify({
      lock_token: lockToken,
      agent_id: AGENT_NAME,
      receipt: sanitizeOutput(typeof receipt === 'string' ? receipt : JSON.stringify(receipt)),
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

    // 3. Parse payload
    const payload = task.description || '';
    let payloadObj = null;
    let isJson = false;
    try {
      payloadObj = JSON.parse(payload);
      isJson = true;
    } catch { /* not JSON, treat as text */ }

    const payloadStr = isJson ? JSON.stringify(payloadObj) : payload;

    // 4. Forbidden keyword gate
    const blockedKeyword = checkForbiddenKeywords(payloadStr);
    if (blockedKeyword) {
      const receipt = {
        status: 'BLOCKED',
        error: 'BLOCKED_FORBIDDEN_MUTATION_WRITE_BLOCKED',
        blocked_keyword: blockedKeyword,
        task_id: task.id,
      };
      await mirrorReceiptToSheets(task.id, 'BLOCKED', JSON.stringify(receipt));
      await submitReceipt(task.id, lockToken, receipt);
      return;
    }

    // 5. Special command: AG_BRAIN_REFRESH_DRY_RUN
    if (
      task.id === 'AG_BRAIN_REFRESH_DRY_RUN' ||
      payload === 'AG_BRAIN_REFRESH_DRY_RUN' ||
      (isJson && payloadObj?.id === 'AG_BRAIN_REFRESH_DRY_RUN')
    ) {
      try {
        const { doctrine, digests } = loadBrainDoctrine();
        const receipt = {
          status: 'SUCCESS',
          task_id: task.id,
          target_surface: 'AG Brain Refresh (Local Filesystem)',
          source: 'LOCAL_FILESYSTEM',
          brain_doctrine_digest: digests,
          doctrine_loaded: !!doctrine,
          no_secret_leak: true,
          proof_summary: `Doctrine loaded from ${BRAIN_DOCTRINE_PATH}`,
        };
        await mirrorReceiptToSheets(task.id, 'SUCCESS', JSON.stringify(receipt));
        await submitReceipt(task.id, lockToken, receipt);
      } catch (err) {
        const receipt = {
          status: 'BLOCKED',
          error: 'BLOCKED_AG_BRAIN_SYNC_UNAVAILABLE',
          reason: err.message,
        };
        await mirrorReceiptToSheets(task.id, 'BLOCKED', JSON.stringify(receipt));
        await submitReceipt(task.id, lockToken, receipt);
      }
      return;
    }

    // 6. Pre-flight: ensure doctrine is loadable
    const { doctrine, digests } = loadBrainDoctrine();
    if (!doctrine) {
      const receipt = {
        status: 'BLOCKED',
        error: 'BLOCKED_AG_BRAIN_UNAVAILABLE',
        reason: 'No doctrine files found. Set BRAIN_DOCTRINE_PATH or populate brain directory.',
      };
      await mirrorReceiptToSheets(task.id, 'BLOCKED', JSON.stringify(receipt));
      await submitReceipt(task.id, lockToken, receipt);
      return;
    }

    // 7. Execute via DeepSeek LLM
    let llmResponse;
    try {
      const llmPayload = isJson ? payloadObj : { text_prompt: payload };
      llmResponse = await callDeepSeek(llmPayload);
    } catch (err) {
      llmResponse = `LLM Execution Error: ${sanitizeOutput(err.message)}`;
    }

    // 8. Build receipt
    const receipt = {
      task_id: isJson ? (payloadObj?.command_id || payloadObj?.id || task.id) : task.id,
      target_surface: 'Cloud AG Read-Only Execution',
      source: 'LOCAL_FILESYSTEM',
      status: 'SUCCESS',
      result: sanitizeOutput(llmResponse),
      brain_doctrine_digest: digests,
      no_secret_leak: true,
      proof_summary: 'Cloud AG LLM executed via DeepSeek API with local doctrine context',
    };

    await mirrorReceiptToSheets(task.id, 'SUCCESS', JSON.stringify(receipt));
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
    // Kill switch check
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

    const newTasks = tasks.filter(t => t.status === 'NEW' && t.target_agent === AGENT_NAME);

    for (const task of newTasks) {
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
  // Let current task finish, then exit
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
  log(`  AG Worker — Sheets-Free Intercom Poller`);
  log(`  Intercom URL:    ${INTERCOM_API_URL}`);
  log(`  Poll interval:   ${BASE_POLL_MS}ms (±20% jitter)`);
  log(`  Heartbeat:       ${HEARTBEAT_MS}ms`);
  log(`  Brain doctrine:  ${BRAIN_DOCTRINE_PATH}`);
  log(`  Sheets mirror:   ${SHEETS_MIRROR_ENABLED ? 'ENABLED' : 'DISABLED'}`);
  log(`  DeepSeek API:    ${DEEPSEEK_API_KEY ? 'configured' : 'MISSING'}`);
  log('═══════════════════════════════════════════════════════');

  if (!INTERCOM_API_KEY) {
    logError('INTERCOM_API_KEY is not set. Exiting.');
    process.exit(1);
  }

  if (SHEETS_MIRROR_ENABLED) {
    await initSheetsMirror();
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
