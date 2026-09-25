#!/bin/sh
set -eu

workspace="${OPENCLAW_WORKSPACE_DIR:-/home/node/.openclaw/workspace}"
mkdir -p "$workspace" "$workspace/memory"

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
node openclaw.mjs config set agents.defaults.model.primary "deepseek/deepseek-v4-flash"
node openclaw.mjs config set agents.defaults.model.fallbacks "[]" --strict-json
node openclaw.mjs config set agents.defaults.models "{\"deepseek/deepseek-v4-flash\":{}}" --strict-json --replace
node openclaw.mjs config validate

exec node openclaw.mjs gateway --allow-unconfigured --bind lan --port 8080
