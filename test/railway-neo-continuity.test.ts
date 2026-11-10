import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

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

  it("registers Railway models through the GeminX provider without copying the DeepSeek secret", () => {
    const script = fs.readFileSync("scripts/railway-neo-runtime-start.sh", "utf8");

    expect(script).toContain("OPENCLAW_MODEL_PROXY_BASE_URL");
    expect(script).toContain('models.providers.geminx-deepseek');
    expect(script).toContain('"OPENCLAW_GATEWAY_TOKEN"');
    expect(script).toContain('"deepseek-flash"');
    expect(script).toContain('"deepseek-v4-pro"');
    expect(script).toContain('"openai-completions"');
    expect(script).toContain("authHeader: true");
    expect(script).not.toContain("DEEPSEEK_API_KEY");
  });

  it("routes free-first GeminX with bounded DeepSeek fallback and no persisted direct DeepSeek credentials", () => {
    const script = fs.readFileSync("scripts/railway-neo-runtime-start.sh", "utf8");

    expect(script).toContain('agents.defaults.model.primary "geminx-deepseek/deepseek-flash"');
    expect(script).toContain('agents.defaults.model.fallbacks "[]" --strict-json');
    expect(script).toContain('agents.defaults.thinkingDefault "off"');
    expect(script).toContain("models.providers.geminx-deepseek");
    expect(script).toContain("geminx-google-qa");
    expect(script).toContain("node scripts/neo-memory-boot-bound.mjs");
    expect(script).not.toContain('agents.defaults.model.primary "deepseek/deepseek-v4-flash"');
    expect(script).not.toContain('geminx-native-neo');
    expect(script).toContain('agents.defaults.compaction.memoryFlush.model "geminx-deepseek/deepseek-flash"');
  });

  it("survives a transient no-inference model-proxy 429 without bypassing auth or model spend guards", () => {
    const script = fs.readFileSync("scripts/railway-neo-runtime-start.sh", "utf8");
    expect(script).toContain("response.status === 429");
    expect(script).toContain("backend_status_degraded=429");
    expect(script).toContain("backend_status_transport_degraded=true");
    expect(script).toContain("signal: AbortSignal.timeout(12000)");
    expect(script).toContain("inference_unverified=true");
    expect(script).toContain('if (!response.ok) throw new Error("MODEL_CORE_BACKEND_STATUS_" + response.status);');
    expect(script).toContain('schema_version !== "geminx.one-model-core.status.v1"');
    expect(script).toContain("OPENCLAW_GATEWAY_TOKEN");
  });

  it("mechanically checks no-inference startup probe: 429/timeout start safely, 401/bad alias refuse", () => {
    const script = fs.readFileSync("scripts/railway-neo-runtime-start.sh", "utf8");
    const snippet = /node - <<'NODE'\n([\s\\S]*?)\nNODE/.exec(script)?.[1];
    expect(snippet).toBeTruthy();
    const run = (mockFetch: string) => spawnSync(process.execPath, ["-"], {
      input: `globalThis.fetch = ${mockFetch};\n${snippet}\n`,
      encoding: "utf8",
      env: {
        ...process.env,
        OPENCLAW_MODEL_PROXY_BASE_URL: "https://model-proxy.test/v1",
        OPENCLAW_GATEWAY_TOKEN: "test-only-secret-not-a-real-key"
      }
    });
    const throttle = run("async () => ({ status: 429, ok: false })");
    expect(throttle.status).toBe(0);
    expect(throttle.stderr).toContain("backend_status_degraded=429");

    const timeout = run('async () => { throw new Error("The operation was aborted due to timeout"); }');
    expect(timeout.status).toBe(0);
    expect(timeout.stderr).toContain("backend_status_transport_degraded=true");

    const unauthorized = run("async () => ({ status: 401, ok: false })");
    expect(unauthorized.status).toBe(1);
    expect(unauthorized.stderr).toContain("MODEL_CORE_BACKEND_STATUS_401");

    const badAlias = run('async () => ({ status: 200, ok: true, json: async () => ({ schema_version: "wrong", provider_route: "not-neo" }) })');
    expect(badAlias.status).toBe(1);
    expect(badAlias.stderr).toContain("MODEL_CORE_BACKEND_ALIAS_UNVERIFIED");

    const good = run('async () => ({ status: 200, ok: true, json: async () => ({ schema_version: "geminx.one-model-core.status.v1", provider_route: "geminx-auto", google_free_admission: "unverified_free_billing", deepseek_fallback_configured: true }) })');
    expect(good.status).toBe(0);
    expect(good.stdout).toContain("backend_status_verified=true");
  });

  it("pins Railway Gateway auth to the runtime token instead of a stale persisted literal", () => {
    const script = fs.readFileSync("scripts/railway-neo-runtime-start.sh", "utf8");

    expect(script).toContain('gateway.auth.mode "token"');
    expect(script).toContain(
      'gateway.auth.token \'{"source":"env","provider":"default","id":"OPENCLAW_GATEWAY_TOKEN"}\' --strict-json --replace',
    );
    expect(script).not.toContain("config set gateway.auth.token \"$OPENCLAW_GATEWAY_TOKEN\"");
  });

  it("keeps OpenClaw as a full NEO runtime instead of bypassing its native tool loop", () => {
    const script = fs.readFileSync("scripts/railway-neo-runtime-start.sh", "utf8");

    expect(script).toContain('gateway.http.endpoints.chatCompletions.enabled true');
    expect(script).toContain('agents.defaults.model.primary "geminx-deepseek/deepseek-flash"');
    expect(script).toContain("geminx-deepseek/geminx-google-qa");
    expect(script).toContain("OpenClaw is a full NEO execution runtime with its own native tool loop");
    expect(script).toContain("DeepSeek Flash owns all BUILD");
    expect(script).not.toContain("geminx-native-neo");
  });

  it("keeps the authenticated OpenClaw agent HTTP bridge without making HQ depend on it", () => {
    const script = fs.readFileSync("scripts/railway-neo-runtime-start.sh", "utf8");

    expect(script).toContain('gateway.http.endpoints.chatCompletions.enabled "true" --strict-json');
    expect(script).toContain("OpenClaw's authenticated agent-first HTTP bridge for direct NEO execution and diagnostics");
    expect(script).toContain("GeminX may delegate bounded work here");
    expect(script).toContain("GeminX HQ does not depend on this gateway for its own availability");
  });

  it("preemptively compacts long Railway NEO sessions before transport or provider overflow", () => {
    const script = fs.readFileSync("scripts/railway-neo-runtime-start.sh", "utf8");

    expect(script).toContain('agents.defaults.contextTokens "1000000"');
    expect(script).toContain('agents.defaults.compaction.reserveTokens "24000"');
    expect(script).toContain('agents.defaults.compaction.keepRecentTokens "8000"');
    expect(script).toContain('agents.defaults.compaction.maxActiveTranscriptBytes "\\"192kb\\""');
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
    expect(agents).toContain("DeepSeek V4.1 Flash as the default");
    expect(agents).toContain("geminx-deepseek/deepseek-v4-pro");
    expect(agents).toContain("Do not treat transport, auth, timeout, rate-limit or billing failure as evidence");
  });
  it("pins supported Google GA image model names instead of retired June 2026 previews", () => {
    const script = fs.readFileSync("scripts/railway-neo-runtime-start.sh", "utf8");
    const plugin = fs.readFileSync("extensions/google/index.ts", "utf8");
    const provider = fs.readFileSync("extensions/google/image-generation-provider.ts", "utf8");
    expect(script).toContain('imageGenerationModel.primary "google/gemini-3.1-flash-image"');
    expect(script).toContain('agents.defaults.imageGenerationModel.fallbacks "[]" --strict-json');
    expect(plugin).toContain('defaultModel: "gemini-3.1-flash-image"');
    expect(provider).toContain('const DEFAULT_GOOGLE_IMAGE_MODEL = "gemini-3.1-flash-image"');
    for (const source of [script, plugin, provider]) {
      expect(source).not.toContain("gemini-3.1-flash-image-preview");
      expect(source).not.toContain("gemini-3-pro-image-preview");
    }
  });

});
