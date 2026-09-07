import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROFILE_FIELDS,
  PROFILE_FIELD_CATALOG,
  hasAnySocialProfileField,
  resolveProfileFields
} from "@pondbridge/shared";
import { formatLastNameWithMaidenName, readMaidenName, resolveTenantProfileFields } from "./profileFields.js";

describe("resolveProfileFields", () => {
  it("fills every catalog key when the tenant has never touched the setting", () => {
    const resolved = resolveProfileFields(undefined);
    expect(Object.keys(resolved).sort()).toEqual(PROFILE_FIELD_CATALOG.map((f) => f.key).sort());
    expect(resolved).toEqual({ ...DEFAULT_PROFILE_FIELDS });
  });

  it("defaults the two newest fields off so no camp starts collecting them unasked", () => {
    const resolved = resolveProfileFields({});
    expect(resolved.maidenName).toBe(false);
    expect(resolved.greekLife).toBe(false);
  });

  it("keeps an explicit choice and ignores keys the catalog does not name", () => {
    const resolved = resolveProfileFields({ phone: false, notAField: true });
    expect(resolved.phone).toBe(false);
    expect(resolved.nickname).toBe(true);
    expect(resolved).not.toHaveProperty("notAField");
  });

  it("forces a child field off when its parent is off, whatever was stored", () => {
    // A major with no college on file reads as an orphan line, so this has to
    // hold even for a tenant whose stored map says otherwise.
    const resolved = resolveProfileFields({ college: false, collegeMajor: true, greekLife: true });
    expect(resolved.collegeMajor).toBe(false);
    expect(resolved.greekLife).toBe(false);
  });

  it("leaves children alone while the parent is on", () => {
    const resolved = resolveProfileFields({ college: true, collegeMajor: false, greekLife: true });
    expect(resolved.collegeMajor).toBe(false);
    expect(resolved.greekLife).toBe(true);
  });
});

describe("hasAnySocialProfileField", () => {
  it("is false only when every network is off", () => {
    expect(hasAnySocialProfileField({})).toBe(true);
    expect(
      hasAnySocialProfileField({ socialLinkedin: false, socialInstagram: false, socialFacebook: false })
    ).toBe(false);
    expect(
      hasAnySocialProfileField({ socialLinkedin: false, socialInstagram: true, socialFacebook: false })
    ).toBe(true);
  });
});

describe("resolveTenantProfileFields", () => {
  it("prefers config.content, which is what the public tenant payload carries", () => {
    const tenant = {
      config: { content: { profileFields: { phone: false } } },
      content: { profileFields: { phone: true } }
    };
    expect(resolveTenantProfileFields(tenant).phone).toBe(false);
  });

  it("falls back to catalog defaults for a tenant whose config has not loaded", () => {
    expect(resolveTenantProfileFields(null)).toEqual({ ...DEFAULT_PROFILE_FIELDS });
  });
});

describe("maiden name display", () => {
  it("reads the value from wherever the payload happens to carry it", () => {
    expect(readMaidenName({ maidenName: "Whitfield" })).toBe("Whitfield");
    expect(readMaidenName({ socials: { maidenName: "Delgado" } })).toBe("Delgado");
    expect(readMaidenName({ social: { maidenName: "Okafor" } })).toBe("Okafor");
    expect(readMaidenName({})).toBe("");
  });

  it("appends the maiden name in parentheses", () => {
    expect(formatLastNameWithMaidenName("Chen", "Delgado")).toBe("Chen (Delgado)");
  });

  it("shows the name once when a member typed the same thing in both boxes", () => {
    expect(formatLastNameWithMaidenName("Chen", "chen")).toBe("Chen");
  });

  it("degrades to whichever half exists", () => {
    expect(formatLastNameWithMaidenName("Chen", "")).toBe("Chen");
    expect(formatLastNameWithMaidenName("", "Delgado")).toBe("Delgado");
    expect(formatLastNameWithMaidenName("", "")).toBe("");
  });
});
