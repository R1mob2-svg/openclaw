import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { test } from "node:test";
import { verifiedNeoBrainRef } from "./neo-verified-brain-ref.mjs";
const sha = "e".repeat(40);
const body = "# NEO Boot Index\nDigital Ambush Mockup Factory: exactly ONE unique private preview, 1440x900.";
const success = (payload) => ({ ok: true, status: 200, json: async () => payload });
function mockFetch(url, options) {
  assert.match(url, /^https:\/\/api\.github\.com\/repos\/R1mob2-svg\/global-agent-brain\//);
  assert.equal(options.headers.authorization, "Bearer mocked-token");
  assert.equal(options.redirect, "error");
  if (url.endsWith("/git/ref/heads/main")) return Promise.resolve(success({ object: { type: "commit", sha } }));
  assert.ok(url.endsWith("?ref=" + sha));
  return Promise.resolve(success({ encoding: "base64", content: Buffer.from(body).toString("base64") }));
}
test("reports real SHA only after same-commit NEO boot contract verification", async () => {
  assert.equal(await verifiedNeoBrainRef({ token: "mocked-token", fetcher: mockFetch }), sha);
});
test("requires a GitHub token before an API call", async () => {
  await assert.rejects(verifiedNeoBrainRef({ token: "", fetcher: () => { throw Error("network called"); } }), /GITHUB_TOKEN_UNAVAILABLE/);
});
test("rejects a mismatched/rewritten boot document", async () => {
  const altered = async (url, opts) => url.endsWith("/git/ref/heads/main")
    ? mockFetch(url, opts)
    : success({ encoding: "base64", content: Buffer.from("# NEO Boot Index\nNo factory contract").toString("base64") });
  await assert.rejects(verifiedNeoBrainRef({ token: "mocked-token", fetcher: altered }), /BOOT_CONTRACT_MISMATCH/);
});
test("rejects an unpinned or forged GitHub ref", async () => {
  await assert.rejects(verifiedNeoBrainRef({
    token: "mocked-token", fetcher: async () => success({ object: { type: "tag", sha } })
  }), /REF_INVALID/);
});
