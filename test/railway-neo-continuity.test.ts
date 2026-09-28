import { describe, expect, it } from "vitest";
import fs from "node:fs";

describe("Railway NEO continuity bootstrap", () => {
  it("uses the native OpenClaw pre-model Brain hook", () => {
    const script = fs.readFileSync("scripts/railway-neo-runtime-start.sh", "utf8");
    const bootstrap = fs.readFileSync("src/agents/bootstrap-files.ts", "utf8");

    expect(script).toContain("NEO_CANONICAL_CONTINUITY_POINTER_V1");
    expect(script).toContain("native bootstrap-files hook");
    expect(script).not.toContain("neo-brain-bootstrap.mjs");
    expect(bootstrap).toContain("OPENCLAW_NEO_BRAIN_URL");
    expect(bootstrap).toContain("OPENCLAW_NEO_BRAIN_TOKEN");
    expect(bootstrap).toContain("OPENCLAW_NEO_BRAIN_REQUIRED");
    expect(bootstrap).toContain("loadNeoRemoteBrainBootstrapFile");
    expect(bootstrap).toContain("immediately before OpenClaw built model context");
  });

  it("registers the Railway DeepSeek model through the GeminX provider bridge without copying the DeepSeek secret", () => {
    const script = fs.readFileSync("scripts/railway-neo-runtime-start.sh", "utf8");

    expect(script).toContain("OPENCLAW_MODEL_PROXY_BASE_URL");
    expect(script).toContain('models.providers.deepseek');
    expect(script).toContain('"OPENCLAW_GATEWAY_TOKEN"');
    expect(script).toContain('"deepseek-v4-flash"');
    expect(script).toContain('"deepseek-v4-pro"');
    expect(script).toContain('"openai-completions"');
    expect(script).toContain("authHeader: true");
    expect(script).not.toContain("DEEPSEEK_API_KEY");
  });

  it("isolates the GeminX DeepSeek proxy from persisted direct DeepSeek credentials", () => {
    const script = fs.readFileSync("scripts/railway-neo-runtime-start.sh", "utf8");

    expect(script).toContain('agents.defaults.model.primary "geminx-deepseek/deepseek-v4-flash"');
    expect(script).toContain("models.providers.geminx-deepseek");
    expect(script).not.toContain('agents.defaults.model.primary "deepseek/deepseek-v4-flash"');
  });

  it("pins Railway Gateway auth to the runtime token instead of a stale persisted literal", () => {
    const script = fs.readFileSync("scripts/railway-neo-runtime-start.sh", "utf8");

    expect(script).toContain('gateway.auth.mode "token"');
    expect(script).toContain(
      'gateway.auth.token \'{"source":"env","provider":"default","id":"OPENCLAW_GATEWAY_TOKEN"}\' --strict-json --replace',
    );
    expect(script).not.toContain("config set gateway.auth.token \"$OPENCLAW_GATEWAY_TOKEN\"");
  });

  it("exposes the same NEO runtime to trusted GeminX Founder HQ chat", () => {
    const script = fs.readFileSync("scripts/railway-neo-runtime-start.sh", "utf8");

    expect(script).toContain('gateway.http.endpoints.chatCompletions.enabled true');
    expect(script).toContain('agents.defaults.models "{\\\"deepseek/deepseek-v4-flash\\\":{},\\\"deepseek/deepseek-v4-pro\\\":{}}"');
    expect(script).toContain("Founder HQ is another trusted client surface for this same NEO runtime");
  });

  it("exposes the authenticated agent HTTP bridge for GeminX HQ to reuse the same NEO runtime", () => {
    const script = fs.readFileSync("scripts/railway-neo-runtime-start.sh", "utf8");

    expect(script).toContain('gateway.http.endpoints.chatCompletions.enabled "true" --strict-json');
    expect(script).toContain("another trusted operator surface for this exact NEO runtime");
  });

  it("preemptively compacts long Railway NEO sessions before transport or provider overflow", () => {
    const script = fs.readFileSync("scripts/railway-neo-runtime-start.sh", "utf8");

    expect(script).toContain('agents.defaults.compaction.reserveTokens "100000"');
    expect(script).toContain('agents.defaults.compaction.keepRecentTokens "60000"');
    expect(script).toContain('agents.defaults.compaction.maxActiveTranscriptBytes "\\"8mb\\""');
    expect(script).toContain('agents.defaults.compaction.truncateAfterCompaction "true"');
    expect(script).toContain('agents.defaults.compaction.midTurnPrecheck.enabled "true"');
    expect(script).toContain('agents.defaults.compaction.notifyUser "false"');
    expect(script).not.toContain('agents.defaults.compaction.enabled');
  });

  it("keeps Railway NEO memory recall available without requiring an OpenAI embedding key", () => {
    const script = fs.readFileSync("scripts/railway-neo-runtime-start.sh", "utf8");

    expect(script).toContain('agents.defaults.memorySearch.provider "none"');
    expect(script).toContain("lexical FTS-only mode");
    expect(script).not.toContain("OPENAI_API_KEY");
  });

  it("installs the canonical Neo soul and operator rules into the persistent workspace", () => {
    const script = fs.readFileSync("scripts/railway-neo-runtime-start.sh", "utf8");
    const soul = fs.readFileSync("runtime/neo/SOUL.md", "utf8");
    const agents = fs.readFileSync("runtime/neo/AGENTS.md", "utf8");

    expect(script).toContain('install -m 0644 "$profile_dir/SOUL.md" "$soul"');
    expect(script).toContain('install -m 0644 "$profile_dir/AGENTS.md" "$agents"');
    expect(script).toContain("SOUL.before-neo-profile-2026-09-25.md");
    expect(script).toContain("AGENTS.before-neo-operator-2026-09-25.md");
    expect(soul).toContain("real sense of humour");
    expect(soul).toContain("2 a.m.");
    expect(soul).toContain("employee handbook");
    expect(soul).toContain("Natural swearing is allowed");
    expect(soul.trim().split(/\r?\n/)).toHaveLength(1);
    expect(agents).toContain("OWNER OUTCOME FIRST");
    expect(agents).toContain("COMPLETE THE OUTCOME, NOT THE CEREMONY");
    expect(agents).toContain("REPAIR IN THE SAME RUN");
    expect(agents).toContain("PROFILE FIDELITY");
  });
});
