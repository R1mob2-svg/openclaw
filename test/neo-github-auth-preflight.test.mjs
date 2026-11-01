import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { selectNeoGithubSource } from "../scripts/neo-github-auth-preflight.mjs";

describe("Cloud Neo GitHub source access preflight", () => {
  it("reuses GH_TOKEN rather than a dead GITHUB_PAT when repo contents are readable", async () => {
    const attempted = [];
    const source = await selectNeoGithubSource({
      environment: { GH_TOKEN: "working", GITHUB_PAT: "dead" },
      fetcher: async (_url, opts) => {
        attempted.push(opts.headers.Authorization);
        return { ok: opts.headers.Authorization === "Bearer working" };
      }
    });
    assert.equal(source, "GH_TOKEN");
    assert.deepEqual(attempted, ["Bearer working"]);
  });
  it("continues to the next candidate when the first credential is invalid", async () => {
    const source = await selectNeoGithubSource({
      environment: { GH_TOKEN: "dead", GITHUB_TOKEN: "valid" },
      fetcher: async (_url, opts) => ({ ok: opts.headers.Authorization === "Bearer valid" })
    });
    assert.equal(source, "GITHUB_TOKEN");
  });
  it("fails closed when none can read the private source", async () => {
    const source = await selectNeoGithubSource({
      environment: { GH_TOKEN: "expired", GITHUB_PAT: "invalid" },
      fetcher: async () => ({ ok: false })
    });
    assert.equal(source, null);
  });
});
