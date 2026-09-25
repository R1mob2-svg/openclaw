const NEO_RAILWAY_CONTROL_UI_HOST = "openclaw-neo-runtime-production.up.railway.app";
const NEO_FOUNDER_LAUNCH_URL =
  "https://geminx-backend-production.up.railway.app/api/v1/founder/openclaw/launch";

export type FounderAutoLaunchInput = {
  authErrorCode?: string | null;
  pageHref?: string | null;
  explicitToken?: string | null;
  password?: string | null;
};

/**
 * The dedicated Rob/NEO Railway UI should never strand the founder on the
 * generic "token missing" screen. A missing shared token on this one canonical
 * deployment is recovered through GeminX's authenticated founder launcher.
 *
 * Other OpenClaw deployments and other authentication failures are untouched.
 */
export function resolveFounderAutoLaunchUrl(input: FounderAutoLaunchInput): string | null {
  if (input.authErrorCode !== "AUTH_TOKEN_MISSING") return null;
  if (String(input.explicitToken ?? "").trim()) return null;
  if (String(input.password ?? "").trim()) return null;

  try {
    const page = new URL(String(input.pageHref ?? ""));
    if (page.protocol !== "https:" || page.hostname !== NEO_RAILWAY_CONTROL_UI_HOST) return null;
  } catch {
    return null;
  }

  return NEO_FOUNDER_LAUNCH_URL;
}

export { NEO_FOUNDER_LAUNCH_URL, NEO_RAILWAY_CONTROL_UI_HOST };
