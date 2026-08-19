import type { MemoryLayer, MemoryRecord } from "./types.js";

export type MemoryIntent =
  | "live_task"
  | "historical_event"
  | "durable_rule"
  | "user_preference";

export function layerForIntent(intent: MemoryIntent): MemoryLayer {
  switch (intent) {
    case "live_task":
      return "working";
    case "historical_event":
      return "episodic";
    case "durable_rule":
      return "semantic";
    case "user_preference":
      return "personal";
  }
}

export type MemoryFreshness = "fresh" | "aging" | "stale";

export function getMemoryFreshness(
  record: MemoryRecord,
  now: Date = new Date(),
): MemoryFreshness {
  const timestamp = Date.parse(record.updatedAt ?? record.createdAt);
  if (!Number.isFinite(timestamp)) return "stale";
  const ageMs = Math.max(0, now.getTime() - timestamp);

  const thresholds: Record<MemoryLayer, { aging: number; stale: number }> = {
    working: { aging: 6 * 60 * 60 * 1000, stale: 2 * 24 * 60 * 60 * 1000 },
    episodic: { aging: 30 * 24 * 60 * 60 * 1000, stale: 180 * 24 * 60 * 60 * 1000 },
    semantic: { aging: 180 * 24 * 60 * 60 * 1000, stale: 365 * 24 * 60 * 60 * 1000 },
    personal: { aging: 180 * 24 * 60 * 60 * 1000, stale: 365 * 24 * 60 * 60 * 1000 },
  };

  const threshold = thresholds[record.layer];
  if (ageMs > threshold.stale) return "stale";
  if (ageMs > threshold.aging) return "aging";
  return "fresh";
}

export type PromotionEvidence = {
  topic: string;
  sourceIds: string[];
  factTexts: string[];
  averageConfidence: number;
};

/**
 * Deterministic semantic-promotion gate. Durable rules require repeated,
 * independent evidence; a single episode can never become semantic law.
 */
export function buildPromotionEvidence(
  records: readonly MemoryRecord[],
  topic: string,
): PromotionEvidence | undefined {
  const matching = records.filter(
    (record) =>
      record.layer === "episodic" &&
      (record.tags ?? []).some((tag) => tag.toLowerCase() === topic.toLowerCase()),
  );
  const sourceIds = Array.from(new Set(matching.flatMap((record) => record.sourceIds ?? [])));
  if (matching.length < 3 || sourceIds.length < 2) return undefined;

  const confidenceValues = matching.map((record) => record.confidence ?? 0.5);
  const averageConfidence =
    confidenceValues.reduce((total, value) => total + value, 0) / confidenceValues.length;
  if (averageConfidence < 0.65) return undefined;

  return {
    topic,
    sourceIds,
    factTexts: matching.map((record) => record.text),
    averageConfidence,
  };
}

/** Personal preferences never auto-promote into global semantic rules. */
export function canMergeIntoSemantic(record: MemoryRecord): boolean {
  return record.layer === "episodic";
}
