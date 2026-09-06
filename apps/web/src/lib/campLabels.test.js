import { describe, expect, it } from "vitest";
import { resolveAgeGroupOptions, resolveCampAiName, resolveTenantLogoUrl } from "./campLabels.js";

describe("camp-specific AI naming", () => {
  it("turns Camp Cedar into Cedar AI", () => {
    expect(resolveCampAiName({ name: "Camp Cedar" })).toBe("Cedar AI");
    expect(resolveCampAiName({ name: "Cedar" })).toBe("Cedar AI");
    expect(resolveCampAiName({ name: "Camp Cedar — Local Staging" })).toBe("Cedar AI");
  });

  it("supports an explicit tenant content override without exposing a vendor label", () => {
    expect(
      resolveCampAiName({
        name: "Camp Pine",
        config: { content: { aiAssistantName: "Pine Guide" } }
      })
    ).toBe("Pine Guide");
  });

  it("does not duplicate an existing AI suffix", () => {
    expect(resolveCampAiName({ name: "Matoaka AI" })).toBe("Matoaka AI");
    expect(resolveCampAiName({ name: "Camp Matoaka" })).toBe("Matoaka AI");
  });
});

describe("camp logo resolution", () => {
  it("uses the configured branding logo", () => {
    expect(
      resolveTenantLogoUrl({
        config: { branding: { logoUrl: "https://assets.example/camp-logo.webp" } }
      })
    ).toBe("https://assets.example/camp-logo.webp");
  });

  it("does not let an empty branding object hide the camp theme logo", () => {
    expect(
      resolveTenantLogoUrl({
        config: { branding: { logoUrl: "" } },
        theme: { logoUrl: "https://assets.example/theme-logo.png" }
      })
    ).toBe("https://assets.example/theme-logo.png");
  });
});

describe("age group options", () => {
  it("uses the camp's own divisions when it has set them", () => {
    const groups = resolveAgeGroupOptions({
      content: { ageGroups: ["Cubs", "Juniors", "Seniors"] }
    });
    expect(groups).toEqual(["Cubs", "Juniors", "Seniors"]);
  });

  it("still answers for tenants that predate the onboarding requirement", () => {
    // Onboarding now requires every new camp to name its own divisions, but
    // camps created before that have nothing stored. Their members' profiles
    // already carry these labels, so the fallback has to keep working -- it is
    // compatibility, not a recommendation.
    const groups = resolveAgeGroupOptions({ content: {} });
    expect(groups.length).toBeGreaterThan(0);
  });

  it("does not put one camp's divisions in front of a camp that named its own", () => {
    const groups = resolveAgeGroupOptions({ content: { ageGroups: ["Minnows", "Sharks"] } });
    expect(groups).not.toContain("Super Warrior");
    expect(groups).not.toContain("Senior II");
  });
});
