import type { LoopBudget, LoopCheckpoint } from "./types.js";

export type LoopTransition =
  | { type: "maker.complete"; outputUnits?: number }
  | { type: "maker.failed"; reason: string; outputUnits?: number }
  | { type: "verifier.passed"; outputUnits?: number }
  | { type: "verifier.failed"; reason: string; outputUnits?: number }
  | { type: "reviewer.passed"; outputUnits?: number }
  | { type: "reviewer.failed"; reason: string; outputUnits?: number };

function assertBudget(budget: LoopBudget): void {
  if (!Number.isInteger(budget.maxAttempts) || budget.maxAttempts < 1) {
    throw new Error("maxAttempts must be a positive integer");
  }
  if (!Number.isFinite(budget.maxRuntimeMs) || budget.maxRuntimeMs <= 0) {
    throw new Error("maxRuntimeMs must be positive");
  }
  if (!Number.isFinite(budget.maxOutputUnits) || budget.maxOutputUnits <= 0) {
    throw new Error("maxOutputUnits must be positive");
  }
}

export function startBoundedLoop(startedAtMs: number = Date.now()): LoopCheckpoint {
  return {
    phase: "maker",
    attempt: 1,
    startedAtMs,
    outputUnits: 0,
  };
}

function block(checkpoint: LoopCheckpoint, reason: string): LoopCheckpoint {
  return { ...checkpoint, phase: "blocked", lastFailure: reason };
}

function consumeOutput(checkpoint: LoopCheckpoint, units: number | undefined): LoopCheckpoint {
  if (units === undefined) return checkpoint;
  if (!Number.isFinite(units) || units < 0) {
    throw new Error("outputUnits must be a non-negative finite number");
  }
  return { ...checkpoint, outputUnits: checkpoint.outputUnits + units };
}

function overBudget(
  checkpoint: LoopCheckpoint,
  budget: LoopBudget,
  nowMs: number,
): string | undefined {
  if (checkpoint.attempt > budget.maxAttempts) return "attempt budget exhausted";
  if (nowMs - checkpoint.startedAtMs > budget.maxRuntimeMs) return "runtime budget exhausted";
  if (checkpoint.outputUnits > budget.maxOutputUnits) return "output budget exhausted";
  return undefined;
}

/**
 * Deterministic maker -> verifier -> reviewer state machine.
 * Failed verification/review returns to maker only while finite budgets remain.
 */
export function transitionBoundedLoop(
  current: LoopCheckpoint,
  transition: LoopTransition,
  budget: LoopBudget,
  nowMs: number = Date.now(),
): LoopCheckpoint {
  assertBudget(budget);
  if (current.phase === "complete" || current.phase === "blocked") return current;

  let next = consumeOutput(current, transition.outputUnits);
  const budgetFailure = overBudget(next, budget, nowMs);
  if (budgetFailure) return block(next, budgetFailure);

  switch (transition.type) {
    case "maker.complete":
      if (current.phase !== "maker") return block(next, "maker result received out of phase");
      return { ...next, phase: "verifier", lastFailure: undefined };
    case "maker.failed":
      if (current.phase !== "maker") return block(next, "maker failure received out of phase");
      if (current.attempt >= budget.maxAttempts) return block(next, transition.reason);
      return {
        ...next,
        phase: "maker",
        attempt: current.attempt + 1,
        lastFailure: transition.reason,
      };
    case "verifier.passed":
      if (current.phase !== "verifier") return block(next, "verification result received out of phase");
      return { ...next, phase: "reviewer", lastFailure: undefined };
    case "verifier.failed":
      if (current.phase !== "verifier") return block(next, "verification failure received out of phase");
      if (current.attempt >= budget.maxAttempts) return block(next, transition.reason);
      return {
        ...next,
        phase: "maker",
        attempt: current.attempt + 1,
        lastFailure: transition.reason,
      };
    case "reviewer.passed":
      if (current.phase !== "reviewer") return block(next, "review result received out of phase");
      return { ...next, phase: "complete", lastFailure: undefined };
    case "reviewer.failed":
      if (current.phase !== "reviewer") return block(next, "review failure received out of phase");
      if (current.attempt >= budget.maxAttempts) return block(next, transition.reason);
      return {
        ...next,
        phase: "maker",
        attempt: current.attempt + 1,
        lastFailure: transition.reason,
      };
  }
}

export function serializeLoopCheckpoint(checkpoint: LoopCheckpoint): string {
  return JSON.stringify(checkpoint);
}

export function restoreLoopCheckpoint(serialized: string): LoopCheckpoint {
  const value = JSON.parse(serialized) as Partial<LoopCheckpoint>;
  if (
    !value ||
    !["maker", "verifier", "reviewer", "complete", "blocked"].includes(String(value.phase)) ||
    !Number.isInteger(value.attempt) ||
    (value.attempt ?? 0) < 1 ||
    !Number.isFinite(value.startedAtMs) ||
    !Number.isFinite(value.outputUnits)
  ) {
    throw new Error("invalid loop checkpoint");
  }
  return value as LoopCheckpoint;
}
