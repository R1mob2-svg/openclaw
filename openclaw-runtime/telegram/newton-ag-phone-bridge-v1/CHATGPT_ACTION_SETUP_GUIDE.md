# ChatGPT Action Setup Guide for Newton

This guide explains how Rob can set up the ChatGPT Action inside his custom Newton GPT instance to submit commands directly from his phone.

## Prerequisites
1.  **Vercel Relay URL:** The HTTPS URL of your deployed Vercel relay (e.g., `https://your-vercel-project.vercel.app`).
2.  **Relay Auth Secret:** A secret token used to authenticate ChatGPT requests (configured on the relay in `RELAY_AUTH_TOKEN` environment variable).

## Step-by-Step Configuration

1.  **Open My GPTs on ChatGPT:**
    *   Navigate to ChatGPT and click **Explore GPTs** -> **Create / Edit** the "Newton" custom GPT.
2.  **Configure Actions:**
    *   Scroll down to the **Actions** section and click **Create new action**.
3.  **Import OpenAPI Schema:**
    *   Choose **Import from URL** or paste the content of [GPT_ACTION_OPENAPI_SCHEMA.yaml](GPT_ACTION_OPENAPI_SCHEMA.yaml) directly into the Schema text box.
    *   Ensure the `servers.url` field in the schema is set to your actual Vercel relay base domain.
4.  **Set Authentication:**
    *   Under **Authentication**, click **Edit**.
    *   Select **API Key** as the Authentication Type.
    *   Set the Auth Key type to **Bearer**.
    *   Enter the `RELAY_AUTH_TOKEN` value as the API key.
    *   Click **Save**.
5.  **Test the Action:**
    *   In the GPT editor preview, tell Newton: `"Run a dry-run bridge ping."`
    *   Newton should construct the command package, ask for your approval, sign it with a nonce, and submit it to the relay.
    *   Check that the relay returns a `200 OK` status with `status: queued`.

## Security Model
*   **Bearer Auth:** Ensures only your authorized Newton GPT can hit the relay.
*   **Nonce Validation:** Rejects any duplicate nonces to prevent replay attacks.
*   **No local ports exposed:** ChatGPT only talks to the Vercel HTTPS relay.
