#!/usr/bin/env node
// NEO activity emitter v1
// Live milestone callbacks for HQ: while a turn runs, POST small, human-readable
// progress events so the Founder HQ branded GitHub/Railway/PC badges light up
// mid-run instead of only at completion.
//
// Contract (HQ side): POST /api/v1/founder/jobs/:id/activity
//   Authorization: Bearer <token>
//   { lease_epoch, event_id, phase, status, label, tool }
//
// phase:  github | railway | pc | workspace
// status: running | done | blocked | failed
//
// This emitter is FAIL-OPEN by design. A progress callback is telemetry, never
// work. Stale leases, terminal jobs, rate limits and network faults are all
// swallowed so a flaky HQ endpoint can never fail a job that actually succeeded.

/** Callback outcomes that mean "the job is fine, the telemetry is not". */
export const SILENT_FAILURE_CODES = Object.freeze([
  "STALE_LEASE",
  "JOB_TERMINAL",
  "STEP_RATE_LIMITED"
]);

export const PHASES = Object.freeze(["github", "railway", "pc", "workspace"]);
export const STATUSES = Object.freeze(["running", "done", "blocked", "failed"]);

const MAX_LABEL_CHARS = 120;

/**
 * Map a tool name onto a HQ phase.
 * Deliberately conservative: anything unrecognised is "workspace", because
 * mislabelling a GitHub step as a Railway step on the Founder's screen is worse
 * than showing a generic badge.
 */
export function phaseForTool(tool) {
  const name = typeof tool === "string" ? tool.trim().toLowerCase() : "";
  if (!name) {
    return "workspace";
  }
  if (/^(github|gh)_/.test(name) || name === "gh" || name.includes("github")) {
    return "github";
  }
  if (name.includes("railway")) {
    return "railway";
  }
  if (/^(pc|desktop|device|geminx_device|screen|camera)/.test(name)) {
    return "pc";
  }
  return "workspace";
}

/** Map a tool lifecycle phase onto a HQ status. */
export function statusForToolPhase(toolPhase) {
  const phase = typeof toolPhase === "string" ? toolPhase.trim().toLowerCase() : "";
  switch (phase) {
    case "start":
      return "running";
    case "done":
    case "complete":
    case "completed":
    case "end":
      return "done";
    case "blocked":
    case "waiting":
    case "pending":
      return "blocked";
    case "failed":
    case "error":
      return "failed";
    default:
      return "running";
  }
}

/**
 * Collapse a tool's args into a short human label.
 * Never leaks a raw JSON blob onto the Founder's screen: we take the single most
 * descriptive scalar and cut it to length.
 */
export function formatLabel({ tool, status, args } = {}) {
  const verb = status === "done" ? "Finished" : status === "failed" ? "Failed" : status === "blocked" ? "Waiting on" : "Running";
  const subject = pickSubject(args);
  const base = subject ? `${verb}: ${subject}` : `${verb}: ${tool || "step"}`;
  return truncateLabel(base);
}

function pickSubject(args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return "";
  }
  const priority = ["command", "path", "url", "query", "name", "title", "file", "pattern", "goal"];
  for (const key of priority) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim().replace(/\s+/g, " ");
    }
  }
  return "";
}

export function truncateLabel(text, max = MAX_LABEL_CHARS) {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  if (clean.length <= max) {
    return clean;
  }
  return `${clean.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/**
 * Normalise raw HQ progress context. Returns null when the turn has no usable
 * callback — then the emitter becomes a no-op rather than a source of errors.
 */
export function normalizeProgressContext(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const callbackUrl = typeof raw.callback_url === "string" ? raw.callback_url.trim() : "";
  const token = typeof raw.token === "string" ? raw.token.trim() : "";
  const jobId = typeof raw.job_id === "string" ? raw.job_id.trim() : "";
  if (!callbackUrl || !token || !jobId) {
    return null;
  }
  if (!/^https?:\/\//i.test(callbackUrl)) {
    return null;
  }
  return {
    callback_url: callbackUrl,
    token,
    job_id: jobId,
    lease_epoch: normalizeLeaseEpoch(raw.lease_epoch)
  };
}

function normalizeLeaseEpoch(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value.trim()))) {
    return Number(value.trim());
  }
  return value ?? null;
}

/** Build the exact JSON body HQ expects. Pure, so tests can assert on it. */
export function buildActivityPayload({ leaseEpoch, eventId, phase, status, label, tool }) {
  return {
    lease_epoch: leaseEpoch,
    event_id: eventId,
    phase: PHASES.includes(phase) ? phase : "workspace",
    status: STATUSES.includes(status) ? status : "running",
    label: truncateLabel(label),
    tool: typeof tool === "string" && tool.trim() ? tool.trim() : null
  };
}

/** True when an HTTP status/error code is one we intentionally ignore. */
export function isSilentFailure({ httpStatus, errorCode } = {}) {
  if (SILENT_FAILURE_CODES.includes(errorCode)) {
    return true;
  }
  // 409 = stale lease / terminal job, 429 = step rate limited.
  return httpStatus === 409 || httpStatus === 429;
}

function log(msg) {
  process.stderr.write(`[neo-activity] ${msg}\n`);
}

/**
 * Create an emitter bound to one turn's progress_context.
 *
 * Every failure path returns instead of throwing: the caller awaits this inside
 * the tool lifecycle hook, and a rejected promise there would surface as a job
 * failure caused purely by telemetry.
 */
export function createActivityEmitter({
  progressContext,
  fetcher = fetch,
  timeoutMs = 5000,
  logger = log
} = {}) {
  const ctx = normalizeProgressContext(progressContext);
  const counters = { sent: 0, skipped: 0, failed: 0, disabled: !ctx };

  if (!ctx) {
    return {
      enabled: false,
      counters,
      emit: async () => ({ ok: false, skipped: true, reason: "NO_PROGRESS_CONTEXT" }),
      emitToolStart: async () => ({ ok: false, skipped: true, reason: "NO_PROGRESS_CONTEXT" }),
      emitToolResult: async () => ({ ok: false, skipped: true, reason: "NO_PROGRESS_CONTEXT" }),
      snapshot: () => ({ ...counters })
    };
  }

  let sequence = 0;

  async function emit({ phase, status, label, tool, eventId } = {}) {
    sequence += 1;
    const payload = buildActivityPayload({
      leaseEpoch: ctx.lease_epoch,
      eventId: eventId || `${ctx.job_id}:${sequence}`,
      phase: phase || (tool ? phaseForTool(tool) : "workspace"),
      status: status || "running",
      label: label || formatLabel({ tool, status }),
      tool
    });

    try {
      const response = await fetcher(ctx.callback_url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ctx.token}`,
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs)
      });

      const httpStatus = response?.status ?? 0;
      if (httpStatus >= 200 && httpStatus < 300) {
        counters.sent += 1;
        return { ok: true, payload, httpStatus };
      }

      // Try to read HQ's structured error_code; ignore failures doing so.
      let errorCode = null;
      try {
        const body = await response.json();
        errorCode = body?.error_code || body?.error?.code || null;
      } catch {
        errorCode = null;
      }

      if (isSilentFailure({ httpStatus, errorCode })) {
        counters.skipped += 1;
        logger(`callback swallowed HTTP ${httpStatus}${errorCode ? ` ${errorCode}` : ""}`);
        return { ok: false, skipped: true, reason: errorCode || `HTTP_${httpStatus}`, httpStatus };
      }

      counters.failed += 1;
      logger(`callback rejected HTTP ${httpStatus}${errorCode ? ` ${errorCode}` : ""} (ignored)`);
      return { ok: false, skipped: true, reason: `HTTP_${httpStatus}`, httpStatus };
    } catch (err) {
      // Network error, DNS, abort/timeout: telemetry must not break the job.
      const reason = err?.name === "TimeoutError" || err?.name === "AbortError" ? "TIMEOUT" : "NETWORK_ERROR";
      counters.skipped += 1;
      logger(`callback ignored (${reason})`);
      return { ok: false, skipped: true, reason };
    }
  }

  return {
    enabled: true,
    counters,
    context: ctx,
    emit,
    /** Hook adapter matching the runner's onToolStart payload shape. */
    emitToolStart: (payload) =>
      emit({
        phase: phaseForTool(payload?.name),
        status: statusForToolPhase(payload?.phase),
        label: formatLabel({ tool: payload?.name, status: statusForToolPhase(payload?.phase), args: payload?.args }),
        tool: payload?.name
      }),
    /** Hook adapter for a completed tool result. */
    emitToolResult: (payload) =>
      emit({
        phase: phaseForTool(payload?.name),
        status: payload?.status === "failed" ? "failed" : "done",
        label: formatLabel({ tool: payload?.name, status: payload?.status === "failed" ? "failed" : "done", args: payload?.args }),
        tool: payload?.name
      }),
    snapshot: () => ({ ...counters })
  };
}
