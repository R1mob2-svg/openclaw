#!/usr/bin/env node
// Provisions the 6-agent OpenClaw parity set (neo, brian, mark, kerry, sophie, ads).
//
// Why this exists: the live agents.list and workspace-* directories are runtime
// state on the container volume, not repo files. Without a re-runnable provisioner
// a container rebuild silently drops five agents and every dispatched job aimed at
// them fails with "Unknown agent id". This script is idempotent: safe to run on a
// healthy container, safe to run on a blank one.
//
// It ports Neo's *operational* boot files verbatim (AGENTS.md, TOOLS.md,
// HEARTBEAT.md, USER.md) because those encode how work is done. It never copies
// SOUL.md / IDENTITY.md / MEMORY.md between agents — persona and memory stay
// per-agent, which is the whole point of separate identities.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

let JSON5;
try {
  JSON5 = (await import("json5")).default;
} catch {
  JSON5 = JSON;
}

export const AGENTS = Object.freeze([
  { id: "neo", name: "NEO", description: "Parent operating agent", portFrom: null, inheritFrom: "workspace" },
  { id: "brian", name: "BRIAN", description: "Autonomous Digital Ambush website designer and visual QA", portFrom: "neo" },
  { id: "mark", name: "MARK", description: "Marketing and outreach", portFrom: "neo" },
  { id: "kerry", name: "KERRY", description: "Operations and delivery", portFrom: "neo" },
  { id: "sophie", name: "SOPHIE", description: "Client service and communication", portFrom: "neo" },
  { id: "ads", name: "ADS", description: "Paid acquisition and campaigns", portFrom: "neo" },
]);

/** The legacy founder-facing agent. Never displaced by provisioning. */
export const DEFAULT_AGENT_ID = "main";

/** Files whose content is methodology, not identity: ported verbatim. */
export const PORTED_FILES = Object.freeze(["AGENTS.md", "TOOLS.md", "HEARTBEAT.md", "USER.md"]);

/** Files that must never be copied between agents. */
export const PERSONA_FILES = Object.freeze(["SOUL.md", "IDENTITY.md", "MEMORY.md"]);

const PERSONA_ROLES = Object.freeze({
  brian: "Autonomous website architecture, live research, original HTML/CSS, image sourcing and Chromium visual QA. Read AG’s canonical GitHub Brain spec. Evidence first.",
  mark: "Marketing and outreach. Digital Ambush prospecting, mockups and review drafts.",
  kerry: "Operations and delivery. Keeps pipelines moving and records the receipts.",
  sophie: "Client service and communication. Clear, human, never corporate.",
  ads: "Paid acquisition and campaign execution. Budget-aware, approval-bound.",
});

export function workspacePath(root, id) {
  return path.join(root, `workspace-${id}`);
}

/**
 * Ensure one agent's workspace exists with ported operational files.
 * Returns the list of actions taken so callers can assert idempotency.
 */
export function provisionWorkspace({ root, id, sourceId, sourceDir, fsImpl = fs }) {
  const actions = [];
  const dir = workspacePath(root, id);
  fsImpl.mkdirSync(path.join(dir, "memory"), { recursive: true });

  // sourceDir allows porting from the legacy default workspace (used for neo).
  const srcRoot = sourceDir ? sourceDir : sourceId ? workspacePath(root, sourceId) : null;
  const srcLabel = sourceId ?? (sourceDir ? path.basename(sourceDir) : null);

  if (srcRoot) {
    for (const file of PORTED_FILES) {
      const src = path.join(srcRoot, file);
      if (!fsImpl.existsSync(src)) {
        continue;
      }
      const dest = path.join(dir, file);
      const incoming = fsImpl.readFileSync(src, "utf8");
      const existing = fsImpl.existsSync(dest) ? fsImpl.readFileSync(dest, "utf8") : null;
      if (existing === incoming) {
        actions.push(`${file}: already current`);
        continue;
      }
      fsImpl.copyFileSync(src, dest);
      actions.push(`${file}: ported from ${srcLabel}`);
    }

    // Skills: one shared source of truth rather than five drifting copies.
    const skillsSrc = path.join(srcRoot, "skills");
    const skillsDest = path.join(dir, "skills");
    if (fsImpl.existsSync(skillsSrc)) {
      const stat = fsImpl.lstatSync(skillsDest, { throwIfNoEntry: false });
      if (!stat || !stat.isSymbolicLink()) {
        fsImpl.rmSync(skillsDest, { recursive: true, force: true });
        try {
          fsImpl.symlinkSync(skillsSrc, skillsDest, "dir");
          actions.push(`skills: linked to ${srcLabel}/skills`);
        } catch (error) {
          actions.push(`skills: link skipped (${error instanceof Error ? error.message : String(error)})`);
        }
      } else {
        actions.push("skills: already linked");
      }
    }
  }

  // Persona files are only created when absent, so an agent's own voice is never
  // overwritten by a later provision run.
  const identityPath = path.join(dir, "IDENTITY.md");
  if (!fsImpl.existsSync(identityPath)) {
    const role = PERSONA_ROLES[id] ?? "Operating agent.";
    fsImpl.writeFileSync(
      identityPath,
      `# ${id.toUpperCase()}\n${role}\n` +
        `GeminX is the platform; ${id.toUpperCase()} is the agent.\n\n` +
        `## Callsign (founder order 2026-11-13)\n` +
        `- GeminX HQ runtime: callsign \`${id.toUpperCase()}\`. Every reply ENDS with \`[${id.toUpperCase()}]\` as the final token.\n`,
    );
    actions.push("IDENTITY.md: created");
  } else {
    actions.push("IDENTITY.md: preserved");
  }

  const soulPath = path.join(dir, "SOUL.md");
  if (!fsImpl.existsSync(soulPath)) {
    const sourceSoul = srcRoot ? path.join(srcRoot, "SOUL.md") : null;
    if (sourceSoul && fsImpl.existsSync(sourceSoul)) {
      const tone = fsImpl.readFileSync(sourceSoul, "utf8").trim();
      const role = PERSONA_ROLES[id] ?? "Operating agent.";
      fsImpl.writeFileSync(
        soulPath,
        `${tone}\n\nYou are ${id.toUpperCase()}. ${role}\n` +
          `You share the parent operating standard and tone, but your judgement and voice are your own.\n`,
      );
      actions.push("SOUL.md: derived from neo tone + own role");
    }
  } else {
    actions.push("SOUL.md: preserved");
  }

  return { id, dir, actions };
}

export const VALID_AGENT_TOOL_KEYS = Object.freeze(new Set([
  "profile",
  "allow",
  "alsoAllow",
  "deny",
  "byProvider",
  "toolsBySender",
  "codeMode",
  "elevated",
  "exec",
  "fs",
  "loopDetection",
  "message",
  "sandbox",
]));

export function sanitizeAgentTools(rawTools, extra = {}) {
  if (!rawTools || typeof rawTools !== "object") {
    return Object.keys(extra).length > 0 ? { ...extra } : undefined;
  }
  const clean = {};
  for (const [key, val] of Object.entries(rawTools)) {
    if (VALID_AGENT_TOOL_KEYS.has(key) && key !== "agentToAgent") {
      clean[key] = val;
    }
  }
  Object.assign(clean, extra);
  return Object.keys(clean).length > 0 ? clean : undefined;
}

/** Merge the six agents into an agents block without disturbing other entries. */
export function mergeAgentList(existingList = [], root = process.env.OPENCLAW_STATE_DIR || (process.platform === "win32" ? "C:\\Users\\tauru\\.openclaw" : "/home/node/.openclaw")) {
  const byId = new Map(existingList.map((agent) => [agent.id, agent]));
  const ordered = [];
  for (const agent of AGENTS) {
    const existing = byId.get(agent.id);
    const base = existing ? { ...existing } : {};
    const next = { ...base, id: agent.id, name: agent.name, description: agent.description, workspace: base.workspace || workspacePath(root, agent.id) };
    if (agent.id === "brian") {
      next.tools = sanitizeAgentTools(base.tools, { profile: "full" });
    } else if (base.tools && typeof base.tools === "object") {
      next.tools = sanitizeAgentTools(base.tools);
    }
    ordered.push(next);
    byId.delete(agent.id);
  }
  // Preserve any unrelated agents the founder configured later.
  for (const leftover of byId.values()) {
    const cleanLeftover = { ...leftover };
    if (cleanLeftover.tools && typeof cleanLeftover.tools === "object") {
      cleanLeftover.tools = sanitizeAgentTools(cleanLeftover.tools);
    }
    ordered.push(cleanLeftover);
  }
  // Exactly one agent may be default, and it must stay the legacy HQ agent so a
  // provision run can never repoint the live founder session.
  // Explicitly strip any invalid nested agentToAgent from every agent tools entry.
  for (const agent of ordered) {
    delete agent.default;
    if (agent.tools) {
      agent.tools = sanitizeAgentTools(agent.tools);
    }
  }
  let defaultAgent = ordered.find((agent) => agent.id === DEFAULT_AGENT_ID);
  if (!defaultAgent) {
    defaultAgent = { id: DEFAULT_AGENT_ID, default: true, workspace: path.join(root, "workspace") };
    ordered.push(defaultAgent);
  } else {
    defaultAgent.default = true;
  }
  return ordered;
}

/**
 * Strict schema validation gate for candidate configuration.
 * Validates candidate configuration before overwriting the live openclaw.json file.
 * If candidate validation fails, aborts write immediately and preserves live config.
 */
export function validateCandidateConfig(candidate, root = process.env.OPENCLAW_STATE_DIR || (process.platform === "win32" ? "C:\\Users\\tauru\\.openclaw" : "/home/node/.openclaw")) {
  if (!candidate || typeof candidate !== "object") {
    throw new Error("Candidate configuration must be an object");
  }
  if (!candidate.agents || typeof candidate.agents !== "object") {
    throw new Error("Candidate configuration missing required 'agents' block");
  }
  if (!Array.isArray(candidate.agents.list)) {
    throw new Error("Candidate configuration 'agents.list' must be an array");
  }

  const defaultAgents = candidate.agents.list.filter((a) => a.default === true);
  if (defaultAgents.length > 1) {
    throw new Error(`Multiple default agents configured: ${defaultAgents.map((a) => a.id).join(", ")}`);
  }

  for (let i = 0; i < candidate.agents.list.length; i++) {
    const agent = candidate.agents.list[i];
    if (!agent || typeof agent !== "object" || !agent.id || typeof agent.id !== "string") {
      throw new Error(`agents.list[${i}] missing valid 'id'`);
    }
    if (agent.tools && typeof agent.tools === "object") {
      if ("agentToAgent" in agent.tools) {
        throw new Error(
          `Invalid candidate config: agents.list[${i}] (${agent.id}).tools.agentToAgent is forbidden. agentToAgent must only reside at root config.tools.agentToAgent.`,
        );
      }
    }
  }

  // Validate root config.tools.agentToAgent if present
  if (candidate.tools?.agentToAgent) {
    if (typeof candidate.tools.agentToAgent !== "object") {
      throw new Error("root tools.agentToAgent must be an object");
    }
    if (candidate.tools.agentToAgent.allow && !Array.isArray(candidate.tools.agentToAgent.allow)) {
      throw new Error("root tools.agentToAgent.allow must be an array");
    }
  }

  // If openclaw executable is available and built, run strict openclaw config validate
  const openclawEntry = path.resolve(process.cwd(), "openclaw.mjs");
  if (fs.existsSync(openclawEntry)) {
    const candidateTemp = path.join(root, `openclaw.json.validate.${process.pid}.${Date.now()}`);
    try {
      fs.writeFileSync(candidateTemp, `${JSON.stringify(candidate, null, 2)}\n`, "utf8");
      const res = spawnSync(process.execPath, [openclawEntry, "config", "validate"], {
        env: { ...process.env, OPENCLAW_CONFIG_PATH: candidateTemp },
        encoding: "utf8",
        timeout: 10000,
      });
      if (res.status !== 0 && !res.stderr?.includes("missing dist/entry")) {
        const errorDetail = (res.stderr || res.stdout || `exit code ${res.status}`).trim();
        throw new Error(`openclaw config validate rejected candidate: ${errorDetail}`);
      }
    } finally {
      if (fs.existsSync(candidateTemp)) {
        try { fs.unlinkSync(candidateTemp); } catch {}
      }
    }
  }

  return true;
}

export function main(options = {}) {
  const rootArg = process.argv.indexOf("--root");
  const root = options.root || (rootArg > -1 ? process.argv[rootArg + 1] : (process.env.OPENCLAW_STATE_DIR || (process.platform === "win32" ? "C:\\Users\\tauru\\.openclaw" : "/home/node/.openclaw")));
  const dryRun = options.dryRun ?? process.argv.includes("--dry-run");

  if (dryRun) {
    // Dry-run is genuinely read-only. No mkdir, persona or config rewrites.
    for (const agent of AGENTS) console.log(`${agent.id} -> ${workspacePath(root, agent.id)} (dry-run; no writes)`);
    console.log("\ndry-run: no writes performed");
    return;
  }

  for (const agent of AGENTS) {
    const plan = provisionWorkspace({
      root,
      id: agent.id,
      sourceId: agent.portFrom ?? null,
      sourceDir: agent.inheritFrom ? path.join(root, agent.inheritFrom) : null,
    });
    console.log(`\n${agent.id} -> ${plan.dir}${dryRun ? " (dry-run)" : ""}`);
    for (const action of plan.actions) {
      console.log(`  - ${action}`);
    }
  }

  const configPath = path.join(root, "openclaw.json");
  if (!fs.existsSync(configPath)) {
    console.log(`\n${configPath} not found; workspace provisioning only`);
    return;
  }
  const rawDisk = fs.readFileSync(configPath, "utf8");
  const persistedConfig = JSON5.parse(rawDisk);
  const beforeRaw = JSON.stringify(persistedConfig);
  const diskBefore = JSON.stringify({
    list: persistedConfig.agents?.list ?? [],
    imageModel: persistedConfig.agents?.defaults?.imageModel,
    a2a: persistedConfig.tools?.agentToAgent ?? null,
  });

  const config = JSON5.parse(rawDisk);
  config.agents = config.agents ?? {};

  // Clean persisted invalid agentToAgent from existing agents.list before merging
  if (Array.isArray(config.agents.list)) {
    for (const agent of config.agents.list) {
      if (agent && agent.tools && typeof agent.tools === "object") {
        delete agent.tools.agentToAgent;
      }
    }
  }
  config.agents.list = mergeAgentList(config.agents.list ?? [], root);
  config.agents.defaults = config.agents.defaults ?? {};
  // The model routing is inherited from the existing runtime. This setting
  // selects vision for screenshot/image review, not image generation.
  config.agents.defaults.imageModel = {
    ...(config.agents.defaults.imageModel ?? {}),
    primary: "google/gemini-2.5-flash",
    fallbacks: ["google/gemini-3-flash-preview"],
  };
  // Cross-agent dispatch is required for Brian to hand finished builds to the
  // other operating agents, so a Railway rebuild must not silently drop it.
  // Merge the enable flag and union the allowlist rather than overwriting, so a
  // founder-added agent is never evicted by a provision run.
  config.tools = config.tools ?? {};
  const existingA2A = config.tools.agentToAgent ?? {};
  const allow = new Set(Array.isArray(existingA2A.allow) ? existingA2A.allow : []);
  for (const agent of config.agents.list) allow.add(agent.id);
  config.tools.agentToAgent = { ...existingA2A, enabled: true, allow: [...allow] };

  const candidateAfter = JSON.stringify({
    list: config.agents.list,
    imageModel: config.agents.defaults.imageModel,
    a2a: config.tools.agentToAgent,
  });

  if (candidateAfter === diskBefore && JSON.stringify(config) === beforeRaw) {
    console.log("\nopenclaw.json: agents.list already current");
    return;
  }

  // Validate candidate configuration before replacing live file
  try {
    validateCandidateConfig(config, root);
  } catch (err) {
    console.error(`\n[provision-neo] Candidate config validation FAILED: ${err.message}`);
    console.error(`[provision-neo] ABORTING write. Live configuration preserved.`);
    process.exit(1);
  }

  // Atomic replace: write candidate to tmpPath in same directory then atomic rename
  const tmpPath = `${configPath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  fs.renameSync(tmpPath, configPath);
  console.log(`\nopenclaw.json: agents.list updated (${config.agents.list.length} agents)`);
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  path.resolve(process.argv[1] ?? "") === path.resolve(new URL(import.meta.url).pathname);

if (invokedDirectly) {
  main();
}
