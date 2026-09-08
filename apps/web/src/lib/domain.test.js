import { describe, expect, it } from "vitest";
import {
  isLocalDevelopmentHost,
  localTenantDestination,
  superAdminLoginUrl,
  canonicalTenantUrlForPreview,
  inferCampSlugFromHost,
  isDeploymentPreviewHost,
  isNamedDeploymentPreviewHost,
  isPotentialCustomTenantHost
} from "./domain.js";

describe("deployment preview domain routing", () => {
  it("keeps Cloudflare Pages previews on path-scoped tenant routes", () => {
    const host = "codex-fall-rollout-overhaul.pondbridge.pages.dev";

    expect(isDeploymentPreviewHost(host)).toBe(true);
    expect(isNamedDeploymentPreviewHost(host)).toBe(true);
    expect(isPotentialCustomTenantHost(host)).toBe(false);
    expect(inferCampSlugFromHost(host)).toBe("");
  });

  it("canonicalizes named tenant previews while leaving production and immutable previews available", () => {
    expect(
      canonicalTenantUrlForPreview({
        host: "codex-fall-rollout-overhaul.pondbridge.pages.dev",
        pathname: "/t/cedar/home",
        search: "?welcome=1",
        hash: "#updates"
      })
    ).toBe("https://cedar.pondbridgealumni.com/home?welcome=1#updates");

    expect(
      canonicalTenantUrlForPreview({
        host: "a632e867.pondbridge.pages.dev",
        pathname: "/t/cedar/home"
      })
    ).toBe("");
    expect(
      canonicalTenantUrlForPreview({
        host: "pondbridge.pages.dev",
        pathname: "/t/cedar/home"
      })
    ).toBe("");
  });

  it("allows explicit QA sessions to remain on a named preview", () => {
    expect(
      canonicalTenantUrlForPreview({
        host: "codex-fall-rollout-overhaul.pondbridge.pages.dev",
        pathname: "/t/cedar/home",
        search: "?pondbridgePreview=1"
      })
    ).toBe("");
  });

  it("continues to recognize real custom tenant domains", () => {
    expect(isDeploymentPreviewHost("alumni.examplecamp.org")).toBe(false);
    expect(isPotentialCustomTenantHost("alumni.examplecamp.org")).toBe(true);
  });
});


describe("local super-admin routing", () => {
  it("keeps local camp and claim links on the current staging port", () => {
    const location = new URL("http://localhost:5184/super/tenants/123");
    expect(localTenantDestination("http://cedar.localhost/", "cedar", location)).toBe("http://localhost:5184/t/cedar");
    expect(localTenantDestination("http://cedar.localhost/director-claim?token=example#form", "cedar", location)).toBe("http://localhost:5184/t/cedar/director-claim?token=example#form");
    expect(localTenantDestination("http://localhost/t/cedar/login", "cedar", location)).toBe("http://localhost:5184/t/cedar/login");
  });

  it("leaves production and custom-domain destinations unchanged", () => {
    const live = "https://cedar.pondbridgealumni.com/director-claim";
    expect(localTenantDestination(live, "cedar", new URL("http://localhost:5184"))).toBe(live);
    expect(localTenantDestination(live, "cedar", new URL("https://super.pondbridgealumni.com"))).toBe(live);
    expect(localTenantDestination("http://cedar.localhost/", "cedar", new URL("https://super.pondbridgealumni.com"))).toBe("http://cedar.localhost/");
    expect(localTenantDestination("javascript:alert(1)", "cedar", new URL("http://localhost:5184"))).toBe("javascript:alert(1)");
  });

  it("preserves local protocol and port for admin links", () => {
    expect(superAdminLoginUrl(new URL("http://localhost:5184/"))).toBe("http://localhost:5184/super/login");
    expect(isLocalDevelopmentHost("localhost:5184")).toBe(true);
    expect(isLocalDevelopmentHost("127.0.0.1")).toBe(true);
    expect(isLocalDevelopmentHost("pondbridgealumni.com")).toBe(false);
    expect(superAdminLoginUrl(new URL("https://pondbridgealumni.com"))).toBe("https://super.pondbridgealumni.com/super/login");
  });

  it("does not classify reserved localhost subdomains as camps", () => {
    for (const prefix of ["super", "api", "app", "www"]) {
      expect(inferCampSlugFromHost(`${prefix}.localhost`)).toBe("");
    }
    expect(inferCampSlugFromHost("cedar.localhost")).toBe("cedar");
  });
});
