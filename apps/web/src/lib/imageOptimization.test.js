import { describe, expect, it } from "vitest";
import {
  IMAGE_OPTIMIZATION_PRESETS,
  calculateContainDimensions,
  extensionForImageMime,
  isUnrenderableImageType,
  shouldPreserveOriginalImageType,
  transcodeUnrenderableImage
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

describe("images a browser accepts but cannot draw", () => {
  it("recognises the formats an iPhone produces", () => {
    expect(isUnrenderableImageType("image/heic")).toBe(true);
    expect(isUnrenderableImageType("image/heif")).toBe(true);
    expect(isUnrenderableImageType("IMAGE/HEIC")).toBe(true);
    expect(isUnrenderableImageType("image/heic-sequence")).toBe(true);
  });

  it("leaves the formats every browser already renders alone", () => {
    expect(isUnrenderableImageType("image/jpeg")).toBe(false);
    expect(isUnrenderableImageType("image/png")).toBe(false);
    expect(isUnrenderableImageType("image/webp")).toBe(false);
    expect(isUnrenderableImageType("")).toBe(false);
  });

  it("passes a renderable file straight through without touching a canvas", async () => {
    const jpeg = { name: "photo.jpg", type: "image/jpeg", size: 1024 };
    await expect(transcodeUnrenderableImage(jpeg)).resolves.toBe(jpeg);
    await expect(transcodeUnrenderableImage(null)).resolves.toBe(null);
  });
});
