import { describe, expect, it } from "vitest";
import fs from "node:fs";

describe("Railway NEO continuity bootstrap", () => {
  it("seeds the first-reply Brain bootstrap without embedding secrets", () => {
    const script = fs.readFileSync("scripts/railway-neo-runtime-start.sh", "utf8");
    expect(script).toContain("NEO_GITHUB_BRAIN_FIRST_REPLY_BOOT_V1");
    expect(script).toContain("node bin/neo-brain-bootstrap.mjs");
    expect(script).toContain("NEO_BRAIN_BRIDGE_URL");
    expect(script).toContain("NEO_BRAIN_BRIDGE_TOKEN");
    expect(script).toContain("A fresh chat is a REHYDRATION EVENT");
    expect(script).toContain("Never print, echo, log, reveal, or persist");
    expect(script).not.toMatch(/Bearer\\s+[A-Za-z0-9_-]{20,}/);
  });
});
