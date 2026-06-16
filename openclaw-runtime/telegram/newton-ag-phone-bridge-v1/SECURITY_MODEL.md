# Security Model

The bridge implements a defense-in-depth security model to ensure that remote commands can never lead to arbitrary code execution or credential exposure.

## 1. Cryptographic Integrity
*   **Command Hashing:** Each command is signed by hashing the payload concatenated with the `nonce` using SHA-256. The local worker verifies this signature to prevent payload tampering.
*   **Anti-Replay Nonce:** Nonces are tracked in a transaction ledger. A command containing an already-used nonce is immediately moved to `blocked/` to prevent replay attacks.

## 2. Authorization Gates
*   **Dual Approval:** Commands require both `rob_approval_status === "APPROVED"` and `newton_review_status === "REVIEWED"`.
*   **Risk Level Isolation:** Risk levels range from 1 (read-only) to 10 (destructive). Risk levels above 5 trigger strict verification gates and can never bypass manual confirmation.

## 3. Secret Trust Law
*   **Usable, Not Sayable:** Under no circumstances are credentials, API keys, or tokens printed in raw text, logs, or receipts.
*   **Token Scan Filter:** The command validator scans all payload variables for typical secret prefixes (`ghp_`, `sk-`, `AIza-`, `eyJ`) and immediately blocks the command if any credentials are found.

## 4. Protected Surfaces
Execution affecting the following paths or APIs requires explicit, signed authority and cannot be automated by default:
*   Cloud billing
*   VM lifecycle
*   Secrets files (.env)
*   OpenClaw core configuration
*   Outbound API integrations (Telegram, Twilio, Email)
