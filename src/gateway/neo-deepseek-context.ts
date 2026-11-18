/**
 * Explicit Railway Neo DeepSeek V4 context contract.
 *
 * The model catalog and agents.defaults declare a 1,000,000-token window, but
 * legacy sessions.json entries still carry the previous 128,000 cap. The UI
 * consumes sessions.list contextTokens, NOT the model CLI list. For this exact
 * configured model only, never let the old persisted metadata override the
 * canonical model contract. Other models retain existing conservative limits.
 */
import type { OpenClawConfig } from "../config/types.openclaw.js";

const NEO_PROVIDER = "geminx-deepseek";
const NEO_MODELS = new Set(["deepseek-flash", "deepseek-v4-pro"]);
export const NEO_CONTEXT_TOKENS = 1_000_000;

export function resolveConfiguredNeoDeepSeekContext(params: {
  cfg: OpenClawConfig;
  provider?: string | null;
  model?: string | null;
}): number | undefined {
  if (params.provider !== NEO_PROVIDER || !NEO_MODELS.has(params.model ?? "")) {
    return undefined;
  }
  // Fail closed unless the current runtime has the actual 1M model declared.
  // This does not inflate an unrelated user/provider/model or custom override.
  const provider = params.cfg.models?.providers?.[NEO_PROVIDER];
  const entry = provider?.models?.find((model) => model.id === params.model);
  if (entry?.contextWindow !== NEO_CONTEXT_TOKENS ||
      params.cfg.agents?.defaults?.contextTokens !== NEO_CONTEXT_TOKENS) {
    return undefined;
  }
  return NEO_CONTEXT_TOKENS;
}
