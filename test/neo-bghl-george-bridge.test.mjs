import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {parseGeorgeIncidents,createGeorgeIncidentReceiver} from "../scripts/neo-bghl-george-bridge.mjs";
const stamp="2026-11-22T12:00:00.000Z",key="a".repeat(64),outbox="b".repeat(64);
const event="### 2026-11-22T11:59:00.000Z — BGHL George — task-scheduler\n\n"+
 "~~~\nevent: SCHEDULED_TASK_FAILED\n"+
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
   getEnv:n=>n==="NEO_BGHL_BRIDGE_ENABLED"?"true":n==="GH_TOKEN"?"TEST":"",requester:fetcher,
   now:()=>new Date(stamp),sendToNeo:async e=>{dispatch++;assert.equal(e.code,"SCHEDULED_TASK_FAILED");
    return {status:"COMPLETED",response:"FINAL STATUS: COMPLETED receipt_id: test-001"};},
   logger:()=>{}});
  const first=await receiver.sweep();
  assert.equal(first.attempted,1);assert.equal(first.acked,1);assert.equal(puts,1);
  assert.match(text,/NEO_TECHNICAL_RECEIPT/);
  assert.match(text,/status: COMPLETED/);
  const again=await receiver.sweep();
  assert.equal(again.attempted,0);
  assert.equal(dispatch,1);assert.equal(puts,1);
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
