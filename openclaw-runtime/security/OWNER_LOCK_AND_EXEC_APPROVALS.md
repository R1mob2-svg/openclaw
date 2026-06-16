# OWNER_LOCK_AND_EXEC_APPROVALS

This repository contains sanitized configurations. Live exec approvals and owner locks must remain local to the runtime target (Windows OpenClaw instance).

* Do not commit raw exec-approvals.json.
* Ensure owner locks are enforced in the live configuration.

## Enforcement Locations
* **auth.owner**: Global owner lock (not the only valid location).
* **openclaw.json**: gateway.exec.ownerAllowFrom and channels.telegram.allowFrom arrays explicitly list allowed users/chats.
* **Telegram Bridge**: Environment variable TELEGRAM_CHAT_ID restricts outbound/inbound routes.
* **Protected Commands**: Protected commands always require an owner check PLUS execution approval from the user.

## Webhook Security Warning
* **Webhooks must not be enabled** until owner lock is definitively proven on the webhook route. Current Telegram webhook routes rely on signed GitHub deliveries or explicit signature checks, but incoming general webhooks must be gated by llowlist or TELEGRAM_CHAT_ID.
