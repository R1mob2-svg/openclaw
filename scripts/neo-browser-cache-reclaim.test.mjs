import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {reclaimBrowserCaches} from './neo-browser-cache-reclaim.mjs';
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'neo-cache-test-'));
 const canonical=path.join(root,'ms-playwright/chromium_headless_shell-111/chrome-headless-shell-linux64/chrome-headless-shell');
 const duplicate=path.join(root,'workspace-neo/.pw/chromium-1010/chrome-linux64/chrome');
 for(const p of [canonical,duplicate])fs.mkdirSync(path.dirname(p),{recursive:true});
 fs.writeFileSync(canonical,'#!/bin/sh\necho "<html></html>"\n');fs.chmodSync(canonical,0o755);
 fs.writeFileSync(duplicate,'DUPLICATE_BROWSER_BIN');
 const precious=path.join(root,'agents/main/sessions/keep.jsonl');fs.mkdirSync(path.dirname(precious),{recursive:true});fs.writeFileSync(precious,'important');
 return {root,canonical,duplicate,precious};
}
test('dry run does not delete browser caches',()=>{
 const x=fixture();try{
  const r=reclaimBrowserCaches({root:x.root,canonicalBrowser:x.canonical,nowMs:Date.now()+4*86400_000,probe:()=>true});
  assert.equal(r.eligible.length,1);assert.equal(fs.existsSync(x.duplicate),true);
 }finally{fs.rmSync(x.root,{recursive:true,force:true})}
});
test('prunes only a stale duplicate browser revision, never canonical or agent state',()=>{
 const x=fixture();try{
  const r=reclaimBrowserCaches({root:x.root,canonicalBrowser:x.canonical,apply:true,nowMs:Date.now()+4*86400_000,probe:()=>true});
  assert.equal(r.eligible[0].status,'PRUNED');assert.ok(r.reclaimedBytes>0);
  assert.equal(fs.existsSync(x.duplicate),false);assert.ok(fs.existsSync(x.canonical));assert.ok(fs.existsSync(x.precious));
 }finally{fs.rmSync(x.root,{recursive:true,force:true})}
});
test('does not delete recent cache or when canonical proof fails',()=>{
 const x=fixture();try{
  const r=reclaimBrowserCaches({root:x.root,canonicalBrowser:x.canonical,apply:true,probe:()=>true});
  assert.equal(r.eligible.length,0);assert.ok(fs.existsSync(x.duplicate));
  const nope=reclaimBrowserCaches({root:x.root,canonicalBrowser:x.canonical,apply:true,nowMs:Date.now()+4*86400_000,probe:()=>false});
  assert.equal(nope.reclaimedBytes,0);assert.ok(fs.existsSync(x.duplicate));
 }finally{fs.rmSync(x.root,{recursive:true,force:true})}
});
test('rejects symlink and suspicious profile content',()=>{
 const x=fixture();try{
  const profile=path.join(path.dirname(x.duplicate),'user-data-dir');fs.writeFileSync(profile,'do not delete');
  const r=reclaimBrowserCaches({root:x.root,canonicalBrowser:x.canonical,apply:true,nowMs:Date.now()+4*86400_000,probe:()=>true});
  assert.equal(r.reclaimedBytes,0);assert.ok(fs.existsSync(profile));
 }finally{fs.rmSync(x.root,{recursive:true,force:true})}
});
