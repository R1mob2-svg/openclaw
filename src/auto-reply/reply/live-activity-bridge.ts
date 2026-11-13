/**
 * Live milestone bridge for HQ-dispatched job turns.
 *
 * Wraps an existing tool lifecycle hook so that, in addition to whatever the
 * channel already does with progress, a compact activity event is POSTed to
 * the HQ job activity endpoint. The emitter is fail-open: any callback fault is
 * swallowed and reported as a skipped event, never as a turn failure.
 */
import {
  createActivityEmitter,
  phaseForTool,
} from "../../../bin/neo-activity-emit.mjs";
import type { GetReplyOptions } from "../get-reply-options.types.js";

type ToolStartPayload = Parameters<NonNullable<GetReplyOptions["onToolStart"]>>[0];
type ToolStartHook = NonNullable<GetReplyOptions["onToolStart"]>;

export type LiveActivityBridge = {
  /** True when HQ supplied a usable progress_context for this turn. */
  enabled: boolean;
  /** Attach this to reply options as `onToolStart`. */
  onToolStart: ToolStartHook;
  /** Emit a terminal milestone (done/blocked/failed) for the whole turn. */
  finish: (status: "done" | "blocked" | "failed", label: string) => Promise<void>;
  counters: () => { sent: number; skipped: number; failed: number; disabled: boolean };
};

function noopBridge(): LiveActivityBridge {
  return {
    enabled: false,
    onToolStart: async () => {},
    finish: async () => {},
    counters: () => ({ sent: 0, skipped: 0, failed: 0, disabled: true }),
  };
}

/**
 * Build the bridge for a turn.
 *
 * `next` is the hook the caller would otherwise have used. It is always
 * invoked first and awaited, so enabling HQ activity never changes existing
 * channel behaviour or ordering.
 */
export function createLiveActivityBridge({
  progressContext,
  next,
  fetcher,
  timeoutMs,
}: {
  progressContext?: GetReplyOptions["progressContext"];
  next?: ToolStartHook;
  fetcher?: typeof fetch;
  timeoutMs?: number;
} = {}): LiveActivityBridge {
  const emitter = createActivityEmitter({ progressContext, fetcher, timeoutMs });

  if (!emitter.enabled) {
    return { ...noopBridge(), onToolStart: next ?? (async () => {}) };
  }

  const onToolStart: ToolStartHook = async (payload: ToolStartPayload) => {
    await next?.(payload);
    // Telemetry only: never let this rejection escape into the agent run.
    await emitter.emitToolStart(payload).catch(() => undefined);
  };

  return {
    enabled: true,
    onToolStart,
    finish: async (status, label) => {
      await emitter
        .emit({ phase: phaseForTool(undefined), status, label })
        .catch(() => undefined);
    },
    counters: () => emitter.snapshot(),
  };
}
