import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildActivityPayload,
  createActivityEmitter,
  formatLabel,
  isSilentFailure,
  normalizeProgressContext,
  phaseForTool,
  statusForToolPhase,
  truncateLabel
} from "../bin/neo-activity-emit.mjs";

const CTX = {
  callback_url: "https://hq.example.test/api/v1/founder/jobs/job-1/activity",
  job_id: "job-1",
  lease_epoch: 7,
  token: "secret-token"
};

function jsonResponse(status, body = {}) {
  return {
    status,
    json: async () => body
  };
}

/** Fetcher that records every call and replies with a scripted response. */
function recordingFetcher(responder) {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return responder(calls.length, init);
  };
  fetcher.calls = calls;
  return fetcher;
}

describe("NEO activity emitter — payload formatting", () => {
  it("builds the exact HQ contract shape", () => {
    const payload = buildActivityPayload({
      leaseEpoch: 7,
      eventId: "job-1:1",
      phase: "github",
      status: "running",
      label: "Opening PR",
      tool: "github_pr_create"
    });
    assert.deepEqual(Object.keys(payload).toSorted(), [
      "event_id",
      "label",
      "lease_epoch",
      "phase",
      "status",
      "tool"
    ]);
    assert.deepEqual(payload, {
      lease_epoch: 7,
      event_id: "job-1:1",
      phase: "github",
      status: "running",
      label: "Opening PR",
      tool: "github_pr_create"
    });
  });

  it("coerces unknown phase/status onto valid values instead of sending junk", () => {
    const payload = buildActivityPayload({
      leaseEpoch: null,
      eventId: "e1",
      phase: "nonsense",
      status: "exploded",
      label: "x",
      tool: "t"
    });
    assert.equal(payload.phase, "workspace");
    assert.equal(payload.status, "running");
  });

  it("keeps labels under 120 chars and never leaks raw JSON", () => {
    const huge = `deploy ${"a".repeat(400)}`;
    const label = truncateLabel(huge);
    assert.ok(label.length <= 120, `label was ${label.length} chars`);
    assert.ok(label.endsWith("…"));

    const jsonish = formatLabel({
      tool: "exec",
      status: "running",
      args: { command: 'curl -X POST -d \'{"a":1,"b":[2,3]}\'' }
    });
    assert.ok(jsonish.length <= 120);
    assert.ok(!jsonish.includes("\n"));
  });

  it("picks a descriptive arg for the label, and falls back to the tool name", () => {
    assert.equal(
      formatLabel({ tool: "exec", status: "running", args: { command: "pnpm test" } }),
      "Running: pnpm test"
    );
    assert.equal(formatLabel({ tool: "exec", status: "done", args: {} }), "Finished: exec");
    assert.equal(formatLabel({ tool: "github_pr_merge", status: "failed" }), "Failed: github_pr_merge");
  });
});

describe("NEO activity emitter — phase/status mapping", () => {
  it("maps tools onto HQ phases", () => {
    assert.equal(phaseForTool("github_pr_create"), "github");
    assert.equal(phaseForTool("gh"), "github");
    assert.equal(phaseForTool("railway_deploy"), "railway");
    assert.equal(phaseForTool("geminx_device"), "pc");
    assert.equal(phaseForTool("device_screenshot"), "pc");
    assert.equal(phaseForTool("read"), "workspace");
    assert.equal(phaseForTool("exec"), "workspace");
    assert.equal(phaseForTool(undefined), "workspace");
  });

  it("maps tool lifecycle phases onto HQ statuses", () => {
    assert.equal(statusForToolPhase("start"), "running");
    assert.equal(statusForToolPhase("update"), "running");
    assert.equal(statusForToolPhase("done"), "done");
    assert.equal(statusForToolPhase("completed"), "done");
    assert.equal(statusForToolPhase("blocked"), "blocked");
    assert.equal(statusForToolPhase("failed"), "failed");
    assert.equal(statusForToolPhase("error"), "failed");
    assert.equal(statusForToolPhase(""), "running");
  });

  it("treats a malformed progress_context as disabled rather than throwing", () => {
    assert.equal(normalizeProgressContext(null), null);
    assert.equal(normalizeProgressContext({}), null);
    assert.equal(normalizeProgressContext({ ...CTX, callback_url: "" }), null);
    assert.equal(normalizeProgressContext({ ...CTX, token: "" }), null);
    assert.equal(normalizeProgressContext({ ...CTX, job_id: "" }), null);
    assert.equal(normalizeProgressContext({ ...CTX, callback_url: "not-a-url" }), null);
    assert.deepEqual(normalizeProgressContext({ ...CTX, lease_epoch: "12" }), { ...CTX, lease_epoch: 12 });
  });
});

describe("NEO activity emitter — fail-open behaviour", () => {
  it("sends a signed POST with bearer auth and increments sent on 200", async () => {
    const fetcher = recordingFetcher(() => jsonResponse(200, { ok: true }));
    const emitter = createActivityEmitter({ progressContext: CTX, fetcher, logger: () => {} });

    const result = await emitter.emitToolStart({ name: "github_pr_create", phase: "start" });

    assert.equal(result.ok, true);
    assert.equal(fetcher.calls.length, 1);
    const { url, init, body } = fetcher.calls[0];
    assert.equal(url, CTX.callback_url);
    assert.equal(init.method, "POST");
    assert.equal(init.headers.Authorization, "Bearer secret-token");
    assert.equal(init.headers["Content-Type"], "application/json");
    assert.equal(body.lease_epoch, 7);
    assert.equal(body.phase, "github");
    assert.equal(body.status, "running");
    assert.equal(body.tool, "github_pr_create");
    assert.match(body.event_id, /^job-1:/);
    assert.equal(emitter.snapshot().sent, 1);
  });

  it("swallows 409 STALE_LEASE without throwing or counting a failure", async () => {
    const fetcher = recordingFetcher(() => jsonResponse(409, { error_code: "STALE_LEASE" }));
    const emitter = createActivityEmitter({ progressContext: CTX, fetcher, logger: () => {} });

    const result = await emitter.emitToolStart({ name: "exec", phase: "start" });

    assert.equal(result.ok, false);
    assert.equal(result.skipped, true);
    assert.equal(result.reason, "STALE_LEASE");
    const counters = emitter.snapshot();
    assert.equal(counters.failed, 0);
    assert.equal(counters.skipped, 1);
  });

  it("swallows 409 JOB_TERMINAL", async () => {
    const fetcher = recordingFetcher(() => jsonResponse(409, { error_code: "JOB_TERMINAL" }));
    const emitter = createActivityEmitter({ progressContext: CTX, fetcher, logger: () => {} });
    const result = await emitter.emitToolStart({ name: "exec", phase: "done" });
    assert.equal(result.skipped, true);
    assert.equal(result.reason, "JOB_TERMINAL");
    assert.equal(emitter.snapshot().failed, 0);
  });

  it("swallows 429 STEP_RATE_LIMITED", async () => {
    const fetcher = recordingFetcher(() => jsonResponse(429, { error_code: "STEP_RATE_LIMITED" }));
    const emitter = createActivityEmitter({ progressContext: CTX, fetcher, logger: () => {} });
    const result = await emitter.emitToolStart({ name: "railway_deploy", phase: "start" });
    assert.equal(result.skipped, true);
    assert.equal(result.reason, "STEP_RATE_LIMITED");
    assert.equal(emitter.snapshot().failed, 0);
  });

  it("swallows a bare 409/429 even when no error_code is returned", () => {
    assert.equal(isSilentFailure({ httpStatus: 409 }), true);
    assert.equal(isSilentFailure({ httpStatus: 429 }), true);
    assert.equal(isSilentFailure({ httpStatus: 500 }), false);
  });

  it("never throws on timeout or network error", async () => {
    const timeoutFetcher = async () => {
      const err = new Error("timed out");
      err.name = "TimeoutError";
      throw err;
    };
    const emitter = createActivityEmitter({ progressContext: CTX, fetcher: timeoutFetcher, logger: () => {} });
    const result = await emitter.emitToolStart({ name: "exec", phase: "start" });
    assert.equal(result.ok, false);
    assert.equal(result.skipped, true);
    assert.equal(result.reason, "TIMEOUT");

    const netFetcher = async () => {
      throw new Error("ECONNREFUSED");
    };
    const emitter2 = createActivityEmitter({ progressContext: CTX, fetcher: netFetcher, logger: () => {} });
    const result2 = await emitter2.emitToolStart({ name: "exec", phase: "start" });
    assert.equal(result2.reason, "NETWORK_ERROR");
    assert.equal(emitter2.snapshot().failed, 0);
  });

  it("still swallows a non-silent 500 and reports it as skipped telemetry", async () => {
    const fetcher = recordingFetcher(() => jsonResponse(500, { error_code: "BOOM" }));
    const emitter = createActivityEmitter({ progressContext: CTX, fetcher, logger: () => {} });
    const result = await emitter.emitToolStart({ name: "exec", phase: "start" });
    assert.equal(result.skipped, true);
    assert.equal(result.httpStatus, 500);
  });

  it("is a clean no-op when the turn carries no progress_context", async () => {
    const fetcher = recordingFetcher(() => jsonResponse(200));
    const emitter = createActivityEmitter({ progressContext: undefined, fetcher, logger: () => {} });
    assert.equal(emitter.enabled, false);
    const result = await emitter.emitToolStart({ name: "exec", phase: "start" });
    assert.equal(result.skipped, true);
    assert.equal(result.reason, "NO_PROGRESS_CONTEXT");
    assert.equal(fetcher.calls.length, 0);
  });

  it("emits monotonically distinct event ids so HQ can order milestones", async () => {
    const fetcher = recordingFetcher(() => jsonResponse(200));
    const emitter = createActivityEmitter({ progressContext: CTX, fetcher, logger: () => {} });
    await emitter.emitToolStart({ name: "exec", phase: "start" });
    await emitter.emitToolStart({ name: "exec", phase: "done" });
    const ids = fetcher.calls.map((c) => c.body.event_id);
    assert.equal(new Set(ids).size, 2);
  });
});
