import { jest } from "@jest/globals";

import {
  clearPublicResponseCache,
  invalidatePublicTenantCache,
  publicResponseCacheKey,
  readPublicResponseCache,
  writePublicResponseCache
} from "../src/utils/publicResponseCache.js";

describe("public tenant response cache", () => {
  beforeEach(() => {
    clearPublicResponseCache();
  });

  test("stores and returns a payload for a slug lookup", () => {
    const key = publicResponseCacheKey("tenant-config", "slug", "Test25");
    expect(key).toBe("tenant-config:slug:test25");

    writePublicResponseCache(key, { slug: "test25", onboardingStatus: "live" });
    expect(readPublicResponseCache(key)).toEqual({
      slug: "test25",
      onboardingStatus: "live"
    });
  });

  test("ignores keys that are missing a lookup value", () => {
    expect(publicResponseCacheKey("tenant-config", "slug", "")).toBe("");
    expect(readPublicResponseCache("")).toBeNull();
  });

  test("drops entries once the TTL has elapsed", () => {
    const key = publicResponseCacheKey("tenant-config", "slug", "test25");
    writePublicResponseCache(key, { slug: "test25" });

    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(Date.now() + 61 * 1000);
    try {
      expect(readPublicResponseCache(key)).toBeNull();
    } finally {
      nowSpy.mockRestore();
    }
  });

  // A launch flips onboardingStatus to "live". If the cached pre-launch payload
  // survives that write, the director is bounced back into the onboarding
  // wizard by the router, which reads onboardingStatus from this payload.
  test("invalidates every lookup a launched tenant answers on", () => {
    const tenant = {
      slug: "test25",
      customDomain: "test25.pondbridgealumni.com",
      onboardingStatus: "live"
    };

    const configBySlug = publicResponseCacheKey("tenant-config", "slug", tenant.slug);
    const configByHost = publicResponseCacheKey("tenant-config", "host", tenant.customDomain);
    const statusBySlug = publicResponseCacheKey("tenant-status", "slug", tenant.slug);
    const otherTenant = publicResponseCacheKey("tenant-config", "slug", "cedar");

    for (const key of [configBySlug, configByHost, statusBySlug, otherTenant]) {
      writePublicResponseCache(key, { onboardingStatus: "in_progress" });
    }

    invalidatePublicTenantCache(tenant);

    expect(readPublicResponseCache(configBySlug)).toBeNull();
    expect(readPublicResponseCache(configByHost)).toBeNull();
    expect(readPublicResponseCache(statusBySlug)).toBeNull();
    expect(readPublicResponseCache(otherTenant)).not.toBeNull();
  });

  test("invalidates the default subdomain when no custom domain is stored", () => {
    const tenant = { slug: "test25", customDomain: "" };
    const configByDefaultHost = publicResponseCacheKey(
      "tenant-config",
      "host",
      "test25.pondbridgealumni.com"
    );

    writePublicResponseCache(configByDefaultHost, { onboardingStatus: "in_progress" });
    invalidatePublicTenantCache(tenant);

    expect(readPublicResponseCache(configByDefaultHost)).toBeNull();
  });
});
