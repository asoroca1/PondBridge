import { describe, it, expect } from "vitest";
import { shouldSpeculativelyPreload } from "./routePreload.js";

/**
 * Warming routes the user has not asked for is a good trade on a laptop on
 * wifi and a bad one on a phone on a train: it spends a member's cellular data
 * and competes for bandwidth with the page they are actually waiting for.
 * These tests pin when the app is allowed to guess.
 */

const wifi = { effectiveType: "4g", saveData: false };

describe("speculative preloading", () => {
  it("warms routes on a good connection", () => {
    expect(shouldSpeculativelyPreload({ connection: wifi })).toBe(true);
  });

  it("respects Data Saver, whatever the connection reports", () => {
    expect(
      shouldSpeculativelyPreload({ connection: { effectiveType: "4g", saveData: true } })
    ).toBe(false);
  });

  it("stays off the slowest connections", () => {
    for (const effectiveType of ["slow-2g", "2g"]) {
      expect(shouldSpeculativelyPreload({ connection: { effectiveType } })).toBe(false);
    }
  });

  it("still warms on 3g, which is slow but not punitive", () => {
    expect(shouldSpeculativelyPreload({ connection: { effectiveType: "3g" } })).toBe(true);
  });

  it("does not guess for a tab nobody is looking at", () => {
    expect(shouldSpeculativelyPreload({ connection: wifi, visibilityState: "hidden" })).toBe(false);
  });

  it("does not guess while offline", () => {
    expect(shouldSpeculativelyPreload({ connection: wifi, online: false })).toBe(false);
  });

  it("keeps preloading where the browser reports nothing", () => {
    // Safari and Firefox expose no Network Information API. Absence of
    // evidence is not evidence of a bad connection, and preloading is the
    // behaviour those browsers have always had.
    expect(shouldSpeculativelyPreload({ connection: null })).toBe(true);
    expect(shouldSpeculativelyPreload({ connection: undefined })).toBe(true);
  });

  it("is case-insensitive about what the browser reports", () => {
    expect(shouldSpeculativelyPreload({ connection: { effectiveType: "SLOW-2G" } })).toBe(false);
  });
});
