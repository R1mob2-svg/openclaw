import { describe, expect, it } from "vitest";
import { isThinkOnlyStrategistModel } from "./model-fallback.js";

describe("Founder-wide think-only strategist guard", () => {
  it("blocks DeepSeek V4 Pro from all agent tool/fallback candidate execution", () => {
    expect(isThinkOnlyStrategistModel("deepseek", "deepseek-v4-pro")).toBe(true);
    expect(isThinkOnlyStrategistModel("geminx-deepseek", "deepseek-v4-pro")).toBe(true);
    expect(isThinkOnlyStrategistModel("deepseek", "deepseek-v4.1-pro")).toBe(true);
  });

  it("blocks expensive Astra reasoning models from the execution lane", () => {
    expect(isThinkOnlyStrategistModel("openai", "gpt-6-astra")).toBe(true);
    expect(isThinkOnlyStrategistModel("openai", "astra-pro")).toBe(true);
  });

  it("keeps Flash, default auto-proxy, and ordinary models available for execution", () => {
    expect(isThinkOnlyStrategistModel("deepseek", "deepseek-v4-flash")).toBe(false);
    expect(isThinkOnlyStrategistModel("geminx-deepseek", "geminx-auto")).toBe(false);
    expect(isThinkOnlyStrategistModel("deepseek", "deepseek-chat")).toBe(false);
    expect(isThinkOnlyStrategistModel("openai", "gpt-4o-mini")).toBe(false);
  });
});
