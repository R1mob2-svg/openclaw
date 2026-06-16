# Relay API Specification

This document details the REST API endpoints exposed by the future Relay service.

## 1. Command Submission
*   **Endpoint:** `POST /api/v1/commands/submit`
*   **Description:** Invoked by Newton (ChatGPT app) to submit a new command for validation and queueing.
*   **Request Payload:**
    ```json
    {
      "command": { ... } // COMMAND_SCHEMA.json compliant
    }
    ```
*   **Responses:**
    *   `202 Accepted`: Command queued as pending.
    *   `400 Bad Request`: Schema validation failure.
    *   `401 Unauthorized`: Invalid credentials.

## 2. Retrieve Approved Commands
*   **Endpoint:** `GET /api/v1/commands/approved`
*   **Description:** Invoked by the local AG worker to poll for commands ready for execution.
*   **Responses:**
    *   `200 OK`: Returns list of approved command objects.

## 3. Submit Receipt
*   **Endpoint:** `POST /api/v1/receipts/submit`
*   **Description:** Invoked by the local AG worker to upload a signed completion receipt.
*   **Request Payload:**
    ```json
    {
      "receipt": { ... } // RECEIPT_SCHEMA.json compliant
    }
    ```
*   **Responses:**
    *   `201 Created`: Receipt logged; triggers Telegram notify.
