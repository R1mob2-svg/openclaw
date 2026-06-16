/**
 * GitHub Receipt Writer — Intercom → GitHub Issue Comment Bridge
 * ===============================================================
 * Polls for tasks in READY_FOR_AUDIT status and posts receipt data
 * as formatted markdown comments on GitHub issues.
 * ZERO Google Sheets dependency.
 *
 * Env vars:
 *   INTERCOM_API_URL  — Base URL of the Intercom API (default: http://localhost:4444)
 *   INTERCOM_API_KEY  — x-api-key header value
 *   GITHUB_TOKEN      — GitHub Personal Access Token for API access
 */

'use strict';

require('dotenv').config({ override: true });

// ─── Configuration ──────────────────────────────────────────────────────────────

const AGENT_NAME = 'github-receipt-writer';
const INTERCOM_API_URL = (process.env.INTERCOM_API_URL || 'http://localhost:4444').replace(/\/+$/, '');
const INTERCOM_API_KEY = process.env.INTERCOM_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

const BASE_POLL_MS = 30000;
const MAX_BACKOFF_MS = 120000;

const INTERCOM_HEADERS = {
  'Content-Type': 'application/json',
  'x-api-key': INTERCOM_API_KEY,
};

const GITHUB_HEADERS = {
  'Accept': 'application/vnd.github+json',
  'Authorization': `Bearer ${GITHUB_TOKEN}`,
  'X-GitHub-Api-Version': '2022-11-28',
  'Content-Type': 'application/json',
};

let running = true;
let consecutiveErrors = 0;

// Track which tasks we've already written comments for (in-memory, reset on restart)
const processedTasks = new Set();

// ─── Logging ────────────────────────────────────────────────────────────────────

function log(msg) {
  console.log(`[${new Date().toISOString()}] [GH Receipt Writer] ${msg}`);
}

function logError(msg) {
  console.error(`[${new Date().toISOString()}] [GH Receipt Writer] ERROR: ${msg}`);
}

// ─── Sanitizer ──────────────────────────────────────────────────────────────────

function sanitizeOutput(text) {
  if (typeof text !== 'string') return String(text);
  let s = text;
  const secretVars = [INTERCOM_API_KEY, GITHUB_TOKEN];
  for (const secret of secretVars) {
    if (secret && secret.length > 10) {
      s = s.split(secret).join('[REDACTED]');
    }
  }
  s = s.replace(/\b(ghp_[A-Za-z0-9]{36,})\b/g, '[REDACTED_GH_PAT]');
  s = s.replace(/\b(ghs_[A-Za-z0-9]{36,})\b/g, '[REDACTED_GH_SECRET]');
  s = s.replace(/\b(sk-[A-Za-z0-9]{20,})\b/g, '[REDACTED_API_KEY]');
  s = s.replace(/\b(AIza[A-Za-z0-9_-]{30,})\b/g, '[REDACTED_GOOGLE_KEY]');
  s = s.replace(/(\+44\s?7\d{3}\s?\d{6})/g, '[REDACTED_PHONE]');
  s = s.replace(/(\b0\d{4}\s?\d{6}\b)/g, '[REDACTED_PHONE]');
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
    headers: { ...INTERCOM_HEADERS, ...(options.headers || {}) },
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

// ─── Format Receipt as Markdown ─────────────────────────────────────────────────

function formatReceiptComment(task) {
  const receipt = task.receipt || '';
  let receiptObj = null;
  try {
    receiptObj = typeof receipt === 'string' ? JSON.parse(receipt) : receipt;
  } catch {
    receiptObj = null;
  }

  const timestamp = new Date().toISOString();
  const agent = task.assigned_agent || 'unknown';
  const taskId = task.id || 'unknown';

  let body = `## ☁️ CLOUDMAKER PICKUP ACK\n\n`;
  body += `| Field | Value |\n`;
  body += `|-------|-------|\n`;
  body += `| **Task ID** | \`${taskId}\` |\n`;
  body += `| **Agent** | ${agent} |\n`;
  body += `| **Status** | ${task.status || 'READY_FOR_AUDIT'} |\n`;
  body += `| **Timestamp** | ${timestamp} |\n`;

  if (receiptObj && typeof receiptObj === 'object') {
    // Add key receipt fields
    if (receiptObj.status) body += `| **Receipt Status** | ${receiptObj.status} |\n`;
    if (receiptObj.summary) body += `| **Summary** | ${sanitizeOutput(receiptObj.summary)} |\n`;
    if (receiptObj.proof_summary) body += `| **Proof** | ${sanitizeOutput(receiptObj.proof_summary)} |\n`;
    if (receiptObj.classification) body += `| **Classification** | ${receiptObj.classification} |\n`;
    if (receiptObj.target_surface) body += `| **Target Surface** | ${receiptObj.target_surface} |\n`;
    if (receiptObj.source) body += `| **Source** | ${receiptObj.source} |\n`;
    if (receiptObj.no_secret_leak !== undefined) body += `| **No Secret Leak** | ${receiptObj.no_secret_leak ? '✅' : '❌'} |\n`;
    if (receiptObj.brain_manifest_commit) body += `| **Brain Commit** | \`${receiptObj.brain_manifest_commit.substring(0, 12)}...\` |\n`;
    if (receiptObj.brain_doctrine_digest) {
      const digestPreview = typeof receiptObj.brain_doctrine_digest === 'object'
        ? Object.keys(receiptObj.brain_doctrine_digest).join(', ')
        : String(receiptObj.brain_doctrine_digest).substring(0, 20) + '...';
      body += `| **Doctrine Digest** | ${digestPreview} |\n`;
    }

    // Result (truncated if long)
    if (receiptObj.result) {
      const resultStr = sanitizeOutput(String(receiptObj.result));
      const truncated = resultStr.length > 500 ? resultStr.substring(0, 500) + '...' : resultStr;
      body += `\n### Result\n\n\`\`\`\n${truncated}\n\`\`\`\n`;
    }
  } else if (receipt) {
    body += `\n### Receipt Data\n\n\`\`\`\n${sanitizeOutput(String(receipt).substring(0, 1000))}\n\`\`\`\n`;
  }

  body += `\n---\n*Posted by Cloudmaker GitHub Receipt Writer at ${timestamp}*\n`;

  return body;
}

// ─── Post Comment to GitHub Issue ───────────────────────────────────────────────

async function postGitHubComment(owner, repo, issueNumber, body) {
  const url = `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments`;
  const res = await fetch(url, {
    method: 'POST',
    headers: GITHUB_HEADERS,
    body: JSON.stringify({ body }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`GitHub API ${res.status}: ${sanitizeOutput(errText)}`);
  }

  const data = await res.json();
  return data;
}

// ─── Process a Single Task ──────────────────────────────────────────────────────

async function processTask(task) {
  // Skip if already processed
  if (processedTasks.has(task.id)) return;

  // Check for required GitHub routing fields
  const sourceRepo = task.source_repo || task.metadata?.source_repo || 'R1mob2-svg/cloudmaker-agent-intercom';
  const sourceIssueNumber = task.source_issue_number || task.metadata?.source_issue_number || task.github_issue_number;

  if (!sourceRepo || !sourceIssueNumber) {
    log(`ORPHAN RECEIPT DETECTED ${task.id}: no source_repo or source_issue_number field.`);
    try {
      const fs = require('fs');
      const path = require('path');
      const orphanedDir = path.join(__dirname, '..', 'receipts', 'orphaned');
      if (!fs.existsSync(orphanedDir)) {
        fs.mkdirSync(orphanedDir, { recursive: true });
      }
      const orphanData = {
        task_id: task.id,
        reason: "Missing source_repo or source_issue_number",
        timestamp: new Date().toISOString(),
        raw_receipt: task.receipt || "No receipt payload attached"
      };
      fs.writeFileSync(path.join(orphanedDir, `${task.id}_summary.json`), JSON.stringify(orphanData, null, 2));
      log(`Quarantined orphan receipt ${task.id} to /receipts/orphaned/`);
    } catch (e) {
      logError(`Failed to quarantine orphan receipt ${task.id}: ${e.message}`);
    }
    processedTasks.add(task.id);
    return;
  }

  // Parse owner/repo
  const repoParts = sourceRepo.split('/');
  if (repoParts.length !== 2) {
    log(`Skipping ${task.id}: invalid source_repo format "${sourceRepo}" (expected "owner/repo").`);
    processedTasks.add(task.id);
    return;
  }

  const [owner, repo] = repoParts;
  const issueNum = parseInt(sourceIssueNumber, 10);
  if (isNaN(issueNum)) {
    log(`Skipping ${task.id}: invalid source_issue_number "${sourceIssueNumber}".`);
    processedTasks.add(task.id);
    return;
  }

  try {
    const commentBody = formatReceiptComment(task);
    await postGitHubComment(owner, repo, issueNum, commentBody);
    log(`Posted receipt comment for task ${task.id} → ${sourceRepo}#${issueNum}`);
    processedTasks.add(task.id);
  } catch (err) {
    logError(`Failed to post comment for ${task.id}: ${sanitizeOutput(err.message)}`);
    // Don't mark as processed so we retry next cycle
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

    const res = await intercomFetch('/tasks?status=READY_FOR_AUDIT');
    if (!res.ok) throw new Error(`Poll HTTP ${res.status}`);

    const data = await res.json();
    const tasks = Array.isArray(data) ? data : (data.tasks || []);

    const auditTasks = tasks.filter(t => t.status === 'READY_FOR_AUDIT');

    if (auditTasks.length > 0) {
      log(`Found ${auditTasks.length} task(s) in READY_FOR_AUDIT status.`);
    }

    for (const task of auditTasks) {
      if (!running) break;
      await processTask(task);
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
  log(`  GitHub Receipt Writer — Intercom → GitHub Bridge`);
  log(`  Intercom URL:    ${INTERCOM_API_URL}`);
  log(`  Poll interval:   ${BASE_POLL_MS}ms (±20% jitter)`);
  log(`  GitHub API:      ${GITHUB_TOKEN ? 'configured' : 'MISSING'}`);
  log(`  Sheets:          NONE (zero dependency)`);
  log('═══════════════════════════════════════════════════════');

  if (!INTERCOM_API_KEY) {
    logError('INTERCOM_API_KEY is not set. Exiting.');
    process.exit(1);
  }

  if (!GITHUB_TOKEN) {
    logError('GITHUB_TOKEN is not set. Exiting.');
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
