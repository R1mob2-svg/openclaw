export type ActivityPhase = "github" | "railway" | "pc" | "workspace";
export type ActivityStatus = "running" | "done" | "blocked" | "failed";

export type ProgressContext = {
  callback_url: string;
  token: string;
  job_id: string;
  lease_epoch?: number | string | null;
};

export type ActivityPayload = {
  lease_epoch: number | string | null;
  event_id: string;
  phase: ActivityPhase;
  status: ActivityStatus;
  label: string;
  tool: string | null;
};

export type ActivityResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  httpStatus?: number;
  payload?: ActivityPayload;
};

export type ActivityCounters = {
  sent: number;
  skipped: number;
  failed: number;
  disabled: boolean;
};

export type ToolStartLike = {
  itemId?: string;
  toolCallId?: string;
  name?: string;
  phase?: string;
  args?: Record<string, unknown>;
  detailMode?: string;
} | undefined;

export type ActivityEmitter = {
  enabled: boolean;
  counters: ActivityCounters;
  context?: ProgressContext;
  emit: (input?: {
    phase?: string;
    status?: string;
    label?: string;
    tool?: string;
    eventId?: string;
  }) => Promise<ActivityResult>;
  emitToolStart: (payload: ToolStartLike) => Promise<ActivityResult>;
  emitToolResult: (payload?: { name?: string; status?: string; args?: Record<string, unknown> }) => Promise<ActivityResult>;
  snapshot: () => ActivityCounters;
};

export const SILENT_FAILURE_CODES: readonly string[];
export const PHASES: readonly ActivityPhase[];
export const STATUSES: readonly ActivityStatus[];

export function phaseForTool(tool?: string | null): ActivityPhase;
export function statusForToolPhase(toolPhase?: string | null): ActivityStatus;
export function formatLabel(input?: { tool?: string; status?: string; args?: Record<string, unknown> }): string;
export function truncateLabel(text: unknown, max?: number): string;
export function normalizeProgressContext(raw?: unknown): ProgressContext | null;
export function buildActivityPayload(input: {
  leaseEpoch: number | string | null | undefined;
  eventId: string;
  phase?: string;
  status?: string;
  label?: string;
  tool?: string | null;
}): ActivityPayload;
export function isSilentFailure(input?: { httpStatus?: number; errorCode?: string | null }): boolean;
export function createActivityEmitter(input?: {
  progressContext?: unknown;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  logger?: (msg: string) => void;
}): ActivityEmitter;
