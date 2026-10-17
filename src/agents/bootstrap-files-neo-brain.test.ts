import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeTempWorkspace } from "../test-helpers/workspace.js";
import { resolveBootstrapFilesForRun } from "./bootstrap-files.js";

describe("NEO remote Brain bootstrap", () => {
  const originalUrl = process.env.OPENCLAW_NEO_BRAIN_URL;
  const originalToken = process.env.OPENCLAW_NEO_BRAIN_TOKEN;
  const originalRequired = process.env.OPENCLAW_NEO_BRAIN_REQUIRED;
  const originalGithubToken = process.env.GITHUB_TOKEN;
  const originalGithubFallback = process.env.OPENCLAW_NEO_GITHUB_FALLBACK_ENABLED;

  beforeEach(() => {
    process.env.OPENCLAW_NEO_BRAIN_URL = "https://geminx.example.test/api/v1/neo/brain-bootstrap";
    process.env.OPENCLAW_NEO_BRAIN_TOKEN = "test-bridge-token";
    process.env.OPENCLAW_NEO_BRAIN_REQUIRED = "1";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalUrl === undefined) delete process.env.OPENCLAW_NEO_BRAIN_URL;
    else process.env.OPENCLAW_NEO_BRAIN_URL = originalUrl;
    if (originalToken === undefined) delete process.env.OPENCLAW_NEO_BRAIN_TOKEN;
    else process.env.OPENCLAW_NEO_BRAIN_TOKEN = originalToken;
    if (originalRequired === undefined) delete process.env.OPENCLAW_NEO_BRAIN_REQUIRED;
    else process.env.OPENCLAW_NEO_BRAIN_REQUIRED = originalRequired;
    if (originalGithubToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = originalGithubToken;
    if (originalGithubFallback === undefined) delete process.env.OPENCLAW_NEO_GITHUB_FALLBACK_ENABLED;
    else process.env.OPENCLAW_NEO_GITHUB_FALLBACK_ENABLED = originalGithubFallback;
  });

  it("fetches the canonical Brain before default-session model context is built", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("https://geminx.example.test/api/v1/neo/brain-bootstrap");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-bridge-token");
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            status: "attached",
            continuity: "ORIGINAL_NEO_CANONICAL_GITHUB_BRAIN",
            generated_at: "2026-09-25T10:00:00.000Z",
            sources: [{ path: "Agents/NEO/ACTIVE_STATE.md" }],
            context: "NEO ACTIVE: canonical fresh Brain state"
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const workspaceDir = await makeTempWorkspace("openclaw-neo-brain-");
    const files = await resolveBootstrapFilesForRun({ workspaceDir, runKind: "default" });
    const remote = files.find((file) =>
      file.path === path.join(workspaceDir, ".neo-remote-brain", "MEMORY.md")
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(remote?.name).toBe("MEMORY.md");
    expect(remote?.content).toContain("REMOTE_BRAIN_STATUS=ATTACHED");
    expect(remote?.content).toContain("ORIGINAL_NEO_CANONICAL_GITHUB_BRAIN");
    expect(remote?.content).toContain("NEO ACTIVE: canonical fresh Brain state");
  });

  it("fails visibly instead of pretending continuity when a required Brain fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 503 })));

    const workspaceDir = await makeTempWorkspace("openclaw-neo-brain-fail-");
    const files = await resolveBootstrapFilesForRun({ workspaceDir, runKind: "default" });
    const remote = files.find((file) =>
      file.path === path.join(workspaceDir, ".neo-remote-brain", "MEMORY.md")
    );

    expect(remote?.content).toContain("REMOTE_BRAIN_STATUS=UNAVAILABLE");
    expect(remote?.content).toContain("Newton is the existing architect/reviewer");
    expect(remote?.content).toContain("PAPER-ONLY trading laboratory");
    expect(remote?.content).toContain("Do not ask the founder for the platform, assets or goals again");
    expect(remote?.content).toContain("fresh status is UNVERIFIED");

    expect(remote?.content).toContain("Do not claim this OpenClaw session is freshly synchronized");
  });

  it("recovers a pinned canonical GitHub Brain snapshot after the GeminX relay returns 503", async () => {
    const sha = "a".repeat(40);
    process.env.GITHUB_TOKEN = "fake-github-token";
    process.env.OPENCLAW_NEO_GITHUB_FALLBACK_ENABLED = "true";
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://geminx.example.test/")) {
        return new Response("temporarily unavailable", { status: 503 });
      }
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer fake-github-token");
      if (url.endsWith("/commits/main")) return Response.json({ sha });
      if (url.includes("/contents/") && url.endsWith("?ref=" + sha)) {
        const file = decodeURIComponent(url.split("/contents/")[1].split("?")[0]);
        return Response.json({
          encoding: "base64",
          content: Buffer.from("CANONICAL_SOURCE=" + file).toString("base64")
        });
      }
      return new Response("wrong URL", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const workspaceDir = await makeTempWorkspace("openclaw-neo-github-fallback-");
    const files = await resolveBootstrapFilesForRun({ workspaceDir, runKind: "default" });
    const remote = files.find((file) => file.path === path.join(workspaceDir, ".neo-remote-brain", "MEMORY.md"));
    expect(remote?.content).toContain("REMOTE_BRAIN_STATUS=ATTACHED");
    expect(remote?.content).toContain("BRIDGE_STATUS=UNAVAILABLE");
    expect(remote?.content).toContain("VERIFIED_GIT_REVISION=" + sha);
    expect(remote?.content).toContain("Agents/Newton/README.md");
    expect(remote?.content).toContain("Trading/MULTI_AGENT_PAPER_LAB_2026-10-07.md");
    expect(remote?.content).toContain("NOT a live trading execution");
    expect(fetchMock).toHaveBeenCalledTimes(7);
  });

  it("never treats missing direct canonical sources as a verified Brain", async () => {
    process.env.GITHUB_TOKEN = "fake-github-token";
    process.env.OPENCLAW_NEO_GITHUB_FALLBACK_ENABLED = "true";
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith("https://geminx.example.test")) return new Response("outage", { status: 503 });
      if (url.endsWith("/commits/main")) return Response.json({ sha: "b".repeat(40) });
      if (url.includes("Agents/Newton/README.md")) return new Response("missing", { status: 404 });
      if (url.includes("/contents/")) return Response.json({ encoding: "base64", content: Buffer.from("valid").toString("base64") });
      return new Response("unexpected", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const workspaceDir = await makeTempWorkspace("openclaw-neo-github-missing-");
    const files = await resolveBootstrapFilesForRun({ workspaceDir, runKind: "default" });
    const remote = files.find((file) => file.path === path.join(workspaceDir, ".neo-remote-brain", "MEMORY.md"));
    expect(remote?.content).toContain("REMOTE_BRAIN_STATUS=UNAVAILABLE");
    expect(remote?.content).toContain("fresh status is UNVERIFIED");
    expect(remote?.content).not.toContain("VERIFIED_GIT_REVISION");
  });

  it("does not attach the founder Brain to heartbeat background runs", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const workspaceDir = await makeTempWorkspace("openclaw-neo-brain-heartbeat-");
    await resolveBootstrapFilesForRun({ workspaceDir, runKind: "heartbeat", contextMode: "lightweight" });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
