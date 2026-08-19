# OpenCore Fusion v1

OpenCore Fusion is a local governance layer for Rob's OpenClaw fork. It combines ideas independently derived from public agent-runtime patterns while preserving OpenClaw as the runtime.

## Implemented in this foundation

- Append-only runtime event ledger with derived task state.
- Capability-level health: process liveness alone can never produce GREEN.
- Bounded maker -> deterministic verifier -> independent reviewer loops.
- Evidence-driven failure learning with candidate/accept/reject/retract history.
- Four memory layers: working, episodic, semantic, personal.
- Semantic promotion requires repeated independent evidence.
- Exact action approval decisions with default approval for mutations.
- SHA-256 approval envelopes bound to the exact tool + action + arguments, with expiry support.
- Secret-shaped argument redaction before persistence/receipts.
- Secretless worker capability grants: workers receive scoped authorization claims rather than provider credentials.
- Honest operator cockpit projection derived from existing probes/events; it cannot hide failed required capabilities behind process liveness.
- Single-supervisor recovery ladder; duplicate supervisors block auto-recovery.
- Golden rollback is only eligible when a baseline is explicitly proven.

## Safety boundary

This directory is deliberately side-effect free. It creates no worker, watchdog, scheduled task, process killer, network listener, provider route, model fallback, or config mutation. Nothing is wired into the live gateway by this branch.

The next integration step must happen only after the active NEO/OpenClaw audit proves the runtime boundary to attach to. Existing Warden/healer/PM2/OpenClaw health mechanisms must be inventoried first so this policy is consumed by one canonical supervisor rather than creating another one.

## Design sources studied

Concepts were studied from public projects including GBrain, agentic-stack, OpenClaw Control Center, AgentTeams, Wardn AI, AionUi, OpenClaw-RL, and community OpenClaw autonomy patterns. This implementation is original code; no source code was copied from those projects.

## Intended future wiring

1. Existing runtime components emit append-only events.
2. Existing health owner emits real capability probes.
3. One canonical supervisor consumes recovery policy.
4. Agent Brain consumes episodic failures and stages candidate lessons.
5. Newton/AG governance promotes or retracts semantic lessons.
6. Operator UI reads the cockpit projection from derived evidence instead of inventing a second state model.
7. A host-owned capability broker resolves credentials; workers receive only secretless scoped grants.
8. Risky mutations require approval that matches the exact tool call digest, not broad standing permission.

## Non-goals

- No new daemon.
- No second watchdog.
- No automatic provider/model changes.
- No OpenRouter route.
- No silent deployment.
- No golden baseline while the system is not proven green.
