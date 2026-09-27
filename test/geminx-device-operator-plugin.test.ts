import { describe, expect, it } from "vitest";
import fs from "node:fs";

describe("GeminX Device Operator OpenClaw bridge", () => {
  it("registers one native NEO device tool against the scoped GeminX bridge", () => {
    const plugin = fs.readFileSync("extensions/geminx-device-operator/index.ts", "utf8");
    const manifest = fs.readFileSync("extensions/geminx-device-operator/openclaw.plugin.json", "utf8");

    expect(manifest).toContain('"id": "geminx-device-operator"');
    expect(manifest).toContain('"enabledByDefault": true');
    expect(manifest).toContain('"tools": [');
    expect(manifest).toContain('"geminx_device"');
    expect(plugin).toContain('name: "geminx_device"');
    expect(plugin).toContain("api.registerTool");
    expect(plugin).toContain("OPENCLAW_GEMINX_DEVICE_BRIDGE_URL");
    expect(plugin).toContain("OPENCLAW_GEMINX_DEVICE_BRIDGE_TOKEN");
    expect(plugin).toContain('"device_screenshot"');
    expect(plugin).toContain('"device_ui_tree"');
    expect(plugin).toContain("Google Photos remains denied by local policy");
  });
});
