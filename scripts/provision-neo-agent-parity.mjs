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
import JSON5 from "json5";

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

/** Merge the six agents into an agents block without disturbing other entries. */
export function mergeAgentList(existingList = [], root = process.env.OPENCLAW_STATE_DIR || "/home/node/.openclaw") {
  const byId = new Map(existingList.map((agent) => [agent.id, agent]));
  const ordered = [];
  for (const agent of AGENTS) {
    const existing = byId.get(agent.id);
    const base = existing ? { ...existing } : {};
    const next = { ...base, id: agent.id, name: agent.name, description: agent.description, workspace: base.workspace || workspacePath(root, agent.id) };
    if (agent.id === "brian") next.tools = { ...(base.tools ?? {}), profile: "full" };
    ordered.push(next);
    byId.delete(agent.id);
  }
  // Preserve any unrelated agents the founder configured later.
  for (const leftover of byId.values()) {
    ordered.push(leftover);
  }
  // Exactly one agent may be default, and it must stay the legacy HQ agent so a
  // provision run can never repoint the live founder session.
  for (const agent of ordered) {
    delete agent.default;
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

function main() {
  const rootArg = process.argv.indexOf("--root");
  const root = rootArg > -1 ? process.argv[rootArg + 1] : (process.env.OPENCLAW_STATE_DIR || "/home/node/.openclaw");
  const dryRun = process.argv.includes("--dry-run");

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
  const config = JSON5.parse(fs.readFileSync(configPath, "utf8"));
  config.agents = config.agents ?? {};
  const before = JSON.stringify({ list: config.agents.list ?? [], imageModel: config.agents.defaults?.imageModel });
  config.agents.list = mergeAgentList(config.agents.list ?? [], root);
  config.agents.defaults = config.agents.defaults ?? {};
  // The model routing is inherited from the existing runtime. This setting
  // selects vision for screenshot/image review, not image generation.
  config.agents.defaults.imageModel = {
    ...(config.agents.defaults.imageModel ?? {}),
    primary: "google/gemini-2.5-flash",
    fallbacks: ["google/gemini-3-flash-preview"],
  };
  if (JSON.stringify({ list: config.agents.list, imageModel: config.agents.defaults.imageModel }) === before) {
    console.log("\nopenclaw.json: agents.list already current");
    return;
  }
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`\nopenclaw.json: agents.list updated (${config.agents.list.length} agents)`);
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  path.resolve(process.argv[1] ?? "") === path.resolve(new URL(import.meta.url).pathname);

if (invokedDirectly) {
  main();
}
