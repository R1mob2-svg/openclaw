import {test} from "node:test";
import assert from "node:assert/strict";
import {selectPendingFactoryQa,pollFactoryQa} from "./neo-da-factory-qa-pickup.mjs";
const sha="a".repeat(40);
const entry={prospect_id:"WM-LTD-20261116-0007",task_id:"DA-CHATGPT-WM-LTD-20261116-0007-23Z",site_blob_sha:sha,qa_status:"QA_PENDING_NEO_PICKUP",request_path:"Agent_Inbox/NEO/Messages/2026-11-22T23Z_CHEEK.md"};
const cp={pending_qa:[entry]};
function fakeFetch(checkpoint=cp,note=entry.task_id+"\n"+entry.site_blob_sha){
 return async url=>({ok:true,status:200,json:async()=>({type:"file",encoding:"base64",content:Buffer.from(url.includes("CHECKPOINT.json")?JSON.stringify(checkpoint):note).toString("base64")})});
}
test("new exact-SHA QA is eligible, never old rejected version",()=>{
 assert.equal(selectPendingFactoryQa(cp).length,1);
 assert.equal(selectPendingFactoryQa({...cp,founder_priority_override:{source_qa_rejected_blob_sha:sha}}).length,0);
 assert.equal(selectPendingFactoryQa({pending_qa:[{...entry,request_path:"../secrets.txt"}]}).length,0);
});
test("no inference on idle or missing token",async()=>{
 let count=0;
 const callback=async()=>{count++};
 assert.equal((await pollFactoryQa({token:"",onPending:callback})).status,"SKIPPED_NO_TOKEN_OR_HANDLER");
 assert.equal((await pollFactoryQa({token:"token",onPending:callback,fetchImpl:fakeFetch({pending_qa:[]})})).status,"IDLE_NO_PENDING_QA");
 assert.equal(count,0);
});
test("dispatch is one exact revision with expected note only",async()=>{
 const dispatched=[];
 const result=await pollFactoryQa({token:"token",onPending:async m=>{dispatched.push(m);return true;},fetchImpl:fakeFetch()});
 assert.equal(result.status,"QA_DISPATCH_ATTEMPTED");
 assert.equal(dispatched.length,1);
 assert.equal(dispatched[0].sourceSha,sha);
 assert.match(dispatched[0].messageId,/DA-QA-WM-LTD-20261116-0007-/);
 const skipped=await pollFactoryQa({token:"token",onPending:async m=>{dispatched.push(m);return true;},fetchImpl:fakeFetch(cp,"wrong-source")});
 assert.equal(skipped.status,"QA_REQUEST_MISMATCH");
 assert.equal(dispatched.length,1);
});
test("an exhausted prior attempt cannot starve the next pending prospect",async()=>{
 const second={...entry,prospect_id:"WM-LTD-20261116-0012",
  task_id:"DA-CHATGPT-WM-LTD-20261116-0012-09Z",
  request_path:"Agent_Inbox/NEO/Messages/2026-11-23T09Z_STM.md"};
 const visited=[];
 const result=await pollFactoryQa({token:"token",fetchImpl:fakeFetch({pending_qa:[entry,second]},
  entry.task_id+"\\n"+second.task_id+"\\n"+sha),onPending:async m=>{
   visited.push(m.taskId);return m.taskId===second.task_id;
  }});
 assert.equal(result.status,"QA_DISPATCH_ATTEMPTED");
 assert.equal(result.messageId,"DA-QA-"+second.prospect_id+"-"+sha.slice(0,12));
 assert.deepEqual(visited,[entry.task_id,second.task_id]);
 assert.equal(result.skipped,1);
});
test("fresh pending QA gets a dispatch slot before repeatedly failing repair",()=>{
 const failed={...entry,prospect_id:"WM-LTD-20261116-0011",
  task_id:"DA-CHATGPT-WM-LTD-20261116-0011-08Z",
  qa_status:"QA_FAIL_REPAIR_PENDING"};
 const fresh={...entry,prospect_id:"WM-LTD-20261116-0012",
  task_id:"DA-CHATGPT-WM-LTD-20261116-0012-09Z"};
 const latest={...entry,prospect_id:"WM-LTD-20261116-0013",
  task_id:"DA-CHATGPT-WM-LTD-20261116-0013-10Z"};
 const list=[failed,fresh,latest];
 const result=selectPendingFactoryQa({pending_qa:list});
 assert.deepEqual(result.map(x=>x.task_id),
   [fresh.task_id,latest.task_id,failed.task_id]);
 assert.equal(list[0].task_id,failed.task_id); // no checkpoint mutation
});
test("the full backlog is visible even after eight older requests",()=>{
 const items=Array.from({length:10},(_,i)=>({...entry,
  prospect_id:"WM-LTD-20261116-"+String(i).padStart(4,"0"),
  task_id:entry.task_id+"-"+i}));
 assert.equal(selectPendingFactoryQa({pending_qa:items}).length,10);
});
test("no successful pickup is claimed if all candidates already have receipts",async()=>{
 const result=await pollFactoryQa({token:"token",fetchImpl:fakeFetch(),
  onPending:async()=>false});
 assert.equal(result.status,"QA_SKIPPED_NO_NEW_DISPATCH");
 assert.equal(result.skipped,1);
});
