# Newton Acceptance Audit & V1.1 Hardening Receipt

This document records the V1.1 security audit, path verification, and validation checks completed for the Newton <=> AG Phone Bridge.

## 1. Project & File Configurations
- **Exact Project Path:** `C:\Users\tauru\OneDrive\Desktop\newton-ag-phone-bridge-v1`
- **Latest Dry-Run Command JSON Path:** `C:\Users\tauru\OneDrive\Desktop\newton-ag-phone-bridge-v1\CommandLedger\receipts\commands\CMD-1781464709545-101.json`
- **Latest Dry-Run Receipt JSON Path:** `C:\Users\tauru\OneDrive\Desktop\newton-ag-phone-bridge-v1\CommandLedger\receipts\CMD-1781464709545-101_receipt.json`
- **Exact Markdown Receipt Paths:**
  - `C:\Users\tauru\OneDrive\Desktop\newton-ag-phone-bridge-v1\receipts\BUILD_RECEIPT.md`
  - `C:\Users\tauru\OneDrive\Desktop\newton-ag-phone-bridge-v1\receipts\DRY_RUN_RECEIPT.md`
  - `C:\Users\tauru\OneDrive\Desktop\newton-ag-phone-bridge-v1\receipts\NEWTON_ACCEPTANCE_AUDIT_V1_1.md`

## 2. Package Scripts Configuration
```json
"scripts": {
  "dry-run": "node src/relay-dry-run.js && node src/simulate-ag-worker.js",
  "validate": "node src/validate-command.js",
  "self-test": "node src/bridge-self-test.js"
}
```

## 3. Execution Verification Summaries

### Dry-Run Output Summary (`npm run dry-run`)
- **Status:** PASS
- **Command Generated:** ID `CMD-1781464709545-101`, Nonce `NONCE-77518693`, Title `PING_AG_FROM_NEWTON_DRY_RUN`.
- **Flow Executed:** Relay generated command -> Validator verified signatures & schemas -> Persisted to `approved/` -> Worker ingested -> Shifted state to `in_progress/` -> Wrote local dummy log and receipt JSON -> Archived command -> Printed mock Telegram outbound summary.

### Self-Test Output Summary (`npm run self-test`)
- **Status:** PASS (0 failures, 8 assertions successful)
- **Verified Tests:**
  1. Base command validation.
  2. Payload signature validation (modified payload rejects hash signature).
  3. Rob approval validation (blocks missing Rob approval status).
  4. Newton review validation (blocks missing Newton review status).
  5. Stateful Nonce verification (blocks command when nonce exists in ledger history).
  6. Protected Surface Gate Block (blocks protected surface touch without approval).
  7. Protected Surface Gate Approval (allows protected surface touch when explicitly listed).
  8. Anti-Credential Scan (blocks API keys/patterns).

## 4. Hardening Audit Metrics

| Audit Parameter | Status / Value |
| --- | --- |
| **Files Modified (since V1)** | `src/validate-command.js`, `COMMAND_SCHEMA.json`, `package.json` |
| **Files Created (since V1)** | `src/bridge-self-test.js`, `receipts/NEWTON_ACCEPTANCE_AUDIT_V1_1.md` |
| **Shell execution possible from Relay** | **NO** |
| **Replay protection persisted** | **YES** (Stateful nonce verification across active/archived directories) |
| **Protected surfaces blocked** | **YES** (Cloud billing, secrets, OpenClaw, routing, twilio, etc., blocked unless explicitly approved) |
| **Secrets printed** | **NO** |
| **Live systems touched** | **NO** |
| **OpenClaw / Cloud / Telegram / GitHub touched** | **NO** |

## 5. Next Safe Implementation Step
Integrate Git polling in the local worker to safely pull authorized commands from the remote GitHub ledger repository over HTTPS (private repository polling) without shell bindings or exposing web ports.
