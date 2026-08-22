import { describe, expect, it } from "vitest";
import { auditRuntimeOwnership } from "./runtime-ownership-audit.js";

describe("NEO/OpenClaw runtime ownership preflight", () => {
  it("passes only one canonical worker with a real browser execution surface", () => {
    const result = auditRuntimeOwnership({
      requiredWorkerName: "neo-worker",
      owners: [
        { kind: "pm2", name: "neo-worker", role: "worker", active: true, canonical: true },
        { kind: "scheduled-task", name: "NEO Telegram Poller", role: "poller", active: false },
        { kind: "process", name: "openclaw-gateway", role: "gateway", active: true, canonical: true },
      ],
      browser: {
        browserEnabled: true,
        browserPluginAllowed: true,
        browserPluginEnabled: true,
        playwrightResolved: true,
        availableProfiles: ["openclaw", "chrome"],
      },
    });

    expect(result.status).toBe("pass");
    expect(result.canonicalWorkerOwners).toEqual(["neo-worker"]);
    expect(result.duplicateActiveConsumers).toEqual([]);
    expect(result.blockers).toEqual([]);
  });

  it("fails closed when an orphan/scheduled consumer competes with neo-worker", () => {
    const result = auditRuntimeOwnership({
      requiredWorkerName: "neo-worker",
      owners: [
        { kind: "pm2", name: "neo-worker", role: "worker", active: true, canonical: true },
        { kind: "scheduled-task", name: "legacy-telegram-poller", role: "poller", active: true },
        { kind: "process", name: "orphan-consumer", role: "worker", active: true },
      ],
      browser: {
        browserEnabled: true,
        playwrightResolved: true,
        availableProfiles: ["openclaw"],
      },
    });

    expect(result.status).toBe("fail");
    expect(result.duplicateActiveConsumers).toEqual(["legacy-telegram-poller", "orphan-consumer"]);
    expect(result.blockers.join(" ")).toContain("duplicate active consumer ownership");
  });

  it("does not call browser healthy from gateway/process liveness alone", () => {
    const result = auditRuntimeOwnership({
      owners: [{ kind: "pm2", name: "neo-worker", role: "worker", active: true, canonical: true }],
      browser: {
        browserEnabled: false,
        browserPluginAllowed: false,
        browserPluginEnabled: false,
        playwrightResolved: false,
        availableProfiles: [],
      },
    });

    expect(result.status).toBe("fail");
    expect(result.blockers).toContain("browser.enabled is not proven true");
    expect(result.blockers).toContain("browser plugin is excluded by plugins.allow");
    expect(result.blockers).toContain("browser plugin entry is disabled");
    expect(result.blockers).toContain("Playwright runtime is not resolvable from the gateway runtime");
    expect(result.blockers).toContain("no browser profile is available for capability proof");
  });

  it("rejects missing or wrong canonical worker ownership", () => {
    const missing = auditRuntimeOwnership({
      requiredWorkerName: "neo-worker",
      owners: [{ kind: "process", name: "random-consumer", role: "worker", active: true }],
      browser: {
        browserEnabled: true,
        playwrightResolved: true,
        availableProfiles: ["openclaw"],
      },
    });
    expect(missing.status).toBe("fail");
    expect(missing.blockers.join(" ")).toContain("exactly one active canonical worker owner");

    const wrong = auditRuntimeOwnership({
      requiredWorkerName: "neo-worker",
      owners: [{ kind: "pm2", name: "neo-worker-copy", role: "worker", active: true, canonical: true }],
      browser: {
        browserEnabled: true,
        playwrightResolved: true,
        availableProfiles: ["openclaw"],
      },
    });
    expect(wrong.status).toBe("fail");
    expect(wrong.blockers.join(" ")).toContain("canonical worker owner mismatch");
  });
});
