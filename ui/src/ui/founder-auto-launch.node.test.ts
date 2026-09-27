import { describe, expect, it } from "vitest";
import {
  NEO_FOUNDER_LAUNCH_URL,
  resolveFounderAutoLaunchUrl,
  resolveFounderInitialLaunchUrl,
} from "./founder-auto-launch.ts";

describe("NEO founder auto-launch", () => {
  it("redirects the canonical Railway UI away from a missing-token dead end", () => {
    expect(
      resolveFounderAutoLaunchUrl({
        authErrorCode: "AUTH_TOKEN_MISSING",
        pageHref: "https://openclaw-neo-runtime-production.up.railway.app/",
        explicitToken: "",
        password: "",
      }),
    ).toBe(NEO_FOUNDER_LAUNCH_URL);
  });

  it("redirects the canonical Railway UI before the first unauthenticated websocket attempt", () => {
    expect(
      resolveFounderInitialLaunchUrl({
        pageHref: "https://openclaw-neo-runtime-production.up.railway.app/",
        explicitToken: "",
        password: "",
      }),
    ).toBe(NEO_FOUNDER_LAUNCH_URL);

    expect(
      resolveFounderInitialLaunchUrl({
        pageHref: "https://openclaw-neo-runtime-production.up.railway.app/#token=present",
        explicitToken: "present",
        password: "",
      }),
    ).toBeNull();
  });

  it("does not redirect unrelated OpenClaw deployments or override explicit auth", () => {
    expect(
      resolveFounderAutoLaunchUrl({
        authErrorCode: "AUTH_TOKEN_MISSING",
        pageHref: "https://another-openclaw.example/",
      }),
    ).toBeNull();
    expect(
      resolveFounderAutoLaunchUrl({
        authErrorCode: "AUTH_TOKEN_MISSING",
        pageHref: "https://openclaw-neo-runtime-production.up.railway.app/",
        explicitToken: "already-present",
      }),
    ).toBeNull();
    expect(
      resolveFounderAutoLaunchUrl({
        authErrorCode: "AUTH_TOKEN_MISMATCH",
        pageHref: "https://openclaw-neo-runtime-production.up.railway.app/",
      }),
    ).toBeNull();
  });
});
