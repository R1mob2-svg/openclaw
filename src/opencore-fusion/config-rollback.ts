import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export type ConfigValidationResult =
  | { ok: true }
  | { ok: false; errors: string[] };

export type ConfigValidator = (value: unknown) => ConfigValidationResult;

export type CapabilityHealthResult = {
  ok: boolean;
  blockers?: string[];
  evidence?: string[];
};

export type ConfigSnapshotManifest = {
  id: string;
  kind: "prechange" | "golden";
  createdAt: string;
  sourcePath: string;
  sha256: string;
  operator: string;
  reason: string;
  configFile: string;
};

export type GoldenProof = {
  systemGreen: boolean;
  rebootSurvival: boolean;
  requiredCapabilities: string[];
  passedCapabilities: string[];
  evidence?: string[];
};

export type ConfigTransactionStatus =
  | "committed"
  | "rejected"
  | "rolled_back"
  | "rollback_failed";

export type ConfigTransactionReceipt = {
  id: string;
  status: ConfigTransactionStatus;
  startedAt: string;
  finishedAt: string;
  configPath: string;
  beforeSha256: string;
  candidateSha256: string;
  snapshot?: ConfigSnapshotManifest;
  candidateHealth?: CapabilityHealthResult;
  rollbackHealth?: CapabilityHealthResult;
  errors: string[];
};

export type ApplyConfigTransactionOptions = {
  configPath: string;
  snapshotDir: string;
  candidateText: string;
  operator: string;
  reason: string;
  validator?: ConfigValidator;
  expectedActiveSha256?: string;
  historyLimit?: number;
  reload: () => Promise<void>;
  healthCheck: () => Promise<CapabilityHealthResult>;
  now?: () => Date;
};

export type PromoteGoldenOptions = {
  configPath: string;
  snapshotDir: string;
  operator: string;
  reason: string;
  proof: GoldenProof;
  validator?: ConfigValidator;
  now?: () => Date;
};

export type ConfigDriftResult = {
  activeSha256: string;
  goldenSha256?: string;
  drifted: boolean;
  goldenPresent: boolean;
};

export function sha256Text(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function validateJsonConfig(
  text: string,
  validator?: ConfigValidator,
): { ok: true; value: unknown } | { ok: false; errors: string[] } {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch (error) {
    return { ok: false, errors: [`invalid JSON: ${String(error)}`] };
  }

  if (!validator) {
    return { ok: true, value };
  }

  const result = validator(value);
  if (!result.ok) {
    return { ok: false, errors: result.errors };
  }
  return { ok: true, value };
}

function timestampForFile(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function writeSnapshot(params: {
  snapshotDir: string;
  kind: ConfigSnapshotManifest["kind"];
  configText: string;
  sourcePath: string;
  operator: string;
  reason: string;
  now: Date;
}): Promise<ConfigSnapshotManifest> {
  await mkdir(params.snapshotDir, { recursive: true });
  const id = `${params.kind}-${timestampForFile(params.now)}-${randomUUID()}`;
  const configFile = `${id}.json`;
  const manifest: ConfigSnapshotManifest = {
    id,
    kind: params.kind,
    createdAt: params.now.toISOString(),
    sourcePath: params.sourcePath,
    sha256: sha256Text(params.configText),
    operator: params.operator,
    reason: params.reason,
    configFile,
  };

  await writeFile(join(params.snapshotDir, configFile), params.configText, {
    encoding: "utf8",
    flag: "wx",
  });
  await writeFile(
    join(params.snapshotDir, `${id}.meta.json`),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  return manifest;
}

async function prunePrechangeHistory(snapshotDir: string, historyLimit: number): Promise<void> {
  if (historyLimit < 1) {
    return;
  }
  const entries = await readdir(snapshotDir, { withFileTypes: true });
  const manifests = entries
    .filter((entry) => entry.isFile() && /^prechange-.*\.meta\.json$/.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse();

  for (const manifestName of manifests.slice(historyLimit)) {
    const manifestPath = join(snapshotDir, manifestName);
    try {
      const parsed = JSON.parse(await readFile(manifestPath, "utf8")) as ConfigSnapshotManifest;
      await rm(join(snapshotDir, parsed.configFile), { force: true });
    } catch {
      // Leave an unreadable snapshot pair alone rather than deleting evidence blindly.
      continue;
    }
    await rm(manifestPath, { force: true });
  }
}

async function replaceConfigWithRollbackGuard(params: {
  configPath: string;
  candidateText: string;
  transactionId: string;
}): Promise<{ previousSwapPath: string }> {
  const dir = dirname(params.configPath);
  const name = basename(params.configPath);
  const tempPath = join(dir, `.${name}.${params.transactionId}.candidate.tmp`);
  const previousSwapPath = join(dir, `.${name}.${params.transactionId}.previous.tmp`);

  await writeFile(tempPath, params.candidateText, { encoding: "utf8", flag: "wx" });
  await rename(params.configPath, previousSwapPath);
  try {
    await rename(tempPath, params.configPath);
  } catch (error) {
    await rename(previousSwapPath, params.configPath).catch(() => undefined);
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
  return { previousSwapPath };
}

async function restorePreviousConfig(params: {
  configPath: string;
  previousSwapPath: string;
  fallbackText: string;
}): Promise<string | undefined> {
  try {
    await rm(params.configPath, { force: true });
    await rename(params.previousSwapPath, params.configPath);
    return undefined;
  } catch (primaryError) {
    try {
      await writeFile(params.configPath, params.fallbackText, { encoding: "utf8" });
      await rm(params.previousSwapPath, { force: true }).catch(() => undefined);
      return `primary restore failed but fallback rewrite succeeded: ${String(primaryError)}`;
    } catch (fallbackError) {
      return `restore failed: ${String(primaryError)}; fallback failed: ${String(fallbackError)}`;
    }
  }
}

/**
 * Apply one OpenClaw config change as a bounded transaction.
 *
 * This function owns no timer, watchdog, daemon, PM2 process, or restart loop.
 * The existing canonical runtime owner must provide reload() and healthCheck().
 */
export async function applyConfigTransaction(
  options: ApplyConfigTransactionOptions,
): Promise<ConfigTransactionReceipt> {
  const now = options.now ?? (() => new Date());
  const started = now();
  const id = `config-tx-${timestampForFile(started)}-${randomUUID()}`;
  const activeText = await readFile(options.configPath, "utf8");
  const beforeSha256 = sha256Text(activeText);
  const candidateSha256 = sha256Text(options.candidateText);
  const baseReceipt = {
    id,
    startedAt: started.toISOString(),
    configPath: options.configPath,
    beforeSha256,
    candidateSha256,
  };

  if (options.expectedActiveSha256 && options.expectedActiveSha256 !== beforeSha256) {
    return {
      ...baseReceipt,
      status: "rejected",
      finishedAt: now().toISOString(),
      errors: ["active config drifted since approval; refusing to overwrite newer state"],
    };
  }

  const currentValidation = validateJsonConfig(activeText, options.validator);
  if (!currentValidation.ok) {
    return {
      ...baseReceipt,
      status: "rejected",
      finishedAt: now().toISOString(),
      errors: currentValidation.errors.map((error) => `active config invalid: ${error}`),
    };
  }

  const candidateValidation = validateJsonConfig(options.candidateText, options.validator);
  if (!candidateValidation.ok) {
    return {
      ...baseReceipt,
      status: "rejected",
      finishedAt: now().toISOString(),
      errors: candidateValidation.errors.map((error) => `candidate config invalid: ${error}`),
    };
  }

  if (beforeSha256 === candidateSha256) {
    return {
      ...baseReceipt,
      status: "rejected",
      finishedAt: now().toISOString(),
      errors: ["candidate is byte-for-byte identical to active config"],
    };
  }

  const snapshot = await writeSnapshot({
    snapshotDir: options.snapshotDir,
    kind: "prechange",
    configText: activeText,
    sourcePath: options.configPath,
    operator: options.operator,
    reason: options.reason,
    now: started,
  });
  await prunePrechangeHistory(options.snapshotDir, options.historyLimit ?? 20);

  let previousSwapPath: string;
  try {
    ({ previousSwapPath } = await replaceConfigWithRollbackGuard({
      configPath: options.configPath,
      candidateText: options.candidateText,
      transactionId: id,
    }));
  } catch (error) {
    return {
      ...baseReceipt,
      snapshot,
      status: "rolled_back",
      finishedAt: now().toISOString(),
      errors: [`candidate swap failed before reload: ${String(error)}`],
    };
  }

  let candidateHealth: CapabilityHealthResult;
  const errors: string[] = [];
  try {
    await options.reload();
    candidateHealth = await options.healthCheck();
  } catch (error) {
    candidateHealth = { ok: false, blockers: [`reload/health exception: ${String(error)}`] };
  }

  if (candidateHealth.ok) {
    await rm(previousSwapPath, { force: true }).catch((error) => {
      errors.push(`committed but previous swap cleanup failed: ${String(error)}`);
    });
    return {
      ...baseReceipt,
      snapshot,
      candidateHealth,
      status: "committed",
      finishedAt: now().toISOString(),
      errors,
    };
  }

  const restoreWarning = await restorePreviousConfig({
    configPath: options.configPath,
    previousSwapPath,
    fallbackText: activeText,
  });
  if (restoreWarning) {
    errors.push(restoreWarning);
  }

  let rollbackHealth: CapabilityHealthResult;
  try {
    await options.reload();
    rollbackHealth = await options.healthCheck();
  } catch (error) {
    rollbackHealth = { ok: false, blockers: [`rollback reload/health exception: ${String(error)}`] };
  }

  const restoredText = await readFile(options.configPath, "utf8").catch(() => "");
  const exactBytesRestored = sha256Text(restoredText) === beforeSha256;
  if (!exactBytesRestored) {
    errors.push("rollback did not restore the exact pre-change config hash");
  }

  return {
    ...baseReceipt,
    snapshot,
    candidateHealth,
    rollbackHealth,
    status: exactBytesRestored && rollbackHealth.ok ? "rolled_back" : "rollback_failed",
    finishedAt: now().toISOString(),
    errors,
  };
}

export function validateGoldenProof(proof: GoldenProof): ConfigValidationResult {
  if (!proof.systemGreen) {
    return { ok: false, errors: ["SYSTEM_GREEN proof is required"] };
  }
  if (!proof.rebootSurvival) {
    return { ok: false, errors: ["reboot-survival proof is required"] };
  }
  const passed = new Set(proof.passedCapabilities);
  const missing = proof.requiredCapabilities.filter((capability) => !passed.has(capability));
  if (missing.length > 0) {
    return { ok: false, errors: [`missing required capability proof: ${missing.join(", ")}`] };
  }
  if (proof.requiredCapabilities.length === 0) {
    return { ok: false, errors: ["at least one required capability must be proven"] };
  }
  return { ok: true };
}

/** Promote the currently active config to GOLDEN only after explicit green proof. */
export async function promoteGoldenConfig(
  options: PromoteGoldenOptions,
): Promise<ConfigSnapshotManifest> {
  const proofValidation = validateGoldenProof(options.proof);
  if (!proofValidation.ok) {
    throw new Error(`golden promotion refused: ${proofValidation.errors.join("; ")}`);
  }

  const configText = await readFile(options.configPath, "utf8");
  const configValidation = validateJsonConfig(configText, options.validator);
  if (!configValidation.ok) {
    throw new Error(`golden promotion refused: ${configValidation.errors.join("; ")}`);
  }

  await mkdir(options.snapshotDir, { recursive: true });
  const goldenPath = join(options.snapshotDir, "openclaw.GOLDEN.json");
  const goldenMetaPath = join(options.snapshotDir, "openclaw.GOLDEN.meta.json");
  const createdAt = (options.now ?? (() => new Date()))();
  const manifest: ConfigSnapshotManifest = {
    id: "openclaw.GOLDEN",
    kind: "golden",
    createdAt: createdAt.toISOString(),
    sourcePath: options.configPath,
    sha256: sha256Text(configText),
    operator: options.operator,
    reason: options.reason,
    configFile: basename(goldenPath),
  };

  const meta = {
    ...manifest,
    proof: options.proof,
  };

  const goldenTemp = `${goldenPath}.${randomUUID()}.tmp`;
  const metaTemp = `${goldenMetaPath}.${randomUUID()}.tmp`;
  await writeFile(goldenTemp, configText, { encoding: "utf8", flag: "wx" });
  await writeFile(metaTemp, `${JSON.stringify(meta, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  await rm(goldenPath, { force: true });
  await rm(goldenMetaPath, { force: true });
  await rename(goldenTemp, goldenPath);
  await rename(metaTemp, goldenMetaPath);
  return manifest;
}

export async function inspectConfigDrift(params: {
  configPath: string;
  snapshotDir: string;
}): Promise<ConfigDriftResult> {
  const activeText = await readFile(params.configPath, "utf8");
  const activeSha256 = sha256Text(activeText);
  const goldenPath = join(params.snapshotDir, "openclaw.GOLDEN.json");
  if (!(await pathExists(goldenPath))) {
    return { activeSha256, drifted: false, goldenPresent: false };
  }
  const goldenSha256 = sha256Text(await readFile(goldenPath, "utf8"));
  return {
    activeSha256,
    goldenSha256,
    drifted: activeSha256 !== goldenSha256,
    goldenPresent: true,
  };
}
