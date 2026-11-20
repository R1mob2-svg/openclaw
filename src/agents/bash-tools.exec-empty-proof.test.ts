import { describe, expect, it } from "vitest";
import { buildExecExitOutcome } from "./bash-tools.exec-runtime.js";

function exited(exitCode: number | null, stdout = "") {
  return buildExecExitOutcome({
    exit: {
      reason: "exit",
      exitCode,
      exitSignal: null,
      stdout,
      stderr: "",
      durationMs: 2,
      timedOut: false,
      noOutputTimedOut: false,
    } as Parameters<typeof buildExecExitOutcome>[0]["exit"],
    aggregated: stdout,
    durationMs: 2,
    timeoutSec: 10,
  });
}

describe("ADDED-14: exec may never mask a failed or empty result", () => {
  it("treats silent nonzero exit as failure with the real code", () => {
    const outcome = exited(9);
    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") throw new Error("expected failed");
    expect(outcome.failureKind).toBe("nonzero-exit");
    expect(outcome.reason).toContain("code 9");
  });

  it("never treats an unknown exit code as a zero exit", () => {
    const outcome = exited(null);
    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") throw new Error("expected failed");
    expect(outcome.reason).toContain("code unknown");
  });

  it("makes a genuine zero-exit no-output command explicit rather than blank", () => {
    const outcome = exited(0);
    expect(outcome.status).toBe("completed");
    expect(outcome.aggregated).toContain("code 0 (no stdout or stderr)");
  });

  it("does not replace real pipe-containing stdout", () => {
    const outcome = exited(0, "a|b|c\n");
    expect(outcome.status).toBe("completed");
    expect(outcome.aggregated).toBe("a|b|c\n");
  });
});
