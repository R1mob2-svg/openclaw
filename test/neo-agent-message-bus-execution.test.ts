import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("NEO GitHub agent bus execution bridge", () => {
  const script = readFileSync("scripts/poll-agent-message-bus.mjs", "utf8");

  it("executes only the bounded canonical NEO autonomous command", () => {
    expect(script).toContain('EXECUTABLE_NEO_COMMANDS = new Set(["GEMINX_AUTONOMOUS_TASK_V1"])');
    expect(script).toContain('toLowerCase() !== "neo"');
    expect(script).toContain('toLowerCase() !== "newton"');
    expect(script).toContain("executionMaxAgeMs()");
  });

  it("dispatches through the authenticated native OpenClaw ingress", () => {
    expect(script).toContain("http://127.0.0.1:8080/v1/chat/completions");
    expect(script).toContain('Authorization: `Bearer ${gatewayToken}`');
    expect(script).toContain('model: "openclaw"');
    expect(script).toContain("OPENCLAW_GATEWAY_TOKEN");
  });

  it("gives tool-using NEO bus objectives a bounded five-minute execution window", () => {
    expect(script).toContain("DEFAULT_NEO_DISPATCH_TIMEOUT_MS = 300_000");
    expect(script).toContain("GEMINX_AGENT_BUS_NEO_DISPATCH_TIMEOUT_MS");
    expect(script).toContain("Math.max(120_000, Math.min(300_000");
    expect(script).toContain("AbortSignal.timeout(neoDispatchTimeoutMs())");
  });

  it("bounds retries and emits durable execution receipts", () => {
    expect(script).toContain("MAX_DISPATCH_ATTEMPTS = 3");
    expect(script).toContain("executionReceiptPath");
    expect(script).toContain("action=executed");
    expect(script).toContain("action=dispatch_failed");
    expect(script).toContain("AGENT_MESSAGE_BUS_RECEIPT_V1");
  });

  it("redacts common credential shapes from mirrored receipt text", () => {
    expect(script).toContain("REDACTED_GITHUB_TOKEN");
    expect(script).toContain("REDACTED_API_KEY");
    expect(script).toContain("Bearer [REDACTED]");
  });
});
