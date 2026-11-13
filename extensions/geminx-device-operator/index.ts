import { Type } from "typebox";
import { jsonResult } from "openclaw/plugin-sdk/channel-actions";
import { definePluginEntry, type AnyAgentTool } from "openclaw/plugin-sdk/plugin-entry";

const ACTION_TO_TOOL: Record<string, string> = {
  list: "device_list",
  status: "device_status",
  open_url: "device_open_url",
  open_app: "device_open_app",
  ui_tree: "device_ui_tree",
  tap: "device_tap",
  swipe: "device_swipe",
  type_text: "device_type_text",
  global_action: "device_global_action",
  screenshot: "device_screenshot",
  install_apk: "device_install_apk",
  // Windows System Operator actions use the same authenticated GeminX bridge,
  // not the Android device command namespace.
  shell_exec: "system_shell_exec",
  git_status: "system_git_status",
  git_diff: "system_git_diff",
  process_list: "system_process_list",
  file_read: "system_file_read",
  desktop_snapshot: "system_desktop_snapshot",
  desktop_uia_scan: "system_desktop_uia_scan",
  desktop_windows: "system_desktop_windows"
};

const GeminXDeviceSchema = Type.Object({
  action: Type.Union([
    Type.Literal("list"),
    Type.Literal("status"),
    Type.Literal("open_url"),
    Type.Literal("open_app"),
    Type.Literal("ui_tree"),
    Type.Literal("tap"),
    Type.Literal("swipe"),
    Type.Literal("type_text"),
    Type.Literal("global_action"),
    Type.Literal("screenshot"),
    Type.Literal("install_apk"),
    Type.Literal("shell_exec"),
    Type.Literal("git_status"),
    Type.Literal("git_diff"),
    Type.Literal("process_list"),
    Type.Literal("file_read"),
    Type.Literal("desktop_snapshot"),
    Type.Literal("desktop_uia_scan"),
    Type.Literal("desktop_windows")
  ]),
  device_id: Type.Optional(Type.String()),
  url: Type.Optional(Type.String()),
  package_name: Type.Optional(Type.String()),
  max_nodes: Type.Optional(Type.Number()),
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
  sha256: Type.Optional(Type.String()),
  command: Type.Optional(Type.String({ maxLength: 16000 })),
  executable: Type.Optional(Type.String({ maxLength: 260 })),
  args: Type.Optional(Type.Array(Type.String({ maxLength: 4096 }), { maxItems: 64 })),
  cwd: Type.Optional(Type.String({ maxLength: 1024 })),
  path: Type.Optional(Type.String({ maxLength: 1024 })),
  timeout_ms: Type.Optional(Type.Integer({ minimum: 1000, maximum: 120000 })),
  monitor_id: Type.Optional(Type.Integer({ minimum: 1, maximum: 16 })),
  include_marks: Type.Optional(Type.Boolean()),
  max_marks: Type.Optional(Type.Integer({ minimum: 1, maximum: 120 })),
  mark_scope: Type.Optional(Type.Union([Type.Literal("foreground"), Type.Literal("desktop")])),
  scope: Type.Optional(Type.Union([Type.Literal("foreground"), Type.Literal("desktop")]))
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
  if (action === "tap") { copy("x"); copy("y"); }
  if (action === "swipe") {
    copy("from_x"); copy("from_y"); copy("to_x"); copy("to_y"); copy("duration_ms");
  }
  if (action === "type_text") copy("value");
  if (action === "global_action") copy("global_action", "action");
  if (action === "screenshot") copy("quality");
  if (action === "install_apk") { copy("url"); copy("sha256"); }
  if (action === "shell_exec") {
    copy("command"); copy("executable"); copy("args"); copy("cwd"); copy("timeout_ms");
  }
  if (action === "git_status" || action === "git_diff") copy("cwd");
  if (action === "file_read") copy("path");
  if (action === "desktop_snapshot") {
    copy("monitor_id"); copy("include_marks"); copy("max_marks"); copy("mark_scope");
  }
  if (action === "desktop_uia_scan") { copy("max_nodes"); copy("scope"); }
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
    signal: AbortSignal.timeout(
      tool === "device_screenshot" || tool === "system_desktop_snapshot" ? 120_000 :
        tool.startsWith("system_") ? 120_000 : 50_000
    )
  });
  const raw = await response.text();
  let payload: any;
  try { payload = JSON.parse(raw); } catch { payload = { ok: false, error: raw.slice(0, 1000) }; }
  if (!response.ok || payload?.ok !== true) {
    throw new Error(String(payload?.error || `GeminX device bridge HTTP ${response.status}`));
  }
  return payload;
}

function createGeminXDeviceTool(): AnyAgentTool {
  return {
    label: "GeminX Device",
    name: "geminx_device",
    description:
      "Operate Rob's paired Android devices and authorised Windows host through the canonical authenticated GeminX bridge. " +
      "Use action=list first; inspect the target status and supported_tools before calling a platform-specific action. " +
      "Windows supports shell_exec, git_status, git_diff, process_list, file_read, desktop_snapshot, desktop_uia_scan and desktop_windows. " +
      "ui_tree is Android-only. Never claim a Windows command succeeded without an execution receipt and relevant readback.",
    parameters: GeminXDeviceSchema,
    execute: async (toolCallId, rawArgs) => {
      const params = rawArgs as Record<string, unknown>;
      const action = String(params.action ?? "").trim();
      const tool = ACTION_TO_TOOL[action];
      if (!tool) throw new Error("Unsupported GeminX device action");
      const windowsAction = tool.startsWith("system_");
      if (windowsAction && !String(params.device_id ?? "").trim())
        throw new Error("WINDOWS_DEVICE_ID_REQUIRED: select the paired Windows host");
      if (action === "ui_tree") {
        const status = await callBridge("device_status", { device_id: params.device_id }, toolCallId + ":platform");
        const device = status?.data ?? {};
        if (String(device.platform ?? "").toLowerCase().includes("windows"))
          throw new Error("ANDROID_ONLY_UI_TREE: use desktop_uia_scan on the Windows host");
      }
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
  }
});
