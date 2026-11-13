#!/usr/bin/env node
// NEO Brain bootstrap v3
// - Surfaces exact error_code on backend 207/unavailable instead of failing blind.
// - Falls back to direct GitHub Brain pull when backend cannot reach the repo.
// - Persists every successful fetch to .neo-remote-brain/brain-live.json (warm boot).

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKSPACE = resolve(HERE, "..");
const SNAPSHOT_DIR = resolve(WORKSPACE, ".neo-remote-brain");
const SNAPSHOT_PATH = resolve(SNAPSHOT_DIR, "brain-live.json");

const endpoint = String(process.env.NEO_BRAIN_BRIDGE_URL || "").trim();
const token = String(process.env.NEO_BRAIN_BRIDGE_TOKEN || "").trim();
// Fallback order matches the Railway start script: the GeminX Brain token is the
// founder-approved GitHub credential for this runtime. Without it here, the
// direct-GitHub fallback silently degrades to "no token" on a fresh container
// where only GEMINX_AGENT_BRAIN_TOKEN is injected.
const ghToken = String(
  process.env.GEMINX_AGENT_BRAIN_TOKEN ||
    process.env.GITHUB_PAT ||
    process.env.GITHUB_TOKEN ||
    process.env.GH_TOKEN ||
    "",
).trim();
const GH_REPO = String(process.env.NEO_BRAIN_GITHUB_REPO || "R1mob2-svg/global-agent-brain").trim();
const GH_REF = String(process.env.NEO_BRAIN_GITHUB_REF || "main").trim();

const BRAIN_SOURCES = [
  "Agents/NEO/OPERATING_RULES.md",
  "Agents/NEO/ACTIVE_STATE.md",
  "Trading/PAPER_TOURNAMENT_RISK_STANDARD.md",
  "Agents/NEO/Handoffs/INDEX.md",
  "Shared_State/WHILE_YOU_WERE_SLEEPING.md",
  "Doctrine/DIGITAL_AMBUSH_MASTER_OPERATING_SYSTEM.md"
];

function log(msg) {
  process.stderr.write(`[neo-brain-bootstrap] ${msg}\n`);
}

async function persist(data) {
  await mkdir(SNAPSHOT_DIR, { recursive: true });
  await writeFile(SNAPSHOT_PATH, JSON.stringify({ ok: true, data }, null, 2), "utf8");
}

function emit(data) {
  process.stdout.write(JSON.stringify({
    schema_version: data.schema_version,
    generated_at: data.generated_at,
    brain_context_status: data.brain_context_status,
    brain_sources: Array.isArray(data.brain_sources) ? data.brain_sources : [],
    context: typeof data.context === "string" ? data.context : ""
  }));
}

function accepted(data) {
  return data && data.brain_context_status === "attached" && typeof data.context === "string" && data.context.trim().length > 0;
}

// ---------- Path 1: backend bridge ----------
async function tryBackend() {
  if (!endpoint || !token) {
    log("backend skipped: NEO_BRAIN_BRIDGE_URL/TOKEN not set");
    return null;
  }
  let response;
  try {
    response = await fetch(endpoint, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(15000)
    });
  } catch (err) {
    log(`backend fetch failed: ${err?.name || "error"}`);
    return null;
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    log(`backend returned non-JSON (HTTP ${response.status})`);
    return null;
  }

  const data = payload && typeof payload === "object" ? payload.data : null;

  if (accepted(data)) {
    log(`backend OK (HTTP ${response.status}) status=attached`);
    return { data, origin: "backend" };
  }

  const errorCode = data?.error_code || "(none)";
  const status = data?.status || "(none)";
  log(`backend NOT usable: HTTP ${response.status} error_code=${errorCode} status=${status} (was: NEO_BRAIN_BRIDGE_REJECTED)`);
  return null;
}

// ---------- Path 2: direct GitHub canonical pull ----------
async function ghFetchJson(url) {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${ghToken}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "neo-brain-bootstrap"
    },
    signal: AbortSignal.timeout(20000)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

function decodeContent(node) {
  if (!node || node.type !== "file" || typeof node.content !== "string") return "";
  return Buffer.from(node.content, node.encoding === "base64" ? "base64" : "utf8").toString("utf8");
}

async function tryGithub() {
  if (!ghToken) {
    log("github fallback skipped: no GITHUB_PAT/GITHUB_TOKEN/GH_TOKEN");
    return null;
  }

  let headSha = "";
  try {
    const commit = await ghFetchJson(`https://api.github.com/repos/${GH_REPO}/commits/${GH_REF}`);
    headSha = commit?.sha || "";
  } catch (err) {
    log(`github fallback failed resolving HEAD: ${err.message}`);
    return null;
  }
  if (!headSha) {
    log("github fallback failed: empty HEAD sha");
    return null;
  }

  const loaded = [];
  const chunks = [];
  let revision = headSha;

  for (const path of BRAIN_SOURCES) {
    try {
      const node = await ghFetchJson(`https://api.github.com/repos/${GH_REPO}/contents/${path}?ref=${revision}`);
      const text = decodeContent(node);
      if (!text.trim()) {
        log(`github source empty: ${path}`);
        continue;
      }
      loaded.push({ kind: "file", path, title: path, url: node.html_url || null, sha: node.sha || null });
      chunks.push(`===== ${path} (sha=${(node.sha || "").slice(0, 12)}) =====\n${text.trim()}`);
    } catch (err) {
      log(`github source skipped ${path}: ${err.message}`);
    }
  }

  if (!chunks.length) {
    log("github fallback failed: no sources loaded");
    return null;
  }

  const now = new Date().toISOString();
  const data = {
    schema_version: "neo.brain-bootstrap.v3",
    generated_at: now,
    status: "attached",
    sources: loaded,
    continuation: "ORIGINAL_NEO_CANONICAL_GITHUB_BRAIN",
    brain_context_status: "attached",
    brain_sources: loaded.map((s) => s.path),
    execution_truth: {
      schema_version: "neo.session-execution-truth.v1",
      resolved_at: now,
      repository: GH_REPO,
      canonical_ref: GH_REF,
      canonical_head_sha: headSha,
      runtime_sha: headSha,
      runtime_branch: GH_REF,
      truth_status: "CURRENT",
      warnings: ["BRAIN_SOURCE=DIRECT_GITHUB_FALLBACK", "BACKEND_BRIDGE=UNAVAILABLE"]
    },
    local_memory_fallback: false,
    error_code: null,
    context: chunks.join("\n\n")
  };

  log(`github fallback OK: ${loaded.length} sources @ ${headSha.slice(0, 12)}`);
  return { data, origin: "github" };
}

// ---------- Path 3: warm disk snapshot ----------
async function trySnapshot() {
  try {
    const raw = await readFile(SNAPSHOT_PATH, "utf8");
    const parsed = JSON.parse(raw);
    const data = parsed?.data;
    if (accepted(data)) {
      log(`warm snapshot OK: generated_at=${data.generated_at}`);
      return { data, origin: "snapshot" };
    }
  } catch {
    /* no usable snapshot */
  }
  return null;
}

// ---------- main ----------
let result = await tryBackend();
if (!result) result = await tryGithub();
if (!result) result = await trySnapshot();

if (!result) {
  log("NEO_BRAIN_BRIDGE_UNAVAILABLE (backend failed, github fallback failed, no warm snapshot)");
  process.exit(78);
}

try {
  await persist(result.data);
  log(`persisted -> ${SNAPSHOT_PATH} (origin=${result.origin})`);
} catch (err) {
  log(`persist failed: ${err.message}`);
}

emit(result.data);
