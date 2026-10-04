import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Railway NEO context budget contract", () => {
  it("advertises the bounded proxy-compatible model window", () => {
    const script = readFileSync("scripts/railway-neo-runtime-start.sh", "utf8");
    expect(script).toContain("contextWindow: 128000");
    expect(script).toContain("maxTokens: 32000");
  });

  it("compacts before reaching the proxy ceiling", () => {
    const script = readFileSync("scripts/railway-neo-runtime-start.sh", "utf8");
    expect(script).toContain('agents.defaults.compaction.reserveTokens "32000"');
    expect(script).toContain('agents.defaults.compaction.keepRecentTokens "24000"');
    expect(script).not.toContain("contextWindow: 1000000");
  });
});
