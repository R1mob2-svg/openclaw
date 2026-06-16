# Newton ↔ AG Phone Bridge V1

This project implements a local dry-run scaffold for the Newton ↔ AG Phone Bridge. It allows Rob to route commands securely from his phone (via a future ChatGPT app -> Newton relay connection) down to the local AG Sentinel agent, producing structured receipts and Telegram notification logs.

## Directory Structure

*   `src/`: Contains the JavaScript dry-run validation, relay generator, and worker simulator.
*   `CommandLedger/`: Folder-based database containing states:
    *   `pending/`: Newly generated commands awaiting review.
    *   `approved/`: Commands validated and authorized for execution.
    *   `in_progress/`: Commands currently picked up by the agent.
    *   `receipts/`: Historical command completion logs.
    *   `blocked/`/`failed/`: Commands rejected due to security or execution errors.
*   `receipts/`: Project build and dry-run receipts.

## How to Run

1.  Make sure you have Node.js installed.
2.  Install dependencies (none required for V1 dry-run).
3.  Run the dry-run simulation:
    ```bash
    npm run dry-run
    ```
