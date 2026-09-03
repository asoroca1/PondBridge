import { buildTenantConfig, resolveTheme } from "../src/services/onboarding.js";

describe("director-supplied tab icon", () => {
  it("keeps faviconUrl on the resolved theme", () => {
    expect(resolveTheme({ theme: { faviconUrl: "https://cdn.example.com/icon-512.png" } }).faviconUrl).toBe(
      "https://cdn.example.com/icon-512.png"
    );
  });

  it("defaults to empty so camps without one fall back to their logo", () => {
    expect(resolveTheme({ theme: {} }).faviconUrl).toBe("");
    expect(resolveTheme({}).faviconUrl).toBe("");
  });

  // The /brand/* edge function reads this off the public config, so it has to be
  // exposed there and not only on the private theme.
  it("is published on the public tenant config branding block", () => {
    const config = buildTenantConfig({
      theme: {
        logoUrl: "https://cdn.example.com/logo.webp",
        faviconUrl: "https://cdn.example.com/icon-512.png",
        iconUrls: { 32: "https://cdn.example.com/icon-32.png" }
      }
    });
    expect(config.branding.faviconUrl).toBe("https://cdn.example.com/icon-512.png");
    expect(config.branding.logoUrl).toBe("https://cdn.example.com/logo.webp");
    expect(config.branding.iconUrls["32"]).toBe("https://cdn.example.com/icon-32.png");
  });
});
