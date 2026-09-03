import {
  buildSettingsWithCampProfile,
  hasCampProfilePatch,
  normalizeCampProfilePatch,
  readCampProfile,
  resolveDirectorClaimLinks
} from "../src/services/superCampProfile.js";

function tenantWithProfile(campProfile, extra = {}) {
  return {
    slug: "pine",
    customDomain: "pine.pondbridgealumni.com",
    settings: { signupMode: "open", accessCodeHash: "hashed", campProfile },
    ...extra
  };
}

describe("camp profile record", () => {
  test("reads an empty record from a camp that has never been edited", () => {
    expect(readCampProfile({ settings: {} })).toMatchObject({
      directorEmail: "",
      contactName: "",
      contactPhone: "",
      notes: "",
      directorClaimUrl: "",
      updatedAt: null
    });
  });

  test("trims and lowercases the director email it stores", () => {
    const profile = readCampProfile(tenantWithProfile({ directorEmail: "  Dana@Camp.ORG " }));
    expect(profile.directorEmail).toBe("dana@camp.org");
  });

  test("a patch only carries the fields the request actually sent", () => {
    expect(hasCampProfilePatch({ status: "active" })).toBe(false);
    expect(hasCampProfilePatch({ notes: "call in March" })).toBe(true);
    expect(normalizeCampProfilePatch({ notes: " call in March ", status: "active" })).toEqual({
      notes: "call in March"
    });
  });

  test("caps notes so one paste cannot bloat the tenant settings row", () => {
    const patch = normalizeCampProfilePatch({ notes: "x".repeat(9000) });
    expect(patch.notes).toHaveLength(5000);
  });

  // settings is a single JSON column: patching it in place would silently drop
  // signup mode, access codes and every other sibling key.
  test("writing the record preserves the rest of the camp settings", () => {
    const tenant = tenantWithProfile({ directorEmail: "dana@camp.org", notes: "renews in May" });
    const settings = buildSettingsWithCampProfile(
      tenant,
      { notes: "renews in June" },
      { updatedByUserId: "user-1" }
    );

    expect(settings.signupMode).toBe("open");
    expect(settings.accessCodeHash).toBe("hashed");
    expect(settings.campProfile.notes).toBe("renews in June");
    expect(settings.campProfile.directorEmail).toBe("dana@camp.org");
    expect(settings.campProfile.updatedByUserId).toBe("user-1");
    expect(settings.campProfile.updatedAt).toEqual(expect.any(String));
  });

  test("the first writer is recorded once and not overwritten by later edits", () => {
    const first = buildSettingsWithCampProfile({ settings: {} }, {}, {
      createdByUserId: "creator",
      updatedByUserId: "creator"
    });
    const second = buildSettingsWithCampProfile(
      { settings: first },
      { notes: "later" },
      { createdByUserId: "someone-else", updatedByUserId: "editor" }
    );

    expect(second.campProfile.createdByUserId).toBe("creator");
    expect(second.campProfile.updatedByUserId).toBe("editor");
  });
});

describe("director claim link recovery", () => {
  test("rebuilds the claim link from the camp domain, so it cannot be lost", () => {
    const links = resolveDirectorClaimLinks(tenantWithProfile(undefined));
    expect(links.liveUrl).toBe("https://pine.pondbridgealumni.com/director-claim");
    expect(links.fallbackPath).toBe("/t/pine/director-claim");
    expect(links.capturedIsStale).toBe(false);
  });

  test("flags the link handed out at creation once the camp domain has moved", () => {
    const links = resolveDirectorClaimLinks(
      tenantWithProfile({ directorClaimUrl: "https://pine.pondbridgealumni.com/director-claim" }, {
        customDomain: "alumni.camppine.org"
      })
    );

    expect(links.liveUrl).toBe("https://alumni.camppine.org/director-claim");
    expect(links.capturedUrl).toBe("https://pine.pondbridgealumni.com/director-claim");
    expect(links.capturedIsStale).toBe(true);
  });

  test("does not flag a captured link that still matches the live one", () => {
    const links = resolveDirectorClaimLinks(
      tenantWithProfile({ directorClaimUrl: "https://pine.pondbridgealumni.com/director-claim" })
    );
    expect(links.capturedIsStale).toBe(false);
  });
});
