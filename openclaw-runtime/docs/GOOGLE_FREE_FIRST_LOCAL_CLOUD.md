# Google-free-first routing: OpenClaw local and cloud

**Status: CANDIDATE ONLY, NOT ACTIVE.** This guide applies to the founder-owned `R1mob2-svg/openclaw` fork, both Windows OpenClaw and Railway `openclaw-neo-runtime`. It does NOT fork/replace the canonical Brain, create a second scheduler, install a new agent, or deploy itself.

## Requested behaviour

1. Every agent starts on Google's **Gemini 3.7 Flash** free API tier.
2. Keep each agent's identity, tools, memory, session and existing OpenClaw execution runtime.
3. Maintain a conservative *per-runtime* agent request counter, `OPENCLAW_GOOGLE_FREE_PER_AGENT_DAILY=12` by default, and a per-runtime total of 36 Google model call starts. These are **local guardrails, not Google's real or global project quota**.
4. Once a local cap is reached, resolve the agent's model as `deepseek/deepseek-chat` for the rest of the UTC day. Google provider HTTP 429 rate-limit/quota errors are handled by OpenClaw's **native** `agents.defaults.model.fallbacks`, not by a new retry loop.
5. After Google's new UTC quota day, prefer Google again. The model-choice hook evaluates that on each new agent turn.
6. If DeepSeek then returns insufficient credits (HTTP 402), **stop and checkpoint**. Never silently route to paid Pro/Astra or resend the same large request. No more balance, no magic extra inference.
7. Only send private Brain/context to Google's free tier if the founder explicitly accepts that free-tier API inputs can be used by Google to improve its products. Keep all three gates disabled before that consent.

## Preconditions: do not skip

- Verify **the Google AI Studio API project is on the Gemini Developer API free tier**. Having a `GOOGLE_API_KEY` or Gemini subscription does NOT prove this. A billing-enabled project may charge for the same endpoint.
- Confirm the model `google/gemini-3.7-flash` exists in the installed OpenClaw provider catalog and is allowed for that project. The [official Gemini pricing page](https://ai.google.dev/gemini-api/docs/pricing) lists free developer API input and output but applies project-specific caps.
- Read the [Google free tier data-use terms](https://ai.google.dev/gemini-api/docs/pricing). Google's pricing page states free-tier requests **may be used to improve Google products**. This code needs explicit private-Brain consent before use.
- Confirm a secret named `GOOGLE_API_KEY` or `GEMINI_API_KEY` exists on each runtime, without copying it into Git or logs.
- Verify the actual persistent `OPENCLAW_STATE_DIR` and agent config is backed up. The checked-in example is not production truth.

## Candidate configuration

See `openclaw-runtime/config-templates/google-free-first.policy.example.json`. **Merge**, don't overwrite, into the existing `openclaw.json` configuration. Existing per-agent `model` definitions are strict: ensure all intended agents either use `agents.defaults.model` or receive their own `primary=google/gemini-3.7-flash; fallbacks=[deepseek/deepseek-chat]` values. The plugin's `before_model_resolve` hook enforces Google-first on enabled agent turns and redirects to DeepSeek after its local quota.

Use `openclaw models status` and inspect the current resolved agent primary and fallback list. Do not treat a Git commit as a configuration update to the existing persistent Railway volume or the Windows `.openclaw` folder.

## Feature gates (required in each runtime)

```text
OPENCLAW_GOOGLE_FREE_FIRST_ENABLED=false
OPENCLAW_GOOGLE_FREE_TIER_CONFIRMED=false
OPENCLAW_GOOGLE_FREE_PRIVATE_DATA_OPT_IN=false
OPENCLAW_GOOGLE_FREE_PER_AGENT_DAILY=12
OPENCLAW_GOOGLE_FREE_SHARED_DAILY=36
```

Only after verifying all preconditions, enabling the `google-free-first` plugin in the actual config with `plugins.entries.google-free-first.enabled=true`, setting its `hooks.allowConversationAccess=true` (needed for the `before_model_resolve` hook), and verifying a model is free, may these three gates be set true. **No API key values belong in the repository.**

The plugin writes its local ledger to `$OPENCLAW_STATE_DIR/google-free-daily-usage.json`. It is independent of the GeminX Gemini ledger, and is **not** a cloud+Windows distributed quota manager. A shared Google project may exhaust its real quota earlier than these local caps. The native Google HTTP 429 route remains authoritative.

## Local Windows acceptance

- Update the founder-owned fork after review and install dependencies using the existing local update workflow. Do not replace local OpenClaw with a second installation.
- Merge the example overlay into the existing Windows `openclaw.json` and back it up.
- With feature gates off, verify current model and tool loop remain unchanged.
- With verified free API, privacy consent and gates on, send an innocuous non-secret no-tool prompt as AG then NEO. Require actual `provider=google` request/response records and independent per-agent counter increments, no credential values in logs.
- Exhaust AG's tiny **test** allowance in an isolated temporary ledger and prove the next AG turn resolves `deepseek/deepseek-chat`, while NEO remains on Google until its own cap. Confirm all existing Brain/tools/session resources remain available.
- With DeepSeek credit empty, confirm fallback blocks on 402 and does not reroute to Pro. Restore production allowances after the test.

## Railway cloud acceptance

- Service: `openclaw-neo-runtime` in the production environment of the same-named Railway project; live state is stored on a persistent volume. Verify current deployment SHA, config and volume before modifying them.
- The Railway service currently advertises the variable names `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `DEEPSEEK_API_KEY`. This proves name presence **only**; no key values, quotas or free-tier billing eligibility were verified.
- Deploy only after branch tests and normal PR checks. Enable the plugin in the **actual Railway volume-backed OpenClaw config**. Keep gates false until the owner verifies the free project and privacy choice.
- Run a live non-sensitive model response probe, free quota counter readback, test cap-exhaustion fallback, and explicit 402 fail-closed probe. Prove the same OpenClaw agent identity/Brain/tool routes still execute and that a process restart preserves the ledger.
- Do not enable automatic paid retry loops or duplicate gateways/cron jobs.

## Known limitations and blockers

- The OpenClaw plugin's `model_call_started` observation counts model requests. It is not a synchronous, cross-process hard billing control. There may be in-flight requests when a cap is crossed. Google project quotas remain authoritative.
- A provider's 429 may represent a per-minute limit as well as daily exhaustion. OpenClaw's native fallback can handle both; locally we conservatively limit attempts.
- Some sessions pinned to a specific model or external agent harness may not accept the configured fallback chain; test the actual execution mode, not just a config file.
- Cloud and local OpenClaw cannot share an accurate global daily counter without one durable atomic store. Do not claim every local agent gets a separate Google free quota.
- GeminX is a separate product with its own Gemini-first implementation and free tier gates. Both may consume the *same Google project allowance* if using the same project key.
