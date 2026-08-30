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
