import { describe, expect, it } from "vitest";
import { classifyGeminxNeoReceiptFailure } from "./openai-http.js";

describe("GeminX NEO failure evidence", () => {
  it("classifies failed image provider quota without declaring a worker receipt", () => {
    const events = [
      { stream: "tool", ts: 1, data: { name: "image_generate", phase: "result", isError: true, result: { error: "OpenAI HTTP 429 credit_balance_exhausted" } } },
      { stream: "tool", ts: 2, data: { name: "image_generate", phase: "result", isError: true, result: { error: "Google RESOURCE_EXHAUSTED" } } },
    ];
    expect(classifyGeminxNeoReceiptFailure(events, true)).toBe("NEO_IMAGE_PROVIDER_QUOTA_EXHAUSTED");
  });

  it("does not attribute quota to unrelated tools or mere generated text", () => {
    const events = [{ stream: "tool", ts: 3, data: { name: "web_search", phase: "result", isError: true, result: "HTTP 429" } }];
    expect(classifyGeminxNeoReceiptFailure(events, true)).toBe("NEO_IMAGE_ARTIFACT_NOT_VERIFIED");
    expect(classifyGeminxNeoReceiptFailure([], true)).toBe("NEO_IMAGE_ARTIFACT_NOT_VERIFIED");
    expect(classifyGeminxNeoReceiptFailure([], false)).toBe("NEO_WORKER_EXECUTION_UNVERIFIED");
  });
});
