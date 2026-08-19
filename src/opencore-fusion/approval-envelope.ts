import { createHash } from "node:crypto";
import type { ToolAction } from "./action-policy.js";

export type ActionApprovalEnvelope = {
  digest: string;
  approvedBy: string;
  approvedAt: string;
  expiresAt?: string;
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry));
  if (!value || typeof value !== "object") return value;

  const output: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    output[key] = canonicalize((value as Record<string, unknown>)[key]);
  }
  return output;
}

/**
 * Binds approval to the exact tool + action + argument payload. The digest is
 * safe to persist; the raw arguments do not need to be copied into approval logs.
 */
export function digestToolAction(input: ToolAction): string {
  const canonical = JSON.stringify(
    canonicalize({ tool: input.tool, action: input.action ?? null, args: input.args ?? {} }),
  );
  return createHash("sha256").update(canonical).digest("hex");
}

export function createActionApproval(
  input: ToolAction,
  approvedBy: string,
  approvedAt: Date = new Date(),
  expiresAt?: Date,
): ActionApprovalEnvelope {
  if (!approvedBy.trim()) throw new Error("approvedBy is required");
  return {
    digest: digestToolAction(input),
    approvedBy,
    approvedAt: approvedAt.toISOString(),
    expiresAt: expiresAt?.toISOString(),
  };
}

export function approvalMatchesAction(
  approval: ActionApprovalEnvelope,
  input: ToolAction,
  now: Date = new Date(),
): boolean {
  if (approval.expiresAt) {
    const expiry = Date.parse(approval.expiresAt);
    if (!Number.isFinite(expiry) || now.getTime() > expiry) return false;
  }
  return approval.digest === digestToolAction(input);
}
