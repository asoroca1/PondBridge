import { describe, expect, it } from "vitest";
import {
  IMAGE_OPTIMIZATION_PRESETS,
  calculateContainDimensions,
  extensionForImageMime,
  shouldPreserveOriginalImageType
} from "./imageOptimization.js";

describe("tenant branding image optimization", () => {
  it("fits large images inside the target without changing aspect ratio", () => {
    expect(calculateContainDimensions(4032, 3024, 2560, 1600)).toEqual({
      width: 2133,
      height: 1600,
      scale: 1600 / 3024
    });
  });

  it("does not upscale smaller images", () => {
    expect(calculateContainDimensions(640, 480, 2560, 1600)).toEqual({
      width: 640,
      height: 480,
      scale: 1
    });
  });

  it("preserves vector and animated formats", () => {
    expect(shouldPreserveOriginalImageType("image/svg+xml")).toBe(true);
    expect(shouldPreserveOriginalImageType("image/gif")).toBe(true);
    expect(shouldPreserveOriginalImageType("image/png")).toBe(false);
  });

  it("uses web-friendly file extensions and meaningful size budgets", () => {
    expect(extensionForImageMime("image/webp")).toBe("webp");
    expect(extensionForImageMime("image/jpeg")).toBe("jpg");
    expect(IMAGE_OPTIMIZATION_PRESETS.logo.maxBytes).toBeLessThan(
      IMAGE_OPTIMIZATION_PRESETS.hero.maxBytes
    );
  });
});
