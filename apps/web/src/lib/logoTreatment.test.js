import { describe, expect, it } from "vitest";
import {
  LOGO_TREATMENTS,
  classifyLogoBackdrop,
  isChipTreatment,
  logoTreatmentClassName,
  resolveLogoTreatment
} from "./logoTreatment.js";

describe("classifyLogoBackdrop", () => {
  it("leaves a cut-out logo alone", () => {
    expect(
      classifyLogoBackdrop({
        backdropIsOpaque: false,
        borderIsUniformLight: false,
        contentWidth: 460,
        contentHeight: 460
      })
    ).toBe(LOGO_TREATMENTS.PLAIN);
  });

  it("gives a square emblem on white a circular chip", () => {
    // Camp Green Lane: a 465px disc centered in a 512px opaque white square.
    expect(
      classifyLogoBackdrop({
        backdropIsOpaque: true,
        borderIsUniformLight: true,
        contentWidth: 465,
        contentHeight: 461
      })
    ).toBe(LOGO_TREATMENTS.CIRCLE);
  });

  it("gives a wordmark on white a rounded chip rather than cropping it", () => {
    expect(
      classifyLogoBackdrop({
        backdropIsOpaque: true,
        borderIsUniformLight: true,
        contentWidth: 900,
        contentHeight: 220
      })
    ).toBe(LOGO_TREATMENTS.ROUNDED);
  });

  it("leaves a deliberate dark or colored backdrop alone", () => {
    expect(
      classifyLogoBackdrop({
        backdropIsOpaque: true,
        borderIsUniformLight: false,
        contentWidth: 400,
        contentHeight: 400
      })
    ).toBe(LOGO_TREATMENTS.PLAIN);
  });

  it("falls back to plain when nothing could be measured", () => {
    expect(classifyLogoBackdrop({})).toBe(LOGO_TREATMENTS.PLAIN);
    expect(
      classifyLogoBackdrop({ backdropIsOpaque: true, borderIsUniformLight: true, contentWidth: 0, contentHeight: 0 })
    ).toBe(LOGO_TREATMENTS.PLAIN);
  });
});

describe("resolveLogoTreatment", () => {
  it("renders tenants that predate detection exactly as they render today", () => {
    expect(resolveLogoTreatment({ config: { branding: { logoUrl: "https://cdn/logo.webp" } } })).toBe(
      LOGO_TREATMENTS.PLAIN
    );
    expect(resolveLogoTreatment(null)).toBe(LOGO_TREATMENTS.PLAIN);
  });

  it("uses what detection recorded", () => {
    expect(
      resolveLogoTreatment({ config: { branding: { logoBackdrop: "circle" } } })
    ).toBe(LOGO_TREATMENTS.CIRCLE);
  });

  it("lets a director override the detected value", () => {
    expect(
      resolveLogoTreatment({
        config: { branding: { logoBackdrop: "circle", logoTreatment: "plain" } }
      })
    ).toBe(LOGO_TREATMENTS.PLAIN);
  });

  it("treats an explicit auto as no choice at all", () => {
    expect(
      resolveLogoTreatment({
        config: { branding: { logoBackdrop: "rounded", logoTreatment: "auto" } }
      })
    ).toBe(LOGO_TREATMENTS.ROUNDED);
  });

  it("reads the legacy theme block when config.branding is absent", () => {
    expect(resolveLogoTreatment({ theme: { logoBackdrop: "circle" } })).toBe(LOGO_TREATMENTS.CIRCLE);
  });

  it("ignores a value that is not a treatment", () => {
    expect(
      resolveLogoTreatment({ config: { branding: { logoTreatment: "squircle" } } })
    ).toBe(LOGO_TREATMENTS.PLAIN);
  });
});

describe("logoTreatmentClassName", () => {
  it("adds nothing for a plain logo", () => {
    expect(logoTreatmentClassName(LOGO_TREATMENTS.PLAIN)).toBe("");
    expect(isChipTreatment(LOGO_TREATMENTS.PLAIN)).toBe(false);
  });

  it("names the chip shape", () => {
    expect(logoTreatmentClassName(LOGO_TREATMENTS.CIRCLE)).toBe("is-logo-chip is-logo-chip-circle");
    expect(logoTreatmentClassName(LOGO_TREATMENTS.ROUNDED)).toBe("is-logo-chip is-logo-chip-rounded");
  });
});
