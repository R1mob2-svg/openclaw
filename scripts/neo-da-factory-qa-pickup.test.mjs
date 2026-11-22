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
 const result=await pollFactoryQa({token:"token",onPending:async m=>dispatched.push(m),fetchImpl:fakeFetch()});
 assert.equal(result.status,"QA_DISPATCH_ATTEMPTED");
 assert.equal(dispatched.length,1);
 assert.equal(dispatched[0].sourceSha,sha);
 assert.match(dispatched[0].messageId,/DA-QA-WM-LTD-20261116-0007-/);
 const skipped=await pollFactoryQa({token:"token",onPending:async m=>dispatched.push(m),fetchImpl:fakeFetch(cp,"wrong-source")});
 assert.equal(skipped.status,"QA_REQUEST_MISMATCH");
 assert.equal(dispatched.length,1);
});