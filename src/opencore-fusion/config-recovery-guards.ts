import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  ApplyConfigTransactionOptions,
  ConfigTransactionReceipt,
  ConfigValidationResult,
  ConfigValidator,
  PromoteGoldenOptions,
} from "./config-rollback.js";
import {
  applyConfigTransaction,
  promoteGoldenConfig,
  sha256Text,
} from "./config-rollback.js";

export type RecoveryGuardOptions = {
  quarantineDir: string;
  recoveryLogPath: string;
  restoreSignalPath: string;
  emergencyLockPath: string;
  minSerializedBytes?: number;
  requiredNonEmptyPaths?: string[];
  maxRestoresPerWindow?: number;
  restoreWindowMs?: number;
  now?: () => Date;
};

export type SecretFinding = {
  path: string;
  reason: string;
};

export type RecoveryLedgerEntry = {
  at: string;
  transactionId: string;
  status: ConfigTransactionReceipt["status"] | "circuit_open";
  reason: string;
  beforeSha256?: string;
  candidateSha256?: string;
  quarantinePath?: string;
};

const SECRET_KEY_PATTERN =
  /(?:api[_-]?key|token|secret|password|authorization|cookie|credential|private[_-]?key|access[_-]?key)/i;
const ENV_REF_PATTERN = /^\$\{[A-Z][A-Z0-9_]*\}$/;

function getPath(value: unknown, path: string): unknown {
  let cursor: unknown = value;
  for (const part of path.split(".")) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

function isNonEmpty(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>).length > 0;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  return value !== null && value !== undefined;
}

/**
 * Structural + semantic floor used before any config can be committed.
 * Defaults intentionally reflect OpenClaw's broad anchors without asserting
 * provider-specific secrets or model names.
 */
export function createOpenClawSemanticFloorValidator(options?: {
  minSerializedBytes?: number;
  requiredNonEmptyPaths?: string[];
  extraValidator?: ConfigValidator;
}): ConfigValidator {
  const minSerializedBytes = options?.minSerializedBytes ?? 200;
  const requiredNonEmptyPaths = options?.requiredNonEmptyPaths ?? ["agents", "models"];

  return (value: unknown): ConfigValidationResult => {
    const errors: string[] = [];
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      errors.push("config root must be a non-empty object");
      return { ok: false, errors };
    }

    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized, "utf8") <= minSerializedBytes) {
      errors.push(`config is below structural floor (${minSerializedBytes} bytes)`);
    }

    for (const path of requiredNonEmptyPaths) {
      if (!isNonEmpty(getPath(value, path))) {
        errors.push(`required config anchor is empty or missing: ${path}`);
      }
    }

    if (options?.extraValidator) {
      const extra = options.extraValidator(value);
      if (!extra.ok) {
        errors.push(...extra.errors);
      }
    }

    return errors.length > 0 ? { ok: false, errors } : { ok: true };
  };
}

export function findHardcodedSecrets(value: unknown, path = "$"): SecretFinding[] {
  const findings: SecretFinding[] = [];
  if (Array.isArray(value)) {
    value.forEach((entry, index) => findings.push(...findHardcodedSecrets(entry, `${path}[${index}]`)));
    return findings;
  }
  if (!value || typeof value !== "object") {
    return findings;
  }

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const childPath = `${path}.${key}`;
    if (SECRET_KEY_PATTERN.test(key) && typeof entry === "string" && entry.trim()) {
      if (!ENV_REF_PATTERN.test(entry.trim())) {
        findings.push({
          path: childPath,
          reason: "secret-shaped field uses a literal value instead of an environment reference",
        });
      }
      continue;
    }
    findings.push(...findHardcodedSecrets(entry, childPath));
  }
  return findings;
}

async function ensureParent(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
}

async function appendRecoveryEntry(path: string, entry: RecoveryLedgerEntry): Promise<void> {
  await ensureParent(path);
  await appendFile(path, `${JSON.stringify(entry)}\n`, { encoding: "utf8" });
}

async function recentRestoreCount(path: string, now: Date, windowMs: number): Promise<number> {
  let text = "";
  try {
    text = await readFile(path, "utf8");
  } catch {
    return 0;
  }
  const cutoff = now.getTime() - windowMs;
  let count = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as RecoveryLedgerEntry;
      if (entry.status !== "rolled_back") continue;
      const at = Date.parse(entry.at);
      if (Number.isFinite(at) && at >= cutoff) count += 1;
    } catch {
      // Ignore malformed historical lines; never delete forensic evidence here.
    }
  }
  return count;
}

async function quarantineCandidate(params: {
  quarantineDir: string;
  candidateText: string;
  transactionId: string;
  at: Date;
  reason: string;
}): Promise<string> {
  await mkdir(params.quarantineDir, { recursive: true });
  const stamp = params.at.toISOString().replace(/[:.]/g, "-");
  const base = `openclaw.json.rejected-${stamp}-${params.transactionId}`;
  const configPath = join(params.quarantineDir, `${base}.json`);
  const metaPath = join(params.quarantineDir, `${base}.meta.json`);
  await writeFile(configPath, params.candidateText, { encoding: "utf8", flag: "wx" });
  await writeFile(
    metaPath,
    `${JSON.stringify({ at: params.at.toISOString(), transactionId: params.transactionId, reason: params.reason, sha256: sha256Text(params.candidateText) }, null, 2)}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  return configPath;
}

/**
 * Guarded transaction wrapper implementing the council recovery additions
 * without creating another watcher, daemon, PM2 process, scheduled task, or
 * process-lifecycle authority.
 */
export async function applyGuardedOpenClawConfigTransaction(
  options: ApplyConfigTransactionOptions & { guard: RecoveryGuardOptions },
): Promise<ConfigTransactionReceipt> {
  const nowFn = options.guard.now ?? options.now ?? (() => new Date());
  const now = nowFn();
  const maxRestores = options.guard.maxRestoresPerWindow ?? 3;
  const restoreWindowMs = options.guard.restoreWindowMs ?? 5_000;
  const recent = await recentRestoreCount(options.guard.recoveryLogPath, now, restoreWindowMs);

  if (recent >= maxRestores) {
    await ensureParent(options.guard.emergencyLockPath);
    await writeFile(
      options.guard.emergencyLockPath,
      `${JSON.stringify({ at: now.toISOString(), reason: "restore circuit breaker opened", recentRestores: recent, windowMs: restoreWindowMs }, null, 2)}\n`,
      { encoding: "utf8" },
    );
    await appendRecoveryEntry(options.guard.recoveryLogPath, {
      at: now.toISOString(),
      transactionId: "circuit-open",
      status: "circuit_open",
      reason: "restore circuit breaker opened",
    });
    return {
      id: "config-tx-circuit-open",
      status: "rejected",
      startedAt: now.toISOString(),
      finishedAt: now.toISOString(),
      configPath: options.configPath,
      beforeSha256: "unknown",
      candidateSha256: sha256Text(options.candidateText),
      errors: ["restore circuit breaker is open; manual review required"],
    };
  }

  const floorValidator = createOpenClawSemanticFloorValidator({
    minSerializedBytes: options.guard.minSerializedBytes,
    requiredNonEmptyPaths: options.guard.requiredNonEmptyPaths,
    extraValidator: options.validator,
  });

  const receipt = await applyConfigTransaction({
    ...options,
    validator: floorValidator,
    now: nowFn,
  });

  const reason = receipt.errors.join("; ") || receipt.candidateHealth?.blockers?.join("; ") || receipt.status;
  let quarantinePath: string | undefined;
  if (receipt.status === "rejected" || receipt.status === "rolled_back" || receipt.status === "rollback_failed") {
    quarantinePath = await quarantineCandidate({
      quarantineDir: options.guard.quarantineDir,
      candidateText: options.candidateText,
      transactionId: receipt.id,
      at: nowFn(),
      reason,
    }).catch(() => undefined);
  }

  await appendRecoveryEntry(options.guard.recoveryLogPath, {
    at: nowFn().toISOString(),
    transactionId: receipt.id,
    status: receipt.status,
    reason,
    beforeSha256: receipt.beforeSha256,
    candidateSha256: receipt.candidateSha256,
    quarantinePath,
  });

  if (receipt.status === "rolled_back") {
    await ensureParent(options.guard.restoreSignalPath);
    await writeFile(
      options.guard.restoreSignalPath,
      `${JSON.stringify({ at: nowFn().toISOString(), transactionId: receipt.id, restoredSha256: receipt.beforeSha256, quarantinePath, instruction: "disk config restored; canonical runtime owner must perform controlled reload/verification" }, null, 2)}\n`,
      { encoding: "utf8" },
    );
  }

  return receipt;
}

/** GOLDEN promotion additionally refuses literal secret-shaped fields by default. */
export async function promoteGuardedGoldenConfig(
  options: PromoteGoldenOptions & { allowHardcodedSecrets?: boolean },
) {
  const text = await readFile(options.configPath, "utf8");
  const parsed = JSON.parse(text) as unknown;
  const findings = findHardcodedSecrets(parsed);
  if (!options.allowHardcodedSecrets && findings.length > 0) {
    throw new Error(
      `golden promotion refused: ${findings.length} hardcoded secret-shaped field(s) must be migrated to env refs or explicitly reviewed`,
    );
  }
  return promoteGoldenConfig(options);
}
