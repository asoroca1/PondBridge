import { describe, expect, it } from "vitest";
import {
  IMAGE_OPTIMIZATION_PRESETS,
  calculateContainDimensions,
  extensionForImageMime,
  isUnrenderableImageType,
  readLogoBackdropFromPixels,
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

function canvas(width, height, paint) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = paint(x, y);
      const index = (y * width + x) * 4;
      data[index] = r;
      data[index + 1] = g;
      data[index + 2] = b;
      data[index + 3] = a;
    }
  }
  return { data, width, height };
}

const WHITE = [255, 255, 255, 255];
// Camp Green Lane's disc color.
const CAMP_GREEN = [1, 110, 46, 255];

describe("readLogoBackdropFromPixels", () => {
  it("measures an emblem centered on an opaque white square", () => {
    const size = 128;
    const radius = 58;
    const { data, width, height } = canvas(size, size, (x, y) => {
      const dx = x - size / 2;
      const dy = y - size / 2;
      return dx * dx + dy * dy <= radius * radius ? CAMP_GREEN : WHITE;
    });

    const result = readLogoBackdropFromPixels(data, width, height);
    expect(result.backdropIsOpaque).toBe(true);
    expect(result.borderIsUniformLight).toBe(true);
    expect(result.contentWidth).toBeGreaterThan(2 * radius - 4);
    expect(result.contentWidth / result.contentHeight).toBeCloseTo(1, 1);
  });

  it("tolerates the compression noise a JPEG leaves in a white frame", () => {
    const size = 64;
    const { data, width, height } = canvas(size, size, (x, y) => {
      if (x > 20 && x < 44 && y > 20 && y < 44) return CAMP_GREEN;
      const jitter = (x + y) % 7;
      return [255 - jitter, 254 - jitter, 255 - jitter, 255];
    });

    expect(readLogoBackdropFromPixels(data, width, height).borderIsUniformLight).toBe(true);
  });

  it("treats a see-through frame as cut out and stops there", () => {
    const size = 64;
    const { data, width, height } = canvas(size, size, (x, y) =>
      x > 16 && x < 48 && y > 16 && y < 48 ? CAMP_GREEN : [0, 0, 0, 0]
    );

    const result = readLogoBackdropFromPixels(data, width, height);
    expect(result.backdropIsOpaque).toBe(false);
    expect(result.borderIsUniformLight).toBe(false);
  });

  it("does not call a dark or colored backdrop light", () => {
    const size = 64;
    const navy = [12, 34, 78, 255];
    const { data, width, height } = canvas(size, size, (x, y) =>
      x > 16 && x < 48 && y > 16 && y < 48 ? WHITE : navy
    );

    expect(readLogoBackdropFromPixels(data, width, height).borderIsUniformLight).toBe(false);
  });

  it("measures a wide wordmark as wide", () => {
    const { data, width, height } = canvas(160, 64, (x, y) =>
      x > 8 && x < 152 && y > 24 && y < 40 ? [20, 20, 20, 255] : WHITE
    );

    const result = readLogoBackdropFromPixels(data, width, height);
    expect(result.contentWidth).toBeGreaterThan(result.contentHeight * 3);
  });

  // Camp Waldemar's logo: a white disc on transparency, whose corners fall
  // outside the disc. It already sits correctly on its own bar, and a chip
  // around it would be a second plate behind the first.
  it("does not call a white disc on transparency an opaque backdrop", () => {
    const size = 96;
    const radius = 46;
    const { data, width, height } = canvas(size, size, (x, y) => {
      const dx = x - size / 2;
      const dy = y - size / 2;
      if (dx * dx + dy * dy > radius * radius) return [0, 0, 0, 0];
      return dx * dx + dy * dy < 400 ? [20, 38, 104, 255] : WHITE;
    });

    expect(readLogoBackdropFromPixels(data, width, height).backdropIsOpaque).toBe(false);
  });

  // Antialiasing inside the artwork must not disable detection: what puts a
  // rectangle on the bar is an opaque frame, not a soft pixel in the middle.
  it("ignores transparency that sits inside the artwork", () => {
    const size = 96;
    const { data, width, height } = canvas(size, size, (x, y) =>
      x === 48 && y === 48 ? [0, 0, 0, 120] : x > 24 && x < 72 && y > 24 && y < 72 ? CAMP_GREEN : WHITE
    );

    const result = readLogoBackdropFromPixels(data, width, height);
    expect(result.backdropIsOpaque).toBe(true);
    expect(result.borderIsUniformLight).toBe(true);
  });

  it("returns an empty measurement for unusable input", () => {
    expect(readLogoBackdropFromPixels(null, 10, 10).contentWidth).toBe(0);
    expect(readLogoBackdropFromPixels(new Uint8ClampedArray(8), 10, 10).borderIsUniformLight).toBe(false);
  });
});
