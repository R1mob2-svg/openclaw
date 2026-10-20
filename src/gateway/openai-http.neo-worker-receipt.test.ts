import { createHash, createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { testOnlyOpenAiHttp } from "./openai-http.js";

describe("GeminX NEO server-owned worker receipt", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("signs exact execution scope and returns independently hashable inline artifact", async () => {
    vi.stubEnv("GEMINX_NEO_WORKER_RECEIPT_HMAC_SECRET", "test-shared-secret-at-least-thirty-two-bytes-long");
    vi.stubEnv("OPENCLAW_SOURCE_COMMIT_SHA", "a".repeat(40));
    vi.stubEnv("OPENCLAW_NEO_BRAIN_SHA", "b".repeat(40));
    vi.stubEnv("RAILWAY_SERVICE_ID", "12345678-1234-4234-8234-123456789abc");

    const bundle = await testOnlyOpenAiHttp.buildGeminXNeoReceiptBundle({
      context: {
        objectiveId: "ambush:ambush_acme",
        taskId: "ambush_acme",
        attemptId: "attempt-1",
        leaseFingerprint: "c".repeat(64),
        requireImageArtifact: false,
      },
      runId: "chatcmpl_test-run-1",
      sessionKey: "openai:neo:ambush",
      model: "openclaw/default",
      content: "Completed execution",
      result: { meta: { stopReason: "stop", executionTrace: { runner: "embedded" } } },
      events: [{
        stream: "tool",
        ts: 1,
        data: { toolCallId: "tool-1", name: "browser", phase: "end", status: "completed" },
      }],
    });
    expect(bundle).not.toBeNull();
    const receipt = bundle!.worker_receipt as any;
    expect(receipt.schema_version).toBe("entreprenuity.neo.execution.v1");
    expect(receipt.objective_id).toBe("ambush:ambush_acme");
    expect(receipt.task_id).toBe("ambush_acme");
    expect(receipt.tool_receipts).toHaveLength(1);
    expect(receipt.tool_receipts[0]).toMatchObject({
      tool_call_id: "tool-1",
      tool: "browser",
      status: "succeeded",
    });
    expect(receipt.artifacts).toHaveLength(1);

    const inline = bundle!.worker_artifacts_inline[0] as any;
    const bytes = Buffer.from(inline.content_base64, "base64");
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(receipt.artifacts[0].sha256);

    const unsigned = { ...receipt };
    delete unsigned.worker_signature;
    const signingPayload = JSON.stringify([
      unsigned.schema_version, unsigned.worker_runtime_id, unsigned.worker_id, unsigned.company_scope,
      unsigned.objective_id, unsigned.task_id, unsigned.lease_fingerprint, unsigned.attempt_id,
      unsigned.source_commit_sha, unsigned.brain_commit_sha, unsigned.tool_receipts,
      unsigned.artifacts, unsigned.completed_at,
    ]);
    const expected = createHmac(
      "sha256",
      "test-shared-secret-at-least-thirty-two-bytes-long"
    ).update(signingPayload).digest("hex");
    expect(receipt.worker_signature).toBe(expected);
  });

  it("fails closed when server signing or provenance config is absent", async () => {
    vi.stubEnv("GEMINX_NEO_WORKER_RECEIPT_HMAC_SECRET", "");
    vi.stubEnv("OPENCLAW_SOURCE_COMMIT_SHA", "");
    vi.stubEnv("OPENCLAW_NEO_BRAIN_SHA", "");
    expect(await testOnlyOpenAiHttp.buildGeminXNeoReceiptBundle({
      context: {
        objectiveId: "ambush:o",
        taskId: "ambush_t",
        attemptId: "attempt-1",
        leaseFingerprint: "d".repeat(64),
        requireImageArtifact: false,
      },
      runId: "run-1",
      sessionKey: "session-1",
      model: "openclaw/default",
      content: "x",
      result: {},
      events: [],
    })).toBeNull();
  });

  it("does not issue a worker PASS for a chat turn with zero observed tool execution", async () => {
    vi.stubEnv("GEMINX_NEO_WORKER_RECEIPT_HMAC_SECRET", "test-shared-secret-at-least-thirty-two-bytes-long");
    vi.stubEnv("OPENCLAW_SOURCE_COMMIT_SHA", "a".repeat(40));
    vi.stubEnv("OPENCLAW_NEO_BRAIN_SHA", "b".repeat(40));
    expect(await testOnlyOpenAiHttp.buildGeminXNeoReceiptBundle({
      context: {
        objectiveId: "ambush:o",
        taskId: "ambush_t",
        attemptId: "attempt-1",
        leaseFingerprint: "d".repeat(64),
        requireImageArtifact: false,
      },
      runId: "run-chat-only",
      sessionKey: "session-chat-only",
      model: "openclaw/default",
      content: "I claim I did it",
      result: { meta: { stopReason: "stop" } },
      events: [],
    })).toBeNull();
  });


  it("binds exact NEO image bytes into the signed receipt and inline artifact bundle", async () => {
    vi.stubEnv("GEMINX_NEO_WORKER_RECEIPT_HMAC_SECRET", "test-shared-secret-at-least-thirty-two-bytes-long");
    vi.stubEnv("OPENCLAW_SOURCE_COMMIT_SHA", "a".repeat(40));
    vi.stubEnv("OPENCLAW_NEO_BRAIN_SHA", "b".repeat(40));
    const imageBytes = Buffer.from("exact-neo-generated-image-bytes");
    const imageSha = createHash("sha256").update(imageBytes).digest("hex");
    const readMediaBufferFn = vi.fn(async () => ({
      id: "final-mockup.png",
      path: "/managed/media/final-mockup.png",
      buffer: imageBytes,
      size: imageBytes.length,
    }));

    const bundle = await testOnlyOpenAiHttp.buildGeminXNeoReceiptBundle({
      context: {
        objectiveId: "ambush:o",
        taskId: "ambush_t",
        attemptId: "attempt-image",
        leaseFingerprint: "e".repeat(64),
        requireImageArtifact: true,
      },
      runId: "run-image",
      sessionKey: "session-image",
      model: "openclaw/default",
      content: "Image generated",
      result: {},
      events: [
        {
          stream: "tool",
          ts: 1,
          data: {
            toolCallId: "tool-image-1",
            name: "image_generate",
            phase: "result",
            isError: false,
            result: {
              details: {
                attachments: [{
                  type: "image",
                  name: "final-mockup.png",
                  mimeType: "image/png",
                  path: "/managed/media/final-mockup.png",
                }],
              },
            },
          },
        },
        {
          stream: "tool",
          ts: 2,
          data: { toolCallId: "tool-image-1", name: "image_generate", phase: "end", status: "completed" },
        },
      ],
      readMediaBufferFn,
    });

    expect(bundle).not.toBeNull();
    expect(readMediaBufferFn).toHaveBeenCalledWith(
      "final-mockup.png",
      "tool-image-generation",
      25_000_000,
    );
    const receipt = bundle!.worker_receipt as any;
    expect(receipt.tool_receipts).toEqual([
      expect.objectContaining({ tool_call_id: "tool-image-1", tool: "image_generate", status: "succeeded" }),
    ]);
    expect(receipt.artifacts[0]).toEqual({
      sha256: imageSha,
      size_bytes: imageBytes.length,
      content_type: "image/png",
    });
    const inlineImage = bundle!.worker_artifacts_inline.find(
      (artifact: any) => artifact.content_type === "image/png",
    ) as any;
    expect(Buffer.from(inlineImage.content_base64, "base64")).toEqual(imageBytes);
    expect(inlineImage.sha256).toBe(imageSha);
  });

  it("fails closed when Digital Ambush requires an image but NEO did not return one", async () => {
    vi.stubEnv("GEMINX_NEO_WORKER_RECEIPT_HMAC_SECRET", "test-shared-secret-at-least-thirty-two-bytes-long");
    vi.stubEnv("OPENCLAW_SOURCE_COMMIT_SHA", "a".repeat(40));
    vi.stubEnv("OPENCLAW_NEO_BRAIN_SHA", "b".repeat(40));
    const bundle = await testOnlyOpenAiHttp.buildGeminXNeoReceiptBundle({
      context: {
        objectiveId: "ambush:o",
        taskId: "ambush_t",
        attemptId: "attempt-image-required",
        leaseFingerprint: "e".repeat(64),
        requireImageArtifact: true,
      },
      runId: "run-image-required",
      sessionKey: "session-image-required",
      model: "openclaw/default",
      content: "Research completed but image missing",
      result: {},
      events: [{
        stream: "tool",
        ts: 1,
        data: { toolCallId: "tool-research-1", name: "browser", phase: "end", status: "completed" },
      }],
    });
    expect(bundle).toBeNull();
  });


  it("keeps one failed image attempt recoverable but terminates the second quota failure", () => {
    const quotaFailure = (id: string) => ({
      stream: "tool",
      ts: 1,
      data: {
        toolCallId: id,
        name: "image_generate",
        phase: "result",
        isError: true,
        result: { error: "HTTP 429 RESOURCE_EXHAUSTED current quota exceeded" },
      },
    });
    expect(testOnlyOpenAiHttp.terminalGeminXNeoImageFailure(
      [quotaFailure("image-1")],
      true,
      2,
    )).toBeNull();
    expect(testOnlyOpenAiHttp.terminalGeminXNeoImageFailure(
      [quotaFailure("image-1"), quotaFailure("image-2")],
      true,
      2,
    )).toBe("NEO_IMAGE_PROVIDER_QUOTA_EXHAUSTED");
  });

  it("does not double-count duplicate error events for the same image tool call", () => {
    const duplicate = {
      stream: "tool",
      ts: 1,
      data: {
        toolCallId: "image-1",
        name: "image_generate",
        phase: "result",
        isError: true,
        result: { error: "HTTP 429 RESOURCE_EXHAUSTED" },
      },
    };
    expect(testOnlyOpenAiHttp.terminalGeminXNeoImageFailure(
      [duplicate, { ...duplicate, ts: 2 }],
      true,
      2,
    )).toBeNull();
  });

  it("terminates two non-quota image failures as artifact-not-verified", () => {
    const failures = ["image-1", "image-2"].map((toolCallId, index) => ({
      stream: "tool",
      ts: index + 1,
      data: {
        toolCallId,
        name: "image_generate",
        phase: "result",
        isError: true,
        result: { error: "renderer returned no usable image attachment" },
      },
    }));
    expect(testOnlyOpenAiHttp.terminalGeminXNeoImageFailure(
      failures,
      true,
      2,
    )).toBe("NEO_IMAGE_ARTIFACT_NOT_VERIFIED");
  });

  it("ignores successful image tool events when enforcing the failed-attempt circuit", () => {
    expect(testOnlyOpenAiHttp.terminalGeminXNeoImageFailure(
      [
        {
          stream: "tool",
          ts: 1,
          data: {
            toolCallId: "image-ok",
            name: "image_generate",
            phase: "result",
            isError: false,
            result: { details: { attachments: [{ type: "image", name: "ok.png" }] } },
          },
        },
      ],
      true,
      2,
    )).toBeNull();
  });

});
