/**
 * vision_inspect OpenClaw Tool Wrapper
 * 
 * Provides a stateless Google free-tier vision adapter for OpenClaw agents.
 * Connects directly to the GeminX vision_inspect tool runtime, ensuring
 * that all agents stay pinned to DeepSeek while delegating visual checks
 * (390px mobile, 820px tablet, 1280px desktop) to Google free tier statelessly,
 * returning a compact byte-capped JSON summary (<= 800 bytes).
 */

export interface OpenClawVisionInspectArgs {
  url?: string;
  image_base64?: string;
  screenshot_path?: string;
  viewport?: number;
  prompt?: string;
}

export const OPENCLAW_VISION_INSPECT_TOOL = {
  name: "vision_inspect",
  description: "Inspects screenshots/images/UI via stateless Google free-tier vision and returns compact JSON (main loop stays on DeepSeek).",
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "Public URL to capture and visually inspect (e.g. https://entreprenuitywebdesign.com/instant-preview)."
      },
      image_base64: {
        type: "string",
        description: "Base64 image data."
      },
      screenshot_path: {
        type: "string",
        description: "Local file path to screenshot image."
      },
      viewport: {
        type: "number",
        description: "Viewport width to audit: 390 (mobile), 820 (tablet), or 1280 (desktop)."
      },
      prompt: {
        type: "string",
        description: "Minimal inspection objective (under 200 chars)."
      }
    }
  }
};
