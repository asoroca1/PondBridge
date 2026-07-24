import { describe, expect, it } from "vitest";
import { normalizeTenantRouteForHost, shouldUseTenantSlugPrefix, tenantRoute } from "./tenantRouting.js";

describe("tenant routing", () => {
  it("prefixes tenant routes on the base app host", () => {
    expect(
      tenantRoute("Cedar", "/directory", {
        pathname: "/",
        host: "pondbridgealumni.com"
      })
    ).toBe("/t/cedar/directory");
  });

  it("does not prefix routes on tenant subdomains or custom domains", () => {
    expect(
      tenantRoute("cedar", "/directory", {
        pathname: "/",
        host: "cedar.pondbridgealumni.com"
      })
    ).toBe("/directory");

    expect(
      tenantRoute("cedar", "/directory", {
        pathname: "/",
        host: "alumni.campcedar.org"
      })
    ).toBe("/directory");
  });

  it("keeps explicit /t routes prefixed while browsing path-scoped tenants", () => {
    expect(shouldUseTenantSlugPrefix("cedar", { pathname: "/t/cedar/admin" })).toBe(true);
    expect(tenantRoute("cedar", "admin", { pathname: "/t/cedar" })).toBe("/t/cedar/admin");
  });

  it("normalizes prefixed routes away on host-scoped tenants", () => {
    expect(
      normalizeTenantRouteForHost("cedar", "/t/cedar/events", {
        pathname: "/",
        host: "cedar.pondbridgealumni.com"
      })
    ).toBe("/events");
  });
});
