#!/usr/bin/env node
/**
 * Railway Neo one-time boot migration for the specific stale DeepSeek 128k
 * session metadata that predates the 1M context upgrade. Runs before gateway.
 * A global replace of "128000" would corrupt other model sessions.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSON5 from "json5";

const TARGET = 1_000_000;
const OLD = new Set([128_000, 131_072]);
const MODEL = new Set(["deepseek-flash", "deepseek-v4-pro"]);
function isTargetSession(row) {
  if (!row || typeof row !== "object") return false;
  const provider = String(row.modelProvider || row.providerOverride || "");
  const model = String(row.model || row.modelOverride || "");
  // Also repair stale pre-prompt budgets even when the entry contextTokens
  // field has already been fixed by gateway status updates.
  const staleWindow = OLD.has(row.contextTokens);
  const staleBudget = OLD.has(row.contextBudgetStatus?.contextTokenBudget);
  return provider === "geminx-deepseek" && MODEL.has(model) &&
    (staleWindow || staleBudget);
}
export function repairNeoContextFile(file) {
  if (!fs.existsSync(file)) return { file: path.basename(file), scanned: 0, repaired: 0 };
  const original = fs.readFileSync(file, "utf8");
  const data = JSON.parse(original);
  if (!data || Array.isArray(data) || typeof data !== "object") {
    throw new Error("NEO_SESSION_STORE_INVALID_SHAPE:" + path.basename(file));
  }
  let scanned = 0, repaired = 0;
  for (const row of Object.values(data)) {
    if (!row || typeof row !== "object") continue;
    scanned++;
    if (!isTargetSession(row)) continue;
    if (OLD.has(row.contextTokens)) row.contextTokens = TARGET;
    // Pre-prompt budget fields are derived from 128k; changing only the
    // contextTokenBudget numeric field would leave contradictory reserves,
    // overflow and remaining-budget figures. Drop stale snapshots entirely.
    if (row.contextBudgetStatus &&
        OLD.has(row.contextBudgetStatus.contextTokenBudget)) {
      delete row.contextBudgetStatus;
    }
    repaired++;
  }
  if (repaired) {
    const backup = file + ".context128k-rollback.bak";
    if (!fs.existsSync(backup)) fs.writeFileSync(backup, original, { mode: 0o600, flag: "wx" });
    const temp = file + "." + process.pid + ".neo-context.tmp";
    try {
      fs.writeFileSync(temp, JSON.stringify(data, null, 2) + "\n", { mode: 0o600, flag: "wx" });
      fs.renameSync(temp, file);
    } finally {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    }
  }
  return { file: path.basename(file), scanned, repaired };
}
export function repairNeoContextStore(root = process.env.OPENCLAW_STATE_DIR ||
  path.join(os.homedir(), ".openclaw")) {
  const dir = path.join(root, "agents");
  if (!fs.existsSync(dir)) return { files: 0, scanned: 0, repaired: 0 };
  let files = 0, scanned = 0, repaired = 0;
  for (const id of fs.readdirSync(dir)) {
    if (!/^[a-z0-9_-]{1,80}$/i.test(id)) continue;
    const file = path.join(dir, id, "sessions", "sessions.json");
    if (!fs.existsSync(file)) continue;
    const result = repairNeoContextFile(file);
    files++; scanned += result.scanned; repaired += result.repaired;
  }
  return { files, scanned, repaired };
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  // All config writes have happened and been validated before this script.
  // Do not run an unvalidated migration against the persistent store.
  const root = process.env.OPENCLAW_STATE_DIR || path.join(os.homedir(), ".openclaw");
  const cfg = JSON5.parse(fs.readFileSync(process.env.OPENCLAW_CONFIG_PATH ||
    path.join(root, "openclaw.json"), "utf8"));
  const models = cfg.models?.providers?.["geminx-deepseek"]?.models || [];
  if (cfg.agents?.defaults?.contextTokens !== TARGET ||
      !["deepseek-flash", "deepseek-v4-pro"].every(id =>
        models.find(model => model.id === id)?.contextWindow === TARGET)) {
    throw new Error("NEO_CONTEXT_REPAIR_CONFIG_NOT_1M");
  }
  console.log("[neo-context-sessions] " + JSON.stringify(repairNeoContextStore(root)));
}
