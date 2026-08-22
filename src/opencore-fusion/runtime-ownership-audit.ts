export type RuntimeOwnerRole = "worker" | "poller" | "gateway" | "browser-relay";

export type RuntimeOwnerEvidence = {
  kind: "pm2" | "scheduled-task" | "process" | "service";
  name: string;
  role: RuntimeOwnerRole;
  active: boolean;
  canonical?: boolean;
};

export type BrowserRuntimeEvidence = {
  browserEnabled: boolean;
  browserPluginAllowed?: boolean;
  browserPluginEnabled?: boolean;
  playwrightResolved: boolean;
  availableProfiles: string[];
};

export type RuntimeOwnershipAuditInput = {
  owners: RuntimeOwnerEvidence[];
  browser: BrowserRuntimeEvidence;
  requiredWorkerName?: string;
};

export type RuntimeOwnershipAuditResult = {
  status: "pass" | "fail";
  canonicalWorkerOwners: string[];
  duplicateActiveConsumers: string[];
  browserProfiles: string[];
  blockers: string[];
};

/**
 * Side-effect-free preflight for the canonical NEO/OpenClaw runtime lane.
 *
 * This does not create, stop, restart, or mutate any process. It turns AG/NEO's
 * live inventory into one deterministic answer before recovery is attempted:
 * exactly one canonical worker owner, no competing poller/worker consumer, and
 * a browser runtime that is actually enabled and executable rather than merely
 * process-alive.
 */
export function auditRuntimeOwnership(input: RuntimeOwnershipAuditInput): RuntimeOwnershipAuditResult {
  const blockers: string[] = [];
  const activeConsumers = input.owners.filter(
    (owner) => owner.active && (owner.role === "worker" || owner.role === "poller"),
  );
  const canonicalWorkers = activeConsumers.filter(
    (owner) => owner.role === "worker" && owner.canonical === true,
  );

  if (canonicalWorkers.length !== 1) {
    blockers.push(`expected exactly one active canonical worker owner, found ${canonicalWorkers.length}`);
  }

  const requiredWorkerName = input.requiredWorkerName?.trim();
  if (requiredWorkerName && canonicalWorkers.length === 1 && canonicalWorkers[0]!.name !== requiredWorkerName) {
    blockers.push(
      `canonical worker owner mismatch: expected ${requiredWorkerName}, found ${canonicalWorkers[0]!.name}`,
    );
  }

  const canonicalName = canonicalWorkers[0]?.name;
  const duplicateActiveConsumers = activeConsumers
    .filter((owner) => owner.name !== canonicalName)
    .map((owner) => owner.name)
    .sort();

  if (duplicateActiveConsumers.length > 0) {
    blockers.push(`duplicate active consumer ownership: ${duplicateActiveConsumers.join(", ")}`);
  }

  if (!input.browser.browserEnabled) {
    blockers.push("browser.enabled is not proven true");
  }
  if (input.browser.browserPluginAllowed === false) {
    blockers.push("browser plugin is excluded by plugins.allow");
  }
  if (input.browser.browserPluginEnabled === false) {
    blockers.push("browser plugin entry is disabled");
  }
  if (!input.browser.playwrightResolved) {
    blockers.push("Playwright runtime is not resolvable from the gateway runtime");
  }

  const browserProfiles = [...new Set(input.browser.availableProfiles.map((profile) => profile.trim()).filter(Boolean))].sort();
  if (browserProfiles.length === 0) {
    blockers.push("no browser profile is available for capability proof");
  }

  return {
    status: blockers.length === 0 ? "pass" : "fail",
    canonicalWorkerOwners: canonicalWorkers.map((owner) => owner.name).sort(),
    duplicateActiveConsumers,
    browserProfiles,
    blockers,
  };
}
