import path from "node:path";
import { fileURLToPath } from "node:url";

const CODE_URL = "https://api.github.com/repos/R1mob2-svg/geminx-v2/contents/package.json";
const CANDIDATES = ["GH_TOKEN", "GEMINX_REPO_ACCESS_TOKEN", "GITHUB_TOKEN", "GITHUB_PAT"];

/** Find an existing credential that can actually read private GeminX source. */
export async function selectNeoGithubSource(options = {}) {
  const environment = options.environment ?? process.env;
  const fetcher = options.fetcher ?? globalThis.fetch;
  for (const name of CANDIDATES) {
    const credential = String(environment[name] ?? "").trim();
    if (!credential) continue;
    try {
      const result = await fetcher(CODE_URL, {
        headers: {
          Authorization: "Bearer " + credential,
          Accept: "application/vnd.github+json",
          "User-Agent": "openclaw-neo-github-preflight"
        },
        signal: AbortSignal.timeout(5000)
      });
      if (result.ok) return name;
    } catch {
      // Continue through existing configured credentials; never disclose them.
    }
  }
  return null;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const source = await selectNeoGithubSource();
  if (source) process.stdout.write(source + "\n");
  else process.exitCode = 1;
}
