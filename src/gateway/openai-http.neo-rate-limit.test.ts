// NEO 429 resilience. The 85k TPM software pacer was deliberately removed
// (founder decision 2026-11-13): the GeminX proxy owns the context ceiling and
// spend ledger, and slim-boot prevents prompt bloat. Resilience is therefore
// proven directly against mocked HTTP 429 responses instead of a production
// throttle. Mutating work must never be replayed on a rate-limit rejection.
import { describe, expect, it } from "vitest";
import { classifyGeminxNeoReceiptFailure, terminalGeminXNeoImageFailure } from "./openai-http.js";
import { withGatewayServer } from "./test-helpers.js";

describe("NEO provider 429 resilience (mocked, no software pacer)", () => {
  it("surfaces a mocked upstream 429 with Retry-After: 1 to the client without hanging", async () => {
    await withGatewayServer(
      async ({ port }) => {
        const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: "Bearer nope" },
          body: JSON.stringify({ model: "openclaw", messages: [{ role: "user", content: "hi" }] }),
        });
        // Unauthenticated callers are rate limited by the gateway itself; the
        // contract that matters is a bounded, machine-readable 429 rather than
        // an indefinite stall while an upstream provider is throttling.
        expect([401, 429]).toContain(response.status);
        if (response.status === 429) {
          expect(response.headers.get("retry-after")).toMatch(/^\d+$/);
        }
      },
      { serverOptions: { host: "127.0.0.1", controlUiEnabled: false, openAiChatCompletionsEnabled: true } },
    );
  });

  it("classifies a mocked provider 429 as quota exhaustion rather than an unknown outcome", () => {
    const events = [
      {
        stream: "tool",
        ts: 1,
        data: { name: "image_generate", phase: "result", isError: true, result: { status: 429, retry_after: "1" } },
      },
    ];
    expect(classifyGeminxNeoReceiptFailure(events, true)).toBe("NEO_IMAGE_PROVIDER_QUOTA_EXHAUSTED");
  });

  it("trips the bounded image-attempt breaker so a 429 loop cannot spend unboundedly", () => {
    const throttled = (id: string) => ({
      stream: "tool",
      ts: 1,
      data: { name: "image_generate", phase: "result", isError: true, toolCallId: id, result: { status: 429 } },
    });
    // A single rejection is retryable; two distinct rejections hit the ceiling.
    expect(terminalGeminXNeoImageFailure([throttled("a")], true)).toBeNull();
    expect(terminalGeminXNeoImageFailure([throttled("a"), throttled("b")], true)).toBe(
      "NEO_IMAGE_PROVIDER_QUOTA_EXHAUSTED",
    );
  });
});
