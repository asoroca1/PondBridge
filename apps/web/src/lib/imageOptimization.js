const KILOBYTE = 1024;

export const IMAGE_OPTIMIZATION_PRESETS = Object.freeze({
  logo: Object.freeze({
    maxWidth: 512,
    maxHeight: 512,
    maxBytes: 160 * KILOBYTE,
    preferredMime: "image/webp",
    quality: 0.9,
    minQuality: 0.72,
    minimumDimension: 256
  }),
  hero: Object.freeze({
    maxWidth: 2560,
    maxHeight: 1600,
    maxBytes: 650 * KILOBYTE,
    preferredMime: "image/webp",
    quality: 0.86,
    minQuality: 0.7,
    minimumDimension: 720
  })
});

export function calculateContainDimensions(
  sourceWidth,
  sourceHeight,
  maxWidth,
  maxHeight
) {
  const safeSourceWidth = Math.max(1, Number(sourceWidth) || 1);
  const safeSourceHeight = Math.max(1, Number(sourceHeight) || 1);
  const safeMaxWidth = Math.max(1, Number(maxWidth) || safeSourceWidth);
  const safeMaxHeight = Math.max(1, Number(maxHeight) || safeSourceHeight);
  const scale = Math.min(
    1,
    safeMaxWidth / safeSourceWidth,
    safeMaxHeight / safeSourceHeight
  );

  return {
    width: Math.max(1, Math.round(safeSourceWidth * scale)),
    height: Math.max(1, Math.round(safeSourceHeight * scale)),
    scale
  };
}

export function shouldPreserveOriginalImageType(mimeType = "") {
  const normalized = String(mimeType || "").trim().toLowerCase();
  return normalized === "image/svg+xml" || normalized === "image/gif";
}

/**
 * Formats a browser will happily accept from a file picker but cannot render.
 *
 * HEIC is what an iPhone produces by default. Safari decodes it, so a member on
 * an Apple device sees their own attachment fine -- and everyone on Chrome or
 * Firefox sees a broken image. Converting on the way in is what keeps the two
 * ends agreeing.
 */
export const UNRENDERABLE_IMAGE_MIME_TYPES = Object.freeze(
  new Set(["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"])
);

export function isUnrenderableImageType(mimeType = "") {
  return UNRENDERABLE_IMAGE_MIME_TYPES.has(String(mimeType || "").trim().toLowerCase());
}

export function extensionForImageMime(mimeType = "") {
  const normalized = String(mimeType || "").trim().toLowerCase();
  if (normalized === "image/png") return "png";
  if (normalized === "image/webp") return "webp";
  if (normalized === "image/avif") return "avif";
  if (normalized === "image/gif") return "gif";
  if (normalized === "image/svg+xml") return "svg";
  return "jpg";
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({
        source: image,
        width: image.naturalWidth || image.width,
        height: image.naturalHeight || image.height,
        release: () => {}
      });
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Unable to process image file."));
    };
    image.src = objectUrl;
  });
}

async function decodeImage(file) {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close()
      };
    } catch {
      try {
        const bitmap = await createImageBitmap(file);
        return {
          source: bitmap,
          width: bitmap.width,
          height: bitmap.height,
          release: () => bitmap.close()
        };
      } catch {
        // Fall through to the broadly supported HTMLImageElement path.
      }
    }
  }
  return loadImageFromFile(file);
}

function canvasToBlob(canvas, mimeType, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Unable to process image file."));
          return;
        }
        resolve(blob);
      },
      mimeType,
      quality
    );
  });
}

function supportsCanvasMimeType(canvas, mimeType) {
  if (mimeType !== "image/webp" && mimeType !== "image/avif") return true;
  try {
    return canvas.toDataURL(mimeType).startsWith(`data:${mimeType}`);
  } catch {
    return false;
  }
}

function chooseOutputMime(canvas, sourceMime, preferredMime) {
  const preferred = String(preferredMime || "image/webp").trim().toLowerCase();
  if (supportsCanvasMimeType(canvas, preferred)) return preferred;
  if (String(sourceMime || "").toLowerCase() === "image/png") return "image/png";
  return "image/jpeg";
}

/**
 * Renders a square PNG icon from a branding logo. Browsers and mobile launchers
 * expect a square, and PNG is the only format every icon surface accepts — iOS in
 * particular ignores a WebP apple-touch-icon. The logo is contained rather than
 * cropped and the padding stays transparent.
 */
export async function renderAppIconPng(file, size) {
  const edge = Math.max(1, Math.round(Number(size) || 0));
  const decoded = await decodeImage(file);
  const canvas = document.createElement("canvas");
  canvas.width = edge;
  canvas.height = edge;
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) {
    decoded.release();
    throw new Error("Unable to process image file.");
  }

  try {
    const { width, height } = calculateContainDimensions(
      decoded.width,
      decoded.height,
      edge,
      edge
    );
    context.clearRect(0, 0, edge, edge);
    context.drawImage(
      decoded.source,
      Math.round((edge - width) / 2),
      Math.round((edge - height) / 2),
      width,
      height
    );
    return await canvasToBlob(canvas, "image/png");
  } finally {
    decoded.release();
    canvas.width = 1;
    canvas.height = 1;
  }
}

/**
 * Reduces tenant branding transfer size before upload while retaining enough
 * resolution for high-density displays. SVG and GIF files are returned intact
 * so vectors remain vectors and animation is never flattened.
 */
export async function optimizeImageFile(file, options = {}) {
  if (!file || !String(file.type || "").startsWith("image/")) {
    throw new Error("Only image files can be optimized.");
  }
  if (shouldPreserveOriginalImageType(file.type)) return file;

  const settings = {
    ...IMAGE_OPTIMIZATION_PRESETS.hero,
    ...options
  };
  const decoded = await decodeImage(file);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) {
    decoded.release();
    throw new Error("Unable to process image file.");
  }

  try {
    let dimensions = calculateContainDimensions(
      decoded.width,
      decoded.height,
      settings.maxWidth,
      settings.maxHeight
    );

    if (
      dimensions.scale === 1 &&
      Number(file.size || 0) <= Number(settings.maxBytes || 0)
    ) {
      return file;
    }

    const render = () => {
      canvas.width = dimensions.width;
      canvas.height = dimensions.height;
      context.clearRect(0, 0, dimensions.width, dimensions.height);
      context.drawImage(decoded.source, 0, 0, dimensions.width, dimensions.height);
    };

    render();
    const outputMime = chooseOutputMime(
      canvas,
      file.type,
      settings.preferredMime
    );
    const qualityIsAdjustable =
      outputMime === "image/jpeg" ||
      outputMime === "image/webp" ||
      outputMime === "image/avif";
    let outputQuality = Number(settings.quality || 0.86);
    const minQuality = Number(settings.minQuality || 0.7);
    let result = await canvasToBlob(canvas, outputMime, outputQuality);

    while (
      result.size > settings.maxBytes &&
      qualityIsAdjustable &&
      outputQuality > minQuality
    ) {
      outputQuality = Math.max(minQuality, outputQuality - 0.06);
      result = await canvasToBlob(canvas, outputMime, outputQuality);
    }

    let resizePasses = 0;
    while (result.size > settings.maxBytes && resizePasses < 6) {
      const nextWidth = Math.max(
        settings.minimumDimension,
        Math.round(dimensions.width * 0.86)
      );
      const nextHeight = Math.max(
        1,
        Math.round((nextWidth / dimensions.width) * dimensions.height)
      );
      if (
        nextWidth >= dimensions.width ||
        nextHeight >= dimensions.height
      ) {
        break;
      }
      dimensions = { width: nextWidth, height: nextHeight, scale: 1 };
      render();
      result = await canvasToBlob(canvas, outputMime, outputQuality);
      resizePasses += 1;
    }

    if (
      Number(file.size || 0) > 0 &&
      result.size >= file.size &&
      file.size <= settings.maxBytes
    ) {
      return file;
    }

    return result;
  } finally {
    decoded.release();
    canvas.width = 1;
    canvas.height = 1;
  }
}


/**
 * Re-encode an image the browser cannot display into a JPEG it can.
 *
 * Decoding is the part that can fail: only a device that understands the format
 * can read it, which in practice means the Apple device the HEIC came from.
 * A picker on Chrome can still hand over a .heic from disk, and there is no way
 * to convert it there -- so this reports the failure rather than passing an
 * unviewable file through to storage.
 *
 * Anything already renderable is returned untouched.
 */
export async function transcodeUnrenderableImage(file, { quality = 0.9 } = {}) {
  if (!file || !isUnrenderableImageType(file.type)) return file;

  let decoded = null;
  try {
    decoded = await decodeImage(file);
  } catch {
    const error = new Error(
      "This browser cannot read HEIC images. Please convert it to JPEG first, or send it from your phone."
    );
    error.code = "IMAGE_DECODE_UNSUPPORTED";
    throw error;
  }

  try {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, decoded.width);
    canvas.height = Math.max(1, decoded.height);
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("no 2d context");
    context.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);

    const blob = await canvasToBlob(canvas, "image/jpeg", quality);
    if (!blob) throw new Error("encode produced nothing");

    const baseName = String(file.name || "image").replace(/\.[^.]+$/, "");
    return new File([blob], `${baseName}.jpg`, {
      type: "image/jpeg",
      lastModified: file.lastModified || Date.now()
    });
  } catch {
    const error = new Error("Could not convert this image. Please try a JPEG or PNG.");
    error.code = "IMAGE_ENCODE_FAILED";
    throw error;
  } finally {
    decoded?.release?.();
  }
}

// Logo backdrop detection. See lib/logoTreatment.js for what the result is used
// for; this half only reads pixels.

// The sample is downscaled first, so the frame has to be wide enough to survive
// that: a single-pixel border would be mostly resampling artifacts.
const BACKDROP_SAMPLE_EDGE = 192;
const BACKDROP_BORDER_FRACTION = 0.04;
// JPEG ringing around a hard edge moves the corners by a few levels even when the
// backdrop was pure white in the source, so "uniform" has to allow for that.
const BACKDROP_UNIFORM_TOLERANCE = 14;
const BACKDROP_LIGHT_MINIMUM = 232;
const BACKDROP_ALPHA_OPAQUE = 250;
// Below this the difference is compression noise rather than artwork.
const BACKDROP_CONTENT_DELTA = 26;

/**
 * Reads RGBA pixels and reports what sits behind the mark: whether the backdrop
 * is opaque, whether its outer frame is a uniform light color, and how big the
 * non-backdrop content is.
 *
 * Transparency is judged on the border ring alone, not the whole image. What
 * makes a rectangle appear on the bar is an opaque *frame*; a mark that is cut
 * out has a see-through one. Sampling everything instead would let a single
 * antialiased pixel anywhere inside the artwork call a solid white box
 * transparent -- and would misread a logo like Camp Waldemar's, which is a white
 * disc on transparency and already sits correctly on its bar.
 *
 * Separated from the canvas so the thresholds can be exercised directly.
 */
export function readLogoBackdropFromPixels(data, width, height) {
  const safeWidth = Math.max(0, Math.floor(Number(width) || 0));
  const safeHeight = Math.max(0, Math.floor(Number(height) || 0));
  const empty = {
    backdropIsOpaque: false,
    borderIsUniformLight: false,
    contentWidth: 0,
    contentHeight: 0
  };
  if (!data || !safeWidth || !safeHeight) return empty;
  if (data.length < safeWidth * safeHeight * 4) return empty;

  const band = Math.max(1, Math.round(Math.min(safeWidth, safeHeight) * BACKDROP_BORDER_FRACTION));
  const isBorder = (x, y) =>
    x < band || y < band || x >= safeWidth - band || y >= safeHeight - band;

  let borderIsOpaque = true;
  let borderCount = 0;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let minR = 255;
  let minG = 255;
  let minB = 255;
  let maxR = 0;
  let maxG = 0;
  let maxB = 0;

  for (let y = 0; y < safeHeight; y += 1) {
    for (let x = 0; x < safeWidth; x += 1) {
      if (!isBorder(x, y)) continue;
      const index = (y * safeWidth + x) * 4;
      if (data[index + 3] < BACKDROP_ALPHA_OPAQUE) borderIsOpaque = false;
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      borderCount += 1;
      sumR += r;
      sumG += g;
      sumB += b;
      if (r < minR) minR = r;
      if (g < minG) minG = g;
      if (b < minB) minB = b;
      if (r > maxR) maxR = r;
      if (g > maxG) maxG = g;
      if (b > maxB) maxB = b;
    }
  }

  // A see-through frame answers the question on its own; its color is moot.
  if (!borderIsOpaque || !borderCount) {
    return {
      backdropIsOpaque: false,
      borderIsUniformLight: false,
      contentWidth: 0,
      contentHeight: 0
    };
  }

  const meanR = sumR / borderCount;
  const meanG = sumG / borderCount;
  const meanB = sumB / borderCount;
  const spread = Math.max(maxR - minR, maxG - minG, maxB - minB);
  const borderIsUniformLight =
    spread <= BACKDROP_UNIFORM_TOLERANCE &&
    meanR >= BACKDROP_LIGHT_MINIMUM &&
    meanG >= BACKDROP_LIGHT_MINIMUM &&
    meanB >= BACKDROP_LIGHT_MINIMUM;

  if (!borderIsUniformLight) {
    return {
      backdropIsOpaque: true,
      borderIsUniformLight: false,
      contentWidth: 0,
      contentHeight: 0
    };
  }

  let minX = safeWidth;
  let minY = safeHeight;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < safeHeight; y += 1) {
    for (let x = 0; x < safeWidth; x += 1) {
      const index = (y * safeWidth + x) * 4;
      const delta = Math.max(
        Math.abs(data[index] - meanR),
        Math.abs(data[index + 1] - meanG),
        Math.abs(data[index + 2] - meanB)
      );
      if (delta < BACKDROP_CONTENT_DELTA) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < 0) {
    return {
      backdropIsOpaque: true,
      borderIsUniformLight: true,
      contentWidth: 0,
      contentHeight: 0
    };
  }

  return {
    backdropIsOpaque: true,
    borderIsUniformLight: true,
    contentWidth: maxX - minX + 1,
    contentHeight: maxY - minY + 1
  };
}

/**
 * Measures a logo file's backdrop. Returns null rather than throwing when the
 * browser will not hand back pixel data -- a logo that cannot be measured keeps
 * the plain treatment, which is what it would have had anyway.
 */
export async function measureLogoBackdrop(file) {
  if (!file || !String(file.type || "").startsWith("image/")) return null;
  // A vector has no pixels to sample and animation is not a branding logo.
  if (shouldPreserveOriginalImageType(file.type)) return null;

  let decoded = null;
  let canvas = null;
  try {
    decoded = await decodeImage(file);
    const { width, height } = calculateContainDimensions(
      decoded.width,
      decoded.height,
      BACKDROP_SAMPLE_EDGE,
      BACKDROP_SAMPLE_EDGE
    );
    canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
    if (!context) return null;
    context.clearRect(0, 0, width, height);
    context.drawImage(decoded.source, 0, 0, width, height);
    const { data } = context.getImageData(0, 0, width, height);
    return readLogoBackdropFromPixels(data, width, height);
  } catch {
    return null;
  } finally {
    decoded?.release?.();
    if (canvas) {
      canvas.width = 1;
      canvas.height = 1;
    }
  }
}
