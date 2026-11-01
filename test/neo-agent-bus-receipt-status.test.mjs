import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyNeoBusReply } from "../scripts/neo-agent-bus-receipt-status.mjs";

describe("Cloud Neo bus no-false-green classification", () => {
  it("does not turn a blocked narrative or empty answer into completion", () => {
    assert.equal(classifyNeoBusReply("I cannot clone: GitHub returned 401."), "BLOCKED");
    assert.equal(classifyNeoBusReply("FINAL STATUS: **BLOCKED WITH EXACT CAUSE AND RECEIPT**"), "BLOCKED");
    assert.equal(classifyNeoBusReply("STATUS: FAILED\nError: bad credentials"), "FAILED");
    assert.equal(classifyNeoBusReply("I'll check and get back to you."), "BLOCKED");
    assert.equal(classifyNeoBusReply(""), "BLOCKED");
  });
  it("requires an explicit success marker and evidence pointer", () => {
    assert.equal(classifyNeoBusReply("FINAL STATUS: COMPLETED"), "BLOCKED");
    assert.equal(classifyNeoBusReply("FINAL STATUS: COMPLETED\nPR: https://github.com/a/b/pull/1"), "BLOCKED");
    assert.equal(classifyNeoBusReply("FINAL STATUS: COMPLETED\nreceipt_id: verified-12345678"), "COMPLETED");
    assert.equal(classifyNeoBusReply("STATUS: DONE\nTest exit code: 0"), "COMPLETED");
  });
});
