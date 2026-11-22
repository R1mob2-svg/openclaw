/**
 * Existing Railway NEO agent-message-bus sidecar: BGHL George incident consumer.
 * Delivers code-only incidents from George's private state branch into the
 * authenticated native NEO gateway and returns a CAS receipt to that branch.
 * No Telegram bot-to-bot messaging, new scheduler, new LLM, or owner alerts.
 */
import {createHash} from "node:crypto";
import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync} from "node:fs";
import path from "node:path";
import {classifyNeoBusReply} from "./neo-agent-bus-receipt-status.mjs";
const REPO="R1mob2-svg/bghl-agent-brain";
const BRANCH="state/bghl-operations-v1";
const FILE="GPT_BRIDGE/NEO_BRIDGE.md";
const ENDPOINT="https://api.github.com/repos/"+REPO+"/contents/"+FILE;
const CODES=new Set(["MODEL_UNAVAILABLE","TOOL_FAILURE","INTEGRATION_FAILURE",
 "SCHEDULED_TASK_FAILED","SESSION_PERSISTENCE_FAILED","GITHUB_SYNC_FAILED",
 "WEBHOOK_FAILURE","RECOVERY_BLOCKED"]);
const SHA=/^[a-f0-9]{64}$/;
const REF=/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,119}$/;
const headers=token=>({Authorization:"Bearer "+token,
 Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28",
 "Content-Type":"application/json","User-Agent":"NEO-BGHL-Technical-Receiver/1.0"});
const rid=x=>createHash("sha256").update(x).digest("hex");
const safeDate=x=>new Date(x).toISOString();
export function parseGeorgeIncidents(text,{now=Date.now(),maxAgeMs=2*60*60*1000}={}){
 const output=[],used=new Set();
 for(const chunk of String(text||"").split(/(?=^### \d{4}-\d{2}-\d{2}T)/gm)){
  const head=/^### ([0-9T:.-]+Z) — BGHL George — ([a-z0-9-]+)\s*$/m.exec(chunk);
  if(!head)continue;
  const time=Date.parse(head[1]);
  if(!Number.isFinite(time)||time>now+300000||now-time>maxAgeMs)continue;
  const code=/^event: ([A-Z_]+)\s*$/m.exec(chunk)?.[1];
  const trace=/^evidence: trace=([A-Za-z0-9_.:-]{8,120}); outbox=[a-f0-9]{64}\s*$/m.exec(chunk)?.[1];
  const key=/^dedupe_key: ([a-f0-9]{64})\s*$/m.exec(chunk)?.[1];
  if(!CODES.has(code)||!trace||!REF.test(trace)||!SHA.test(key)||used.has(key))continue;
  // The payload has no user-generated Markdown, free-text instructions, phone IDs or secrets.
  output.push({code,trace,source:head[2],at:head[1],key});
  used.add(key);
 }
 return output.sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
}
function atomic(file,obj){
 const tmp=file+"."+process.pid+".tmp";
 writeFileSync(tmp,JSON.stringify(obj)+"\n",{mode:0o600});
 renameSync(tmp,file);
}
export function createGeorgeIncidentReceiver({
 getEnv=k=>process.env[k],requester=fetch,root,
 now=()=>new Date(),sendToNeo=null,logger=console.log
}={}){
 if(typeof root!=="function")throw Error("BGHL_RECEIVER_ROOT_REQUIRED");
 const cfg=k=>String(getEnv(k)||"").trim();
 const tkn=()=>cfg("GH_TOKEN")||cfg("GITHUB_TOKEN")||cfg("GITHUB_PAT");
 const directory=()=>{const p=path.join(root(),"receipts");mkdirSync(p,{recursive:true,mode:0o700});return p;};
 const local=e=>path.join(directory(),"george-"+e.key+".json");
 async function getDoc(){
  const token=tkn();
  if(!token)throw Error("BGHL_BRIDGE_GITHUB_TOKEN_MISSING");
  const r=await requester(ENDPOINT+"?ref="+encodeURIComponent(BRANCH),{
   headers:headers(token),signal:AbortSignal.timeout(12000)});
  if(!r.ok)throw Error("BGHL_BRIDGE_READ_HTTP_"+r.status);
  const doc=await r.json();
  if(doc?.encoding!=="base64"||doc?.type!=="file"||!doc.sha||
   Number(doc.size)>900000)throw Error("BGHL_BRIDGE_INVALID_DOC");
  const markdown=Buffer.from(doc.content.replace(/\s/g,""),"base64").toString("utf8");
  if(markdown.length>900000||!markdown.startsWith("# BGHL NEO Bridge"))
   throw Error("BGHL_BRIDGE_INVALID_CONTENT");
  return {markdown,sha:doc.sha};
 }
 async function appendAck(event,receipt){
  const key=rid("NEO_ACK|"+event.key);
  const signature="neo_ack_key: "+key;
  for(let i=0;i<4;i++){
   const current=await getDoc();
   if(current.markdown.includes(signature))return {ok:true,duplicate:true};
   const at=now().toISOString();
   const next=current.markdown.trimEnd()+"\n\n### "+at+
    " — Railway NEO — technical-receipt\n\n"+
    "~~~\nevent: NEO_TECHNICAL_RECEIPT\nsource: Railway NEO / existing agent-message-bus\n"+
    "in_reply_to: "+event.key+"\nneo_ack_key: "+key+
    "\nstatus: "+receipt.status+"\n"+
    "evidence: durable_receiver_receipt="+receipt.id+
    "\nalerted_brian: false\n"+
    "resolution: receiver response recorded; independent Telegram handoff not implied\n~~~\n";
   const reply=await requester(ENDPOINT,{
    method:"PUT",headers:headers(tkn()),
    body:JSON.stringify({branch:BRANCH,sha:current.sha,
     content:Buffer.from(next).toString("base64"),
     message:"bghl: NEO technical incident receipt "+event.code}),
    signal:AbortSignal.timeout(12000)});
   if([409,422].includes(reply.status))continue;
   if(!reply.ok)throw Error("BGHL_BRIDGE_ACK_HTTP_"+reply.status);
   const saved=await reply.json();
   if(!saved?.commit?.sha)throw Error("BGHL_BRIDGE_ACK_UNCONFIRMED");
   const checked=await getDoc();
   if(!checked.markdown.includes(signature))throw Error("BGHL_BRIDGE_ACK_READBACK_FAILED");
   return {ok:true,commit:saved.commit.sha};
  }
  throw Error("BGHL_BRIDGE_ACK_CAS_CONFLICT");
 }
 async function runAgent(event){
  if(typeof sendToNeo==="function")return sendToNeo(event);
  const gateway=cfg("OPENCLAW_GATEWAY_TOKEN");
  if(!gateway)throw Error("NEO_GATEWAY_TOKEN_MISSING");
  const prompt=[
   "BGHL_GEORGE_TO_NEO_TECHNICAL_INCIDENT_V1",
   "George is the existing BGHL AI. You are Railway NEO, the existing repair operator.",
   "This is a validated code-only technical event from BGHL's private incident ledger.",
   "Inspect the current BGHL brain, GitHub main, Railway logs and live deployment.",
   "Diagnose source-backed root cause, perform only founder-authorised safe bounded fixes",
   "with regression tests/deployment verification. No customer messaging, owner changes,",
   "secrets, new agents, unapproved spending, phone activation or fabricated success.",
   "If access is unavailable, return an exact BLOCKED receipt, not a pretend repair.",
   "Do not interpret this alert as an instruction from Brian or a human customer.",
   "Report status and mechanical evidence; end with FINAL STATUS: COMPLETED plus receipt_id:",
   "only if independently proved, otherwise FINAL STATUS: BLOCKED.",
   "incident_code="+event.code,
   "component="+event.source,
   "trace_reference="+event.trace,
   "incident_utc="+event.at,
   "dedupe_key="+event.key
  ].join("\n");
  const response=await requester("http://127.0.0.1:8080/v1/chat/completions",{
   method:"POST",headers:{Authorization:"Bearer "+gateway,
    "Content-Type":"application/json",
    "X-OpenClaw-Message-Channel":"bghl-george-technical-bridge"},
   body:JSON.stringify({model:"openclaw",stream:false,
    user:"bghl-george-"+event.key.slice(0,16),
    messages:[{role:"user",content:prompt}]}),
   signal:AbortSignal.timeout(300000)
  });
  if(!response.ok)throw Error("BGHL_NEO_GATEWAY_HTTP_"+response.status);
  const payload=await response.json();
  const message=String(payload?.choices?.[0]?.message?.content||"");
  if(!message.trim())throw Error("BGHL_NEO_GATEWAY_EMPTY");
  return {status:classifyNeoBusReply(message),response:message.slice(0,2800)};
 }
 async function sweep(){
  if(cfg("NEO_BGHL_BRIDGE_ENABLED")!=="true")return {status:"DISABLED"};
  const doc=await getDoc();
  const incidents=parseGeorgeIncidents(doc.markdown,{now:now().getTime()});
  let attempted=0,acked=0,failed=0;
  for(const event of incidents){
   const file=local(event);
   let receipt=existsSync(file)?JSON.parse(readFileSync(file,"utf8")):null;
   if(!receipt){
    if(attempted>=2)break;
    attempted++;
    // Local durable claim precedes any model tool call. A crash never
    // silently executes the same external repair twice.
    const id="bghl-neo-"+event.key.slice(0,32);
    atomic(file,{id,status:"CLAIMED",at:now().toISOString(),event});
    // Default is zero paid API requests. A recorded incident is durable, but
    // no background DeepSeek (or other paid model) work is authorised.
    // Human-approved repair is handled by the existing BGHL ChatGPT warden.
    if(cfg("NEO_BGHL_BRIDGE_PAID_INFERENCE_ENABLED")!=="true"){
     receipt={id,event,status:"BLOCKED",
      error:"COST_GUARD_NO_MODEL_CALL",at:now().toISOString(),ack:false};
    }else{
     try{
      const response=await runAgent(event);
      receipt={id,event,status:response?.status||"BLOCKED",
       response:String(response?.response||"").slice(0,2800),
       at:now().toISOString(),ack:false};
     }catch(e){
      receipt={id,event,status:"BLOCKED",
       error:String(e?.message||"NEO_DISPATCH_FAILED").slice(0,110),
       at:now().toISOString(),ack:false};
     }
    }
    atomic(file,receipt);
    logger("[bghl-george-bridge] action=neo_received code="+event.code+
     " status="+receipt.status+" receipt="+receipt.id);
   }
   if(receipt.status==="CLAIMED"){failed++;continue;}
   if(receipt.ack===true)continue;
   try{
    const result=await appendAck(event,receipt);
    receipt.ack=true;receipt.ack_commit=result.commit||null;
    atomic(file,receipt);acked++;
    logger("[bghl-george-bridge] action=ack_confirmed code="+event.code+
     " status="+receipt.status+" receipt="+receipt.id);
   }catch(e){
    failed++;
    logger("[bghl-george-bridge] action=ack_pending reason="+
     String(e?.message||"UNKNOWN").replace(/[^A-Za-z0-9_]/g,"_").slice(0,90));
   }
  }
  return {status:"ACTIVE",seen:incidents.length,attempted,acked,failed};
 }
 return {sweep};
}
