const rawBase=String(process.env.OPENCLAW_AUDIT_URL||"").trim().replace(/\/$/,"");
const token=String(process.env.OPENCLAW_AUDIT_TOKEN||"").trim();
if(!rawBase) throw new Error("OPENCLAW_AUDIT_URL_MISSING");
if(!token) throw new Error("OPENCLAW_AUDIT_TOKEN_MISSING");
const base=/^https?:\/\//i.test(rawBase)?rawBase:`https://${rawBase}`;

async function rpc(method,params={}){
  const response=await fetch(base+"/api/v1/admin/rpc",{
    method:"POST",
    headers:{"content-type":"application/json",authorization:"Bearer "+token},
    body:JSON.stringify({id:"geminx-windows-recovery-audit",method,params}),
    signal:AbortSignal.timeout(20000)
  });
  const raw=await response.text();
  let body={}; try{body=raw?JSON.parse(raw):{}}catch{}
  if(!response.ok||body?.ok!==true){
    throw new Error(`RPC_${method}_FAILED status=${response.status} reason=${JSON.stringify(body?.error||raw.slice(0,300))}`);
  }
  return body.payload??{};
}
const payload=await rpc("node.list",{});
const nodes=Array.isArray(payload?.nodes)?payload.nodes:Array.isArray(payload)?payload:[];
const safe=nodes.map((n)=>({
  node_id:String(n?.nodeId??n?.id??"").slice(0,160),
  display_name:String(n?.displayName??n?.name??"").slice(0,160),
  platform:String(n?.platform??"").slice(0,80),
  device_family:String(n?.deviceFamily??n?.device_family??"").slice(0,80),
  connected:n?.connected===true,
  commands:Array.isArray(n?.commands)?n.commands.map(String).filter((x)=>/^(?:system\.|device\.|screen\.|canvas\.)/.test(x)).slice(0,80):[]
}));
console.log("OPENCLAW_NODE_MATRIX",JSON.stringify(safe));
const windows=safe.filter((n)=>/win/i.test(n.platform)||/win/i.test(n.device_family)||/windows/i.test(n.display_name));
console.log("OPENCLAW_WINDOWS_NODES",JSON.stringify(windows));
const connected=windows.filter((n)=>n.connected);
if(!windows.length){
  console.log("OPENCLAW_WINDOWS_RECOVERY_BOUNDARY",JSON.stringify({status:"NO_WINDOWS_NODE"}));
  process.exit(2);
}
if(!connected.length){
  console.log("OPENCLAW_WINDOWS_RECOVERY_BOUNDARY",JSON.stringify({status:"WINDOWS_NODE_OFFLINE",nodes:windows.map(n=>({node_id:n.node_id,display_name:n.display_name}))}));
  process.exit(2);
}
console.log("OPENCLAW_WINDOWS_RECOVERY_READY",JSON.stringify({nodes:connected}));
