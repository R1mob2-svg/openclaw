import { mkdtempSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readNeoRemoteBrainCache, saveNeoRemoteBrainCache } from "./neo-remote-brain-cache.js";

const dirs: string[] = [];
function temp() { const dir = mkdtempSync(path.join(os.tmpdir(), "neo-brain-cache-")); dirs.push(dir); return path.join(dir, "workspace"); }
const params = {
  revision: "b".repeat(40),
  generated_at: "2026-11-13T11:00:00Z",
  continuity: "ORIGINAL_NEO_CANONICAL_GITHUB_BRAIN",
  source_count: 3,
  context: "Verified NEO operating doctrine",
};
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => fs.rm(dir, {recursive: true, force: true})));
});

describe("OpenClaw NEO mounted Brain cache", () => {
  it("persists a revision-tagged memory and rehydrates within 30 minutes", async () => {
    const dir = temp();
    expect(await saveNeoRemoteBrainCache(dir, params, 1_000_000)).toBe(true);
    const cached = await readNeoRemoteBrainCache(dir, 1_000_200);
    expect(cached?.record.context).toBe(params.context);
    expect(cached?.record.revision).toBe(params.revision);
    expect(cached?.ageMs).toBe(200);
    const memory = await fs.readFile(path.join(path.dirname(dir), ".neo-remote-brain", "MEMORY.md"), "utf8");
    expect(memory).toContain("REMOTE_BRAIN_STATUS=LAST_KNOWN_VERIFIED");
    expect(memory).not.toContain(params.context);
    const complete = JSON.parse(await fs.readFile(
      path.join(path.dirname(dir), ".neo-remote-brain", "brain-live.json"), "utf8"));
    expect(complete.context).toBe(params.context);
    expect(complete.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(memory).not.toContain("REMOTE_BRAIN_STATUS=ATTACHED");
  });
  it("refuses to store a missing revision or empty snapshot", async () => {
    const dir = temp();
    expect(await saveNeoRemoteBrainCache(dir, {...params, revision:""}, 1_000_000)).toBe(false);
    expect(await saveNeoRemoteBrainCache(dir, {...params, context:""}, 1_000_000)).toBe(false);
    expect(await readNeoRemoteBrainCache(dir, 1_000_100)).toBeNull();
  });
  it("rejects expired and tampered content", async () => {
    const dir = temp();
    expect(await saveNeoRemoteBrainCache(dir, params, 1_000_000)).toBe(true);
    expect(await readNeoRemoteBrainCache(dir, 1_000_000 + 30*60_000 + 1)).toBeNull();
    const file = path.join(path.dirname(dir), ".neo-remote-brain", "verified-snapshot.json");
    const body = JSON.parse(await fs.readFile(file, "utf8"));
    body.context = "Injected fake instructions";
    await fs.writeFile(file, JSON.stringify(body));
    expect(await readNeoRemoteBrainCache(dir, 1_000_001)).toBeNull();
  });
});
