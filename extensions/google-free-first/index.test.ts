import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import googleFreePlugin from "./index.js";

type Hook = (...args: any[]) => unknown;
const envSave = { ...process.env };
const tempDirs: string[] = [];

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-google-free-"));
  tempDirs.push(dir);
  process.env.OPENCLAW_GOOGLE_FREE_LEDGER_PATH = path.join(dir, "daily.json");
  process.env.OPENCLAW_GOOGLE_FREE_FIRST_ENABLED = "true";
  process.env.OPENCLAW_GOOGLE_FREE_TIER_CONFIRMED = "true";
  process.env.OPENCLAW_GOOGLE_FREE_PRIVATE_DATA_OPT_IN = "true";
  process.env.GOOGLE_API_KEY = "test-only";
  process.env.OPENCLAW_GOOGLE_FREE_PER_AGENT_DAILY = "1";
  process.env.OPENCLAW_GOOGLE_FREE_SHARED_DAILY = "2";
  const handlers: Record<string, Hook> = {};
  (googleFreePlugin as any).register({
    on(name: string, callback: Hook) { handlers[name] = callback; },
    logger: { info: vi.fn(), warn: vi.fn() }
  });
  return { handlers, ledger: process.env.OPENCLAW_GOOGLE_FREE_LEDGER_PATH };
}

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in envSave)) delete process.env[key];
  }
  Object.assign(process.env, envSave);
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("OpenClaw Google free-first per-agent routing", () => {
  it("does not activate without explicit private context consent", () => {
    const { handlers } = setup();
    delete process.env.OPENCLAW_GOOGLE_FREE_PRIVATE_DATA_OPT_IN;
    expect(handlers.before_model_resolve({ prompt: "hello" }, { agentId: "ag" })).toBeUndefined();
  });

  it("defaults to Google and then routes only the exhausted agent to DeepSeek", () => {
    const { handlers, ledger } = setup();
    expect(handlers.before_model_resolve({ prompt: "a" }, { agentId: "ag" }))
      .toMatchObject({ providerOverride: "google", modelOverride: "gemini-3.7-flash" });
    handlers.model_call_started({ provider: "google", model: "gemini-3.7-flash" }, { agentId: "ag" });
    expect(handlers.before_model_resolve({ prompt: "a" }, { agentId: "ag" }))
      .toMatchObject({ providerOverride: "deepseek", modelOverride: "deepseek-chat" });
    expect(handlers.before_model_resolve({ prompt: "b" }, { agentId: "neo" }))
      .toMatchObject({ providerOverride: "google", modelOverride: "gemini-3.7-flash" });
    handlers.model_call_started({ provider: "google", model: "gemini-3.7-flash" }, { agentId: "neo" });
    expect(handlers.before_model_resolve({ prompt: "c" }, { agentId: "geminx" }))
      .toMatchObject({ providerOverride: "deepseek", modelOverride: "deepseek-chat" });
    expect(JSON.parse(fs.readFileSync(ledger!, "utf8")).total).toBe(2);
  });

  it("does not count DeepSeek calls against Google free quota", () => {
    const { handlers, ledger } = setup();
    handlers.model_call_started({ provider: "deepseek", model: "deepseek-chat" }, { agentId: "ag" });
    expect(fs.existsSync(ledger!)).toBe(false);
  });
});
