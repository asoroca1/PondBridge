import { describe, expect, it } from "vitest";
import { resolveNativeNavigationTarget, tenantSlugFromAppPath } from "./nativeNavigation.js";

describe("native app navigation", () => {
  it("opens tenant-scoped universal links inside the app", () => {
    expect(
      resolveNativeNavigationTarget("https://app.pondbridgealumni.com/t/camp-cedar/events/123?from=push#details")
    ).toBe("/t/camp-cedar/events/123?from=push#details");
  });

  it("converts a default tenant subdomain into the native path-scoped route", () => {
    expect(resolveNativeNavigationTarget("https://camp-cedar.pondbridgealumni.com/events/123")).toBe(
      "/t/camp-cedar/events/123"
    );
  });

  it("uses the remembered camp only for trusted unscoped product links", () => {
    expect(
      resolveNativeNavigationTarget("https://app.pondbridgealumni.com/notifications", {
        rememberedSlug: "lake-camp"
      })
    ).toBe("/t/lake-camp/notifications");
    expect(resolveNativeNavigationTarget("https://app.pondbridgealumni.com/notifications")).toBe("");
  });

  it("accepts the explicit PondBridge custom scheme", () => {
    expect(resolveNativeNavigationTarget("pondbridge://open/t/lake-camp/home")).toBe("/t/lake-camp/home");
  });

  it("rejects external, malformed, and super-admin targets", () => {
    expect(resolveNativeNavigationTarget("https://example.com/t/camp-cedar/home")).toBe("");
    expect(resolveNativeNavigationTarget("pondbridge://unknown/t/camp-cedar/home")).toBe("");
    expect(resolveNativeNavigationTarget("https://app.pondbridgealumni.com/super/dashboard")).toBe("");
  });

  it("reads the active tenant from an app route", () => {
    expect(tenantSlugFromAppPath("/t/Camp-Cedar/admin/dashboard")).toBe("camp-cedar");
    expect(tenantSlugFromAppPath("/email-preferences")).toBe("");
  });
});
