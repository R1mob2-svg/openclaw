#!/usr/bin/env node
/**
 * Railway persistent-volume guard. Node-only, no model credits.
 * Default: READ ONLY. --apply requires NEO_SAFE_RETENTION_APPLY=1.
 *
 * NEVER deletes from agents/, sessions/, workspace/, memory/, ledgers, queues,
 * receipts, credentials, source repos or Chromium downloads.
 * It only unlinks expired regular files with exact disposable extensions under
 * explicitly named, isolated housekeeping folders.
 */
import { reclaimBrowserCaches } from "./neo-browser-cache-reclaim.mjs";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const MiB = 1024 * 1024;
const DEFAULT_CAPACITY = 5_000_000_000; // Railway 5GB nominal cap, decimal.
// Two thresholds: early CLEANUP at 1.2GiB free; critical WRITE SAFETY
// retains the existing 600MiB reserve. Do not reject useful work at 1.2GiB.
const DEFAULT_RESERVE = 600 * MiB;
const EARLY_CLEAN_RESERVE = 1200 * MiB;
const MAX_DEPTH = 4;
const MAX_CANDIDATES = 2000;
// One existing deterministic sidecar, more frequent than previously (15m).
const WATCH_MS = 5 * 60 * 1000;
const PRESSURE_MIN_DAYS = 2; // never prune a freshly touched/active artifact
// A directory being named "tmp" never makes its contents disposable.
// Only owner-scoped cache/triage/ROTATED logs here can be pruned.
const POLICIES = Object.freeze([
  // OpenClaw's native rotating logs live directly in logs/, not logs/rotated.
  // NEVER touch active neo-runtime.log; only old numbered/compressed rolls.
  { relative: "logs", days: 5, file: /^neo-runtime\.log\.[1-9]\d*(?:\.gz)?$/i },
  { relative: "logs/rotated", days: 14, file: /^(?:neo|openclaw|geminx)[\w.-]*?(?:\.[1-9]\d*\.log|\.log\.(?:[1-9]\d*|gz))$/i },
  { relative: "cache/neo-ephemeral", days: 7, file: /^[\w.-]+\.(?:cache|tmp)$/i },
  { relative: "tmp/neo-triage", days: 7, file: /^[\w.-]+\.(?:tmp|log|log\.gz)$/i },
  { relative: "tmp/neo-preview-builds", days: 7, file: /^[\w.-]+\.(?:tmp|cache)$/i },
  { relative: ".vitest-triage/ephemeral", days: 7, file: /^[\w.-]+\.(?:tmp|log)$/i }
]);
const BLOCKED_NAMES = /(?:^|[._-])(?:session|queue|ledger|receipt|lock|checkpoint|state|token|credential|secret|backup|source|uncommitted)(?:[._-]|$)/i;

function parsePositiveInt(v, fallback, name) {
  const n = v === undefined ? fallback : Number(v);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error("INVALID_" + name);
  return n;
}
function canonicalRoot(root) {
  const absolute = path.resolve(root);
  if (absolute === "/" || absolute === "/home" || absolute === "/tmp") {
    throw new Error("GUARD_UNSAFE_VOLUME_ROOT");
  }
  const stat = fs.lstatSync(absolute);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("GUARD_ROOT_NOT_DIRECTORY");
  return fs.realpathSync(absolute);
}
function duBytes(root) {
  // statfs on Railway can report the host filesystem rather than the
  // per-volume quota. du measures actual allocated file blocks in this mount.
  const output = execFileSync("du", ["-x", "-sk", "--", root], {
    encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 128
  }).trim();
  const match = /^(\d+)\s/.exec(output);
  if (!match) throw new Error("GUARD_DU_UNAVAILABLE");
  return Number(match[1]) * 1024;
}
export function diskSnapshot(root, { capacityBytes = DEFAULT_CAPACITY, reserveBytes = DEFAULT_RESERVE } = {}) {
  const canonical = canonicalRoot(root);
  const usedBytes = duBytes(canonical);
  const freeBytes = Math.max(0, capacityBytes - usedBytes);
  return { root: canonical, capacityBytes, reserveBytes, usedBytes, freeBytes,
    usedPercent: Math.round((usedBytes / capacityBytes) * 10000) / 100,
    pressure: freeBytes < reserveBytes };
}
export function requireArtifactHeadroom(root, expectedBytes, limits = {}) {
  const snapshot = diskSnapshot(root, limits);
  if (snapshot.usedBytes + expectedBytes + snapshot.reserveBytes > snapshot.capacityBytes) {
    const error = new Error("RUNTIME_DISK_PRESSURE: refuse optional artifact/batch write");
    error.code = "RUNTIME_DISK_PRESSURE";
    error.snapshot = snapshot;
    throw error;
  }
  return snapshot;
}
// Non-log scratch/cache candidates are only safe when the producing worker
// has explicitly marked them completed, non-recoverable and externally saved.
// Age alone is NOT evidence an unpushed source/artifact can be deleted.
function hasDisposableProof(root, candidate, policy) {
  if (policy === "logs/rotated" || policy === "logs") return true;
  const markerPath = candidate + ".disposable.json";
  try {
    const st = fs.lstatSync(markerPath);
    if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1 || st.size > 2048) return false;
    const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
    return marker?.schema === "runtime-disposable.v1" &&
      marker?.file === path.relative(root, candidate) &&
      marker?.completed === true && marker?.externallySaved === true &&
      marker?.safeToPrune === true;
  } catch {
    return false;
  }
}

function candidateFiles(root, nowMs, rootDev, pressure = false) {
  const discovered = [];
  for (const policy of POLICIES) {
    const dir = path.join(root, policy.relative);
    if (!fs.existsSync(dir)) continue;
    let dirStat;
    try { dirStat = fs.lstatSync(dir); } catch { continue; }
    if (!dirStat.isDirectory() || dirStat.isSymbolicLink() || dirStat.dev !== rootDev) continue;
    // Ancestor symlinks (e.g. logs -> /external) are also forbidden.
    const actualDir = fs.realpathSync(dir);
    if (!actualDir.startsWith(root + path.sep)) continue;
    const walk = (folder, depth) => {
      if (depth > MAX_DEPTH || discovered.length >= MAX_CANDIDATES) return;
      for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
        if (discovered.length >= MAX_CANDIDATES) return;
        if (entry.isSymbolicLink()) continue;
        const file = path.join(folder, entry.name);
        let st;
        try { st = fs.lstatSync(file); } catch { continue; }
        if (st.dev !== rootDev || st.isSymbolicLink()) continue;
        if (st.isDirectory()) {
          if (depth < MAX_DEPTH && !entry.name.startsWith(".") &&
              !BLOCKED_NAMES.test(entry.name)) walk(file, depth + 1);
          continue;
        }
        if (!st.isFile() || st.nlink !== 1 || !policy.file.test(entry.name) ||
            BLOCKED_NAMES.test(entry.name) ||
            !hasDisposableProof(root, file, policy.relative)) continue;
        // ctime catches newly moved/touched files whose original mtime is old;
        // preserve recent access too. Nothing touched within the last 7/14d.
        const retentionDays = pressure
          ? Math.max(PRESSURE_MIN_DAYS, Math.min(policy.days, PRESSURE_MIN_DAYS))
          : policy.days;
        const cutoff = nowMs - retentionDays * 86400_000;
        if ([st.ctimeMs, st.mtimeMs, st.atimeMs].some(t => t >= cutoff)) continue;
        discovered.push({ file, size: st.size, dev: st.dev, ino: st.ino,
          mtimeMs: st.mtimeMs, ctimeMs: st.ctimeMs, policy: policy.relative,
          retentionDays });
      }
    };
    walk(dir, 0);
  }
  return discovered;
}
/**
 * Top-level sizes ONLY: no traversal paths or file content in emitted logs.
 * Uses one bounded OS du rather than a model call, and refuses links.
 */
export function topLevelUsage(root, limit = 8) {
  const canonical = canonicalRoot(root);
  const dev = fs.lstatSync(canonical).dev;
  const dirs = fs.readdirSync(canonical, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.isSymbolicLink())
    .map(e => ({ name: e.name, full: path.join(canonical, e.name) }))
    .filter(e => {
      try {
        const st = fs.lstatSync(e.full);
        return st.dev === dev && st.isDirectory() && !st.isSymbolicLink();
      } catch { return false; }
    })
    .slice(0, 40);
  if (dirs.length === 0) return [];
  try {
    const result = execFileSync("du", ["-x", "-sk", "--", ...dirs.map(d => d.full)], {
      encoding: "utf8", timeout: 45_000, maxBuffer: 1024 * 128
    });
    const names = new Map(dirs.map(d => [d.full, d.name]));
    return result.split("\n").flatMap(line => {
      const match = /^(\d+)\s+(.+)$/.exec(line);
      if (!match || !names.has(match[2])) return [];
      return [{ directory: names.get(match[2]), usedBytes: Number(match[1]) * 1024 }];
    }).sort((a,b) => b.usedBytes - a.usedBytes).slice(0, limit);
  } catch { return []; }
}

/**
 * Read-only nested space inventory. Only immediate directory names and allocated
 * byte counts, never file contents, tokens or full user paths. This is
 * deliberately NOT an automatic deletion policy: workspace subtrees can
 * include live source and unsaved job state even when a GitHub Brain exists.
 */
export function pressureSubtreeInventory(root, { parents = ["workspace-neo", "workspace", "agents"], limit = 12 } = {}) {
  const canonical = canonicalRoot(root);
  const rootDev = fs.lstatSync(canonical).dev;
  const result = [];
  for (const parent of parents) {
    if (typeof parent !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(parent)) continue;
    const base = path.join(canonical, parent);
    let bs;
    try { bs=fs.lstatSync(base); } catch { continue; }
    if (!bs.isDirectory() || bs.isSymbolicLink() || bs.dev !== rootDev) continue;
    const children = fs.readdirSync(base, { withFileTypes: true })
      .filter(e => !e.isSymbolicLink() && e.isDirectory())
      .slice(0, 100)
      .map(e => ({ path: path.join(base,e.name), name: e.name }))
      .filter(e => {
        try { const st=fs.lstatSync(e.path);return st.isDirectory() && st.dev===rootDev && !st.isSymbolicLink(); }
        catch { return false; }
      });
    const rows=[];
    if (children.length) {
      try {
        const output=execFileSync("du",["-x","-sk","--",...children.map(c=>c.path)],{
          encoding:"utf8",timeout:45_000,maxBuffer:1024*128
        });
        const names=new Map(children.map(c=>[c.path,c.name]));
        for (const line of output.split("\n")) {
          const m=/^(\d+)\s+(.+)$/.exec(line);
          if (m && names.has(m[2])) rows.push({directory:names.get(m[2]), usedBytes:Number(m[1])*1024});
        }
      } catch { /* No estimates on failed probes. */ }
    }
    const sum=rows.reduce((n,e)=>n+e.usedBytes,0);
    // Large unaccounted data may be files directly in parent.
    let allBytes=0;
    try { allBytes=duBytes(base); } catch { /* unknown */ }
    result.push({parent,usedBytes:allBytes,unclassifiedBytes:Math.max(0,allBytes-sum),
      topChildren:rows.sort((a,b)=>b.usedBytes-a.usedBytes).slice(0,Math.max(0,Math.min(limit,20)))});
  }
  return result;
}

export function retentionSweep(root, { apply = false, nowMs = Date.now(), capacityBytes = DEFAULT_CAPACITY,
  reserveBytes = DEFAULT_RESERVE } = {}) {
  const snapshot = diskSnapshot(root, { capacityBytes, reserveBytes });
  const rootDev = fs.lstatSync(snapshot.root).dev;
  // The early cleanup threshold does not change preflight write admission.
  // Only previously proven disposable files older than 48h are eligible.
  const earlyPressure = snapshot.freeBytes < Math.max(reserveBytes, EARLY_CLEAN_RESERVE);
  const candidates = candidateFiles(snapshot.root, nowMs, rootDev, earlyPressure);
  const files = [];
  let reclaimedBytes = 0;
  for (const c of candidates) {
    const row = { path: path.relative(snapshot.root, c.file),
      sizeBytes: c.size, retentionDays: c.retentionDays, action: "WOULD_PRUNE" };
    if (apply) {
      try {
        const latest = fs.lstatSync(c.file);
        // Recheck external-save proof immediately before unlink.
        if (!hasDisposableProof(snapshot.root, c.file, c.policy)) {
          row.action = "SKIPPED_UNPROVEN";
          files.push(row);
          continue;
        }
        if (!latest.isFile() || latest.isSymbolicLink() || latest.nlink !== 1 ||
            latest.dev !== c.dev || latest.ino !== c.ino ||
            latest.size !== c.size || latest.mtimeMs !== c.mtimeMs ||
            latest.ctimeMs !== c.ctimeMs ||
            [latest.ctimeMs, latest.mtimeMs, latest.atimeMs].some(
              t => t >= nowMs - c.retentionDays * 86400_000)) {
          row.action = "SKIPPED_CHANGED";
        } else {
          // Only named, aged, regular isolated scratch files. NEVER recursive rm.
          fs.unlinkSync(c.file);
          reclaimedBytes += c.size;
          row.action = "PRUNED";
        }
      } catch (error) {
        row.action = "SKIPPED_ERROR";
        row.errorCode = error?.code || "UNKNOWN";
      }
    }
    files.push(row);
  }
  return { before: snapshot, after: apply ? diskSnapshot(root, { capacityBytes, reserveBytes }) : null,
    reclaimedBytes, candidates: files, dryRun: !apply,
    // Used to target only proven disposable growth; if this dominates protected
    // business data, the warden must request extra capacity, not erase history.
    earlyPressure, topConsumers: earlyPressure ? topLevelUsage(root) : [],
    policies: POLICIES.map(
      ({ relative, days }) => ({ relative, retentionDays: days })) };
}
function cliArgs() {
  const args = process.argv.slice(2);
  const value = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
  };
  const root = value("--root", process.env.OPENCLAW_STATE_DIR || process.env.GEMINX_RUNTIME_ROOT ||
    process.env.RAILWAY_VOLUME_MOUNT_PATH || "/home/node/.openclaw");
  const capacityBytes = parsePositiveInt(value("--capacity-bytes", process.env.RUNTIME_VOLUME_CAPACITY_BYTES),
    DEFAULT_CAPACITY, "CAPACITY");
  const reserveBytes = parsePositiveInt(value("--reserve-bytes", process.env.RUNTIME_VOLUME_RESERVE_BYTES),
    DEFAULT_RESERVE, "RESERVE");
  if (capacityBytes <= reserveBytes) throw new Error("GUARD_INVALID_CAPACITY_RESERVE");
  const expectedBytes = parsePositiveInt(value("--expected-bytes", undefined), 0, "EXPECTED_WRITE");
  return { root, capacityBytes, reserveBytes, expectedBytes,
    preflight: args.includes("--preflight"), watch: args.includes("--watch"),
    apply: args.includes("--apply") };
}
function shortReport(report) {
  return { schema: "safe.volume.guard.v1", usedBytes: report.before.usedBytes,
    usedPercent: report.before.usedPercent, freeBytes: report.before.freeBytes,
    reserveBytes: report.before.reserveBytes, pressure: report.before.pressure,
    afterBytes: report.after?.usedBytes ?? null, afterPercent: report.after?.usedPercent ?? null,
    reclaimedBytes: report.reclaimedBytes, files: report.candidates, dryRun: report.dryRun,
    topConsumers: report.topConsumers,
    earlyPressure: report.earlyPressure,
    pressureUnresolved: Boolean(report.after &&
      report.after.freeBytes < Math.max(report.after.reserveBytes, EARLY_CLEAN_RESERVE) &&
      report.reclaimedBytes === 0),
    policies: report.policies };
}
/**
 * Daily no-model maintenance window, 03:00-03:59 UK local time, including DST.
 * No new scheduler: existing five-minute watchdog owns the check.
 */
export function londonDailyAuditDate(nowMs=Date.now()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date(nowMs));
  const get = (name) => parts.find(p => p.type === name)?.value;
  return get("hour") === "03" ? [get("year"), get("month"), get("day")].join("-") : null;
}
async function main() {
  const opts = cliArgs();
  if (opts.apply && process.env.NEO_SAFE_RETENTION_APPLY !== "1") {
    throw new Error("GUARD_APPLY_REQUIRES_EXPLICIT_APPROVAL");
  }
  if (opts.preflight) {
    try {
      const snapshot = requireArtifactHeadroom(opts.root, opts.expectedBytes, opts);
      console.log("DISK_HEADROOM_OK " + JSON.stringify({ usedPercent: snapshot.usedPercent,
        freeBytes: snapshot.freeBytes, expectedBytes: opts.expectedBytes }));
    } catch (error) {
      if (error.code === "RUNTIME_DISK_PRESSURE") {
        console.error("RUNTIME_DISK_PRESSURE " + JSON.stringify({
          usedPercent: error.snapshot.usedPercent, freeBytes: error.snapshot.freeBytes,
          reserveBytes: error.snapshot.reserveBytes, expectedBytes: opts.expectedBytes }));
        process.exitCode = 75; // EX_TEMPFAIL; never corrupt an in-flight artifact
        return;
      }
      throw error;
    }
    return;
  }
  let pressureScanNumber = 0;
  let tickNumber = 0;
  let lastDailyAuditDate = null;
  let lastCapacityBand = null;
  const tick = () => {
    const result = retentionSweep(opts.root, opts);
    console.log("VOLUME_GUARD " + JSON.stringify(shortReport(result)));

    // The EXISTING five-minute worker owns both hourly pressure scanning and
    // a UK 03:00 deeper inventory. No cron service or model inference.
    const hourlyPressureScan = result.earlyPressure && pressureScanNumber++ % 12 === 0;
    const ukDate = londonDailyAuditDate();
    const dailyAuditDue = ukDate !== null && ukDate !== lastDailyAuditDate;
    if (dailyAuditDue) lastDailyAuditDate = ukDate;
    let duplicateBrowserReclaimedBytes = 0;
    if (hourlyPressureScan || dailyAuditDue) {
      const inventory = pressureSubtreeInventory(opts.root);
      if (hourlyPressureScan) {
        console.log("VOLUME_PRESSURE_SUBTREE_INVENTORY " +
          JSON.stringify({schema:"safe.volume.subtree-inventory.v1",entries:inventory}));
      }
      if (dailyAuditDue) {
        // READ ONLY outside the existing narrowly scoped retention policies.
        // Never infer that a workspace or Git clone is disposable.
        console.log("NEO_DAILY_STORAGE_AUDIT " + JSON.stringify({
          schema:"neo.daily-storage-audit.v1",ukDate,
          usedBytes:result.after?.usedBytes ?? result.before.usedBytes,
          usedPercent:result.after?.usedPercent ?? result.before.usedPercent,
          topConsumers:topLevelUsage(opts.root),
          workspaceInventory:inventory,
          workspaceDeletionAuthorized:false,
          modelCalls:0, extraScheduler:false
        }));
      }
      // Conservatively reclaim only verified aged, unused duplicate browsers.
      // Canonical ms-playwright, profiles, sessions and source are protected.
      try {
        const caches = reclaimBrowserCaches({root:opts.root,apply:opts.apply});
        duplicateBrowserReclaimedBytes = caches.reclaimedBytes;
        console.log("NEO_BROWSER_CACHE_RECLAIM " + JSON.stringify(caches));
      } catch (error) {
        console.warn("NEO_BROWSER_CACHE_RECLAIM_BLOCKED code=" +
          String(error?.code || error?.message || "UNKNOWN").replace(/[^A-Za-z0-9_.:-]/g,"_").slice(0,80));
      }
    }
    const post = duplicateBrowserReclaimedBytes > 0
      ? diskSnapshot(opts.root, {capacityBytes:opts.capacityBytes,reserveBytes:opts.reserveBytes})
      : (result.after ?? result.before);
    const band = post.usedPercent >= 80 ? "CRITICAL" :
      (post.usedPercent >= 70 ? "WARNING" : "OK");
    // Warn at most hourly unless the threshold changes. Never trigger an AI
    // repair turn merely because a threshold has been crossed.
    if (band !== lastCapacityBand || (band !== "OK" && tickNumber % 12 === 0)) {
      console.log("NEO_VOLUME_CAPACITY_LEVEL " + JSON.stringify({
        schema:"neo.volume-capacity-level.v1",band,
        usedPercent:post.usedPercent,freeBytes:post.freeBytes,
        autoPaidInference:false
      }));
    }
    lastCapacityBand = band;
    tickNumber++;
    if (result.after &&
        post.freeBytes < Math.max(post.reserveBytes, EARLY_CLEAN_RESERVE) &&
        result.reclaimedBytes === 0 && duplicateBrowserReclaimedBytes === 0) {
      console.warn("VOLUME_GUARD_CAPACITY_ACTION_REQUIRED protected_data_preserved=true no_safe_cleanup_candidates=true");
    }
  };
  tick();
  if (opts.watch) {
    const timer = setInterval(tick, WATCH_MS);
    process.once("SIGTERM", () => { clearInterval(timer); process.exit(0); });
    process.once("SIGINT", () => { clearInterval(timer); process.exit(0); });
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main().catch(error => {
    console.error("VOLUME_GUARD_ERROR code=" + String(error?.code || error?.message || error));
    process.exitCode = 75;
  });
}
