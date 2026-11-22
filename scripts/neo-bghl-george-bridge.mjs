/**
 * Existing Railway NEO agent-message-bus sidecar: BGHL George incident consumer.
 * Delivers code-only incidents from George's private state branch into the
 * authenticated native NEO gateway and returns a CAS receipt to that branch.
 * No Telegram bot-to-bot messaging, new scheduler, new LLM, or owner alerts.
 */
import {createHash,randomUUID} from "node:crypto";
import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync,readdirSync} from "node:fs";
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
  const messageId=/^message_id: (BGHL-TECH-[a-f0-9]{64})\s*$/m.exec(chunk)?.[1];
  if(!CODES.has(code)||!trace||!REF.test(trace)||!SHA.test(key)||!messageId||used.has(key))continue;
  // The payload has no user-generated Markdown, free-text instructions, phone IDs or secrets.
  output.push({code,trace,source:head[2],at:head[1],key,messageId});
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
 const maxRepairsPerDay=()=>Math.min(3,Math.max(1,Number(cfg("NEO_BGHL_REPAIR_DAILY_MAX"))||2));
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
    "\nstatus: RECEIVED\nreported_outcome: "+receipt.status+"\nrepair_mechanically_verified: false\n"+
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
  // Atomic cross-agent claim. Newton must use this SAME GitHub CAS ledger,
  // not a separate lock. Leases are deliberately longer than a model run.
  async function claim(event){
   const leaseId="lease-"+randomUUID(),holder="RAILWAY_NEO";
   for(let attempt=0;attempt<5;attempt++){
    const current=await getDoc(),time=now();
    const chunks=current.markdown.split(/(?=^### \d{4}-\d{2}-\d{2}T)/gm);
    // A technical receipt is an acknowledgement, not a verified repair.
    // Newton can take over after a BLOCKED result or an expired lease.
    const repaired=chunks.some(x=>/^event: BGHL_REPAIR_RESOLUTION$/m.test(x)&&
      /^status: VERIFIED$/m.test(x)&&x.includes("message_id: "+event.messageId+"\n"));
    if(repaired)return {ok:false,reason:"REPAIR_ALREADY_VERIFIED"};
    const previous=chunks.filter(x=>/^event: BGHL_REPAIR_CLAIM$/m.test(x)&&
      x.includes("message_id: "+event.messageId+"\n"))
      .map(x=>({until:Date.parse(/^lease_until: (.+)$/m.exec(x)?.[1]||""),
        holder:/^claimed_by: (.+)$/m.exec(x)?.[1]}))
      .filter(x=>Number.isFinite(x.until)).sort((a,b)=>b.until-a.until)[0];
    if(previous&&previous.until>time.getTime())
      return {ok:false,reason:"EXCLUSIVE_LEASE_HELD",holder:previous.holder};
    if(!parseGeorgeIncidents(current.markdown,{now:time.getTime()}).some(x=>
      x.key===event.key&&x.messageId===event.messageId))
      return {ok:false,reason:"INCIDENT_CHANGED_OR_STALE"};
    const end=new Date(time.getTime()+15*60000).toISOString();
    const next=current.markdown.trimEnd()+"\n\n### "+time.toISOString()+
     " — Railway NEO — exclusive-repair-claim\n\n~~~\n"+
     "event: BGHL_REPAIR_CLAIM\nmessage_id: "+event.messageId+
     "\nincident_key: "+event.key+
     "\nclaimed_by: "+holder+
     "\nlease_id: "+leaseId+
     "\nlease_until: "+end+
     "\nstatus: CLAIMED\nno_customer_send: true\n~~~\n";
    const r=await requester(ENDPOINT,{method:"PUT",headers:headers(tkn()),
     body:JSON.stringify({branch:BRANCH,sha:current.sha,
      content:Buffer.from(next).toString("base64"),
      message:"bghl: NEO claim "+event.messageId}),
     signal:AbortSignal.timeout(12000)});
    if([409,422].includes(r.status))continue;
    if(!r.ok)throw Error("BGHL_REPAIR_CLAIM_HTTP_"+r.status);
    if(!(await r.json())?.commit?.sha)throw Error("BGHL_REPAIR_CLAIM_UNCONFIRMED");
    const readback=await getDoc();
    if(!readback.markdown.includes("lease_id: "+leaseId+"\n"))
      throw Error("BGHL_REPAIR_CLAIM_READBACK_FAILED");
    return {ok:true,leaseId,holder,until:end};
   }
   return {ok:false,reason:"EXCLUSIVE_CAS_CONFLICT"};
  }
  function repairsToday(){
   const day=now().toISOString().slice(0,10);
   return readdirSync(directory()).filter(name=>{
     if(!/^george-[a-f0-9]{64}\.json$/.test(name))return false;
     try{const rec=JSON.parse(readFileSync(path.join(directory(),name),"utf8"));
       return rec?.claimed_at?.startsWith(day)&&rec?.paid_repair_dispatched===true;
     }catch{return false;}
   }).length;
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
  let attempted=0,acked=0,failed=0,skipped=0;
  for(const event of incidents){
   const file=local(event);
   let receipt=existsSync(file)?JSON.parse(readFileSync(file,"utf8")):null;
   if(!receipt){
    if(attempted>=1)break; // one genuine repair at most per 30-minute sweep
    if(cfg("NEO_BGHL_BRIDGE_PAID_INFERENCE_ENABLED")!=="true"){
      skipped++;continue; // no paid call, no false terminal receipt
    }
    if(repairsToday()>=maxRepairsPerDay()){skipped++;continue;}
    const lease=await claim(event);
    if(!lease.ok){skipped++;continue;}
    attempted++;
    const id="bghl-neo-"+event.key.slice(0,32);
    receipt={id,event,status:"CLAIMED",claimed_at:now().toISOString(),
      lease_id:lease.leaseId,paid_repair_dispatched:true,ack:false};
    atomic(file,receipt);
    try{
     const response=await runAgent(event);
     receipt={...receipt,status:response?.status||"BLOCKED",
      response:String(response?.response||"").slice(0,2800),
      finished_at:now().toISOString()};
    }catch(e){
     receipt={...receipt,status:"BLOCKED",
      error:String(e?.message||"NEO_DISPATCH_FAILED").slice(0,110),
      finished_at:now().toISOString()};
    }
    atomic(file,receipt);
    logger("[bghl-george-bridge] action=neo_repair_attempt code="+event.code+
     " status="+receipt.status+" receipt="+receipt.id);
   }
   if(receipt.status==="CLAIMED"){failed++;continue;}
   if(receipt.ack===true)continue;
   try{
    const result=await appendAck(event,receipt);
    receipt.ack=true;receipt.ack_commit=result.commit||null;
    atomic(file,receipt);acked++;
    logger("[bghl-george-bridge] action=ack_confirmed message_id="+event.messageId+
     " status="+receipt.status+" receipt="+receipt.id);
   }catch(e){
    failed++;
    logger("[bghl-george-bridge] action=ack_pending reason="+
     String(e?.message||"UNKNOWN").replace(/[^A-Za-z0-9_]/g,"_").slice(0,90));
   }
  }
  return {status:"ACTIVE",seen:incidents.length,attempted,acked,failed,skipped};
 }
 return {sweep};
}

