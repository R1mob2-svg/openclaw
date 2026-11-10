import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

function withWorkspace(initial, verify) {
  const dir = mkdtempSync(path.join(tmpdir(), "neo-memory-boot-"));
  try {
    mkdirSync(path.join(dir, "memory"), { recursive: true });
    writeFileSync(path.join(dir, "MEMORY.md"), initial, "utf8");
    const run = () => spawnSync(process.execPath, ["scripts/neo-memory-boot-bound.mjs"], {
      cwd: process.cwd(), encoding: "utf8",
      env: { ...process.env, OPENCLAW_WORKSPACE_DIR: dir }
    });
    const first = run();
    assert.equal(first.status, 0, first.stderr || first.stdout);
    verify(dir, first, run);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("large private memory is SHA-archived and compacted idempotently", () => {
  const original = "BEGIN_PRIVATE_MEMORY\n" + ("Historical Neo facts and receipts.\n".repeat(1900)) + "LATEST_NEO_CONTEXT\n";
  const sha = createHash("sha256").update(original).digest("hex");
  withWorkspace(original, (dir, first, run) => {
    const after = readFileSync(path.join(dir, "MEMORY.md"), "utf8");
    assert.ok(after.length < 18000);
    assert.ok(after.includes("LATEST_NEO_CONTEXT"));
    assert.ok(after.includes(sha));
    assert.ok(!first.stdout.includes("Historical Neo facts"));
    const archive = path.join(dir, "memory", "archive", "MEMORY." + sha + ".md");
    assert.ok(existsSync(archive));
    assert.equal(readFileSync(archive, "utf8"), original);
    const repeat = run();
    assert.equal(repeat.status, 0, repeat.stderr || repeat.stdout);
    assert.equal(readFileSync(path.join(dir, "MEMORY.md"), "utf8"), after);
    assert.deepEqual(readdirSync(path.join(dir, "memory", "archive")), ["MEMORY." + sha + ".md"]);
  });
});

test("short memory is preserved byte-for-byte and not archived", () => {
  withWorkspace("SHORT_NEO_MEMORY\n", (dir) => {
    assert.equal(readFileSync(path.join(dir, "MEMORY.md"), "utf8"), "SHORT_NEO_MEMORY\n");
    assert.equal(existsSync(path.join(dir, "memory", "archive")), false);
  });
});
