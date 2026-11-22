#!/usr/bin/env node
/** Reclaim only inactive and aged DUPLICATE downloaded Chromium versions.
 * Never delete canonical ms-playwright, agent sessions, workspaces, source,
 * credentials, receipts or any browser profile. No model calls or scheduler.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
const STALE_MS=48*60*60*1000;
const BAD_NAMES=/(^|[._-])(profile|user.?data|cookie|session|credential|token|secret|receipt|queue|ledger|lock|state|backup)([._-]|$)/i;
const specs=[
 {base:'workspace-neo/.pw',version:/^chromium(?:_headless_shell)?-\d+$/,binary:(n)=>n.startsWith('chromium_headless_shell-')?'chrome-headless-shell-linux64/chrome-headless-shell':'chrome-linux64/chrome'},
 {base:'workspace-neo/.puppeteer-local/chrome',version:/^linux-\d+$/,binary:()=> 'chrome-linux64/chrome'},
 {base:'workspace-neo/.puppeteer-local/chrome-headless-shell',version:/^linux-\d+$/,binary:()=> 'chrome-headless-shell-linux64/chrome-headless-shell'}
];
function usage(p){return Number(execFileSync('du',['-x','-sk','--',p],{encoding:'utf8',timeout:25000}).trim().split(/\s+/)[0])*1024}
function isActive(p){
 let ps;
 try{ps=fs.readdirSync('/proc').filter(x=>/^\d+$/.test(x))}catch{return true}
 for(const pid of ps){
   try{
    const cmd=fs.readFileSync('/proc/'+pid+'/cmdline','utf8');
    const exe=fs.readlinkSync('/proc/'+pid+'/exe');
    if(cmd.includes(p+'/')||exe.startsWith(p+'/'))return true;
   }catch{}
 }
 return false;
}
function scanVersion(candidate,device,nowMs){
 const entries=[],dirs=[];let valid=true,count=0;
 const visit=(p)=>{
  if(!valid||++count>20000){valid=false;return;}
  const st=fs.lstatSync(p);
  if(st.dev!==device||st.isSymbolicLink()){valid=false;return}
  if(st.isDirectory()){
    dirs.push(p);
    for(const n of fs.readdirSync(p))visit(path.join(p,n));
  }else if(st.isFile()){
    if(st.nlink!==1||BAD_NAMES.test(path.basename(p))||[st.mtimeMs,st.atimeMs].some(t=>t>=nowMs-STALE_MS)){
      valid=false;return;
    }
    entries.push({path:p,ino:st.ino,size:st.size,mtime:st.mtimeMs,ctime:st.ctimeMs,atime:st.atimeMs});
  }else valid=false;
 };
 try{visit(candidate)}catch{valid=false}
 return valid&&entries.length?{entries,dirs}:null;
}
export function reclaimBrowserCaches({root='/home/node/.openclaw',canonicalBrowser=process.env.CHROMIUM_PATH,apply=false,nowMs=Date.now(),probe}={}){
 const report={schema:'neo.duplicate-browser-cache-reclaim.v1',dryRun:!apply,eligible:[],reclaimedBytes:0,reason:'NOT_PROVEN'};
 let mount,canonical;
 try{
   mount=fs.realpathSync(root);
   if(mount==='/'||fs.lstatSync(mount).isSymbolicLink())return report;
   const real=fs.realpathSync(canonicalBrowser);
   if(!real.startsWith(path.join(mount,'ms-playwright')+path.sep)||!fs.statSync(real).isFile())return report;
   canonical=real;
 }catch{return report}
 const candidates=[];
 const dev=fs.lstatSync(mount).dev;
 for(const spec of specs){
  const base=path.join(mount,spec.base);
  let st;
  try{st=fs.lstatSync(base)}catch{continue}
  if(!st.isDirectory()||st.isSymbolicLink()||st.dev!==dev)continue;
  for(const dir of fs.readdirSync(base,{withFileTypes:true})){
   if(!dir.isDirectory()||dir.isSymbolicLink()||!spec.version.test(dir.name))continue;
   const folder=path.join(base,dir.name);
   if(fs.existsSync(path.join(folder,spec.binary(dir.name))))candidates.push(folder);
  }
 }
 if(!candidates.length){report.reason='NO_REDUNDANT_BROWSER_INSTALLS';return report}
 try{
   const ok=probe?probe(canonical):/<html[\s>]/i.test(execFileSync(canonical,
     ['--headless','--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--dump-dom','about:blank'],
     {encoding:'utf8',timeout:12000,maxBuffer:262144,stdio:['ignore','pipe','ignore']}));
   if(!ok){report.reason='CANONICAL_CHROMIUM_NOT_VERIFIED';return report}
 }catch{report.reason='CANONICAL_CHROMIUM_FAILED';return report}
 report.reason='CANDIDATES_CHECKED';
 for(const folder of candidates){
  if(isActive(folder))continue;
  const inventory=scanVersion(folder,dev,nowMs);
  if(!inventory)continue;
  const rel=path.relative(mount,folder);
  if(!apply){report.eligible.push({path:rel,status:'ELIGIBLE_DRY_RUN'});continue}
  if(isActive(folder))continue;
  try{
   // Compare every inode again, and delete only the files we just inspected.
   for(const entry of inventory.entries){
    const st=fs.lstatSync(entry.path);
    if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||st.ino!==entry.ino||st.size!==entry.size||
       st.mtimeMs!==entry.mtime||st.ctimeMs!==entry.ctime||st.atimeMs!==entry.atime)throw Error('FILE_CHANGED');
   }
   const before=usage(folder);
   for(const entry of inventory.entries)fs.unlinkSync(entry.path);
   for(const dir of inventory.dirs.sort((a,b)=>b.length-a.length))fs.rmdirSync(dir);
   report.reclaimedBytes+=before;
   report.eligible.push({path:rel,status:'PRUNED',allocatedBytes:before});
  }catch{report.eligible.push({path:rel,status:'SKIPPED_CHANGED_OR_BUSY'});}
 }
 return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(new URL(import.meta.url).pathname)){
 const argv=process.argv.slice(2),i=argv.indexOf('--root');
 const root=i>=0?argv[i+1]:'/home/node/.openclaw';
 const apply=argv.includes('--apply')&&process.env.NEO_SAFE_RETENTION_APPLY==='1';
 const result=reclaimBrowserCaches({root,apply});
 console.log('NEO_BROWSER_CACHE_RECLAIM '+JSON.stringify(result));
 if(result.reason==='CANONICAL_CHROMIUM_FAILED')process.exitCode=75;
}
