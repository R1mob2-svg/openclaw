import type { IncomingMessage, ServerResponse } from "node:http";
import { Type } from "typebox";
import { dispatchGatewayMethod } from "openclaw/plugin-sdk/gateway-method-runtime";
import { jsonResult } from "openclaw/plugin-sdk/channel-actions";
import { definePluginEntry, type AnyAgentTool } from "openclaw/plugin-sdk/plugin-entry";

const ACTION_TO_TOOL: Record<string, string> = {
  list: "device_list",
  status: "device_status",
  open_url: "device_open_url",
  open_app: "device_open_app",
  ui_tree: "device_ui_tree",
  tap_text: "device_tap_text",
  tap_id: "device_tap_id",
  focus_and_type: "device_focus_and_type",
  scroll: "device_scroll",
  tap: "device_tap",
  swipe: "device_swipe",
  type_text: "device_type_text",
  global_action: "device_global_action",
  screenshot: "device_screenshot",
  audio_capture: "device_audio_capture",
  install_apk: "device_install_apk"
};

const GeminXDeviceSchema = Type.Object({
  action: Type.Union([
    Type.Literal("list"),
    Type.Literal("status"),
    Type.Literal("open_url"),
    Type.Literal("open_app"),
    Type.Literal("ui_tree"),
    Type.Literal("tap_text"),
    Type.Literal("tap_id"),
    Type.Literal("focus_and_type"),
    Type.Literal("scroll"),
    Type.Literal("tap"),
    Type.Literal("swipe"),
    Type.Literal("type_text"),
    Type.Literal("global_action"),
    Type.Literal("screenshot"),
    Type.Literal("audio_capture"),
    Type.Literal("install_apk")
  ]),
  device_id: Type.Optional(Type.String()),
  url: Type.Optional(Type.String()),
  package_name: Type.Optional(Type.String()),
  max_nodes: Type.Optional(Type.Number()),
  text: Type.Optional(Type.String()),
  view_id: Type.Optional(Type.String()),
  direction: Type.Optional(Type.Union([
    Type.Literal("forward"),
    Type.Literal("backward"),
    Type.Literal("down"),
    Type.Literal("up")
  ])),
  seconds: Type.Optional(Type.Number()),
  x: Type.Optional(Type.Number()),
  y: Type.Optional(Type.Number()),
  from_x: Type.Optional(Type.Number()),
  from_y: Type.Optional(Type.Number()),
  to_x: Type.Optional(Type.Number()),
  to_y: Type.Optional(Type.Number()),
  duration_ms: Type.Optional(Type.Number()),
  value: Type.Optional(Type.String()),
  global_action: Type.Optional(Type.Union([
    Type.Literal("back"),
    Type.Literal("home"),
    Type.Literal("recents"),
    Type.Literal("notifications"),
    Type.Literal("quick_settings")
  ])),
  quality: Type.Optional(Type.Number()),
  sha256: Type.Optional(Type.String())
});

function bridgeUrl(): string {
  const raw = String(process.env.OPENCLAW_GEMINX_DEVICE_BRIDGE_URL ?? "").trim();
  if (!raw) throw new Error("OPENCLAW_GEMINX_DEVICE_BRIDGE_URL is not configured");
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error("GeminX device bridge must use HTTPS");
  return url.toString().replace(/\/+$/, "");
}

function bridgeToken(): string {
  const token = String(process.env.OPENCLAW_GEMINX_DEVICE_BRIDGE_TOKEN ?? "").trim();
  if (!token) throw new Error("OPENCLAW_GEMINX_DEVICE_BRIDGE_TOKEN is not configured");
  return token;
}

function toolArgs(params: Record<string, unknown>, action: string): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  const copy = (from: string, to = from) => {
    if (params[from] !== undefined) args[to] = params[from];
  };
  copy("device_id");
  if (action === "open_url") copy("url");
  if (action === "open_app") copy("package_name");
  if (action === "ui_tree") copy("max_nodes");
  if (action === "tap_text") copy("text");
  if (action === "tap_id") copy("view_id");
  if (action === "focus_and_type") { copy("x"); copy("y"); copy("value"); }
  if (action === "scroll") copy("direction");
  if (action === "tap") { copy("x"); copy("y"); }
  if (action === "swipe") {
    copy("from_x"); copy("from_y"); copy("to_x"); copy("to_y"); copy("duration_ms");
  }
  if (action === "type_text") copy("value");
  if (action === "global_action") copy("global_action", "action");
  if (action === "screenshot") copy("quality");
  if (action === "audio_capture") copy("seconds");
  if (action === "install_apk") { copy("url"); copy("sha256"); }
  return args;
}

async function callBridge(tool: string, args: Record<string, unknown>, toolCallId: string) {
  const response = await fetch(`${bridgeUrl()}/execute`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${bridgeToken()}`
    },
    body: JSON.stringify({
      tool,
      args,
      tool_call_id: toolCallId,
      correlation_id: `openclaw:${toolCallId}`
    }),
    signal: AbortSignal.timeout(tool === "device_screenshot" || tool === "device_audio_capture" ? 80_000 : 50_000)
  });
  const raw = await response.text();
  let payload: any;
  try { payload = JSON.parse(raw); } catch { payload = { ok: false, error: raw.slice(0, 1000) }; }
  if (!response.ok || payload?.ok !== true) {
    throw new Error(String(payload?.error || `GeminX device bridge HTTP ${response.status}`));
  }
  return payload;
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.statusCode = statusCode;
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

async function handleGeminXRepairRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  if ((req.method ?? "GET").toUpperCase() !== "POST") {
    res.setHeader("Allow", "POST");
    sendJson(res, 405, { ok: false, error: "method_not_allowed" });
    return true;
  }

  const result = await dispatchGatewayMethod("gateway.restart.request", {
    reason: "GeminX warden requested bounded OpenClaw gateway recovery",
    skipDeferral: false,
  });

  if (!result.ok) {
    sendJson(res, 503, {
      ok: false,
      error: result.error?.message ?? "gateway restart request failed",
    });
    return true;
  }

  sendJson(res, 202, {
    ok: true,
    data: {
      accepted: true,
      action: "safe_gateway_restart",
      payload: result.payload ?? null,
    },
  });
  return true;
}

function createGeminXDeviceTool(): AnyAgentTool {
  return {
    label: "GeminX Device",
    name: "geminx_device",
    description:
      "Control Rob's paired GeminX Android device through the canonical Device Operator. " +
      "Use action=list first when device_id is unknown, then status/ui_tree/screenshot before making claims about what is connected or visible. " +
      "Use tap/swipe/type/open actions only when Rob asks. Google Photos remains denied by local policy unless Rob explicitly changes that policy.",
    parameters: GeminXDeviceSchema,
    execute: async (toolCallId, rawArgs) => {
      const params = rawArgs as Record<string, unknown>;
      const action = String(params.action ?? "").trim();
      const tool = ACTION_TO_TOOL[action];
      if (!tool) throw new Error("Unsupported GeminX device action");
      const payload = await callBridge(tool, toolArgs(params, action), toolCallId);
      const data = payload?.data ?? null;

      if (action === "screenshot" && data && typeof data === "object") {
        const dataUrl = String((data as Record<string, unknown>).screenshot_data_url ?? "");
        const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\r\n]+)$/.exec(dataUrl);
        if (match) {
          const details = { ...(data as Record<string, unknown>), screenshot_data_url: undefined };
          return {
            content: [
              { type: "image", data: match[2], mimeType: match[1] },
              { type: "text", text: "GeminX Device screenshot captured successfully." }
            ],
            details
          };
        }
      }

      return jsonResult(data ?? { ok: true });
    }
  };
}

export default definePluginEntry({
  id: "geminx-device-operator",
  name: "GeminX Device Operator",
  description: "Canonical GeminX paired-device bridge for NEO",
  register(api) {
    api.registerTool(() => createGeminXDeviceTool());
    api.registerHttpRoute({
      path: "/api/v1/geminx/repair",
      auth: "gateway",
      match: "exact",
      gatewayRuntimeScopeSurface: "trusted-operator",
      handler: handleGeminXRepairRequest,
    });
  }
});
