import { buildTenantConfig, resolveContent } from "../src/services/onboarding.js";

// A content field that is written by the admin route but dropped by
// resolveContent / buildTenantConfig saves fine and then never reaches a
// member, which is invisible in an endpoint test. Pin both hops here.
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
