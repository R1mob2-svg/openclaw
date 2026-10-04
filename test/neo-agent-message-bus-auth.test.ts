import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("NEO GitHub message bus credential fallback", () => {
  it("accepts the canonical repo token first and existing GitHub credential names as fallbacks", () => {
    const script = readFileSync("scripts/poll-agent-message-bus.mjs", "utf8");
    const expected = [
      "GEMINX_REPO_ACCESS_TOKEN",
      "GH_TOKEN",
      "GITHUB_TOKEN",
      "GITHUB_PAT",
    ];
    for (const name of expected) expect(script).toContain(name);
    expect(script).toContain("auth_source=");
    expect(script).not.toContain("console.log(token)");
  });
});
