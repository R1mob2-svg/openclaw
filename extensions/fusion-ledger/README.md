# Fusion Evidence Ledger

`fusion-ledger` is an opt-in OpenClaw plugin for append-only runtime evidence.

It captures a bounded set of sanitized agent event streams and writes two JSONL files under the OpenClaw state directory:

- `fusion-ledger/events.jsonl` — append-only runtime evidence.
- `fusion-ledger/failure-candidates.jsonl` — failed/blocked/error evidence marked `UNREVIEWED`.

## Safety model

- Disabled unless explicitly enabled through `plugins.entries.fusion-ledger`.
- Does not restart, heal, kill, schedule, or mutate agents.
- Does not change model/provider selection.
- Does not capture assistant text or command-output streams by default.
- Redacts secret-like keys and common token shapes before persistence.
- Serializes writes through one in-process append queue to avoid concurrent file rewrite races.
- Failure records are evidence only; they are never automatically promoted into doctrine or configuration.

This plugin is intentionally an evidence layer, not another watchdog. Existing OpenClaw health/recovery machinery remains authoritative.
