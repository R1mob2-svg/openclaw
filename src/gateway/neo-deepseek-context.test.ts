import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { NEO_CONTEXT_TOKENS, resolveConfiguredNeoDeepSeekContext } from "./neo-deepseek-context.js";
import fs from "node:fs";
import { buildGatewaySessionRow } from "./session-utils.js";

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
  it("projects 1M in the actual gateway sessions.list row despite an old 128k store entry", () => {
    const entry = {
      sessionId: "test-context-old",
      updatedAt: 1795000000000,
      modelProvider: "geminx-deepseek",
      model: "deepseek-flash",
      contextTokens: 128000,
      totalTokens: 32000,
      totalTokensFresh: true,
    };
    const key = "agent:neo:main";
    const row = buildGatewaySessionRow({
      cfg, storePath: "/tmp/neo-context-fixture/sessions.json",
      store: { [key]: entry }, key, entry,
    });
    expect(row.contextTokens).toBe(1000000);
    expect(row.modelProvider).toBe("geminx-deepseek");
    expect(row.model).toBe("deepseek-flash");
    expect(row.totalTokens).toBe(32000);
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
