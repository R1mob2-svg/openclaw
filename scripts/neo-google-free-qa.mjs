// OPTIONAL Google-only factual QA after NEO's DeepSeek-built website passes deterministic checks.
// Uses the EXISTING authenticated GeminX proxy; never uses raw Google keys or paid fallbacks.
// Usage: node scripts/neo-google-free-qa.mjs /path/to/public-evidence-and-qa.txt
import fs from "node:fs";

function fail(code, detail) {
  console.error("[neo-google-free-qa] " + code + (detail ? " " + detail : ""));
  process.exitCode = 3;
}

export function buildQaRequest(evidence) {
  return {
    model: "geminx-google-qa",
    stream: false,
    temperature: 0,
    max_tokens: 1024,
    messages: [
      { role: "system", content: "You are an independent read-only Digital Ambush quality checker. Evaluate ONLY the evidence supplied. Flag wrong branding, missing logo provenance, inaccurate services, unsafe claims, inaccessible URL or skipped tests. Never claim to have visited a URL or executed tests. Reply in concise JSON with keys verdict, supported, failures, missing_evidence." },
      { role: "user", content: evidence }
    ]
  };
}

async function main() {
  const input = process.argv[2];
  if (!input || !fs.existsSync(input)) { fail("EVIDENCE_FILE_MISSING"); return; }
  const stat = fs.statSync(input);
  if (!stat.isFile() || stat.size < 10 || stat.size > 12000) { fail("EVIDENCE_SIZE_INVALID"); return; }
  const evidence = fs.readFileSync(input, "utf8");
  const base = String(process.env.OPENCLAW_MODEL_PROXY_BASE_URL || "").trim().replace(/\/+$/, "");
  const token = String(process.env.OPENCLAW_GATEWAY_TOKEN || "").trim();
  if (!base || token.length < 24) { fail("EXISTING_PROXY_AUTH_UNAVAILABLE"); return; }
  const root = base.replace(/\/v1$/, "");
  const status = await fetch(root + "/status", {
    headers: { authorization: "Bearer " + token },
    signal: AbortSignal.timeout(12000)
  });
  if (!status.ok) { fail("PROXY_STATUS_UNAVAILABLE", String(status.status)); return; }
  const snapshot = await status.json();
  if (snapshot.schema_version !== "geminx.one-model-core.status.v1" ||
      snapshot.google_free_admission !== "ready" ||
      !Number.isFinite(snapshot.google_free_requests_remaining) ||
      snapshot.google_free_requests_remaining < 1) {
    fail("GOOGLE_FREE_QA_NOT_VERIFIED_OR_EXHAUSTED");
    return;
  }
  // Only the dedicated, no-paid-fallback alias is permitted. The backend
  // rejects unsupported Google formats and never silently bills DeepSeek.
  const response = await fetch(base + "/chat/completions", {
    method: "POST",
    headers: { authorization: "Bearer " + token, "content-type": "application/json" },
    body: JSON.stringify(buildQaRequest(evidence)),
    signal: AbortSignal.timeout(45000)
  });
  if (!response.ok) { fail("GOOGLE_QA_PROVIDER_BLOCKED", String(response.status)); return; }
  const payload = await response.json();
  const providerModel = String(payload.model || "");
  if (!/^gemini[-/]/i.test(providerModel)) { fail("GOOGLE_QA_PROVIDER_MISMATCH"); return; }
  const answer = String(payload.choices?.[0]?.message?.content || "").slice(0, 4096);
  if (!answer) { fail("GOOGLE_QA_EMPTY_RESULT"); return; }
  console.log(JSON.stringify({ status: "GOOGLE_ONLY_QA_RECEIVED", provider_model: providerModel, response: answer }));
}

if (process.argv[1]?.endsWith("neo-google-free-qa.mjs")) {
  main().catch(() => fail("GOOGLE_QA_TRANSPORT_UNAVAILABLE"));
}
