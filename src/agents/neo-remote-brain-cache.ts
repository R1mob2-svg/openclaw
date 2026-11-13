/**
 * Durable local mirror of a server-verified NEO canonical GitHub Brain fetch.
 * This is a bounded last-known-good fallback, not a second Brain or an assertion
 * that GitHub is currently reachable.
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const NEO_REMOTE_CACHE_MAX_AGE_MS = 30 * 60 * 1000;
const MAX_CONTEXT_CHARS = 200_000;
export interface NeoRemoteBrainCache {
  saved_at_ms: number;
  revision: string;
  generated_at: string;
  continuity: string;
  source_count: number;
  context: string;
  sha256: string;
}
const cachedPath = (workspaceDir: string) =>
  path.join(workspaceDir, ".neo-remote-brain", "verified-snapshot.json");

export async function readNeoRemoteBrainCache(
  workspaceDir: string,
  now = Date.now(),
): Promise<{ record: NeoRemoteBrainCache; ageMs: number } | null> {
  try {
    const candidate: unknown = JSON.parse(await fs.readFile(cachedPath(workspaceDir), "utf8"));
    if (!candidate || typeof candidate !== "object") return null;
    const record = candidate as NeoRemoteBrainCache;
    const ageMs = now - record.saved_at_ms;
    if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > NEO_REMOTE_CACHE_MAX_AGE_MS ||
        !/^[a-f0-9]{40}$/i.test(record.revision) ||
        typeof record.context !== "string" || !record.context.trim() ||
        record.context.length > MAX_CONTEXT_CHARS ||
        typeof record.sha256 !== "string" ||
        createHash("sha256").update(record.context, "utf8").digest("hex") !== record.sha256) {
      return null;
    }
    return { record, ageMs };
  } catch {
    return null;
  }
}

export async function saveNeoRemoteBrainCache(
  workspaceDir: string,
  params: Omit<NeoRemoteBrainCache, "saved_at_ms" | "sha256">,
  now = Date.now(),
): Promise<boolean> {
  if (!/^[a-f0-9]{40}$/i.test(params.revision) || !params.context.trim() ||
      params.context.length > MAX_CONTEXT_CHARS ||
      !Number.isFinite(params.source_count) || params.source_count < 1) return false;
  const dir = path.dirname(cachedPath(workspaceDir));
  const record: NeoRemoteBrainCache = {
    ...params, saved_at_ms: now,
    sha256: createHash("sha256").update(params.context, "utf8").digest("hex"),
  };
  const temp = cachedPath(workspaceDir) + "." + process.pid + "." + randomUUID() + ".tmp";
  const memoryFile = path.join(dir, "MEMORY.md");
  try {
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    await fs.writeFile(temp, JSON.stringify(record), { encoding: "utf8", mode: 0o600 });
    await fs.rename(temp, cachedPath(workspaceDir));
    // A persisted memory file helps OpenClaw recover without an ephemeral injection.
    // It must NOT claim that a future session is freshly synced with GitHub.
    await fs.writeFile(memoryFile, [
      "# NEO last verified canonical GitHub Brain snapshot",
      "REMOTE_BRAIN_STATUS=LAST_KNOWN_VERIFIED",
      "This file is a bounded historical snapshot, not proof of live GitHub synchronization.",
      "REVISION=" + params.revision,
      "GENERATED_AT=" + params.generated_at,
      "SAVED_AT=" + new Date(now).toISOString(),
      "",
      params.context,
    ].join("\n"), { encoding: "utf8", mode: 0o600 });
    return true;
  } catch {
    try { await fs.unlink(temp); } catch { /* temp already renamed or not created */ }
    return false;
  }
}
