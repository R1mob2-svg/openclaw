#!/bin/sh
set -eu

workspace="${OPENCLAW_WORKSPACE_DIR:-/home/node/.openclaw/workspace}"
mkdir -p "$workspace" "$workspace/memory"

profile_dir="/app/runtime/neo"
soul="$workspace/SOUL.md"
agents="$workspace/AGENTS.md"
soul_backup="$workspace/memory/SOUL.before-neo-profile-2026-09-25.md"
agents_backup="$workspace/memory/AGENTS.before-neo-operator-2026-09-25.md"

# Preserve the pre-cutover runtime profile once, then make the repository profile
# canonical on every boot. This prevents an old persistent Railway volume from
# silently resurrecting stale personality/operator instructions.
if [ -s "$soul" ] && [ ! -e "$soul_backup" ]; then
  cp "$soul" "$soul_backup"
fi
if [ -s "$agents" ] && [ ! -e "$agents_backup" ]; then
  cp "$agents" "$agents_backup"
fi
install -m 0644 "$profile_dir/SOUL.md" "$soul"
install -m 0644 "$profile_dir/AGENTS.md" "$agents"

identity="$workspace/IDENTITY.md"
if [ ! -s "$identity" ]; then
  cat > "$identity" <<'EOF'
# NEO

Original NEO lineage.
GeminX is the canonical execution platform.
The private GitHub Agent Brain is the canonical continuity authority.
EOF
fi

memory="$workspace/MEMORY.md"
touch "$memory"
if ! grep -q "NEO_CANONICAL_CONTINUITY_POINTER_V1" "$memory"; then
  cat >> "$memory" <<'EOF'

## NEO canonical continuity pointer
NEO_CANONICAL_CONTINUITY_POINTER_V1

- NEO is the durable founder-facing agent identity.
- GeminX is the canonical execution platform/runtime.
- OpenClaw is a runtime home for the same NEO lineage, never a separate clone.
- The private GitHub Agent Brain is the continuity authority.
- OpenClaw's native bootstrap-files hook must attach the current Brain snapshot before the first model invocation in a fresh default session.
- Receipt-driven runtime truth outranks stale summaries.
EOF
fi

node openclaw.mjs config set agents.defaults.workspace "$workspace"
node openclaw.mjs config set agents.defaults.heartbeat.every "0m"
node openclaw.mjs config set agents.defaults.model.primary "geminx-deepseek/deepseek-v4-flash"
node openclaw.mjs config set agents.defaults.model.fallbacks "[]" --strict-json
node openclaw.mjs config set agents.defaults.models "{\"geminx-deepseek/deepseek-v4-flash\":{}}" --strict-json --replace
# The Railway NEO runtime intentionally carries no OpenAI embedding credential.
# Keep memory_search useful without noisy startup/auth failures by selecting
# OpenClaw's deliberate lexical FTS-only mode instead of the default OpenAI provider.
node openclaw.mjs config set agents.defaults.memorySearch.provider "none"
# Founder HQ is another trusted client surface for this same NEO runtime.
# Enable OpenClaw's native agent HTTP compatibility endpoint so GeminX can
# share NEO identity/session continuity instead of running a separate clone.
node openclaw.mjs config set gateway.http.endpoints.chatCompletions.enabled true
# Railway can retain an older literal gateway.auth.token on the persistent volume.
# Make the runtime environment variable the canonical auth source on every boot
# without persisting the secret value itself in openclaw.json.
node openclaw.mjs config set gateway.auth.mode "token"
node openclaw.mjs config set gateway.auth.token '{"source":"env","provider":"default","id":"OPENCLAW_GATEWAY_TOKEN"}' --strict-json --replace
node openclaw.mjs config set agents.defaults.models "{\"geminx-deepseek/deepseek-v4-flash\":{},\"geminx-deepseek/deepseek-v4-pro\":{}}" --strict-json --replace

# NEO context self-heal profile.
# Compact long active transcripts before transport/model limits are threatened,
# retain a useful recent tail, and re-check pressure between tool turns.
node openclaw.mjs config set agents.defaults.compaction.reserveTokens "100000" --strict-json
node openclaw.mjs config set agents.defaults.compaction.keepRecentTokens "60000" --strict-json
node openclaw.mjs config set agents.defaults.compaction.maxActiveTranscriptBytes "\"8mb\"" --strict-json
node openclaw.mjs config set agents.defaults.compaction.truncateAfterCompaction "true" --strict-json
node openclaw.mjs config set agents.defaults.compaction.midTurnPrecheck.enabled "true" --strict-json
node openclaw.mjs config set agents.defaults.compaction.notifyUser "false" --strict-json

if [ -z "${OPENCLAW_MODEL_PROXY_BASE_URL:-}" ]; then
  echo "OPENCLAW_MODEL_PROXY_BASE_URL is required for the Railway DeepSeek provider bridge" >&2
  exit 1
fi

deepseek_provider_json="$(
  node - <<'NODE'
const baseUrl = process.env.OPENCLAW_MODEL_PROXY_BASE_URL?.trim().replace(/\/+$/, "");
if (!baseUrl) process.exit(2);
const common = {
  reasoning: true,
  input: ["text"],
  contextWindow: 1000000,
  maxTokens: 384000,
  cost: { input: 0.14, output: 0.28, cacheRead: 0.028, cacheWrite: 0 },
  compat: {
    supportsUsageInStreaming: true,
    supportsReasoningEffort: true,
    maxTokensField: "max_tokens"
  }
};
process.stdout.write(JSON.stringify({
  baseUrl,
  apiKey: { source: "env", provider: "default", id: "OPENCLAW_GATEWAY_TOKEN" },
  // Normal interactive turns can let the OpenAI-compatible client derive auth
  // from apiKey, but compaction resolves request credentials separately through
  // ModelRegistry. Make the shared GeminX proxy bearer explicit for both paths.
  authHeader: true,
  api: "openai-completions",
  models: [
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", ...common },
    {
      id: "deepseek-v4-pro",
      name: "DeepSeek V4 Pro",
      ...common,
      cost: { input: 1.74, output: 3.48, cacheRead: 0.145, cacheWrite: 0 }
    }
  ]
}));
NODE
)"
# Use a dedicated provider namespace for the GeminX-authenticated DeepSeek proxy.
# The generic "deepseek" provider may have a persisted direct DeepSeek credential
# in AuthStorage; AuthStorage outranks models.json apiKey resolution and would send
# that provider key to the GeminX proxy instead of the shared proxy bearer.
node openclaw.mjs config set models.providers.geminx-deepseek "$deepseek_provider_json" --strict-json --replace

if [ -n "${RAILWAY_PUBLIC_DOMAIN:-}" ]; then
  node openclaw.mjs config set gateway.controlUi.allowedOrigins "[\"https://${RAILWAY_PUBLIC_DOMAIN}\"]" --strict-json --replace
fi

# GeminX Founder HQ is another trusted operator surface for this exact NEO runtime.
# Expose OpenClaw's authenticated agent-first HTTP bridge so HQ can reuse the same
# agent/session instead of running a second NEO personality beside it.
node openclaw.mjs config set gateway.http.endpoints.chatCompletions.enabled "true" --strict-json

# Enable OpenClaw's bundled authenticated admin HTTP RPC for trusted GeminX/Cloud AG
# health checks and bounded gateway restart requests. This reuses the existing
# gateway bearer auth and does not expose an unauthenticated repair surface.
node openclaw.mjs plugins enable admin-http-rpc

node openclaw.mjs config validate

exec node openclaw.mjs gateway --allow-unconfigured --bind lan --port 8080
