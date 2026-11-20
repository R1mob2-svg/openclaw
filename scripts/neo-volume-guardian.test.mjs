import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { diskSnapshot, requireArtifactHeadroom, retentionSweep } from "./neo-volume-guardian.mjs";

const roots=[];
function setup() {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"neo-volume-guard-test-"));
  roots.push(root);
  return root;
}
function file(root,name,content="artifact") {
  const pathName=path.join(root,name);
  fs.mkdirSync(path.dirname(pathName),{recursive:true});
  fs.writeFileSync(pathName,content);
  return pathName;
}
afterEach(()=>{ for(const r of roots.splice(0))fs.rmSync(r,{recursive:true,force:true}); });
const future=Date.now()+30*86400_000;
const limits={capacityBytes:25*1024*1024,reserveBytes:1*1024*1024};

describe("NEO 5GB volume guardian: fail closed and never delete live state",()=>{
  it("inventories disk via du and leaves all files untouched by default",()=>{
    const root=setup();
    const candidate=file(root,"tmp/neo-triage/old.log","candidate");
    const report=retentionSweep(root,{...limits,nowMs:future});
    assert.equal(report.dryRun,true);
    assert.equal(report.candidates.length,1);
    assert.equal(report.candidates[0].action,"WOULD_PRUNE");
    assert.ok(fs.existsSync(candidate));
    assert.ok(diskSnapshot(root,limits).usedBytes>=0);
  });
  it("removes only eligible aged scratch files under exact owned directories",()=>{
    const root=setup();
    const a=file(root,"tmp/neo-triage/old.log","A".repeat(8_000));
    const b=file(root,"cache/neo-ephemeral/old.cache","B".repeat(5000));
    const c=file(root,"logs/rotated/openclaw.1.log","C".repeat(5000));
    const report=retentionSweep(root,{...limits,nowMs:future,apply:true});
    assert.equal(report.candidates.filter(x=>x.action==="PRUNED").length,3);
    for(const pathName of [a,b,c])assert.equal(fs.existsSync(pathName),false);
    assert.ok(report.after);
    assert.ok(report.before.usedBytes>=report.after.usedBytes);
  });
  it("preserves sessions, sqlite, queue, ledger, receipts, locks and uncommitted source",()=>{
    const root=setup();
    const protectedFiles=[
      "agents/main/sessions/old.jsonl","agents/main/sessions/dead.lock",
      "workspace/customer-site/src/index.ts", "workspace/unfinished/.git/index",
      "memory/notes.md","queue/outstanding.json","ledgers/receipts.json",
      "tmp/neo-triage/customer-receipt.tmp",
      "tmp/neo-triage/active-session.tmp",
      "tmp/neo-triage/unpushed-code.ts",
      "tmp/neo-triage/store.sqlite",
      "logs/rotated/unrecognised.1.log"
    ].map(x=>file(root,x,"DO NOT DELETE"));
    retentionSweep(root,{...limits,nowMs:future,apply:true});
    for(const pathName of protectedFiles)
      assert.ok(fs.existsSync(pathName),"deleted protected file: "+pathName);
  });
  it("does not follow symlinks outside managed folders",()=>{
    const root=setup(),outside=setup();
    const target=file(outside,"private.tmp","do not delete");
    const managed=path.join(root,"tmp/neo-triage");
    fs.mkdirSync(managed,{recursive:true});
    fs.symlinkSync(target,path.join(managed,"outside.tmp"));
    const report=retentionSweep(root,{...limits,nowMs:future,apply:true});
    assert.equal(report.candidates.length,0);
    assert.ok(fs.existsSync(target));
  });
  it("does not unlink multiply linked files, even in an allowlisted directory",()=>{
    const root=setup();
    const protectedPath=file(root,"queue/job-receipt","keep");
    fs.mkdirSync(path.join(root,"tmp/neo-triage"),{recursive:true});
    fs.linkSync(protectedPath,path.join(root,"tmp/neo-triage/old.tmp"));
    const result=retentionSweep(root,{...limits,nowMs:future,apply:true});
    assert.equal(result.candidates.length,0);
    assert.ok(fs.existsSync(protectedPath));
  });
  it("never removes active or recently changed candidate files",()=>{
    const root=setup();
    const active=file(root,"tmp/neo-triage/active.log","active");
    const result=retentionSweep(root,{...limits,nowMs:Date.now()+60000,apply:true});
    assert.equal(result.candidates.length,0);
    assert.ok(fs.existsSync(active));
  });
  it("raises RUNTIME_DISK_PRESSURE before an oversized optional artifact write",()=>{
    const root=setup();
    assert.throws(()=>requireArtifactHeadroom(root,30*1024*1024,limits),
      error=>error.code==="RUNTIME_DISK_PRESSURE");
    assert.ok(requireArtifactHeadroom(root,1024,limits).freeBytes>0);
  });
  it("refuses root filesystem and unauthorized apply mode",()=>{
    assert.throws(()=>diskSnapshot("/",limits),/GUARD_UNSAFE_VOLUME_ROOT/);
    const root=setup();
    const cli=spawnSync(process.execPath,["scripts/neo-volume-guardian.mjs","--root",root,
      "--apply","--capacity-bytes","26214400","--reserve-bytes","1048576"],{
      cwd:process.cwd(),encoding:"utf8",env:{...process.env,NEO_SAFE_RETENTION_APPLY:"0"}
    });
    assert.equal(cli.status,75);
    assert.match(cli.stderr,/GUARD_APPLY_REQUIRES_EXPLICIT_APPROVAL/);
  });
});
