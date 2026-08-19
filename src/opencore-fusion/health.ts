import type { CapabilityHealth, CapabilityProbe } from "./types.js";

export type CapabilityHealthInput = {
  probes: readonly CapabilityProbe[];
  requiredCapabilities: readonly string[];
  optionalCapabilities?: readonly string[];
  now?: Date;
  staleAfterMs?: number;
};

function latestProbeByCapability(probes: readonly CapabilityProbe[]): Map<string, CapabilityProbe> {
  const latest = new Map<string, CapabilityProbe>();
  for (const probe of probes) {
    const current = latest.get(probe.capability);
    const currentTime = current ? Date.parse(current.observedAt) : Number.NEGATIVE_INFINITY;
    const candidateTime = Date.parse(probe.observedAt);
    if (!current || candidateTime >= currentTime) {
      latest.set(probe.capability, probe);
    }
  }
  return latest;
}

/**
 * Health is based on real capability probes, never merely on process liveness.
 * A required capability that is missing, stale, or failed makes the system red.
 */
export function evaluateCapabilityHealth(input: CapabilityHealthInput): CapabilityHealth {
  const now = input.now ?? new Date();
  const staleAfterMs = input.staleAfterMs ?? 20 * 60 * 1000;
  const latest = latestProbeByCapability(input.probes);
  const required = [...new Set(input.requiredCapabilities)];
  const optional = [...new Set(input.optionalCapabilities ?? [])].filter(
    (capability) => !required.includes(capability),
  );

  const passing: string[] = [];
  const failing: string[] = [];
  const stale: string[] = [];
  const missing: string[] = [];
  const blockers: string[] = [];

  const inspect = (capability: string, isRequired: boolean) => {
    const probe = latest.get(capability);
    if (!probe) {
      missing.push(capability);
      if (isRequired) blockers.push(`${capability}: no capability proof`);
      return;
    }

    const observedAt = Date.parse(probe.observedAt);
    const isStale = !Number.isFinite(observedAt) || now.getTime() - observedAt > staleAfterMs;
    if (isStale) {
      stale.push(capability);
      if (isRequired) blockers.push(`${capability}: proof is stale`);
      return;
    }

    if (probe.status === "pass") {
      passing.push(capability);
      return;
    }

    failing.push(capability);
    if (isRequired) {
      blockers.push(`${capability}: ${probe.evidence ?? probe.status}`);
    }
  };

  for (const capability of required) inspect(capability, true);
  for (const capability of optional) inspect(capability, false);

  const requiredIsBroken = required.some(
    (capability) =>
      failing.includes(capability) || stale.includes(capability) || missing.includes(capability),
  );
  const optionalIsBroken = optional.some(
    (capability) =>
      failing.includes(capability) || stale.includes(capability) || missing.includes(capability),
  );

  return {
    status: requiredIsBroken ? "red" : optionalIsBroken ? "degraded" : "green",
    checkedAt: now.toISOString(),
    required,
    passing,
    failing,
    stale,
    missing,
    blockers,
  };
}

/**
 * Recovery is eligible only when the latest failed probe explicitly marks the
 * capability as safe to recover automatically.
 */
export function isSafeAutoRecoveryCandidate(
  probes: readonly CapabilityProbe[],
  capability: string,
): boolean {
  const latest = latestProbeByCapability(probes).get(capability);
  return latest?.status === "fail" && latest.safeAutoRecover === true;
}
