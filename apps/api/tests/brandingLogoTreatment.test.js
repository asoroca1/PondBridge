import { buildTenantConfig, resolveTheme } from "../src/services/onboarding.js";

describe("logo backdrop treatment", () => {
  it("keeps what detection measured and what the director chose", () => {
    const theme = resolveTheme({ theme: { logoBackdrop: "circle", logoTreatment: "plain" } });
    expect(theme.logoBackdrop).toBe("circle");
    expect(theme.logoTreatment).toBe("plain");
  });

  // Every camp on the platform before detection existed has neither field, and
  // empty is what the client reads as "render the logo exactly as it is today".
  it("defaults to empty for camps that predate detection", () => {
    expect(resolveTheme({ theme: {} }).logoBackdrop).toBe("");
    expect(resolveTheme({}).logoTreatment).toBe("");
  });

  it("drops a value that is not a treatment rather than storing it", () => {
    expect(resolveTheme({ theme: { logoBackdrop: "squircle" } }).logoBackdrop).toBe("");
    expect(resolveTheme({ theme: { logoTreatment: "<script>" } }).logoTreatment).toBe("");
  });

  it("normalizes case and surrounding whitespace", () => {
    expect(resolveTheme({ theme: { logoBackdrop: "  Circle " } }).logoBackdrop).toBe("circle");
  });

  // The navbar reads this off the public config's branding block, so it has to be
  // published there and not only on the private theme.
  it("is published on the public tenant config branding block", () => {
    const config = buildTenantConfig({
      theme: { logoUrl: "https://cdn.example.com/logo.webp", logoBackdrop: "rounded" }
    });
    expect(config.branding.logoBackdrop).toBe("rounded");
    expect(config.branding.logoTreatment).toBe("");
  });
});
