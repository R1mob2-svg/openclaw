import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { repairNeoContextStore } from "../scripts/repair-neo-context-meter.mjs";

test("Railway Neo migration repairs only stale DeepSeek 128k, preserves other providers and is idempotent", () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"neo-ctx-"));
  try {
    const dir=path.join(root,"agents","neo","sessions");
    fs.mkdirSync(dir,{recursive:true});
    const file=path.join(dir,"sessions.json");
    const rows={
      "agent:neo:main":{modelProvider:"geminx-deepseek",model:"deepseek-flash",contextTokens:128000,sessionId:"a"},
      "agent:neo:other":{modelProvider:"geminx-deepseek",model:"deepseek-v4-pro",contextTokens:131072,sessionId:"b"},
      "agent:neo:google":{modelProvider:"geminx-deepseek",model:"geminx-auto",contextTokens:128000},
      "agent:neo:unknown":{modelProvider:"other",model:"deepseek-flash",contextTokens:128000}
    };
    fs.writeFileSync(file,JSON.stringify(rows));
    assert.deepEqual(repairNeoContextStore(root),{files:1,scanned:4,repaired:2});
    const next=JSON.parse(fs.readFileSync(file,"utf8"));
    assert.equal(next["agent:neo:main"].contextTokens,1000000);
    assert.equal(next["agent:neo:other"].contextTokens,1000000);
    assert.equal(next["agent:neo:google"].contextTokens,128000);
    assert.equal(next["agent:neo:unknown"].contextTokens,128000);
    assert.deepEqual(repairNeoContextStore(root),{files:1,scanned:4,repaired:0});
    assert.equal(fs.existsSync(file+".context128k-rollback.bak"),true);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
