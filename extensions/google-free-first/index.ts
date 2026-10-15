import fs from "node:fs";
import path from "node:path";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

const PRIMARY_PROVIDER = "google";
const PRIMARY_MODEL = "gemini-3.7-flash";
const FALLBACK_PROVIDER = "deepseek";
const FALLBACK_MODEL = "deepseek-chat";

type DailyLedger = {
  utcDay: string;
  total: number;
  counts: Record<string, number>;
};

function isTrue(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

function limit(raw: string | undefined, fallback: number, max: number): number {
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

function getPath(): string {
  return process.env.OPENCLAW_GOOGLE_FREE_LEDGER_PATH ||
    path.join(process.env.OPENCLAW_STATE_DIR || path.join(process.env.HOME || ".", ".openclaw"),
      "google-free-daily-usage.json");
}

function readDay(): DailyLedger {
  const utcDay = new Date().toISOString().slice(0, 10);
  try {
    const v = JSON.parse(fs.readFileSync(getPath(), "utf8")) as Partial<DailyLedger>;
    if (v.utcDay === utcDay && v.counts && typeof v.counts === "object") {
      return { utcDay, total: Math.max(0, Number(v.total || 0)), counts: v.counts };
    }
  } catch {
    // Missing ledger is normal at first startup; quota availability is NOT proved.
  }
  return { utcDay, total: 0, counts: {} };
}

function writeDay(value: DailyLedger): void {
  const file = getPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + ".tmp-" + process.pid;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(temp, file);
}

function eligible(): boolean {
  // Google's free API may use inputs to improve products. NEVER auto-enable
  // private Brain/credentials for free-tier processing without deliberate opt-in.
  return isTrue(process.env.OPENCLAW_GOOGLE_FREE_FIRST_ENABLED) &&
    isTrue(process.env.OPENCLAW_GOOGLE_FREE_TIER_CONFIRMED) &&
    isTrue(process.env.OPENCLAW_GOOGLE_FREE_PRIVATE_DATA_OPT_IN) &&
    Boolean((process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "").trim());
}

export default definePluginEntry({
  id: "google-free-first",
  name: "Google free-first routing",
  description: "Google Flash first, conservative per-agent request caps and DeepSeek fallback.",
  register(api) {
    api.on("before_model_resolve", (_event, ctx) => {
      if (!eligible()) return;
      const agent = String(ctx.agentId || "main").toLowerCase();
      const state = readDay();
      const agentCap = limit(process.env.OPENCLAW_GOOGLE_FREE_PER_AGENT_DAILY, 12, 200);
      const sharedCap = limit(process.env.OPENCLAW_GOOGLE_FREE_SHARED_DAILY, 36, 1000);
      if (state.total >= sharedCap || (state.counts[agent] || 0) >= agentCap) {
        return { providerOverride: FALLBACK_PROVIDER, modelOverride: FALLBACK_MODEL };
      }
      return { providerOverride: PRIMARY_PROVIDER, modelOverride: PRIMARY_MODEL };
    }, { priority: 50 });

    // Counts actual calls rather than chat turns. The native OpenClaw model
    // failover remains the authority when Google itself returns a quota 429.
    // Each runtime has a local counter, not a distributed Google project ledger.
    api.on("model_call_started", (event, ctx) => {
      if (!eligible()) return;
      if (event.provider !== PRIMARY_PROVIDER || event.model !== PRIMARY_MODEL) return;
      const agent = String(ctx.agentId || "main").toLowerCase();
      const state = readDay();
      state.total += 1;
      state.counts[agent] = (state.counts[agent] || 0) + 1;
      writeDay(state);
      api.logger.info("[google-free-first] quota reservation agent=" + agent +
        " requests=" + state.counts[agent] + " total=" + state.total);
    });
  }
});
