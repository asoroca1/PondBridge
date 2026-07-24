import { describe, expect, it } from "vitest";
import { generatePalette, hexToHsl, hslToHex } from "./colorUtils.js";

describe("color utilities", () => {
  it("converts between hex and HSL for canonical colors", () => {
    expect(hexToHsl("#002b5c")).toEqual([212, 100, 18]);
    expect(hexToHsl("#ffffff")).toEqual([0, 0, 100]);
    expect(hslToHex(212, 100, 18)).toBe("#002b5c");
  });

  it("normalizes invalid hex input to a black HSL fallback", () => {
    expect(hexToHsl("not-a-color")).toEqual([0, 0, 0]);
    expect(hexToHsl("")).toEqual([0, 0, 0]);
  });

  it("generates a complete palette from the primary color", () => {
    const palette = generatePalette("#002b5c");

    expect(palette.primary).toBe("#002b5c");
    expect(palette).toEqual({
      primary: expect.stringMatching(/^#[0-9a-f]{6}$/),
      dark: expect.stringMatching(/^#[0-9a-f]{6}$/),
      light: expect.stringMatching(/^#[0-9a-f]{6}$/),
      accent: expect.stringMatching(/^#[0-9a-f]{6}$/),
      warm: expect.stringMatching(/^#[0-9a-f]{6}$/)
    });
  });
});
