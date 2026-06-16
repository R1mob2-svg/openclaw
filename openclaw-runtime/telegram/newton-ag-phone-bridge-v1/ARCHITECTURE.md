# System Architecture

## Data Flow Diagram

```mermaid
graph TD
    A[Rob in ChatGPT App] -->|Prompt/Intent| B(Newton / ChatGPT)
    B -->|Generates Command Package| C[Rob Approval Gate]
    C -->|Approved Command| D[Relay API Validation]
    D -->|Commits Command| E[GitHub Command Ledger]
    E -->|Polls Approved folder| F[AG Local Worker]
    F -->|Executes Bounded Task| F
    F -->|Writes Receipt| G[GitHub Command Ledger receipts/]
    F -->|Outbound Webhook| H[Telegram Notification Bridge]
    H -->|Summary Message| I[Rob's Phone]
```

## Component Breakdown

1.  **Newton/ChatGPT:** Formulates structured commands matching `COMMAND_SCHEMA.json` based on conversations.
2.  **Relay API:** Runs validation checks, ensures integrity checks, and handles authentication.
3.  **Command Ledger:** Local filesystem simulating a Git-backed JSON data store for command records.
4.  **AG Local Worker:** The client daemon that picks up approved commands, executes tasks safely within allowed paths, and writes receipts.
5.  **Telegram Bridge:** Outbound notification gate sending execution success summaries back to Rob's phone.
