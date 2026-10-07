import path from "node:path";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";

const API_VERSION = "2022-11-28";
const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_EXECUTION_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const DEFAULT_NEO_DISPATCH_TIMEOUT_MS = 300_000;
const MAX_DISPATCH_ATTEMPTS = 3;
const EXECUTABLE_NEO_COMMANDS = new Set(["GEMINX_AUTONOMOUS_TASK_V1"]);
const TITLE_PREFIX = "AGENT_MESSAGE_BUS:";
const SAFE_ID = /^[A-Za-z0-9._-]{1,160}$/;
const SAFE_AGENT = /^[A-Za-z0-9._-]{1,80}$/;
const DEFAULT_REPOS = ["R1mob2-svg/geminx-v2", "R1mob2-svg/global-agent-brain"];

function env(name) {
  return String(process.env[name] ?? "").trim();
}

function repos() {
  const configured = env("GEMINX_AGENT_BUS_REPOS");
  if (!configured) return DEFAULT_REPOS;
  const values = configured.split(",").map((value) => value.trim()).filter(Boolean);
  return values.length ? [...new Set(values)] : DEFAULT_REPOS;
}

function intervalMs() {
  const raw = Number(env("GEMINX_AGENT_BUS_POLL_MS"));
  return Number.isFinite(raw) && raw >= 15_000 ? Math.floor(raw) : DEFAULT_INTERVAL_MS;
}

function executionMaxAgeMs() {
  const raw = Number(env("GEMINX_AGENT_BUS_EXECUTION_MAX_AGE_MS"));
  if (!Number.isFinite(raw)) return DEFAULT_EXECUTION_MAX_AGE_MS;
  return Math.max(15 * 60 * 1000, Math.min(24 * 60 * 60 * 1000, Math.floor(raw)));
}

function neoDispatchTimeoutMs() {
  const raw = Number(env("GEMINX_AGENT_BUS_NEO_DISPATCH_TIMEOUT_MS"));
  if (!Number.isFinite(raw)) return DEFAULT_NEO_DISPATCH_TIMEOUT_MS;
  return Math.max(120_000, Math.min(300_000, Math.floor(raw)));
}

function runtimeRoot() {
  // Keep the issue poller on the exact same durable directory as CommsStore.
  // Railway provides a mounted volume even when GEMINX_RUNTIME_ROOT is unset.
  const explicit = env("GEMINX_RUNTIME_ROOT");
  if (explicit) return path.resolve(explicit);
  const volume = env("RAILWAY_VOLUME_MOUNT_PATH");
  if (volume) return path.join(path.resolve(volume), "geminx-runtime");
  return path.join(process.cwd(), "runtime");
}

function commsRoot() {
  const root = path.join(runtimeRoot(), "comms");
  mkdirSync(root, { recursive: true });
  return root;
}

function safeMessageId(messageId) {
  return messageId.replace(/[^A-Za-z0-9._-]/g, "_");
}

function messagePath(messageId) {
  return path.join(commsRoot(), `${safeMessageId(messageId)}.json`);
}

function dispatchStatePath(messageId) {
  const root = path.join(commsRoot(), "dispatch");
  mkdirSync(root, { recursive: true });
  return path.join(root, `${safeMessageId(messageId)}.json`);
}

function executionReceiptPath(messageId) {
  const root = path.join(commsRoot(), "receipts");
  mkdirSync(root, { recursive: true });
  return path.join(root, `${safeMessageId(messageId)}.json`);
}

function atomicWrite(filePath, value) {
  const temp = `${filePath}.${process.pid}.agent-bus.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2), "utf8");
  renameSync(temp, filePath);
}

function parseFields(body) {
  const fields = {};
  const lines = String(body ?? "").replace(/\r/g, "").split("\n");
  for (const line of lines) {
    const match = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!match) continue;
    const key = match[1].trim().toLowerCase();
    if (!(key in fields)) fields[key] = match[2].trim();
  }
  return fields;
}

function validEnvelope(issue) {
  if (!issue || typeof issue !== "object") return null;
  if (issue.pull_request) return null;
  const title = typeof issue.title === "string" ? issue.title : "";
  if (!title.startsWith(TITLE_PREFIX)) return null;

  const fields = parseFields(issue.body);
  const messageId = fields.message_id;
  const correlationId = fields.correlation_id || messageId;
  const sender = fields.sender;
  const recipient = fields.recipient;
  const status = String(fields.status ?? "SENT").toUpperCase();
  if (!messageId || !SAFE_ID.test(messageId)) return null;
  if (!correlationId || !SAFE_ID.test(correlationId)) return null;
  if (!sender || !SAFE_AGENT.test(sender)) return null;
  if (!recipient || !SAFE_AGENT.test(recipient)) return null;
  if (!["SENT", "RECEIVED", "ACKNOWLEDGED", "STARTED", "RUNNING", "BLOCKED", "DONE", "COMPLETED"].includes(status)) return null;

  let commandPayload = {};
  if (fields.payload_b64) {
    try {
      const decoded = Buffer.from(fields.payload_b64, "base64").toString("utf8");
      const parsed = JSON.parse(decoded);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
      commandPayload = parsed;
    } catch {
      return null;
    }
  }

  if (
    typeof commandPayload.command === "string" &&
    fields.command &&
    commandPayload.command !== fields.command
  ) return null;

  return {
    messageId,
    correlationId,
    sender,
    recipient,
    status,
    priority: fields.priority || "NORMAL",
    command: fields.command || "UNSPECIFIED",
    project: fields.project || null,
    replyTo: fields.reply_to || null,
    leaseUntil: fields.lease_until || null,
    commandPayload,
  };
}

function githubHeaders(token, etag) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": API_VERSION,
    "User-Agent": "GeminX-Agent-Message-Bus/1.0",
    ...(etag ? { "If-None-Match": etag } : {}),
  };
}

const etags = new Map();

async function fetchOpenIssues(repo, token) {
  const endpoint = new URL(`https://api.github.com/repos/${repo}/issues`);
  endpoint.searchParams.set("state", "open");
  endpoint.searchParams.set("sort", "updated");
  endpoint.searchParams.set("direction", "desc");
  endpoint.searchParams.set("per_page", "100");

  const response = await fetch(endpoint, {
    headers: githubHeaders(token, etags.get(repo)),
    signal: typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(15_000) : undefined,
  });

  if (response.status === 304) return [];
  if (!response.ok) throw new Error(`issues_http_${response.status}`);
  const etag = response.headers.get("etag");
  if (etag) etags.set(repo, etag);
  const body = await response.json();
  return Array.isArray(body) ? body : [];
}

async function fetchIssueComments(repo, issueNumber, token) {
  const endpoint = new URL(`https://api.github.com/repos/${repo}/issues/${issueNumber}/comments`);
  endpoint.searchParams.set("per_page", "100");
  const response = await fetch(endpoint, {
    headers: githubHeaders(token),
    signal: typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(15_000) : undefined,
  });
  if (!response.ok) throw new Error(`issue_comments_http_${response.status}`);
  const body = await response.json();
  return Array.isArray(body) ? body : [];
}

async function envelopeForIssue(repo, issue, token) {
  const direct = validEnvelope(issue);
  if (direct) return direct;
  const title = typeof issue?.title === "string" ? issue.title : "";
  const issueNumber = Number(issue?.number);
  if (!title.startsWith(TITLE_PREFIX) || !Number.isSafeInteger(issueNumber)) return null;

  // Corrections are often posted as issue comments. Read newest-first and accept
  // the latest complete machine envelope instead of silently ignoring it.
  const comments = await fetchIssueComments(repo, issueNumber, token);
  for (const comment of [...comments].reverse()) {
    const candidate = validEnvelope({
      title,
      body: comment?.body ?? "",
    });
    if (candidate) return candidate;
  }
  return null;
}

function localStatus(remoteStatus) {
  if (remoteStatus === "BLOCKED") return "BLOCKED";
  if (remoteStatus === "DONE" || remoteStatus === "COMPLETED") return "COMPLETED";
  if (remoteStatus === "ACKNOWLEDGED") return "ACKNOWLEDGED";
  if (remoteStatus === "STARTED" || remoteStatus === "RUNNING") return "RUNNING";
  return "QUEUED";
}

function buildMessage(repo, issue, envelope) {
  if (!envelope) return null;
  const issueNumber = Number(issue.number);
  const issueUrl = typeof issue.html_url === "string" ? issue.html_url : null;
  const createdAt = typeof issue.created_at === "string" ? issue.created_at : new Date().toISOString();
  return {
    message_id: envelope.messageId,
    correlation_id: envelope.correlationId,
    sender: envelope.sender,
    recipient: envelope.recipient,
    created_at: createdAt,
    priority: envelope.priority,
    type: "github_issue_bus",
    payload: {
      command: envelope.command,
      project: envelope.project,
      issue_repo: repo,
      issue_number: Number.isSafeInteger(issueNumber) ? issueNumber : null,
      issue_url: issueUrl,
      reply_to: envelope.replyTo,
      lease_until: envelope.leaseUntil,
      ...envelope.commandPayload,
    },
    requires_reply: true,
    status: localStatus(envelope.status),
  };
}

function ingestIssue(repo, issue, envelope) {
  const message = buildMessage(repo, issue, envelope);
  if (!message) return { message: null, created: false };

  const filePath = messagePath(message.message_id);
  if (existsSync(filePath)) return { message, created: false };

  atomicWrite(filePath, message);
  const issueNumber = Number(issue.number);
  console.log(`[agent-message-bus] action=queued repo=${repo} issue=${Number.isSafeInteger(issueNumber) ? issueNumber : "unknown"} message_id=${message.message_id} sender=${message.sender} recipient=${message.recipient} command=${message.payload.command}`);
  return { message, created: true };
}

function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function shouldDispatchToNeo(message) {
  if (!message) return false;
  if (String(message.recipient ?? "").toLowerCase() !== "neo") return false;
  if (String(message.sender ?? "").toLowerCase() !== "newton") return false;
  if (!EXECUTABLE_NEO_COMMANDS.has(String(message.payload?.command ?? ""))) return false;
  if (!["QUEUED", "ACKNOWLEDGED"].includes(String(message.status ?? ""))) return false;
  const createdMs = Date.parse(String(message.created_at ?? ""));
  if (!Number.isFinite(createdMs)) return false;
  return Date.now() - createdMs >= 0 && Date.now() - createdMs <= executionMaxAgeMs();
}

function boundedReceiptText(value) {
  return String(value ?? "")
    .replace(/\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{16,}\b/gi, "[REDACTED_GITHUB_TOKEN]")
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, "[REDACTED_API_KEY]")
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]{16,}/gi, "Bearer [REDACTED]")
    .slice(0, 4000);
}

function promptForNeoBusMessage(message) {
  const payload = JSON.stringify(message.payload ?? {}, null, 2);
  return [
    "AGENT_MESSAGE_BUS_OBJECTIVE_V1",
    `message_id=${message.message_id}`,
    `correlation_id=${message.correlation_id}`,
    `sender=${message.sender}`,
    `priority=${message.priority}`,
    "",
    "This is a founder-authorized NEO coordination objective delivered through the canonical GitHub agent bus.",
    "Own the objective end-to-end using native OpenClaw tools. Recover mechanically discoverable repo/service/runtime details yourself.",
    "Do not ask Rob to point you at a repo/service when current tools or the canonical Brain can resolve it.",
    "Do not claim PASS without mechanical evidence. After any repair, rerun the same failed probe.",
    "Return a concise terminal receipt with status, evidence, remaining blocker if any, and next action.",
    "",
    "PAYLOAD:",
    payload,
  ].join("\n");
}

async function postIssueReceipt(repo, issueNumber, token, message, status, responseText) {
  if (!Number.isSafeInteger(issueNumber)) return;
  const receiptPayload = {
    schema_version: "openclaw.neo-agent-message-bus-receipt.v1",
    message_id: message.message_id,
    correlation_id: message.correlation_id,
    status,
    response: boundedReceiptText(responseText),
    observed_at: new Date().toISOString(),
  };
  const body = [
    `message_id: ${message.message_id}-receipt`,
    `correlation_id: ${message.correlation_id}`,
    "sender: neo",
    `recipient: ${message.sender}`,
    `status: ${status}`,
    `priority: ${message.priority}`,
    "command: AGENT_MESSAGE_BUS_RECEIPT_V1",
    `payload_b64: ${Buffer.from(JSON.stringify(receiptPayload), "utf8").toString("base64")}`,
  ].join("\n");
  const response = await fetch(`https://api.github.com/repos/${repo}/issues/${issueNumber}/comments`, {
    method: "POST",
    headers: {
      ...githubHeaders(token),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ body }),
    signal: typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(15_000) : undefined,
  });
  if (!response.ok) throw new Error(`receipt_comment_http_${response.status}`);
}

async function dispatchNeoMessage(repo, issue, token, message) {
  if (!shouldDispatchToNeo(message)) return false;
  const receiptFile = executionReceiptPath(message.message_id);
  if (existsSync(receiptFile)) return false;

  const stateFile = dispatchStatePath(message.message_id);
  const state = readJsonFile(stateFile, { attempts: 0 });
  const attempts = Number(state?.attempts ?? 0);
  if (attempts >= MAX_DISPATCH_ATTEMPTS) return false;

  const gatewayToken = env("OPENCLAW_GATEWAY_TOKEN");
  if (!gatewayToken) {
    console.log(`[agent-message-bus] action=dispatch_blocked message_id=${message.message_id} reason=gateway_token_missing`);
    return false;
  }

  const nextAttempts = attempts + 1;
  atomicWrite(stateFile, {
    attempts: nextAttempts,
    last_attempt_at: new Date().toISOString(),
  });

  let terminalStatus = "BLOCKED";
  let terminalText = "";
  try {
    const response = await fetch("http://127.0.0.1:8080/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${gatewayToken}`,
        "Content-Type": "application/json",
        "X-OpenClaw-Message-Channel": "agent-message-bus",
      },
      body: JSON.stringify({
        model: "openclaw",
        stream: false,
        user: `agent-bus-${message.message_id}`,
        messages: [{ role: "user", content: promptForNeoBusMessage(message) }],
      }),
      signal: typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(neoDispatchTimeoutMs()) : undefined,
    });

    if (!response.ok) {
      terminalText = `gateway_http_${response.status}`;
      throw new Error(terminalText);
    }
    const body = await response.json();
    terminalText = boundedReceiptText(body?.choices?.[0]?.message?.content ?? "");
    if (!terminalText) throw new Error("gateway_empty_response");
    terminalStatus = "COMPLETED";

    atomicWrite(receiptFile, {
      schema_version: "openclaw.neo-agent-message-bus-receipt.v1",
      message_id: message.message_id,
      correlation_id: message.correlation_id,
      status: terminalStatus,
      attempts: nextAttempts,
      response: terminalText,
      observed_at: new Date().toISOString(),
    });
    console.log(`[agent-message-bus] action=executed message_id=${message.message_id} correlation_id=${message.correlation_id} status=${terminalStatus} attempts=${nextAttempts}`);

    try {
      await postIssueReceipt(repo, Number(issue.number), token, message, terminalStatus, terminalText);
      console.log(`[agent-message-bus] action=receipt_mirrored repo=${repo} issue=${Number(issue.number)} message_id=${message.message_id}`);
    } catch (error) {
      const mirrorError = error instanceof Error ? error.message : String(error);
      console.log(`[agent-message-bus] action=receipt_mirror_failed message_id=${message.message_id} error=${mirrorError.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 160)}`);
    }
    return true;
  } catch (error) {
    const failure = error instanceof Error ? error.message : String(error);
    console.log(`[agent-message-bus] action=dispatch_failed message_id=${message.message_id} attempt=${nextAttempts}/${MAX_DISPATCH_ATTEMPTS} error=${failure.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 160)}`);
    if (nextAttempts >= MAX_DISPATCH_ATTEMPTS) {
      atomicWrite(receiptFile, {
        schema_version: "openclaw.neo-agent-message-bus-receipt.v1",
        message_id: message.message_id,
        correlation_id: message.correlation_id,
        status: terminalStatus,
        attempts: nextAttempts,
        error: boundedReceiptText(failure),
        observed_at: new Date().toISOString(),
      });
      try {
        await postIssueReceipt(repo, Number(issue.number), token, message, terminalStatus, failure);
      } catch {}
    }
    return false;
  }
}

async function sweep() {
  const tokenCandidates = [
    ["GEMINX_REPO_ACCESS_TOKEN", env("GEMINX_REPO_ACCESS_TOKEN")],
    ["GH_TOKEN", env("GH_TOKEN")],
    ["GITHUB_TOKEN", env("GITHUB_TOKEN")],
    ["GITHUB_PAT", env("GITHUB_PAT")]
  ];
  const selected = tokenCandidates.find(([, value]) => Boolean(value));
  const token = selected?.[1] ?? "";
  const tokenSource = selected?.[0] ?? "none";
  if (!token) {
    console.log("[agent-message-bus] skipped=repo_access_missing");
    return;
  }
  console.log(`[agent-message-bus] auth_source=${tokenSource}`);

  let discovered = 0;
  for (const repo of repos()) {
    try {
      const issues = await fetchOpenIssues(repo, token);
      for (const issue of issues) {
        const envelope = await envelopeForIssue(repo, issue, token);
        const ingested = ingestIssue(repo, issue, envelope);
        if (ingested.created) discovered += 1;
        if (ingested.message) {
          await dispatchNeoMessage(repo, issue, token, ingested.message);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`[agent-message-bus] repo=${repo} error=${message.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 160)}`);
    }
  }
  if (discovered > 0) console.log(`[agent-message-bus] sweep_queued=${discovered}`);
}

let running = false;
async function guardedSweep() {
  if (running) return;
  running = true;
  try {
    await sweep();
  } finally {
    running = false;
  }
}

console.log(`[agent-message-bus] started interval_ms=${intervalMs()} repos=${repos().join(",")}`);
await guardedSweep();
setInterval(() => void guardedSweep(), intervalMs());
