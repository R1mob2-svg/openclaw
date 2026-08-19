import { describe, expect, it } from "vitest";
import { isFailureCandidate, redactString, sanitizeForLedger } from "./index.js";

describe("fusion-ledger redaction", () => {
  it("redacts secret-looking object keys recursively", () => {
    expect(
      sanitizeForLedger({
        ok: true,
        nested: {
          apiKey: "super-secret-value",
          Authorization: "Bearer abcdefghijklmnopqrstuvwxyz",
          label: "safe",
        },
      }),
    ).toEqual({
      ok: true,
      nested: {
        apiKey: "[REDACTED]",
        Authorization: "[REDACTED]",
        label: "safe",
      },
    });
  });

  it("redacts common credential shapes embedded in text", () => {
    const input = "token=sk-abcdefghijklmnopqrstuvwxyz github=github_pat_abcdefghijklmnopqrstuvwxyz";
    expect(redactString(input)).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
    expect(redactString(input)).not.toContain("github_pat_abcdefghijklmnopqrstuvwxyz");
  });

  it("bounds deeply nested payloads", () => {
    const input = { a: { b: { c: { d: { e: { f: { g: { h: { i: "too deep" } } } } } } } } };
    expect(JSON.stringify(sanitizeForLedger(input))).toContain("[MAX_DEPTH]");
  });
});

describe("fusion-ledger failure candidate classification", () => {
  it("captures error stream events", () => {
    expect(isFailureCandidate("error", { message: "boom" })).toBe(true);
  });

  it("captures failed and blocked status events", () => {
    expect(isFailureCandidate("item", { status: "failed" })).toBe(true);
    expect(isFailureCandidate("item", { status: "blocked" })).toBe(true);
  });

  it("does not promote healthy events", () => {
    expect(isFailureCandidate("item", { status: "completed" })).toBe(false);
    expect(isFailureCandidate("lifecycle", { phase: "end" })).toBe(false);
  });
});
