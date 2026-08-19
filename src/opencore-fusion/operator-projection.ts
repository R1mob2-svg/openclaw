import type { CapabilityHealth, DerivedTaskState, LessonCandidate } from "./types.js";

export type OperatorTaskSummary = {
  total: number;
  queued: number;
  running: number;
  blocked: number;
  failed: number;
  complete: number;
};

export type OperatorProjection = {
  status: "green" | "degraded" | "red";
  headline: string;
  checkedAt: string;
  whyNotGreen: string[];
  capabilities: {
    required: number;
    passing: number;
    failing: string[];
    stale: string[];
    missing: string[];
  };
  tasks: OperatorTaskSummary;
  taskBlockers: Array<{ taskId: string; blocker: string }>;
  lessonCandidates: number;
};

function summarizeTasks(tasks: readonly DerivedTaskState[]): OperatorTaskSummary {
  const summary: OperatorTaskSummary = {
    total: tasks.length,
    queued: 0,
    running: 0,
    blocked: 0,
    failed: 0,
    complete: 0,
  };
  for (const task of tasks) {
    if (task.status === "unknown") continue;
    summary[task.status] += 1;
  }
  return summary;
}

/**
 * Produces one honest operator-facing snapshot from existing runtime evidence.
 * It never invents a second source of truth: capability health and task state
 * must already have been derived from receipts/events/probes.
 */
export function projectOperatorState(input: {
  health: CapabilityHealth;
  tasks?: readonly DerivedTaskState[];
  lessonCandidates?: readonly LessonCandidate[];
}): OperatorProjection {
  const tasks = input.tasks ?? [];
  const taskSummary = summarizeTasks(tasks);
  const taskBlockers = tasks
    .filter((task) => (task.status === "blocked" || task.status === "failed") && task.blocker)
    .map((task) => ({ taskId: task.taskId, blocker: task.blocker as string }));

  const whyNotGreen = [...input.health.blockers];
  if (taskSummary.failed > 0) whyNotGreen.push(`${taskSummary.failed} task(s) failed`);
  if (taskSummary.blocked > 0) whyNotGreen.push(`${taskSummary.blocked} task(s) blocked`);

  let status: OperatorProjection["status"] = input.health.status;
  if (taskSummary.failed > 0) status = "red";
  else if (status === "green" && taskSummary.blocked > 0) status = "degraded";

  const headline =
    status === "green"
      ? "All required capabilities are proven and current."
      : status === "degraded"
        ? "Core capabilities are available, but operator attention is required."
        : "System is not proven healthy.";

  return {
    status,
    headline,
    checkedAt: input.health.checkedAt,
    whyNotGreen,
    capabilities: {
      required: input.health.required.length,
      passing: input.health.passing.length,
      failing: [...input.health.failing],
      stale: [...input.health.stale],
      missing: [...input.health.missing],
    },
    tasks: taskSummary,
    taskBlockers,
    lessonCandidates: input.lessonCandidates?.length ?? 0,
  };
}
