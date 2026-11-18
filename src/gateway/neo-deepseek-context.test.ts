import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { NEO_CONTEXT_TOKENS, resolveConfiguredNeoDeepSeekContext } from "./neo-deepseek-context.js";
import fs from "node:fs";

const cfg = {
  agents: { defaults: { contextTokens: 1000000 } },
  models: { providers: { "geminx-deepseek": { models: [
    { id: "deepseek-flash", contextWindow: 1000000 },
    { id: "deepseek-v4-pro", contextWindow: 1000000 },
    { id: "geminx-auto", contextWindow: 128000 }
  ] } } }
} as unknown as OpenClawConfig;
describe("Neo browser context-meter projection", () => {
  it("returns exact 1,000,000 for both configured DeepSeek V4 models", () => {
    for (const model of ["deepseek-flash","deepseek-v4-pro"]) {
      expect(resolveConfiguredNeoDeepSeekContext({cfg, provider:"geminx-deepseek",model})).toBe(NEO_CONTEXT_TOKENS);
    }
  });
  it("never replaces Google, legacy or another provider window", () => {
    for (const model of ["geminx-auto","geminx-google-qa"]) {
      expect(resolveConfiguredNeoDeepSeekContext({cfg,provider:"geminx-deepseek",model})).toBeUndefined();
    }
    expect(resolveConfiguredNeoDeepSeekContext({cfg,provider:"google",model:"deepseek-flash"})).toBeUndefined();
  });
  it("fails closed if the live config is regressed", () => {
    const regressed = structuredClone(cfg) as OpenClawConfig;
    regressed.agents!.defaults!.contextTokens = 128000;
    expect(resolveConfiguredNeoDeepSeekContext({
      cfg:regressed,provider:"geminx-deepseek",model:"deepseek-flash"
    })).toBeUndefined();
  });
  it("wires the gateway result path used by UI context meter", () => {
    const projection = fs.readFileSync("src/gateway/session-utils.ts","utf8");
    const ui = fs.readFileSync("ui/src/ui/chat/context-notice.ts","utf8");
    expect(projection).toContain("const neoConfiguredContext = resolveConfiguredNeoDeepSeekContext");
    expect(projection).toContain("const contextTokens = neoConfiguredContext ?? (lightweight");
    expect(ui).toContain("session?.contextTokens ?? defaultContextTokens");
    expect(fs.readFileSync("scripts/railway-neo-runtime-start.sh","utf8")).toContain("node scripts/repair-neo-context-meter.mjs");
  });
});
