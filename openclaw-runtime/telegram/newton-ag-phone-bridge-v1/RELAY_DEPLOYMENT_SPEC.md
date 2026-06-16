# Relay Deployment Specification

This specification documents the architecture and deployment configurations for the hosted webhook relay layer. 

> [!WARNING]
> **Safety Constraint:** Under no circumstances should the local host PC run a public-facing port listener or connect directly to incoming GitHub webhooks. All external web traffic must be received by a secure serverless platform (Vercel or Cloudflare Workers) which serves as a relay.

## Relay Architecture Rules

1.  **Public Endpoint:** A hosted HTTPS endpoint receives the POST webhook request from GitHub.
2.  **Signature Validation:** The relay verifies the `X-Hub-Signature-256` HMAC SHA-256 signature immediately using the configured webhook secret.
3.  **Branch & Path Verification:** The relay parses the commit history to verify that modifications are strictly scoped to the sandbox branch `newton-ag-bridge-v2-ledger-dry-run` and within the `CommandLedger/approved/` directory.
4.  **No Direct Local Execution:** The relay does not execute the payload. It only parses the request and queues the command.
5.  **Local AG Worker Sync:** The local AG daemon polls the repo or runs a secure outbound queue reader (e.g. Server Sent Events or secure database check) to fetch approved commands, maintaining a completely outbound-only network profile.

## Example Handlers
The workspace provides two example templates for deploying this relay:
*   [vercel-webhook-handler.example.js](file:///C:/Users/tauru/OneDrive/Desktop/newton-ag-phone-bridge-v1/src/vercel-webhook-handler.example.js): Setup template for Vercel Serverless Functions.
*   [cloudflare-worker-webhook-handler.example.js](file:///C:/Users/tauru/OneDrive/Desktop/newton-ag-phone-bridge-v1/src/cloudflare-worker-webhook-handler.example.js): Setup template for Cloudflare Workers.
