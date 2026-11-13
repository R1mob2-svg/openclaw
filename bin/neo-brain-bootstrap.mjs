#!/usr/bin/env node
// NEO Brain bootstrap v4
// - Surfaces exact error_code on backend 207/unavailable instead of failing blind.
// - Falls back to direct GitHub Brain pull when backend cannot reach the repo.
// - Persists every successful fetch to .neo-remote-brain/brain-live.json (warm boot).
// - Revision-keyed cache validation: a snapshot is only trusted when it carries an
//   explicit brain_revision. Legacy revision-less snapshots are refused, and a
//   snapshot whose revision differs from the live backend is rewritten with the
//   fresh payload instead of being served.

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKSPACE = resolve(HERE, "..");
const SNAPSHOT_DIR = resolve(WORKSPACE, ".neo-remote-brain");
const SNAPSHOT_PATH = resolve(SNAPSHOT_DIR, "brain-live.json");
const SCHEMA_VERSION = "neo.brain-bootstrap.v4";

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

// ---------- revision helpers ----------

/** A revision only counts when it is a non-empty scalar string. */
export function normalizeRevision(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Revision the payload is pinned to: data.brain_revision, else the execution-truth head. */
export function payloadRevision(data) {
  return (
    normalizeRevision(data?.brain_revision) ||
    normalizeRevision(data?.execution_truth?.canonical_head_sha)
  );
}

export function accepted(data) {
  return (
    data &&
    data.brain_context_status === "attached" &&
    typeof data.context === "string" &&
    data.context.trim().length > 0
  );
}

/**
 * Decide whether a persisted snapshot may be served.
 * A legacy snapshot with no brain_revision is refused (that is exactly the stale
 * 2026-11-13 12:03 snapshot) because freshness cannot be confirmed for it.
 */
export function inspectSnapshot(parsed) {
  const data = parsed?.data;
  if (!accepted(data)) {
    return { usable: false, reason: "SNAPSHOT_UNUSABLE_PAYLOAD", data: null, revision: null };
  }
  const revision = payloadRevision(data) || normalizeRevision(parsed?.brain_revision);
  if (!revision) {
    return { usable: false, reason: "SNAPSHOT_REVISION_MISSING", data, revision: null };
  }
  return { usable: true, reason: "SNAPSHOT_OK", data, revision };
}

/** Explicit staleness metadata attached whenever we fall back to disk cache. */
export function staleNotice({ cachedRevision, liveRevision }) {
  const freshness = !liveRevision
    ? "UNCONFIRMED"
    : cachedRevision === liveRevision
      ? "CONFIRMED_MATCH"
      : "MISMATCH";
  const stale = freshness !== "CONFIRMED_MATCH";
  return {
    cached_brain_revision: cachedRevision || null,
    live_brain_revision: liveRevision || null,
    revision_freshness: freshness,
    cache_stale: stale,
    staleness_warning: stale,
    warning: stale
      ? `SERVING_CACHED_BRAIN_CONTEXT: revision freshness ${freshness} (cached=${cachedRevision || "none"}, live=${liveRevision || "unavailable"})`
      : null
  };
}

export function shouldRefreshCache({ liveRevision, cachedRevision }) {
  if (!liveRevision) {
    return { refresh: true, reason: "LIVE_REVISION_UNAVAILABLE" };
  }
  if (!cachedRevision) {
    return { refresh: true, reason: "SNAPSHOT_REVISION_MISSING" };
  }
  if (liveRevision !== cachedRevision) {
    return { refresh: true, reason: "REVISION_MISMATCH" };
  }
  return { refresh: false, reason: "REVISION_MATCH" };
}

async function persist(data, { origin, revision, snapshotDir = SNAPSHOT_DIR, snapshotPath = SNAPSHOT_PATH } = {}) {
  const pinned = normalizeRevision(revision) || payloadRevision(data);
  await mkdir(snapshotDir, { recursive: true });
  const envelope = {
    ok: true,
    schema_version: SCHEMA_VERSION,
    brain_revision: pinned,
    cache_written_at: new Date().toISOString(),
    origin: origin || "unknown",
    data: pinned ? { ...data, brain_revision: pinned } : { ...data }
  };
  await writeFile(snapshotPath, JSON.stringify(envelope, null, 2), "utf8");
  return envelope;
}

function emit(data, extra = {}) {
  process.stdout.write(
    JSON.stringify({
      schema_version: data.schema_version,
      generated_at: data.generated_at,
      brain_context_status: data.brain_context_status,
      brain_sources: Array.isArray(data.brain_sources) ? data.brain_sources : [],
      context: typeof data.context === "string" ? data.context : "",
      brain_revision: payloadRevision(data),
      cache_origin: extra.cache_origin || null,
      ...(extra.cache ? { cache: extra.cache } : {})
    }),
  );
}

// ---------- Path 1: backend bridge ----------
async function tryBackend({ endpoint: ep = endpoint, token: tk = token, fetcher = fetch } = {}) {
  if (!ep || !tk) {
    log("backend skipped: NEO_BRAIN_BRIDGE_URL/TOKEN not set");
    return null;
  }
  let response;
  try {
    response = await fetcher(ep, {
      method: "GET",
      headers: { Authorization: `Bearer ${tk}`, Accept: "application/json" },
      signal: AbortSignal.timeout(15000)
    });
  } catch (err) {
    log(`backend fetch failed: ${err?.name || "error"}`);
    return null;
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    log(`backend returned non-JSON (HTTP ${response.status})`);
    return null;
  }

  const data = payload && typeof payload === "object" ? payload.data : null;

  if (accepted(data)) {
    const revision = payloadRevision(data);
    log(`backend OK (HTTP ${response.status}) status=attached revision=${revision || "(none)"}`);
    return { data, origin: "backend", revision };
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
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return res.json();
}

function decodeContent(node) {
  if (!node || node.type !== "file" || typeof node.content !== "string") {
    return "";
  }
  return Buffer.from(node.content, node.encoding === "base64" ? "base64" : "utf8").toString("utf8");
}

async function tryGithub() {
  if (!ghToken) {
    log("github fallback skipped: no GITHUB_PAT/GITHUB_TOKEN/GH_TOKEN");
    return null;
  }

  let headSha;
  try {
    const commit = await ghFetchJson(`https://api.github.com/repos/${GH_REPO}/commits/${GH_REF}`);
    headSha = normalizeRevision(commit?.sha) || "";
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
  const revision = headSha;

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
    schema_version: "neo.brain-bootstrap.v4",
    generated_at: now,
    status: "attached",
    sources: loaded,
    continuation: "ORIGINAL_NEO_CANONICAL_GITHUB_BRAIN",
    brain_context_status: "attached",
    brain_sources: loaded.map((s) => s.path),
    brain_revision: headSha,
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
  return { data, origin: "github", revision: headSha };
}

// ---------- Path 3: warm disk snapshot ----------
async function trySnapshot({ snapshotPath = SNAPSHOT_PATH } = {}) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(snapshotPath, "utf8"));
  } catch {
    return null;
  }
  const inspected = inspectSnapshot(parsed);
  if (!inspected.usable) {
    log(`warm snapshot REFUSED: ${inspected.reason} (brain_revision=${inspected.revision || "missing"})`);
    return null;
  }
  log(`warm snapshot OK: revision=${inspected.revision} generated_at=${inspected.data.generated_at}`);
  return { data: inspected.data, origin: "snapshot", revision: inspected.revision };
}

// ---------- orchestration ----------
/**
 * Resolve Brain context with revision-keyed caching, then persist the outcome.
 * Order: live backend -> direct GitHub -> revision-validated disk snapshot.
 */
export async function resolveBootstrap({
  fetcher = fetch,
  snapshotPath = SNAPSHOT_PATH,
  snapshotDir = SNAPSHOT_DIR,
  backend = endpoint,
  bridgeToken = token,
  disableBackend = false,
  disableGithub = false
} = {}) {
  const cachedBefore = await trySnapshot({ snapshotPath });
  const cachedRevision = cachedBefore?.revision || null;

  let result = null;
  let liveRevision = null;

  if (!disableBackend) {
    result = await tryBackend({ endpoint: backend, token: bridgeToken, fetcher });
    liveRevision = result?.revision || null;
  }
  if (!result && !disableGithub) {
    result = await tryGithub();
    liveRevision = result?.revision || null;
  }

  let cache = null;

  if (result) {
    const decision = shouldRefreshCache({ liveRevision: result.revision, cachedRevision });
    try {
      const envelope = await persist(result.data, {
        origin: result.origin,
        revision: result.revision,
        snapshotDir,
        snapshotPath
      });
      log(`persisted -> ${snapshotPath} (origin=${result.origin}, revision=${envelope.brain_revision || "none"}, cache=${decision.reason})`);
      cache = {
        cache_written: true,
        cache_refresh_reason: decision.reason,
        brain_revision: envelope.brain_revision || null,
        previous_cached_brain_revision: cachedRevision
      };
    } catch (err) {
      log(`persist failed: ${err.message}`);
      cache = { cache_written: false, cache_error: err.message };
    }
  } else {
    // Backend and GitHub both unavailable: serve cache only with explicit staleness metadata.
    result = cachedBefore;
    if (result) {
      cache = staleNotice({ cachedRevision: result.revision, liveRevision: null });
      log(`serving disk cache with staleness warning (revision=${result.revision})`);
    }
  }

  return { result, cache, cachedRevision, liveRevision };
}

// ---------- main ----------
async function main() {
  const { result, cache } = await resolveBootstrap();

  if (!result) {
    log("NEO_BRAIN_BRIDGE_UNAVAILABLE (backend failed, github fallback failed, no revision-valid snapshot)");
    process.exit(78);
  }

  // A cache fallback during an outage must announce staleness in its execution truth.
  if (cache?.staleness_warning) {
    const et = result.data.execution_truth;
    if (et && typeof et === "object") {
      et.cache = {
        cached_brain_revision: cache.cached_brain_revision,
        live_brain_revision: cache.live_brain_revision,
        revision_freshness: cache.revision_freshness,
        staleness_warning: true
      };
      if (!Array.isArray(et.warnings)) {
        et.warnings = [];
      }
      if (!et.warnings.includes("BRAIN_CONTEXT_SERVED_FROM_DISK_CACHE")) {
        et.warnings.push("BRAIN_CONTEXT_SERVED_FROM_DISK_CACHE");
      }
    }
  }

  emit(result.data, {
    cache_origin: cache?.staleness_warning ? "snapshot-stale" : result.origin,
    cache: cache || undefined
  });
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  await main();
}
