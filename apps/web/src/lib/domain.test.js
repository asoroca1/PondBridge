import { describe, expect, it } from "vitest";
import {
  inferCampSlugFromHost,
  isDeploymentPreviewHost,
  isPotentialCustomTenantHost
} from "./domain.js";

describe("deployment preview domain routing", () => {
  it("keeps Cloudflare Pages previews on path-scoped tenant routes", () => {
    const host = "codex-fall-rollout-overhaul.pondbridge.pages.dev";

    expect(isDeploymentPreviewHost(host)).toBe(true);
    expect(isPotentialCustomTenantHost(host)).toBe(false);
    expect(inferCampSlugFromHost(host)).toBe("");
  });

  it("continues to recognize real custom tenant domains", () => {
    expect(isDeploymentPreviewHost("alumni.examplecamp.org")).toBe(false);
    expect(isPotentialCustomTenantHost("alumni.examplecamp.org")).toBe(true);
  });
});
