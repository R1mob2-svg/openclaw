import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

type JsonRecord = Record<string, unknown>;

const CAPTURED_STREAMS = [
  "lifecycle",
  "tool",
  "error",
  "item",
  "plan",
  "approval",
  "patch",
  "compaction",
] as const;

const SECRET_KEY_PATTERN =
  /(?:api[_-]?key|token|secret|password|authorization|cookie|credential|private[_-]?key|access[_-]?key)/i;
const SECRET_VALUE_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+\/-]+=*\b/gi,
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{16,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{12,}\b/g,
];
const MAX_DEPTH = 8;
const MAX_STRING_LENGTH = 8_192;

export function redactString(value: string): string {
  let result = value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}…[TRUNCATED]` : value;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    result = result.replace(pattern, "[REDACTED]");
  }
  return result;
}

export function sanitizeForLedger(value: unknown, depth = 0, keyHint?: string): unknown {
  if (keyHint && SECRET_KEY_PATTERN.test(keyHint)) {
    return "[REDACTED]";
  }
  if (depth >= MAX_DEPTH) {
    return "[MAX_DEPTH]";
  }
  if (value == null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return redactString(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeForLedger(entry, depth + 1));
  }
  if (typeof value === "object") {
    const out: JsonRecord = {};
    for (const [key, entry] of Object.entries(value as JsonRecord)) {
      out[key] = sanitizeForLedger(entry, depth + 1, key);
    }
    return out;
  }
  return String(value);
}

export function isFailureCandidate(stream: string, data: JsonRecord): boolean {
  if (stream === "error") {
    return true;
  }
  const status = typeof data.status === "string" ? data.status.toLowerCase() : "";
  return status === "failed" || status === "blocked";
}

function toJsonLine(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

export default definePluginEntry({
  id: "fusion-ledger",
  name: "Fusion Evidence Ledger",
  description: "Append sanitized agent evidence and failure candidates without mutating agent state.",
  register(api) {
    let ledgerDir: string | undefined;
    let writeTail: Promise<void> = Promise.resolve();
    let warnedUnavailable = false;

    const enqueueAppend = (fileName: string, payload: unknown) => {
      if (!ledgerDir) {
        if (!warnedUnavailable) {
          warnedUnavailable = true;
          api.logger.warn("fusion-ledger: state directory not ready; skipping early event");
        }
        return;
      }
      const path = join(ledgerDir, fileName);
      writeTail = writeTail
        .then(async () => {
          await appendFile(path, toJsonLine(payload), { encoding: "utf8" });
        })
        .catch((error) => {
          api.logger.error(`fusion-ledger: append failed: ${String(error)}`);
        });
    };

    api.registerService({
      id: "fusion-ledger-storage",
      async start(ctx) {
        ledgerDir = join(ctx.stateDir, "fusion-ledger");
        await mkdir(ledgerDir, { recursive: true });
        api.logger.info(`fusion-ledger: append-only ledger ready at ${ledgerDir}`);
      },
      async stop() {
        await writeTail;
      },
    });

    api.agent.events.registerAgentEventSubscription({
      id: "fusion-ledger-agent-events",
      description: "Persist bounded, sanitized runtime evidence for audit and later lesson consolidation.",
      streams: [...CAPTURED_STREAMS],
      handle(event) {
        const sanitizedData = sanitizeForLedger(event.data) as JsonRecord;
        const record = {
          runId: event.runId,
          seq: event.seq,
          ts: event.ts,
          stream: event.stream,
          sessionKey: event.sessionKey,
          sessionId: event.sessionId,
          agentId: event.agentId,
          data: sanitizedData,
        };
        enqueueAppend("events.jsonl", record);

        if (isFailureCandidate(event.stream, sanitizedData)) {
          enqueueAppend("failure-candidates.jsonl", {
            ...record,
            candidate: {
              status: "UNREVIEWED",
              source: "fusion-ledger",
              rule: "Evidence only. Never auto-promote a failure into doctrine without review.",
            },
          });
        }
      },
    });
  },
});
