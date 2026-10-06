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

# Repository-managed NEO skills are canonical on every Railway boot. This keeps
# the persistent volume from drifting away from the reviewed GitHub skill set.
managed_skills="$profile_dir/skills"
workspace_skills="$workspace/skills"
mkdir -p "$workspace_skills"
if [ -d "$managed_skills" ]; then
  for skill_dir in "$managed_skills"/*; do
    [ -d "$skill_dir" ] || continue
    skill_name="$(basename "$skill_dir")"
    rm -rf "$workspace_skills/$skill_name"
    cp -R "$skill_dir" "$workspace_skills/$skill_name"
  done
fi

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
node openclaw.mjs config set agents.defaults.model.primary "geminx-deepseek/deepseek-flash"
node openclaw.mjs config set agents.defaults.model.fallbacks "[]" --strict-json
# Keep routine turns non-thinking by default; the shared GeminX proxy raises
# V4.1 Flash effort from the current task. Pro stays registered for explicit,
# evidence-driven escalation instead of generic auth/billing/timeout failover.
# Explicit /think overrides remain higher priority.
node openclaw.mjs config set agents.defaults.thinkingDefault "off"
node openclaw.mjs config set agents.defaults.models "{\"geminx-deepseek/deepseek-flash\":{},\"geminx-deepseek/deepseek-v4-pro\":{}}" --strict-json --replace
# The Railway NEO runtime intentionally carries no OpenAI embedding credential.
# Keep memory_search useful without noisy startup/auth failures by selecting
# OpenClaw's deliberate lexical FTS-only mode instead of the default OpenAI provider.
node openclaw.mjs config set agents.defaults.memorySearch.provider "none"
# OpenClaw is a full NEO execution runtime with its own native tool loop.
# GeminX provides the authenticated DeepSeek transport, while the canonical Brain
# provides identity/continuity. Do not route the default OpenClaw agent through
# the GeminX-native NEO completion path, because that bypasses OpenClaw exec/files/process/browser tools.
node openclaw.mjs config set gateway.http.endpoints.chatCompletions.enabled true
# Railway can retain an older literal gateway.auth.token on the persistent volume.
# Make the runtime environment variable the canonical auth source on every boot
# without persisting the secret value itself in openclaw.json.
node openclaw.mjs config set gateway.auth.mode "token"
node openclaw.mjs config set gateway.auth.token '{"source":"env","provider":"default","id":"OPENCLAW_GATEWAY_TOKEN"}' --strict-json --replace
node openclaw.mjs config set agents.defaults.models "{\"geminx-deepseek/deepseek-flash\":{},\"geminx-deepseek/deepseek-v4-pro\":{}}" --strict-json --replace

# NEO context self-heal profile.
# Compact long active transcripts before transport/model limits are threatened,
# retain a useful recent tail, and re-check pressure between tool turns.
node openclaw.mjs config set agents.defaults.contextTokens "1048576" --strict-json
node openclaw.mjs config set agents.defaults.compaction.reserveTokens "65536" --strict-json
node openclaw.mjs config set agents.defaults.compaction.keepRecentTokens "65536" --strict-json
node openclaw.mjs config set agents.defaults.compaction.maxActiveTranscriptBytes "\"32mb\"" --strict-json
node openclaw.mjs config set agents.defaults.compaction.truncateAfterCompaction "true" --strict-json
node openclaw.mjs config set agents.defaults.compaction.midTurnPrecheck.enabled "true" --strict-json
node openclaw.mjs config set agents.defaults.compaction.notifyUser "false" --strict-json
# Memory flush is OpenClaw housekeeping, not Founder conversation. Keep it on the raw provider lane.
node openclaw.mjs config set agents.defaults.compaction.memoryFlush.model "geminx-deepseek/deepseek-flash"

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
  // DeepSeek V4.1 Flash and V4 Pro expose a native 1,048,576-token window.
  // Keep OpenClaw aligned with the provider so Cloud NEO can use the full context
  // while compaction still reserves a bounded tail before the true ceiling.
  contextWindow: 1048576,
  maxTokens: 32000,
  cost: { input: 0.30, output: 1.20, cacheRead: 0.006, cacheWrite: 0 },
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
    { id: "deepseek-flash", name: "DeepSeek V4.1 Flash", ...common },
    {
      id: "deepseek-v4-pro",
      name: "DeepSeek V4 Pro",
      ...common,
      cost: { input: 1.32, output: 3.96, cacheRead: 0.044, cacheWrite: 0 }
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

# Keep OpenClaw's authenticated agent-first HTTP bridge for direct NEO execution and diagnostics.
# GeminX may delegate bounded work here, but GeminX HQ does not depend on this gateway for its own availability.
node openclaw.mjs config set gateway.http.endpoints.chatCompletions.enabled "true" --strict-json

# Enable OpenClaw's bundled authenticated admin HTTP RPC for trusted GeminX/Cloud AG
# health checks and bounded gateway restart requests. This reuses the existing
# gateway bearer auth and does not expose an unauthenticated repair surface.
node openclaw.mjs plugins enable admin-http-rpc

node openclaw.mjs config validate

# GitHub issue bus is a durable coordination ingress for NEO. Run it as a
# sidecar in the same container so AGENT_MESSAGE_BUS envelopes are actually
# materialized into the persistent OpenClaw runtime instead of sitting unread.
node scripts/poll-agent-message-bus.mjs &
agent_bus_pid=$!
trap 'kill "$agent_bus_pid" 2>/dev/null || true' EXIT INT TERM

node openclaw.mjs gateway --allow-unconfigured --bind lan --port 8080
