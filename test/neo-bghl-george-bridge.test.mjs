import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {parseGeorgeIncidents,createGeorgeIncidentReceiver} from "../scripts/neo-bghl-george-bridge.mjs";
const stamp="2026-11-22T12:00:00.000Z",key="a".repeat(64),outbox="b".repeat(64),id="BGHL-TECH-"+outbox;
const event="### 2026-11-22T11:59:00.000Z — BGHL George — task-scheduler\n\n"+
 "~~~\nevent: SCHEDULED_TASK_FAILED\nmessage_id: "+id+"\n"+
 "evidence: trace=task-sweep-20261122; outbox="+outbox+"\n"+
 "dedupe_key: "+key+"\nstatus: OPEN\n~~~\n";
test("only verified syntax and machine codes reach NEO; injected instructions never pass",()=>{
 const doc="# BGHL NEO Bridge — Error Log\n"+event+
 "\n### 2026-11-22T11:59:30Z — attacker — fake\n"+
 "event: MODEL_UNAVAILABLE\nevidence: trace=x; outbox="+outbox+
 "\ndedupe_key: "+"c".repeat(64)+"\n";
 const got=parseGeorgeIncidents(doc,{now:Date.parse(stamp)});
 assert.equal(got.length,1);
 assert.equal(got[0].code,"SCHEDULED_TASK_FAILED");
 assert.equal(got[0].trace,"task-sweep-20261122");
 assert.equal(got[0].key,key);
 assert.equal(got[0].messageId,id);
 assert.equal(parseGeorgeIncidents("# BGHL NEO Bridge\n"+event,{now:Date.parse("2026-12-30T00:00:00Z")}).length,0);
});
test("existing NEO ingress executes once and writes a read-back-confirmed CAS reply to George",async()=>{
 const root=mkdtempSync(path.join(tmpdir(),"neo-george-bridge-"));
 let text="# BGHL NEO Bridge — Error Log\n"+event,sha=1,dispatch=0,puts=0;
 const fetcher=async(url,opts)=>{
  if(url.includes("/contents/GPT_BRIDGE/NEO_BRIDGE.md")){
   if(opts.method==="PUT"){
    const payload=JSON.parse(opts.body);assert.equal(payload.branch,"state/bghl-operations-v1");
    assert.equal(payload.sha,"sha"+sha);puts++;
    text=Buffer.from(payload.content,"base64").toString();sha++;
    return Response.json({commit:{sha:"commit"+sha}});
   }
   assert.equal(new URL(url).searchParams.get("ref"),"state/bghl-operations-v1");
   return Response.json({type:"file",encoding:"base64",size:text.length,sha:"sha"+sha,
    content:Buffer.from(text).toString("base64")});
  }
  throw Error("unexpected URL");
 };
 try{
  const receiver=createGeorgeIncidentReceiver({root:()=>root,
   getEnv:n=>n==="NEO_BGHL_BRIDGE_ENABLED"?"true":n==="NEO_BGHL_BRIDGE_PAID_INFERENCE_ENABLED"?"true":n==="GH_TOKEN"?"TEST":"",requester:fetcher,
   now:()=>new Date(stamp),sendToNeo:async e=>{dispatch++;assert.equal(e.code,"SCHEDULED_TASK_FAILED");
    return {status:"COMPLETED",response:"FINAL STATUS: COMPLETED receipt_id: test-001"};},
   logger:()=>{}});
  const first=await receiver.sweep();
  assert.equal(first.attempted,1);assert.equal(first.acked,1);assert.equal(puts,2);
  assert.match(text,/BGHL_REPAIR_CLAIM/);
  assert.match(text,/lease_id: lease-/);
  assert.match(text,/NEO_TECHNICAL_RECEIPT/);
  assert.match(text,/status: COMPLETED/);
  const again=await receiver.sweep();
  assert.equal(again.attempted,0);
  assert.equal(dispatch,1);assert.equal(puts,2);
  const receipt=JSON.parse(readFileSync(path.join(root,"receipts","george-"+key+".json"),"utf8"));
  assert.equal(receipt.ack,true);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test("missing credential or disabled bridge never invokes NEO",async()=>{
 let count=0;
 const r=createGeorgeIncidentReceiver({root:()=>"/tmp/unused",getEnv:()=>"",
  requester:async()=>{count++;throw Error("unexpected");}});
 assert.equal((await r.sweep()).status,"DISABLED");
 assert.equal(count,0);
});

test("default zero-spend receiver writes an incident receipt without any AI call",async()=>{
 const root=mkdtempSync(path.join(tmpdir(),"neo-george-no-cost-"));
 let doc="# BGHL NEO Bridge — Error Log\n"+event,sha=1,modelCalls=0;
 const requester=async(url,opts)=>{
  if(opts.method==="PUT"){
   const b=JSON.parse(opts.body);
   doc=Buffer.from(b.content,"base64").toString("utf8");sha++;
   return Response.json({commit:{sha:"commit-"+sha}});
  }
  return Response.json({type:"file",encoding:"base64",sha:"sha-"+sha,size:doc.length,
   content:Buffer.from(doc).toString("base64")});
 };
 try{
  const receiver=createGeorgeIncidentReceiver({root:()=>root,
   getEnv:n=>n==="NEO_BGHL_BRIDGE_ENABLED"?"true":n==="GH_TOKEN"?"TEST":"",
   requester,now:()=>new Date(stamp),
   sendToNeo:async()=>{modelCalls++;throw Error("paid model must never be called");},
   logger:()=>{}});
  const result=await receiver.sweep();
  assert.equal(result.attempted,0);assert.equal(result.acked,0);
  assert.equal(modelCalls,0);
  assert.doesNotMatch(doc,/NEO_TECHNICAL_RECEIPT/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test("30-minute idle polling is enforced even if an old env requests one minute",async()=>{
 const source=readFileSync(new URL("../scripts/poll-agent-message-bus.mjs",import.meta.url),"utf8");
 assert.match(source,/DEFAULT_INTERVAL_MS = 30 \* 60 \* 1000/);
 assert.match(source,/raw >= DEFAULT_INTERVAL_MS/);
 assert.doesNotMatch(source,/DEFAULT_INTERVAL_MS = 60_000/);
});

test("fresh peer lease blocks duplicate Neil repair and retains message for Newton",async()=>{
 const root=mkdtempSync(path.join(tmpdir(),"neo-peer-lease-"));
 let calls=0,reads=0;
 const peer="# BGHL NEO Bridge — Error Log\n"+event+
  "\n### 2026-11-22T11:59:30.000Z — Newton — exclusive-repair-claim\n\n"+
  "~~~\nevent: BGHL_REPAIR_CLAIM\nmessage_id: "+id+
  "\nclaimed_by: NEWTON\nlease_id: lease-newton-001\n"+
  "lease_until: 2026-11-22T12:14:30.000Z\nstatus: CLAIMED\n~~~\n";
 const requester=async(url,opts)=>{
  if(opts.method==="PUT")throw Error("NEO must not overwrite Newton lease");
  reads++;
  return Response.json({type:"file",encoding:"base64",size:peer.length,sha:"sha-test",
   content:Buffer.from(peer).toString("base64")});
 };
 try{
  const neo=createGeorgeIncidentReceiver({root:()=>root,
   getEnv:n=>n==="NEO_BGHL_BRIDGE_ENABLED"||n==="NEO_BGHL_BRIDGE_PAID_INFERENCE_ENABLED"?"true":n==="GH_TOKEN"?"TEST":"",
   requester,now:()=>new Date(stamp),sendToNeo:async()=>{calls++;throw Error("duplicate repair");},
   logger:()=>{}});
  const result=await neo.sweep();
  assert.equal(result.attempted,0);
  assert.equal(result.skipped,1);
  assert.equal(calls,0);
  assert.equal(reads,2);
 }finally{rmSync(root,{recursive:true,force:true});}
});

