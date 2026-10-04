import path from "node:path";
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";

const API_VERSION = "2022-11-28";
const DEFAULT_INTERVAL_MS = 60_000;
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

function messagePath(messageId) {
  return path.join(commsRoot(), `${messageId.replace(/[^A-Za-z0-9._-]/g, "_")}.json`);
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

function ingestIssue(repo, issue, envelope) {
  if (!envelope) return false;

  const filePath = messagePath(envelope.messageId);
  if (existsSync(filePath)) return false;

  const issueNumber = Number(issue.number);
  const issueUrl = typeof issue.html_url === "string" ? issue.html_url : null;
  const createdAt = typeof issue.created_at === "string" ? issue.created_at : new Date().toISOString();
  const message = {
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

  atomicWrite(filePath, message);
  console.log(`[agent-message-bus] action=queued repo=${repo} issue=${Number.isSafeInteger(issueNumber) ? issueNumber : "unknown"} message_id=${envelope.messageId} sender=${envelope.sender} recipient=${envelope.recipient} command=${envelope.command}`);
  return true;
}

async function sweep() {
  const token = env("GEMINX_REPO_ACCESS_TOKEN");
  if (!token) {
    console.log("[agent-message-bus] skipped=repo_access_missing");
    return;
  }

  let discovered = 0;
  for (const repo of repos()) {
    try {
      const issues = await fetchOpenIssues(repo, token);
      for (const issue of issues) {
        const envelope = await envelopeForIssue(repo, issue, token);
        if (ingestIssue(repo, issue, envelope)) discovered += 1;
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
