import { describe, expect, it } from "vitest";
import { compactNeoBrain, NEO_SLIM_BRAIN_MAX_CHARS, NEO_NATIVE_BOOT_MAX_CHARS } from "./neo-slim-boot.js";

const RULES = "Agents/NEO/OPERATING_RULES.md";
const STATE = "Agents/NEO/ACTIVE_STATE.md";
const SOURCE = "Trading/PAPER_TOURNAMENT_RISK_STANDARD.md";
function segment(path: string, text: string) {
  return `SOURCE FILE: ${path}\nhttps://github.com/verified/brain/blob/sha/${path}\n${text}`;
}
function fixture() {
  return [
    segment(RULES, "Never fabricate receipts. ".repeat(300)),
    segment(STATE, "current=ACTIVE\n".repeat(250)),
    segment(SOURCE, "PAPER_ONLY=true\n".repeat(10)),
  ].join("\n\n---\n\n");
}
describe("NEO static-first compact Brain capsule", () => {
  it("caps all Brain content at 6k with deterministic rule/index first and volatile metadata last", () => {
    const context = fixture();
    const a = compactNeoBrain({context, sourcePaths:[RULES,STATE,SOURCE], status:"ATTACHED",revision:"a".repeat(40),cacheAgeMs:3});
    const b = compactNeoBrain({context, sourcePaths:[SOURCE,STATE,RULES], status:"ATTACHED",revision:"a".repeat(40),cacheAgeMs:3});
    expect(a).toBe(b);
    expect(a.length).toBeLessThanOrEqual(NEO_SLIM_BRAIN_MAX_CHARS);
    expect(NEO_SLIM_BRAIN_MAX_CHARS + 3_000).toBeLessThanOrEqual(NEO_NATIVE_BOOT_MAX_CHARS);
    expect(a.indexOf("Never fabricate receipts")).toBeLessThan(a.indexOf("## Brain index"));
    expect(a.indexOf("## Brain index")).toBeLessThan(a.indexOf("## Current state"));
    expect(a.indexOf("## Current state")).toBeLessThan(a.indexOf("## Verification metadata"));
    expect(a).toContain(SOURCE);
    expect(a).not.toContain("PAPER_ONLY=true");
    expect(a).not.toContain("Never fabricate receipts. ".repeat(150));
  });
  it("does not move the dynamic revision into the leading cacheable prefix", () => {
    const context=fixture();
    const a=compactNeoBrain({context, sourcePaths:[],status:"CACHED_VERIFIED",revision:"a".repeat(40),cacheAgeMs:100});
    const b=compactNeoBrain({context, sourcePaths:[],status:"CACHED_VERIFIED",revision:"b".repeat(40),cacheAgeMs:120});
    expect(a.split("## Verification metadata")[0]).toBe(b.split("## Verification metadata")[0]);
    expect(a).not.toBe(b);
  });
  it("fails closed if operating doctrine or active state is missing", () => {
    const ctx=segment(RULES,"rules");
    expect(() => compactNeoBrain({context:ctx, sourcePaths:[RULES],status:"ATTACHED"})).toThrow("NEO_REQUIRED_BOOT_CONTEXT_UNAVAILABLE");
  });
});
