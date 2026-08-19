import type { FailureIncident, LessonCandidate, LessonDecision } from "./types.js";

function normalizeFailureText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[a-f0-9]{8,}/g, "<id>")
    .replace(/\b\d+\b/g, "<n>")
    .replace(/\s+/g, " ")
    .trim();
}

export function fingerprintFailure(incident: FailureIncident): string {
  const code = incident.code ? normalizeFailureText(incident.code) : "no-code";
  return `${normalizeFailureText(incident.surface)}|${code}|${normalizeFailureText(incident.message)}`;
}

export type StageLessonOptions = {
  threshold?: number;
  windowMs?: number;
  now?: Date;
};

/**
 * Repeated failures become reviewable candidate lessons. This function never
 * auto-accepts or mutates semantic memory.
 */
export function stageLessonCandidates(
  incidents: readonly FailureIncident[],
  options: StageLessonOptions = {},
): LessonCandidate[] {
  const threshold = options.threshold ?? 3;
  const windowMs = options.windowMs ?? 14 * 24 * 60 * 60 * 1000;
  const now = options.now ?? new Date();
  const cutoff = now.getTime() - windowMs;
  const groups = new Map<string, FailureIncident[]>();

  for (const incident of incidents) {
    const at = Date.parse(incident.at);
    if (!Number.isFinite(at) || at < cutoff || at > now.getTime()) continue;
    const fingerprint = fingerprintFailure(incident);
    const bucket = groups.get(fingerprint) ?? [];
    bucket.push(incident);
    groups.set(fingerprint, bucket);
  }

  const candidates: LessonCandidate[] = [];
  for (const [fingerprint, bucket] of groups.entries()) {
    if (bucket.length < threshold) continue;
    const sorted = bucket.slice().sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const evidence = Array.from(
      new Set(sorted.flatMap((incident) => incident.evidence ?? []).filter(Boolean)),
    );
    candidates.push({
      id: `lesson:${fingerprint}`,
      fingerprint,
      firstSeen: first.at,
      lastSeen: last.at,
      occurrences: sorted.length,
      claim: `Prevent recurring failure on ${last.surface}: ${last.message}`,
      evidence,
    });
  }

  return candidates.sort((a, b) => b.occurrences - a.occurrences || a.id.localeCompare(b.id));
}

export function appendLessonDecision(
  ledger: readonly LessonDecision[],
  decision: LessonDecision,
): LessonDecision[] {
  if (ledger.some((existing) => existing.id === decision.id)) {
    throw new Error(`duplicate lesson decision id: ${decision.id}`);
  }
  if (!decision.rationale.trim()) {
    throw new Error("lesson decisions require a rationale");
  }
  return [...ledger, { ...decision }];
}

export type LessonState = "candidate" | "accepted" | "rejected" | "retracted";

/** Append-only decisions are replayed to derive current lesson state. */
export function deriveLessonState(
  candidateId: string,
  decisions: readonly LessonDecision[],
): LessonState {
  const relevant = decisions
    .filter((decision) => decision.candidateId === candidateId)
    .slice()
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id));

  let state: LessonState = "candidate";
  for (const decision of relevant) {
    switch (decision.action) {
      case "accept":
        state = "accepted";
        break;
      case "reject":
        state = "rejected";
        break;
      case "retract":
        state = "retracted";
        break;
      case "reopen":
        state = "candidate";
        break;
    }
  }
  return state;
}
