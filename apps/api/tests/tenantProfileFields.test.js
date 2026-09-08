import { buildTenantConfig, resolveContent } from "../src/services/onboarding.js";
import { resolveProfileFields } from "@pondbridge/shared";

describe("tenant profile-field settings", () => {
  it("resolves to a complete map for a tenant that has never set one", () => {
    const fields = resolveContent({}).profileFields;
    expect(fields.nickname).toBe(true);
    expect(fields.college).toBe(true);
    // The two fields added with this feature start off, so no existing camp
    // silently begins asking its members for them.
    expect(fields.maidenName).toBe(false);
    expect(fields.greekLife).toBe(false);
  });

  it("keeps a director's choices", () => {
    const fields = resolveContent({
      content: { profileFields: { phone: false, greekLife: true } }
    }).profileFields;
    expect(fields.phone).toBe(false);
    expect(fields.greekLife).toBe(true);
    expect(fields.industry).toBe(true);
  });

  it("forces major and greek life off when college is off", () => {
    const fields = resolveContent({
      content: { profileFields: { college: false, collegeMajor: true, greekLife: true } }
    }).profileFields;
    expect(fields.collegeMajor).toBe(false);
    expect(fields.greekLife).toBe(false);
  });

  // Members read this off the public tenant config, and the client prefers
  // config.content over content — so leaving it out of the allow-list would
  // make every camp's choices look like they never saved.
  it("is published on the public tenant config", () => {
    const config = buildTenantConfig({
      content: { profileFields: { location: false, maidenName: true } }
    });
    expect(config.content.profileFields.location).toBe(false);
    expect(config.content.profileFields.maidenName).toBe(true);
    expect(config.content.profileFields.nickname).toBe(true);
  });

  it("drops keys the catalog does not name rather than storing them", () => {
    const fields = resolveProfileFields({ notAField: true, phone: false });
    expect(fields).not.toHaveProperty("notAField");
    expect(fields.phone).toBe(false);
  });
});
