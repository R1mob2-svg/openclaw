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
# Full memory is archived (not deleted) before reducing the oversized 49KB
# bootstrap to a compact pointer. Fail closed rather than injecting a silent
# 20KB truncation into every Neo turn.
node scripts/neo-memory-boot-bound.mjs
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

# Record the pinned canonical Brain commit only after validating the factory
# rules actually present at that exact GitHub revision. This is boot-reference
# evidence; the later worker tool events prove execution separately.
# If private Brain cannot be verified, keep NEO online but FAIL CLOSED on
# server-signed Digital Ambush completion receipts. Never invent a SHA.
unset OPENCLAW_NEO_BRAIN_SHA
# Resolve private-source access using existing Railway secrets, without printing
# or persisting token values. The bus can use GH_TOKEN while a stale GITHUB_PAT
# breaks NEO's shell tools; both must share the validated identity.
neo_github_source="$(node scripts/neo-github-auth-preflight.mjs 2>/dev/null)" || neo_github_source=""
case "$neo_github_source" in
  GH_TOKEN) export GITHUB_PAT="$GH_TOKEN" ;;
  GEMINX_REPO_ACCESS_TOKEN)
    export GH_TOKEN="$GEMINX_REPO_ACCESS_TOKEN"
    export GITHUB_PAT="$GH_TOKEN"
    ;;
  GITHUB_TOKEN)
    export GH_TOKEN="$GITHUB_TOKEN"
    export GITHUB_PAT="$GH_TOKEN"
    ;;
  GITHUB_PAT) export GH_TOKEN="$GITHUB_PAT" ;;
esac
if [ -n "$neo_github_source" ]; then
  export GIT_ASKPASS="/app/scripts/neo-git-askpass.sh"
  export GIT_TERMINAL_PROMPT=0
  echo "[neo-github] code_access=verified source=$neo_github_source"
else
  echo "[neo-github] code_access=unavailable: no configured token could read geminx-v2"
fi

verified_neo_brain_sha="$(node scripts/neo-verified-brain-ref.mjs 2>/dev/null)" || verified_neo_brain_sha=""
if [ -n "$verified_neo_brain_sha" ]; then
  export OPENCLAW_NEO_BRAIN_SHA="$verified_neo_brain_sha"
  echo "[neo-brain] receipt_reference_verified sha_prefix=$(printf "%.12s" "$verified_neo_brain_sha")"
else
  echo "[neo-brain] receipt_reference_unavailable: fail-closed for signed worker receipts"
fi

# Avoid restarting the entire OpenClaw config parser for unchanged values.
# This is read-only; the native CLI still performs every real write and validates.
neo_config_set() {
  if node --input-type=module - "$@" <<'NEO_CONFIG_MATCH'
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSON5 from "json5";
try {
  const key = process.argv[2];
  const raw = process.argv[3];
  const strict = process.argv.slice(4).includes("--strict-json");
  if (!key || raw === undefined) process.exit(1);
  const state = process.env.OPENCLAW_STATE_DIR || path.join(os.homedir(), ".openclaw");
  const filename = process.env.OPENCLAW_CONFIG_PATH || path.join(state, "openclaw.json");
  const stored = JSON5.parse(fs.readFileSync(filename, "utf8"));
  const actual = key.split(".").reduce((v, k) =>
    v && typeof v === "object" ? v[k] : undefined, stored);
  let desired = raw;
  if (strict) desired = JSON5.parse(raw);
  else if (raw === "true") desired = true;
  else if (raw === "false") desired = false;
  else if (/^-?\d+(?:\.\d+)?$/.test(raw)) desired = Number(raw);
  const normalized = (v) => {
    if (Array.isArray(v)) return v.map(normalized);
    if (v && typeof v === "object") return Object.fromEntries(
      Object.keys(v).sort().map(k => [k, normalized(v[k])]));
    return v;
  };
  process.exit(JSON.stringify(normalized(actual)) ===
    JSON.stringify(normalized(desired)) ? 0 : 1);
} catch {
  process.exit(1);
}
NEO_CONFIG_MATCH
  then
    return 0
  fi
  node openclaw.mjs config set "$@"
}

neo_config_set agents.defaults.workspace "$workspace"
# Founder-approved hourly self-check. Persist through deployments in the canonical startup script.
# No separate scheduler or external send channel; existing gateway and budgets still apply.
neo_config_set agents.defaults.heartbeat.every "1h"
neo_config_set agents.defaults.model.primary "geminx-deepseek/deepseek-flash"
neo_config_set agents.defaults.model.fallbacks "[]" --strict-json
# Founder 2026-11-10: DeepSeek Flash owns all BUILD, tool-use and continuation
# turns. geminx-google-qa is a separate EXPLICIT no-paid-fallback verification
# lane; it refuses to run unless the backend independently confirms Google's
# API project is actually eligible for the free tier and has remaining quota.
# No automatic model swap in the middle of a mutating job.
# Pro remains a separately authorised reasoning escalation.
# Explicit /think overrides remain higher priority.
neo_config_set agents.defaults.thinkingDefault "off"
neo_config_set agents.defaults.models "{\"geminx-deepseek/geminx-auto\":{},\"geminx-deepseek/deepseek-flash\":{},\"geminx-deepseek/deepseek-v4-pro\":{},\"geminx-deepseek/geminx-google-qa\":{}}" --strict-json --replace
# The Railway NEO runtime intentionally carries no OpenAI embedding credential.
# Keep memory_search useful without noisy startup/auth failures by selecting
# OpenClaw's deliberate lexical FTS-only mode instead of the default OpenAI provider.
neo_config_set agents.defaults.memorySearch.provider "none"
# Digital Ambush final-image ownership stays inside the real NEO tool loop.
# Reuse OpenClaw's native Google image_generate provider; no second image factory.
neo_config_set agents.defaults.imageGenerationModel.primary "google/gemini-3.1-flash-image"
neo_config_set agents.defaults.imageGenerationModel.fallbacks "[]" --strict-json
# OpenClaw is a full NEO execution runtime with its own native tool loop.
# GeminX provides authenticated free-first/budgeted model transport, while the canonical Brain
# provides identity/continuity. Do not route the default OpenClaw agent through
# the GeminX-native NEO completion path, because that bypasses OpenClaw exec/files/process/browser tools.
neo_config_set gateway.http.endpoints.chatCompletions.enabled true
# Railway can retain an older literal gateway.auth.token on the persistent volume.
# Make the runtime environment variable the canonical auth source on every boot
# without persisting the secret value itself in openclaw.json.
neo_config_set gateway.auth.mode "token"
neo_config_set gateway.auth.token '{"source":"env","provider":"default","id":"OPENCLAW_GATEWAY_TOKEN"}' --strict-json --replace
neo_config_set agents.defaults.models "{\"geminx-deepseek/geminx-auto\":{},\"geminx-deepseek/deepseek-flash\":{},\"geminx-deepseek/deepseek-v4-pro\":{},\"geminx-deepseek/geminx-google-qa\":{}}" --strict-json --replace

# NEO runtime bounds the effective proxy context to 128k to avoid runaway
# transcript inflation and extended client-held requests (observed HTTP 499).
# The model provider may support larger contexts, but interactive HQ is bounded.
# Compact early while retaining durable Brain and tool receipts on disk.
neo_config_set agents.defaults.contextTokens "128000" --strict-json
neo_config_set agents.defaults.compaction.reserveTokens "32000" --strict-json
neo_config_set agents.defaults.compaction.keepRecentTokens "24000" --strict-json
neo_config_set agents.defaults.compaction.maxActiveTranscriptBytes "\"128kb\"" --strict-json
neo_config_set agents.defaults.compaction.truncateAfterCompaction "true" --strict-json
neo_config_set agents.defaults.compaction.midTurnPrecheck.enabled "true" --strict-json
neo_config_set agents.defaults.compaction.notifyUser "false" --strict-json
# Memory flush is OpenClaw housekeeping, not Founder conversation. Keep it on the raw provider lane.
neo_config_set agents.defaults.compaction.memoryFlush.model "geminx-deepseek/deepseek-flash"

if [ -z "${OPENCLAW_MODEL_PROXY_BASE_URL:-}" ]; then
  echo "OPENCLAW_MODEL_PROXY_BASE_URL is required for the Railway DeepSeek provider bridge" >&2
  exit 1
fi

# Refuse to turn on the new model alias until the SAME existing backend exposes
# its authenticated zero-inference model-core status. No credits are consumed.
node - <<'NODE'
(async () => {
  const base = process.env.OPENCLAW_MODEL_PROXY_BASE_URL?.trim().replace(/\/+$/, "");
  const token = process.env.OPENCLAW_GATEWAY_TOKEN?.trim();
  if (!base || !token) throw new Error("MODEL_CORE_PROXY_CREDENTIALS_MISSING");
  const statusUrl = base.replace(/\/v1$/, "") + "/status";
  let response;
  try {
    response = await fetch(statusUrl, {
      headers: { authorization: "Bearer " + token },
      signal: AbortSignal.timeout(12000)
    });
  } catch (error) {
    // When the backend is deploying or its edge times out, starting OpenClaw
    // still must be possible. Every real model call is separately authenticated
    // by the existing proxy; this never authorizes an inference bypass.
    console.warn("[model-core] backend_status_transport_degraded=true gateway_start_allowed=true inference_unverified=true");
    return;
  }
  // The backend may return HTTP 429 from its edge/rate controls even when
  // authenticated. Do not restart the entire gateway forever on a transient
  // status probe. No LLM inference is used here, and all actual model calls
  // remain authenticated and independently subject to backend spending gates.
  if (response.status === 429) {
    console.warn("[model-core] backend_status_degraded=429 gateway_start_allowed=true inference_unverified=true");
    return;
  }
  // A Railway 502/503/504 during a sibling backend rollout is a temporary
  // dependency outage, not a reason to kill and restart the entire Neo Gateway.
  // No model request is authorized here: the proxy still authenticates and
  // budget-checks every eventual inference call independently.
  if ([502, 503, 504].includes(response.status)) {
    console.warn("[model-core] backend_status_degraded=" + response.status +
      " gateway_start_allowed=true inference_unverified=true");
    return;
  }
  if (!response.ok) throw new Error("MODEL_CORE_BACKEND_STATUS_" + response.status);
  const report = await response.json();
  if (report.schema_version !== "geminx.one-model-core.status.v1" || report.provider_route !== "geminx-auto") {
    throw new Error("MODEL_CORE_BACKEND_ALIAS_UNVERIFIED");
  }
  console.log("[model-core] backend_status_verified=true free_admission=" +
    String(report.google_free_admission) + " deepseek_fallback=" +
    Boolean(report.deepseek_fallback_configured));
})().catch((error) => {
  console.error("[model-core] fail_closed_on_unverified_backend=" + String(error.message || error));
  process.exit(1);
});
NODE

deepseek_provider_json="$(
  node - <<'NODE'
const baseUrl = process.env.OPENCLAW_MODEL_PROXY_BASE_URL?.trim().replace(/\/+$/, "");
if (!baseUrl) process.exit(2);
const common = {
  reasoning: true,
  input: ["text"],
  // Enforce the bounded HQ interactive context; avoid unbounded transcripts
  // repeatedly dominating DeepSeek tool calls and client timeout budgets.
  contextWindow: 128000,
  maxTokens: 8192,
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
    { id: "geminx-auto", name: "Legacy Google-first/DeepSeek core", ...common, reasoning: false },
    { id: "geminx-google-qa", name: "Read-only VERIFIED FREE Google QA / NO paid fallback", ...common, reasoning: false,
      contextWindow: 32768, maxTokens: 4096,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
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
neo_config_set models.providers.geminx-deepseek "$deepseek_provider_json" --strict-json --replace

if [ -n "${RAILWAY_PUBLIC_DOMAIN:-}" ]; then
  neo_config_set gateway.controlUi.allowedOrigins "[\"https://${RAILWAY_PUBLIC_DOMAIN}\"]" --strict-json --replace
fi

# Keep OpenClaw's authenticated agent-first HTTP bridge for direct NEO execution and diagnostics.
# GeminX may delegate bounded work here, but GeminX HQ does not depend on this gateway for its own availability.
neo_config_set gateway.http.endpoints.chatCompletions.enabled "true" --strict-json

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
