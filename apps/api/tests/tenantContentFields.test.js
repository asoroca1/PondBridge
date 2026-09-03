import { buildTenantConfig, resolveContent } from "../src/services/onboarding.js";

// A content field that the admin route writes but resolveContent or
// buildTenantConfig drops saves cleanly and then never reaches anyone — the
// director's own settings page reads back the default too, so the save looks
// like it silently did nothing. Both hops are pinned here for every field a
// director can edit through Settings > Features.
describe("side nav tenant content field", () => {
  it("defaults to off", () => {
    expect(resolveContent({ name: "Camp Cedar" }).sideNavEnabled).toBe(false);
    expect(resolveContent({ name: "Camp Cedar", content: {} }).sideNavEnabled).toBe(false);
  });

  it("survives resolveContent once a director enables it", () => {
    expect(
      resolveContent({ name: "Camp Cedar", content: { sideNavEnabled: true } }).sideNavEnabled
    ).toBe(true);
  });

  it("reaches members through the public tenant config", () => {
    const config = buildTenantConfig({
      name: "Camp Cedar",
      slug: "cedar",
      content: { sideNavEnabled: true }
    });
    expect(config.content.sideNavEnabled).toBe(true);
  });

  it("stays off in the public tenant config by default", () => {
    const config = buildTenantConfig({ name: "Camp Cedar", slug: "cedar" });
    expect(config.content.sideNavEnabled).toBe(false);
  });
});

describe("module display name content fields", () => {
  it("falls back to the product defaults", () => {
    const content = resolveContent({ name: "Camp Cedar" });
    expect(content.newsletterName).toBe("Newsletter");
    expect(content.photoStreamName).toBe("Media Stream");
  });

  it("survives resolveContent once a director renames a module", () => {
    const content = resolveContent({
      name: "Camp Cedar",
      content: { newsletterName: "Cedar Chest", photoStreamName: "Cedar Reel" }
    });
    expect(content.newsletterName).toBe("Cedar Chest");
    expect(content.photoStreamName).toBe("Cedar Reel");
  });

  it("reaches members through the public tenant config", () => {
    const config = buildTenantConfig({
      name: "Camp Cedar",
      slug: "cedar",
      content: { newsletterName: "Cedar Chest", photoStreamName: "Cedar Reel" }
    });
    expect(config.content.newsletterName).toBe("Cedar Chest");
    expect(config.content.photoStreamName).toBe("Cedar Reel");
  });

  it("serves the defaults through the public tenant config when unset", () => {
    const config = buildTenantConfig({ name: "Camp Cedar", slug: "cedar" });
    expect(config.content.newsletterName).toBe("Newsletter");
    expect(config.content.photoStreamName).toBe("Media Stream");
  });
});
