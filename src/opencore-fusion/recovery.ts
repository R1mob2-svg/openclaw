export type RecoveryContext = {
  capability: string;
  safeAutoRecover: boolean;
  affectedWorker?: string;
  gatewayAffected?: boolean;
  retryCount: number;
  maxRetries?: number;
  canonicalSupervisorCount: number;
  goldenBaselineProven: boolean;
};

export type RecoveryStep =
  | { action: "retry_capability"; target: string }
  | { action: "restart_worker"; target: string }
  | { action: "restart_gateway"; target: "gateway" }
  | { action: "rollback_golden"; target: "openclaw-config" }
  | { action: "request_human"; target: string; reason: string };

export type RecoveryPlan = {
  automatic: boolean;
  blockedBy?: string;
  steps: RecoveryStep[];
};

/**
 * A policy-only recovery ladder. It deliberately creates no watchdog, timer,
 * daemon, scheduled task, or process killer. Existing supervision must call it.
 */
export function planRecovery(context: RecoveryContext): RecoveryPlan {
  if (context.canonicalSupervisorCount !== 1) {
    return {
      automatic: false,
      blockedBy: `expected exactly one canonical supervisor, found ${context.canonicalSupervisorCount}`,
      steps: [
        {
          action: "request_human",
          target: context.capability,
          reason: "consolidate duplicate or missing supervisors before automatic recovery",
        },
      ],
    };
  }

  if (!context.safeAutoRecover) {
    return {
      automatic: false,
      steps: [
        {
          action: "request_human",
          target: context.capability,
          reason: "failure is not classified as safe for automatic recovery",
        },
      ],
    };
  }

  const maxRetries = context.maxRetries ?? 2;
  const steps: RecoveryStep[] = [];

  if (context.retryCount < maxRetries) {
    steps.push({ action: "retry_capability", target: context.capability });
  }
  if (context.affectedWorker) {
    steps.push({ action: "restart_worker", target: context.affectedWorker });
  }
  if (context.gatewayAffected) {
    steps.push({ action: "restart_gateway", target: "gateway" });
  }
  if (context.goldenBaselineProven) {
    steps.push({ action: "rollback_golden", target: "openclaw-config" });
  }

  steps.push({
    action: "request_human",
    target: context.capability,
    reason: "bounded recovery ladder exhausted",
  });

  return { automatic: true, steps };
}
