import { describe, expect, it } from "vitest";
import { getContextNoticeViewModel } from "./context-notice.ts";

describe("Neo Control UI 1M context denominator", () => {
  const session = {
    key: "agent:neo:main", modelProvider: "geminx-deepseek",
    model: "deepseek-flash", totalTokens: 12800, totalTokensFresh: true,
    contextTokens: 128000
  };
  it("renders 1M when the WS defaults confirm the Neo 1M configuration, even if row was stale", () => {
    const vm = getContextNoticeViewModel(session as never, 1000000);
    expect(vm?.detail).toBe("12.8k / 1M");
    expect(vm?.pct).toBe(1);
  });
  it("preserves genuinely configured smaller context budgets", () => {
    const vm = getContextNoticeViewModel(session as never, 128000);
    expect(vm?.detail).toBe("12.8k / 128k");
  });
  it("does not inflate unrelated models even when the default is 1M", () => {
    const vm = getContextNoticeViewModel({
      ...session, modelProvider: "geminx-deepseek", model: "geminx-auto"
    } as never, 1000000);
    expect(vm?.detail).toBe("12.8k / 128k");
  });
});
