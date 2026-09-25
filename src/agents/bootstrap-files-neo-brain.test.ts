import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeTempWorkspace } from "../test-helpers/workspace.js";
import { resolveBootstrapFilesForRun } from "./bootstrap-files.js";

describe("NEO remote Brain bootstrap", () => {
  const originalUrl = process.env.OPENCLAW_NEO_BRAIN_URL;
  const originalToken = process.env.OPENCLAW_NEO_BRAIN_TOKEN;
  const originalRequired = process.env.OPENCLAW_NEO_BRAIN_REQUIRED;

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
    expect(remote?.content).toContain("Do not claim this OpenClaw session is freshly synchronized");
  });

  it("does not attach the founder Brain to heartbeat background runs", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const workspaceDir = await makeTempWorkspace("openclaw-neo-brain-heartbeat-");
    await resolveBootstrapFilesForRun({ workspaceDir, runKind: "heartbeat", contextMode: "lightweight" });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
