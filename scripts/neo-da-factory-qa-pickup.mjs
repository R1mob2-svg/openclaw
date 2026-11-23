/**
 * Read the EXISTING ChatGPT factory checkpoint inside the existing 30-minute
 * GitHub issue-bus poller. This is not a second scheduler or queue.
 * Only a new, SHA-bound QA request can cause a model/tool invocation.
 */
const REPO="R1mob2-svg/global-agent-brain";
const CHECKPOINT="Campaigns/Digital_Ambush/CHATGPT_FACTORY_CHECKPOINT.json";
const QA_STATUSES=new Set(["QA_PENDING_NEO_PICKUP","QA_FAIL_REPAIR_PENDING","BUILT_QA_PENDING"]);
const SHA=/^[a-f0-9]{40}$/;
const PATH=/^Agent_Inbox\/NEO\/Messages\/[A-Za-z0-9._-]+\.md$/;
const SAFE_ID=/^[A-Za-z0-9._-]{1,160}$/;
export function selectPendingFactoryQa(checkpoint){
 const arr=Array.isArray(checkpoint?.pending_qa)?checkpoint.pending_qa:[];
 const rejected=checkpoint?.founder_priority_override?.source_qa_rejected_blob_sha;
 // A failed older QA must never repeatedly occupy the only half-hour dispatch
 // slot while fresh, exact-SHA sites are waiting. Preserve FIFO within a tier.
 const candidates=arr.filter(x=> x && QA_STATUSES.has(x.qa_status) &&
   SAFE_ID.test(x.task_id||"") && SAFE_ID.test(x.prospect_id||"") &&
   SHA.test(x.site_blob_sha||"") && PATH.test(x.request_path||"") &&
   x.site_blob_sha!==rejected);
 return candidates.sort((a,b)=>
   Number(a.qa_status==="QA_FAIL_REPAIR_PENDING")-
   Number(b.qa_status==="QA_FAIL_REPAIR_PENDING"));
}
async function contentAt(path,token,fetchImpl){
 const url="https://api.github.com/repos/"+REPO+"/contents/"+path.split("/").map(encodeURIComponent).join("/")+"?ref=main";
 const response=await fetchImpl(url,{headers:{Authorization:"Bearer "+token,Accept:"application/vnd.github+json","User-Agent":"NEO-Factory-QA/1"},signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error("BRAIN_CONTENT_HTTP_"+response.status);
 const object=await response.json();
 if(object.type!=="file"||object.encoding!=="base64"||typeof object.content!=="string")throw Error("BRAIN_CONTENT_FORMAT_INVALID");
 return Buffer.from(object.content.replace(/\s/g,""),"base64").toString("utf8");
}
export async function pollFactoryQa({token,onPending,fetchImpl=fetch}){
 if(!token||typeof onPending!=="function")return {status:"SKIPPED_NO_TOKEN_OR_HANDLER"};
 const checkpoint=JSON.parse(await contentAt(CHECKPOINT,token,fetchImpl));
 const pending=selectPendingFactoryQa(checkpoint);
 if(!pending.length)return {status:"IDLE_NO_PENDING_QA",pending:0};
 let skipped=0,mismatched=0;
 for(const item of pending){
   const note=await contentAt(item.request_path,token,fetchImpl);
   if(!note.includes(item.task_id)||!note.includes(item.site_blob_sha)){mismatched++;continue;}
   const messageId=("DA-QA-"+item.prospect_id+"-"+item.site_blob_sha.slice(0,12)).slice(0,155);
   // onPending returns true only when a real dispatch was attempted.
   // A receipt, exhausted retry cap or absent gateway is a skip, NOT a successful pickup.
   const attempted=await onPending({messageId,taskId:item.task_id,prospectId:item.prospect_id,
      sourceSha:item.site_blob_sha,requestPath:item.request_path,requestText:note.slice(0,9000)});
   if(attempted===true)return {status:"QA_DISPATCH_ATTEMPTED",pending:pending.length,messageId,skipped};
   skipped++;
 }
 return {status:skipped?"QA_SKIPPED_NO_NEW_DISPATCH":"QA_REQUEST_MISMATCH",
   pending:pending.length,skipped,mismatched};
}
