import type { ApprovalDecision } from "./types.js";

export type ToolAction = {
  tool: string;
  action?: string;
  args?: Record<string, unknown>;
};

export type ToolPolicyRule = {
  tool: string | RegExp;
  action?: string | RegExp;
  decision: ApprovalDecision["decision"];
  reason: string;
};

const SECRET_KEY_PATTERN = /(api[_-]?key|token|secret|password|authorization|cookie|credential|private[_-]?key)/i;
const READ_ACTION_PATTERN = /^(get|list|read|fetch|search|status|inspect|show|diff|compare|check)$/i;
const MUTATION_ACTION_PATTERN = /^(create|update|delete|write|edit|merge|push|send|publish|deploy|restart|stop|start|execute|run|apply|approve|transfer)$/i;

function matches(value: string | undefined, matcher: string | RegExp | undefined): boolean {
  if (matcher === undefined) return true;
  if (value === undefined) return false;
  return typeof matcher === "string" ? value === matcher : matcher.test(value);
}

export function decideToolAction(
  input: ToolAction,
  rules: readonly ToolPolicyRule[] = [],
): ApprovalDecision {
  for (const rule of rules) {
    if (matches(input.tool, rule.tool) && matches(input.action, rule.action)) {
      return { decision: rule.decision, reason: rule.reason };
    }
  }

  const action = input.action ?? "";
  if (/secret|credential|vault/i.test(input.tool) && !READ_ACTION_PATTERN.test(action)) {
    return { decision: "deny", reason: "secret material must not be mutated by a general worker" };
  }
  if (READ_ACTION_PATTERN.test(action)) {
    return { decision: "allow", reason: "read-only action" };
  }
  if (MUTATION_ACTION_PATTERN.test(action)) {
    return { decision: "require_approval", reason: "state-changing action requires exact approval" };
  }
  return { decision: "require_approval", reason: "unknown action defaults to approval" };
}

/**
 * Remove secret-looking fields before events, receipts, or approval previews are persisted.
 */
export function redactSensitiveArgs(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => redactSensitiveArgs(entry));
  if (!value || typeof value !== "object") return value;

  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    output[key] = SECRET_KEY_PATTERN.test(key) ? "[REDACTED]" : redactSensitiveArgs(child);
  }
  return output;
}

export function containsSensitiveArgumentKeys(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((entry) => containsSensitiveArgumentKeys(entry));
  if (!value || typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).some(
    ([key, child]) => SECRET_KEY_PATTERN.test(key) || containsSensitiveArgumentKeys(child),
  );
}
