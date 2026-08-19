import type { DerivedTaskState, RuntimeEvent } from "./types.js";

function eventTime(event: RuntimeEvent): number {
  const value = Date.parse(event.at);
  return Number.isFinite(value) ? value : 0;
}

/**
 * Append-only ledger helper. Existing event ids are immutable and duplicates are rejected.
 */
export function appendRuntimeEvent(
  ledger: readonly RuntimeEvent[],
  event: RuntimeEvent,
): RuntimeEvent[] {
  if (ledger.some((existing) => existing.id === event.id)) {
    throw new Error(`duplicate runtime event id: ${event.id}`);
  }
  return [...ledger, { ...event, evidence: event.evidence ? [...event.evidence] : undefined }];
}

/**
 * Derive current task state from history instead of storing a mutable status blob.
 */
export function deriveTaskState(
  ledger: readonly RuntimeEvent[],
  taskId: string,
): DerivedTaskState {
  const events = ledger
    .filter((event) => event.taskId === taskId)
    .slice()
    .sort((a, b) => eventTime(a) - eventTime(b) || a.id.localeCompare(b.id));

  const state: DerivedTaskState = {
    taskId,
    status: "unknown",
    verified: false,
    reviewed: false,
  };

  for (const event of events) {
    state.lastEvent = event;
    switch (event.kind) {
      case "task.created":
        state.status = "queued";
        break;
      case "task.started":
      case "task.progress":
      case "handoff.accepted":
      case "recovery.started":
      case "recovery.completed":
        state.status = "running";
        state.currentOwner = event.actor;
        state.blocker = undefined;
        break;
      case "handoff.requested":
        state.status = "running";
        break;
      case "task.blocked":
        state.status = "blocked";
        state.blocker = event.summary;
        break;
      case "task.failed":
      case "recovery.failed":
        state.status = "failed";
        state.blocker = event.summary;
        break;
      case "verification.passed":
        state.verified = true;
        break;
      case "verification.failed":
        state.verified = false;
        state.status = "running";
        break;
      case "review.passed":
        state.reviewed = true;
        break;
      case "review.failed":
        state.reviewed = false;
        state.status = "running";
        break;
      case "task.completed":
        state.status = state.verified && state.reviewed ? "complete" : "running";
        if (state.status === "complete") {
          state.blocker = undefined;
        }
        break;
    }
  }

  return state;
}

export function listTaskEvents(
  ledger: readonly RuntimeEvent[],
  taskId: string,
): RuntimeEvent[] {
  return ledger
    .filter((event) => event.taskId === taskId)
    .slice()
    .sort((a, b) => eventTime(a) - eventTime(b) || a.id.localeCompare(b.id));
}
