import { describe, expect, it } from "vitest";
import {
  approvalMatchesAction,
  assertSecretlessGrant,
  capabilityGrantAllows,
  createActionApproval,
  projectOperatorState,
} from "./index.js";
import type { CapabilityGrant, CapabilityHealth, DerivedTaskState } from "./index.js";

describe("OpenCore Fusion advanced governance", () => {
  it("binds approval to the exact action arguments and respects expiry", () => {
    const action = {
      tool: "github",
      action: "merge",
      args: { repo: "R1mob2-svg/example", pr: 17, method: "squash" },
    };
    const approval = createActionApproval(
      action,
      "Rob",
      new Date("2026-08-19T20:00:00Z"),
      new Date("2026-08-19T20:10:00Z"),
    );

    expect(approvalMatchesAction(approval, action, new Date("2026-08-19T20:05:00Z"))).toBe(true);
    expect(
      approvalMatchesAction(
        approval,
        { ...action, args: { ...action.args, pr: 18 } },
        new Date("2026-08-19T20:05:00Z"),
      ),
    ).toBe(false);
    expect(approvalMatchesAction(approval, action, new Date("2026-08-19T20:11:00Z"))).toBe(false);
  });

  it("keeps worker capability grants secretless and tightly scoped", () => {
    const grant: CapabilityGrant = {
      id: "grant-1",
      actor: "NEO",
      capability: "github",
      actions: ["read", "search"],
      resource: "R1mob2-svg/openclaw",
      issuedAt: "2026-08-19T20:00:00Z",
      expiresAt: "2026-08-19T21:00:00Z",
    };

    expect(() => assertSecretlessGrant(grant)).not.toThrow();
    expect(
      capabilityGrantAllows(
        grant,
        { actor: "NEO", capability: "github", action: "read", resource: "R1mob2-svg/openclaw" },
        new Date("2026-08-19T20:10:00Z"),
      ),
    ).toBe(true);
    expect(
      capabilityGrantAllows(
        grant,
        { actor: "NEO", capability: "github", action: "merge", resource: "R1mob2-svg/openclaw" },
        new Date("2026-08-19T20:10:00Z"),
      ),
    ).toBe(false);

    expect(() =>
      assertSecretlessGrant({ ...grant, apiKey: "should-never-be-here" } as CapabilityGrant),
    ).toThrow(/forbidden secret/);
  });

  it("builds an operator cockpit from evidence without hiding failed capabilities", () => {
    const health: CapabilityHealth = {
      status: "red",
      checkedAt: "2026-08-19T20:00:00Z",
      required: ["gateway", "neo.text", "neo.vision"],
      passing: ["gateway", "neo.text"],
      failing: ["neo.vision"],
      stale: [],
      missing: [],
      blockers: ["neo.vision: pixel proof failed"],
    };
    const tasks: DerivedTaskState[] = [
      { taskId: "T1", status: "running", verified: false, reviewed: false },
      {
        taskId: "T2",
        status: "blocked",
        blocker: "waiting for vision repair",
        verified: false,
        reviewed: false,
      },
    ];

    const projection = projectOperatorState({ health, tasks });
    expect(projection.status).toBe("red");
    expect(projection.headline).toBe("System is not proven healthy.");
    expect(projection.capabilities.passing).toBe(2);
    expect(projection.capabilities.failing).toEqual(["neo.vision"]);
    expect(projection.tasks.blocked).toBe(1);
    expect(projection.whyNotGreen).toContain("neo.vision: pixel proof failed");
    expect(projection.whyNotGreen).toContain("1 task(s) blocked");
  });
});
