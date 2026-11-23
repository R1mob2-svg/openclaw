/**
 * Digital Ambush: deterministic missing-wake detector running INSIDE the
 * existing 30-minute NEO agent-bus poll. No second timer, scheduler or LLM
 * call on healthy wakes. On a proven missing factory START, create exactly
 * one idempotent recovery work item on the SAME GitHub issue bus.
 */
const BRAIN = "R1mob2-svg/global-agent-brain";
const DIRECTORY = "Campaigns/Digital_Ambush/CHATGPT_FACTORY_RUNS";
const API = "https://api.github.com/repos/" + BRAIN;
const FIRST_HOUR = "2026-11-23T18Z";
function headers(token){return {Authorization:"Bearer "+token,Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28","User-Agent":"NEO-Factory-Wake-Monitor/1"};}
export function factoryHourToken(date){return date.toISOString().slice(0,13)+"Z";}
export function classifyFactoryHour({nowIso,names}){
  const now = new Date(nowIso);
  if(Number.isNaN(now.getTime())) return {status:"BAD_CLOCK"};
  const t = new Date(now);
  if(t.getUTCMinutes()<35) t.setUTCHours(t.getUTCHours()-1);
  const hour = factoryHourToken(t);
  if(hour<FIRST_HOUR) return {status:"BEFORE_MONITOR_START",hour};
  if(!Array.isArray(names)) return {status:"NO_RECEIPT_LIST",hour};
  const matching=names.filter(x=>typeof x==="string"&&x.startsWith(hour+"_"));
  const starts=matching.filter(x=>x.endsWith("_START.json"));
  const ends=matching.filter(x=>x.endsWith("_END.json"));
  if(ends.length) return {status:"END_PRESENT",hour,starts:starts.length,ends:ends.length};
  if(starts.length) return {status:"START_PRESENT_END_PENDING",hour,starts:starts.length};
  return {status:"MISSING_START_AND_END",hour};
}
async function request(url,token,fetchImpl,init={}){
  const res=await fetchImpl(url,{...init,headers:{...headers(token),...(init.headers||{})},signal:AbortSignal.timeout(15000)});
  if(!res.ok) throw Error("FACTORY_MONITOR_HTTP_"+res.status);
  return res.json();
}
export async function monitorFactoryWake({token,fetchImpl=fetch,nowIso=new Date().toISOString()}){
  if(!token) return {status:"NO_GH_TOKEN"};
  const files=await request(API+"/contents/"+DIRECTORY+"?ref=main",token,fetchImpl);
  if(!Array.isArray(files)) return {status:"NO_RECEIPT_LIST"};
  // Fail closed if the single REST directory response may be truncated.
  if(files.length>=1000) return {status:"RECEIPT_DIRECTORY_TOO_LARGE",count:files.length};
  const verdict=classifyFactoryHour({nowIso,names:files.map(x=>x.name)});
  if(verdict.status!=="MISSING_START_AND_END") return verdict;
  const marker="DA-FACTORY-WAKE-RECOVERY-"+verdict.hour.replace(/[^0-9A-Z]/g,"");
  const issues=await request(API+"/issues?state=all&sort=created&direction=desc&per_page=100",token,fetchImpl);
  if(!Array.isArray(issues)) return {status:"ISSUE_LIST_INVALID",hour:verdict.hour};
  if(issues.some(x=>String(x.title||"").includes(marker)||String(x.body||"").includes(marker)))
    return {status:"RECOVERY_ALREADY_ENQUEUED",hour:verdict.hour,marker};
  const taskId="DA-RECOVERY-"+verdict.hour.replace(/[^0-9A-Z]/g,"");
  const payload={
    command:"GEMINX_AUTONOMOUS_TASK_V1",
    task_id:taskId,
    prospect_id:"NONE_UNTIL_CRM_ADMISSION",
    objective:"Recover the real missed ChatGPT Digital Ambush factory hour "+verdict.hour+
      ". Cold boot current Brain revenue directive and canonical CRM. Reconcile receipts and leases first; if a valid build already exists do not duplicate it. Otherwise run actual existing nationwide UK lead enrichment/discovery, then build ONE unique legally eligible no-official-site UK corporate prospect website plus exact matching internal HTML/text email, and do real SHA-bound browser QA if available. Persist matching immutable START/END receipts in existing Brain using RECOVERY_"+verdict.hour.replace(/[^0-9A-Z]/g,"")+" suffix, CRM and commit readbacks. No new service, no extra scheduler, no fake tests, no canned replies, no automatic external email. Gmail send is a separate ChatGPT gate."
  };
  const body=[
    "message_id: "+marker,"correlation_id: "+taskId,
    "sender: newton","recipient: neo","project: digital-ambush",
    "priority: P0","command: GEMINX_AUTONOMOUS_TASK_V1","status: SENT",
    "reply_to: newton","payload_b64: "+Buffer.from(JSON.stringify(payload)).toString("base64"),
    "","Automatic deterministic missing-wake recovery (same existing NEO agent bus).",
    "Missing hour: "+verdict.hour,"No durable START or END found in Brain at check time: "+nowIso,
    "Before executing, check again to avoid races. NEVER send customer email."
  ].join("\n");
  const issue=await request(API+"/issues",token,fetchImpl,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({title:"AGENT_MESSAGE_BUS: "+marker,body})});
  if(!issue.number) return {status:"ISSUE_CREATION_UNCONFIRMED",hour:verdict.hour};
  return {status:"RECOVERY_QUEUED",hour:verdict.hour,issueNumber:issue.number,issueUrl:issue.html_url};
}
