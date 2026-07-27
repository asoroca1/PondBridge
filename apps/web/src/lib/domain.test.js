import { describe, expect, it } from "vitest";
import {
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
