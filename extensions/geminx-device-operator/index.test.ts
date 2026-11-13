import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const names = ["shell_exec","git_status","git_diff","process_list","file_read",
  "desktop_snapshot","desktop_uia_scan","desktop_windows"] as const;

describe("GeminX device operator Windows bridge contract", () => {
  it("has 19 actions with the canonical device_* backend prefix", () => {
    const literals = [...source.matchAll(/Type\.Literal\("([^"]+)"\)/g)]
      .map(match => match[1]);
    const actions = literals.slice(0, 19);
    expect(actions).toHaveLength(19);
    expect(new Set(actions).size).toBe(19);
    for (const action of names) {
      expect(source).toContain(`${action}: "device_${action}"`);
      expect(actions).toContain(action);
      expect(source).not.toContain(`${action}: "system_${action}"`);
    }
  });
  it("keeps Windows-shell timeout at 120 seconds and Android-only ui_tree", () => {
    expect(source).toContain('tool === "device_shell_exec" ? 120_000');
    expect(source).toContain("ANDROID_ONLY_UI_TREE");
    expect(source).toContain('const windowsAction = WINDOWS_ONLY_ACTIONS.has(action);');
    expect(source).toContain('callBridge("device_status"');
  });
});
