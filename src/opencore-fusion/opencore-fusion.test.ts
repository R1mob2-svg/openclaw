import { describe, expect, it } from "vitest";
import {
  appendLessonDecision,
  appendRuntimeEvent,
  buildPromotionEvidence,
  canMergeIntoSemantic,
  decideToolAction,
  deriveLessonState,
  deriveTaskState,
  evaluateCapabilityHealth,
  planRecovery,
  redactSensitiveArgs,
  stageLessonCandidates,
  startBoundedLoop,
  transitionBoundedLoop,
} from "./index.js";
import type { FailureIncident, MemoryRecord, RuntimeEvent } from "./types.js";

describe("OpenCore Fusion governance", () => {
  it("does not confuse process liveness with capability health", () => {
    const health = evaluateCapabilityHealth({
      now: new Date("2026-08-19T20:00:00Z"),
      staleAfterMs: 60_000,
      requiredCapabilities: ["gateway.process", "neo.text", "neo.vision"],
      probes: [
        {
          id: "p1",
          capability: "gateway.process",
          status: "pass",
          observedAt: "2026-08-19T19:59:30Z",
        },
        {
          id: "p2",
          capability: "neo.text",
          status: "pass",
          observedAt: "2026-08-19T19:59:30Z",
        },
        {
          id: "p3",
          capability: "neo.vision",
          status: "fail",
          observedAt: "2026-08-19T19:59:30Z",
          evidence: "pixel proof failed",
        },
      ],
    });

    expect(health.status).toBe("red");
    expect(health.blockers).toContain("neo.vision: pixel proof failed");
  });

  it("derives task truth from an append-only event ledger", () => {
    let ledger: RuntimeEvent[] = [];
    const add = (event: RuntimeEvent) => {
      ledger = appendRuntimeEvent(ledger, event);
    };
    add({ id: "1", taskId: "T1", kind: "task.created", at: "2026-08-19T19:00:00Z", actor: "NEO", summary: "created" });
    add({ id: "2", taskId: "T1", kind: "task.started", at: "2026-08-19T19:01:00Z", actor: "Jules", summary: "started" });
    add({ id: "3", taskId: "T1", kind: "verification.passed", at: "2026-08-19T19:02:00Z", actor: "AG", summary: "tests pass" });
    add({ id: "4", taskId: "T1", kind: "review.passed", at: "2026-08-19T19:03:00Z", actor: "Newton", summary: "accepted" });
    add({ id: "5", taskId: "T1", kind: "task.completed", at: "2026-08-19T19:04:00Z", actor: "NEO", summary: "done" });

    const state = deriveTaskState(ledger, "T1");
    expect(state.status).toBe("complete");
    expect(state.verified).toBe(true);
    expect(state.reviewed).toBe(true);
    expect(() => appendRuntimeEvent(ledger, ledger[0])).toThrow(/duplicate/);
  });

  it("bounds maker verifier reviewer retries", () => {
    const budget = { maxAttempts: 2, maxRuntimeMs: 60_000, maxOutputUnits: 100 };
    let checkpoint = startBoundedLoop(0);
    checkpoint = transitionBoundedLoop(checkpoint, { type: "maker.complete", outputUnits: 10 }, budget, 1);
    checkpoint = transitionBoundedLoop(checkpoint, { type: "verifier.failed", reason: "test failed" }, budget, 2);
    expect(checkpoint.phase).toBe("maker");
    expect(checkpoint.attempt).toBe(2);
    checkpoint = transitionBoundedLoop(checkpoint, { type: "maker.complete" }, budget, 3);
    checkpoint = transitionBoundedLoop(checkpoint, { type: "verifier.passed" }, budget, 4);
    checkpoint = transitionBoundedLoop(checkpoint, { type: "reviewer.passed" }, budget, 5);
    expect(checkpoint.phase).toBe("complete");
  });

  it("turns repeated failures into reviewable lessons without auto-accepting them", () => {
    const incidents: FailureIncident[] = [1, 2, 3].map((n) => ({
      id: `f${n}`,
      at: `2026-08-${16 + n}T12:00:00Z`,
      surface: "neo.vision",
      code: "MODEL_TEXT_ONLY",
      message: "image model cannot accept image input",
      evidence: [`receipt-${n}`],
    }));
    const candidates = stageLessonCandidates(incidents, {
      now: new Date("2026-08-19T20:00:00Z"),
      threshold: 3,
    });
    expect(candidates).toHaveLength(1);
    const candidate = candidates[0];
    expect(deriveLessonState(candidate.id, [])).toBe("candidate");

    let decisions = appendLessonDecision([], {
      id: "d1",
      candidateId: candidate.id,
      at: "2026-08-19T20:01:00Z",
      actor: "Newton",
      action: "accept",
      rationale: "three independent receipts prove recurrence",
    });
    expect(deriveLessonState(candidate.id, decisions)).toBe("accepted");
    decisions = appendLessonDecision(decisions, {
      id: "d2",
      candidateId: candidate.id,
      at: "2026-08-20T20:01:00Z",
      actor: "Newton",
      action: "retract",
      rationale: "upstream model contract changed",
    });
    expect(deriveLessonState(candidate.id, decisions)).toBe("retracted");
  });

  it("requires exact approval for mutations and redacts secret-shaped arguments", () => {
    expect(decideToolAction({ tool: "github", action: "get" }).decision).toBe("allow");
    expect(decideToolAction({ tool: "github", action: "merge" }).decision).toBe("require_approval");
    expect(decideToolAction({ tool: "secret-vault", action: "write" }).decision).toBe("deny");

    const redacted = redactSensitiveArgs({
      repo: "example",
      token: "do-not-log",
      nested: { apiKey: "also-secret", branch: "main" },
    });
    expect(redacted).toEqual({
      repo: "example",
      token: "[REDACTED]",
      nested: { apiKey: "[REDACTED]", branch: "main" },
    });
  });

  it("refuses automatic recovery when supervisors are duplicated", () => {
    const duplicatePlan = planRecovery({
      capability: "neo.text",
      safeAutoRecover: true,
      retryCount: 0,
      canonicalSupervisorCount: 3,
      goldenBaselineProven: false,
    });
    expect(duplicatePlan.automatic).toBe(false);
    expect(duplicatePlan.blockedBy).toMatch(/exactly one canonical supervisor/);

    const healthyPlan = planRecovery({
      capability: "neo.text",
      safeAutoRecover: true,
      affectedWorker: "neo-worker",
      gatewayAffected: true,
      retryCount: 0,
      canonicalSupervisorCount: 1,
      goldenBaselineProven: true,
    });
    expect(healthyPlan.steps.map((step) => step.action)).toEqual([
      "retry_capability",
      "restart_worker",
      "restart_gateway",
      "rollback_golden",
      "request_human",
    ]);
  });

  it("keeps personal memory isolated from semantic doctrine", () => {
    const records: MemoryRecord[] = [
      { id: "e1", layer: "episodic", text: "vision failed", createdAt: "2026-08-16T00:00:00Z", sourceIds: ["r1"], confidence: 0.9, tags: ["vision"] },
      { id: "e2", layer: "episodic", text: "vision failed again", createdAt: "2026-08-17T00:00:00Z", sourceIds: ["r2"], confidence: 0.8, tags: ["vision"] },
      { id: "e3", layer: "episodic", text: "text-only image model", createdAt: "2026-08-18T00:00:00Z", sourceIds: ["r3"], confidence: 0.85, tags: ["vision"] },
    ];
    expect(buildPromotionEvidence(records, "vision")?.sourceIds).toHaveLength(3);
    expect(canMergeIntoSemantic({ id: "p1", layer: "personal", text: "user preference", createdAt: "2026-08-19T00:00:00Z" })).toBe(false);
  });
});
