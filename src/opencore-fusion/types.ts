export type CapabilityStatus = "pass" | "fail" | "unknown";

export type CapabilityProbe = {
  id: string;
  capability: string;
  status: CapabilityStatus;
  observedAt: string;
  evidence?: string;
  source?: string;
  safeAutoRecover?: boolean;
};

export type CapabilityHealth = {
  status: "green" | "degraded" | "red";
  checkedAt: string;
  required: string[];
  passing: string[];
  failing: string[];
  stale: string[];
  missing: string[];
  blockers: string[];
};

export type RuntimeEventKind =
  | "task.created"
  | "task.started"
  | "task.progress"
  | "task.blocked"
  | "task.completed"
  | "task.failed"
  | "handoff.requested"
  | "handoff.accepted"
  | "verification.passed"
  | "verification.failed"
  | "review.passed"
  | "review.failed"
  | "recovery.started"
  | "recovery.completed"
  | "recovery.failed";

export type RuntimeEvent = {
  id: string;
  taskId: string;
  kind: RuntimeEventKind;
  at: string;
  actor: string;
  summary: string;
  evidence?: string[];
  metadata?: Record<string, unknown>;
};

export type DerivedTaskState = {
  taskId: string;
  status: "unknown" | "queued" | "running" | "blocked" | "failed" | "complete";
  currentOwner?: string;
  lastEvent?: RuntimeEvent;
  blocker?: string;
  verified: boolean;
  reviewed: boolean;
};

export type LoopBudget = {
  maxAttempts: number;
  maxRuntimeMs: number;
  maxOutputUnits: number;
};

export type LoopCheckpoint = {
  phase: "maker" | "verifier" | "reviewer" | "complete" | "blocked";
  attempt: number;
  startedAtMs: number;
  outputUnits: number;
  lastFailure?: string;
};

export type FailureIncident = {
  id: string;
  at: string;
  surface: string;
  code?: string;
  message: string;
  evidence?: string[];
};

export type LessonCandidate = {
  id: string;
  fingerprint: string;
  firstSeen: string;
  lastSeen: string;
  occurrences: number;
  claim: string;
  evidence: string[];
};

export type LessonDecision = {
  id: string;
  candidateId: string;
  at: string;
  actor: string;
  action: "accept" | "reject" | "retract" | "reopen";
  rationale: string;
};

export type MemoryLayer = "working" | "episodic" | "semantic" | "personal";

export type MemoryRecord = {
  id: string;
  layer: MemoryLayer;
  text: string;
  createdAt: string;
  updatedAt?: string;
  sourceIds?: string[];
  confidence?: number;
  tags?: string[];
};

export type ApprovalDecision = {
  decision: "allow" | "require_approval" | "deny";
  reason: string;
};
