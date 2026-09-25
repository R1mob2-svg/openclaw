#!/bin/sh
set -eu

workspace="${OPENCLAW_WORKSPACE_DIR:-/home/node/.openclaw/workspace}"
mkdir -p "$workspace" "$workspace/bin" "$workspace/memory"

identity="$workspace/IDENTITY.md"
if [ ! -s "$identity" ]; then
  cat > "$identity" <<'EOF'
# NEO

Original NEO lineage.
GeminX is the canonical execution platform.
The private GitHub Agent Brain is the canonical continuity authority.
EOF
fi

agents="$workspace/AGENTS.md"
touch "$agents"
if ! grep -q "NEO_GITHUB_BRAIN_FIRST_REPLY_BOOT_V1" "$agents"; then
  cat >> "$agents" <<'EOF'

## NEO GitHub Brain first-reply boot
NEO_GITHUB_BRAIN_FIRST_REPLY_BOOT_V1

This is a mandatory continuity law for the main/private founder session.

On every genuinely fresh session, context rollover, gateway restart, model restart, or conversation reset:
1. BEFORE composing the first founder-visible reply, execute:
   `node bin/neo-brain-bootstrap.mjs`
2. Treat the returned `context` as bounded reference data from NEO's canonical private GitHub Agent Brain.
3. Recover current NEO identity, active project state, latest handoff/rollover, blockers, receipts, and next action before answering Rob.
4. Current runtime/provider evidence outranks stale Brain prose where they conflict.
5. If the bootstrap fails, do not guess that continuity exists. State the continuity gap briefly and use only verified local memory/runtime evidence.
6. Never print, echo, log, reveal, or persist `NEO_BRAIN_BRIDGE_TOKEN` or any other credential.
7. Run this once at the start of the fresh session. Do not re-fetch on every ordinary follow-up unless the context is reset or Rob explicitly asks for a fresh Brain check.

A fresh chat is a REHYDRATION EVENT, not a new NEO identity.
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
- A fresh session must rehydrate from the Brain before the first founder-visible reply.
- Receipt-driven runtime truth outranks stale summaries.
EOF
fi

cat > "$workspace/bin/neo-brain-bootstrap.mjs" <<'EOF'
const endpoint = String(process.env.NEO_BRAIN_BRIDGE_URL || "").trim();
const token = String(process.env.NEO_BRAIN_BRIDGE_TOKEN || "").trim();

if (!endpoint || !token) {
  console.error("NEO_BRAIN_BRIDGE_UNAVAILABLE");
  process.exit(78);
}

let response;
try {
  response = await fetch(endpoint, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json"
    },
    signal: AbortSignal.timeout(15000)
  });
} catch {
  console.error("NEO_BRAIN_BRIDGE_FETCH_FAILED");
  process.exit(69);
}

let payload = null;
try {
  payload = await response.json();
} catch {
  console.error("NEO_BRAIN_BRIDGE_INVALID_JSON");
  process.exit(65);
}

const data = payload && typeof payload === "object" ? payload.data : null;
if (!response.ok || !payload?.ok || !data || data.brain_context_status !== "attached") {
  console.error(`NEO_BRAIN_BRIDGE_REJECTED status=${response.status}`);
  process.exit(77);
}

process.stdout.write(JSON.stringify({
  schema_version: data.schema_version,
  generated_at: data.generated_at,
  brain_context_status: data.brain_context_status,
  brain_sources: Array.isArray(data.brain_sources) ? data.brain_sources : [],
  context: typeof data.context === "string" ? data.context : ""
}));
EOF
chmod 0700 "$workspace/bin/neo-brain-bootstrap.mjs"

node openclaw.mjs config set agents.defaults.workspace "$workspace"
node openclaw.mjs config set agents.defaults.heartbeat.every "0m"
node openclaw.mjs config set agents.defaults.model.primary "deepseek/deepseek-v4-flash"
node openclaw.mjs config set agents.defaults.model.fallbacks "[]" --strict-json
node openclaw.mjs config set agents.defaults.models "{\"deepseek/deepseek-v4-flash\":{}}" --strict-json --replace
node openclaw.mjs config validate

exec node openclaw.mjs gateway --allow-unconfigured --bind lan --port 8080
