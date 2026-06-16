# Newton ↔ AG Phone Bridge Webhook Intake Dry-Run Receipt

## Ingestion Validation Verdict
*   **Status:** PASSED (Verified via mock webhook dry run and webhook self-test suite).
*   **Signature Header Checked:** `X-Hub-Signature-256` (HMAC SHA-256).
*   **Secret Comparison Mechanism:** Timing-safe buffer comparison (`crypto.timingSafeEqual`).
*   **Replay Prevention:** Logs and rejects duplicate `X-GitHub-Delivery` ID values.
*   **Branch Validation Bounds:** Scoped strictly to target branch `newton-ag-bridge-v2-ledger-dry-run`. All other refs are rejected (e.g. `refs/heads/main` returns 400).
*   **Directory Path Bounds:** Restricts modifications to files matching prefix `CommandLedger/approved/`. Changes outside this folder are forbidden and return 403.
*   **Outbound Communication:** Offline dry-run only. No Telegram API notifications, cloud, or external network requests are executed.

## Log Output Files Created
*   **Delivery Records:** `CommandLedger/webhook_deliveries/<delivery_id>.json`
*   **Webhook Receipts:** `CommandLedger/webhook_receipts/<delivery_id>_receipt.json`

## Webhook Intake Self-Test Results
*   **Test Script:** `node src/webhook-self-test.js`
*   **Status:** PASSED
*   **Assertions Checked:**
    *   Fail closed on missing signature: **PASSED**
    *   Fail closed on invalid signature: **PASSED**
    *   Reject wrong branch: **PASSED**
    *   Reject wrong path prefix: **PASSED**
    *   Succeed on valid push webhook payload: **PASSED**
    *   Block replayed delivery ID: **PASSED**
