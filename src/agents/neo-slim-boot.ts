/**
 * Deterministic, static-first NEO model-facing capsule.
 * The entire canonical context is preserved separately in brain-live.json.
 * Source paths are identifiers (not authority): only verified snapshots may
 * produce an ATTACHED capsule. This function never fetches or sends tokens.
 */
const STATIC_RULES = "Agents/NEO/OPERATING_RULES.md";
const ACTIVE_STATE = "Agents/NEO/ACTIVE_STATE.md";
export const NEO_SLIM_BRAIN_MAX_CHARS = 6_000;
export const NEO_NATIVE_BOOT_MAX_CHARS = 10_000;

export interface NeoSlimBrainInput {
  context: string;
  sourcePaths: readonly string[];
  status: "ATTACHED" | "CACHED_VERIFIED";
  revision?: string;
  cacheAgeMs?: number;
}
function segmentsOf(context: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const segment of context.split(/\n\n---\n\n/g)) {
    const match = /^SOURCE FILE: ([^\r\n]+)\r?\n[^\r\n]*\r?\n([\s\S]*)/.exec(segment.trimStart());
    if (match && !map.has(match[1])) map.set(match[1], match[2].trim());
  }
  return map;
}
export function compactNeoBrain(input: NeoSlimBrainInput): string {
  const segments = segmentsOf(input.context);
  // Server may return source_paths separately; older on-disk cache has only
  // the verified original context. Derive the same index from its source markers.
  const sourceSet = new Set([...segments.keys(), ...input.sourcePaths]);
  if (!sourceSet.has(STATIC_RULES) || !sourceSet.has(ACTIVE_STATE) ||
      !segments.has(STATIC_RULES) || !segments.has(ACTIVE_STATE)) {
    // A missing doctrine is a continuity failure, not licence to substitute
    // a stale free-form summary or report CURRENT.
    throw new Error("NEO_REQUIRED_BOOT_CONTEXT_UNAVAILABLE");
  }
  const paths = [...sourceSet].filter((p) => /^[A-Za-z0-9_./-]{1,220}$/.test(p)).sort();
  const ruleText = segments.get(STATIC_RULES)!;
  const stateText = segments.get(ACTIVE_STATE)!;
  // Keep rule instructions and immutable paths before all changing state.
  const rule = ruleText.slice(0, 3_500);
  const index = paths.map((p) => "- " + p).join("\n").slice(0, 950);
  const staticPart = [
    "# NEO — canonical operating rules (verified source)",
    rule,
    "",
    "## Brain index (full snapshot on persistent volume)",
    "Use targeted read of /home/node/.openclaw/.neo-remote-brain/brain-live.json",
    "Do not read the full snapshot into the model context by default.",
    index,
    "",
    "## Current state (bounded; live receipts override stale prose)",
    stateText.slice(0, 850),
  ].join("\n");
  const metadata = [
    "",
    "## Verification metadata (volatile; intentionally last)",
    "REMOTE_BRAIN_STATUS=" + input.status,
    "BRAIN_REVISION=" + (input.revision ?? "UNVERIFIED"),
    "CACHE_AGE_MS=" + (input.cacheAgeMs ?? 0),
  ].join("\n");
  return (staticPart.slice(0, NEO_SLIM_BRAIN_MAX_CHARS - metadata.length) + metadata)
    .slice(0, NEO_SLIM_BRAIN_MAX_CHARS);
}
