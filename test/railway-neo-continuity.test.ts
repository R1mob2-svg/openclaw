import { describe, expect, it } from "vitest";
import fs from "node:fs";

describe("Railway NEO continuity bootstrap", () => {
  it("uses the native OpenClaw pre-model Brain hook and keeps only local continuity pointers in startup", () => {
    const script = fs.readFileSync("scripts/railway-neo-runtime-start.sh", "utf8");
    const bootstrap = fs.readFileSync("src/agents/bootstrap-files.ts", "utf8");

    expect(script).toContain("NEO_CANONICAL_CONTINUITY_POINTER_V1");
    expect(script).toContain("native bootstrap-files hook");
    expect(script).not.toContain("neo-brain-bootstrap.mjs");
    expect(bootstrap).toContain("OPENCLAW_NEO_BRAIN_URL");
    expect(bootstrap).toContain("OPENCLAW_NEO_BRAIN_TOKEN");
    expect(bootstrap).toContain("OPENCLAW_NEO_BRAIN_REQUIRED");
    expect(bootstrap).toContain("loadNeoRemoteBrainBootstrapFile");
    expect(bootstrap).toContain("immediately before OpenClaw built model context");
  });
});
