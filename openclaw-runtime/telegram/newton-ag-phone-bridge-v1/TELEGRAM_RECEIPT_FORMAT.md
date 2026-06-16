# Telegram Notification Summary Format

When a command completes execution, a notification message is posted to Rob's Telegram.

## Message Layout

```text
🤖 AG Phone Bridge Alert

Status: [COMPLETE | BLOCKED | FAILED]
Command ID: [command_id]
Title: [title]
Risk Level: [risk_level]

---
Summary:
[Execution summary details...]

Files Touched:
- Created: [count]
- Modified: [count]
- Deleted: [count]

Protected Surfaces Touched: [None | List of systems]
Secrets Exposed: [None | WARNING alert]

Next Safe Step: [recommended action]
```

## Security Rule
Notifications must never output plaintext secret tokens, password parts, or raw error messages that leak internal directory structures.
