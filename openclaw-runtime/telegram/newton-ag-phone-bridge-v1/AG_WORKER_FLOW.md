# AG Worker Lifecycle Flow

The local AG worker daemon operates on a state machine logic to check, parse, run, and close out command tasks.

## State Transitions

```text
[Pending]
   │
   ├── (Validate Structure & Hashes)
   ▼
[Approved]
   │
   ├── (Worker Polls & Transitions)
   ▼
[In Progress]
   │
   ├───(Success)─────────► [Completed] (Write Receipt)
   │
   ├───(Validation Fail)─► [Blocked] (Write Receipt)
   │
   └───(Execution Fail)──► [Failed] (Write Receipt)
```

## Step-by-Step Execution Plan

1.  **Polling Loop:** Worker executes a long-poll request to `approved/` folder/API.
2.  **Integrity Validation:** Worker parses command payload, calculates the hash, and matches it against `command_hash`.
3.  **Security Filtering:** Checks risk level and forbidden actions. Scans variables for sensitive keys or secrets.
4.  **Acknowledge Pickup:** Moves JSON command file from `approved/` to `in_progress/`.
5.  **Bounded Run:** Executes code payload strictly inside sandbox/project scope.
6.  **Create Receipt:** Compiles results, lists files altered, and saves JSON record under `receipts/` directory.
7.  **Outbound Log:** Triggers notification handler.
