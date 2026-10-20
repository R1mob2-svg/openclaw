import { Buffer } from "node:buffer";
import { pathToFileURL } from "node:url";

const API = "https://api.github.com/repos/R1mob2-svg/global-agent-brain";
const SHA = /^[a-f0-9]{40}$/i;

/** Read-only, pinned boot validation. A SHA is never invented from model prose. */
export async function verifiedNeoBrainRef({ token, fetcher = fetch } = {}) {
  const credential = String(token ?? process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? process.env.GITHUB_PAT ?? "").trim();
  if (!credential) throw new Error("NEO_BRAIN_GITHUB_TOKEN_UNAVAILABLE");
  const headers = {
    authorization: `Bearer ${credential}`,
    accept: "application/vnd.github+json",
    "user-agent": "entreprenuity-neo-brain-boot-receipt"
  };
  const ref = await fetcher(`${API}/git/ref/heads/main`, {
    headers, redirect: "error", signal: AbortSignal.timeout(8000)
  });
  if (!ref.ok) throw new Error(`NEO_BRAIN_REF_HTTP_${ref.status}`);
  const body = await ref.json();
  const sha = String(body?.object?.sha ?? "").trim();
  if (!SHA.test(sha) || body?.object?.type !== "commit") {
    throw new Error("NEO_BRAIN_REF_INVALID");
  }
  // Verify the actual factory contract at the very same immutable SHA.
  const boot = await fetcher(`${API}/contents/Agents/NEO/BOOT/INDEX.md?ref=${sha}`, {
    headers, redirect: "error", signal: AbortSignal.timeout(8000)
  });
  if (!boot.ok) throw new Error(`NEO_BRAIN_BOOT_HTTP_${boot.status}`);
  const payload = await boot.json();
  if (payload?.encoding !== "base64" || typeof payload?.content !== "string") {
    throw new Error("NEO_BRAIN_BOOT_NOT_BASE64");
  }
  const doc = Buffer.from(payload.content.replace(/\s/g, ""), "base64").toString("utf8");
  if (!doc.includes("# NEO Boot Index") || !doc.includes("Digital Ambush Mockup Factory") ||
      !doc.includes("1440x900") || !doc.includes("ONE unique private")) {
    throw new Error("NEO_BRAIN_FACTORY_BOOT_CONTRACT_MISMATCH");
  }
  return sha.toLowerCase();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifiedNeoBrainRef()
    .then(sha => { process.stdout.write(sha); })
    .catch(err => {
      // Output only a non-sensitive error class, never token or private Brain.
      process.stderr.write("NEO_BRAIN_RECEIPT_REF_UNAVAILABLE: " + String(err?.message || err).slice(0, 100) + "\n");
      process.exitCode = 1;
    });
}
