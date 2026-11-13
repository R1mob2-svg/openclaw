// Bounded NEO Railway workspace bootstrap: archive full memory then retain
// a short source pointer instead of silently truncating a 49KB MEMORY.md.
// Runs locally at process startup; no network, inference, secrets or deletion.
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

const workspace = process.env.OPENCLAW_WORKSPACE_DIR || "/home/node/.openclaw/workspace";
const memory = path.join(workspace, "MEMORY.md");
const archiveDir = path.join(workspace, "memory", "archive");
const MAX_BOOTSTRAP_CHARS = 3_000;
const RETAIN_HEAD_CHARS = 500;
const RETAIN_TAIL_CHARS = 900;

function atomicPrivateWrite(target, value) {
  const tmp = target + "." + process.pid + "." + randomUUID() + ".tmp";
  try {
    fs.writeFileSync(tmp, value, { encoding: "utf8", mode: 0o600, flag: "wx" });
    fs.renameSync(tmp, target);
  } finally {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
  }
}

fs.mkdirSync(path.dirname(memory), { recursive: true });
if (!fs.existsSync(memory)) fs.writeFileSync(memory, "", { mode: 0o600 });
const original = fs.readFileSync(memory, "utf8");
if (original.length <= MAX_BOOTSTRAP_CHARS) {
  console.log("[neo-memory] boot_within_limit=true");
} else {
  const digest = createHash("sha256").update(original).digest("hex");
  const archive = path.join(archiveDir, "MEMORY." + digest + ".md");
  fs.mkdirSync(archiveDir, { recursive: true, mode: 0o700 });
  if (!fs.existsSync(archive)) {
    fs.writeFileSync(archive, original, { encoding: "utf8", mode: 0o600, flag: "wx" });
  }
  if (createHash("sha256").update(fs.readFileSync(archive)).digest("hex") !== digest) {
    throw new Error("NEO_MEMORY_ARCHIVE_SHA_MISMATCH");
  }
  const trimmed = [
    "# NEO compact Railway bootstrap (full source preserved on volume)",
    "Original MEMORY.md SHA256: " + digest,
    "Original bytes: " + Buffer.byteLength(original, "utf8"),
    "Full historical record: memory/archive/MEMORY." + digest + ".md",
    "The GitHub Global Agent Brain is the current durable source of truth.",
    "Archive is private: read it only for scoped recovery, not every turn.",
    "",
    "## Pinned earlier context (abridged, not certification)",
    original.slice(0, RETAIN_HEAD_CHARS),
    "",
    "## Latest context (abridged, not certification)",
    original.slice(-RETAIN_TAIL_CHARS),
    "",
    "Every job requires fresh Brain SHA, session and execution receipts."
  ].join("\n");
  if (trimmed.length >= MAX_BOOTSTRAP_CHARS) throw new Error("NEO_MEMORY_COMPACTION_OVERSIZE");
  atomicPrivateWrite(memory, trimmed);
  if (fs.readFileSync(memory, "utf8") !== trimmed) throw new Error("NEO_MEMORY_READBACK_MISMATCH");
  console.log("[neo-memory] archived_sha_prefix=" + digest.slice(0, 12) + " compact_chars=" + trimmed.length);
}
