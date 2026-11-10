import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildQaRequest } from "./neo-google-free-qa.mjs";

test("Google QA is read-only, evidence-bound and never requests paid DeepSeek", () => {
  const r = buildQaRequest("Verified business evidence, screenshot SHA and browser pass results.");
  assert.equal(r.model, "geminx-google-qa");
  assert.equal(r.stream, false);
  assert.equal(r.temperature, 0);
  assert.equal(r.messages[1].role, "user");
  assert.ok(r.messages[0].content.includes("Never claim to have visited a URL"));
  assert.equal("tools" in r, false);
});
test("Google-only verification checks authenticated free-tier status before inference", () => {
  const source = readFileSync("scripts/neo-google-free-qa.mjs", "utf8");
  assert.ok(source.includes('google_free_admission !== "ready"'));
  assert.ok(source.includes('snapshot.google_free_requests_remaining < 1'));
  assert.ok(source.includes('model: "geminx-google-qa"'));
  assert.ok(source.includes("GOOGLE_QA_PROVIDER_MISMATCH"));
  assert.ok(!source.includes("DEEPSEEK_API_KEY"));
});
