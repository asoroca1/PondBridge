import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";

const rootDir = process.cwd();
const distAssetsDir = path.resolve(rootDir, "apps/web/dist/assets");
const distIndexPath = path.resolve(rootDir, "apps/web/dist/index.html");

/**
 * Budgets are ratchets, not aspirations.
 *
 * These were set far enough above the real build that most of them could not
 * fail: the route budget had 19KB of slack, the largest-asset budget over a
 * megabyte. A budget with that much room does not catch a regression, it
 * records one after the fact — the build can double a route's cost and still
 * go green.
 *
 * Each number below now sits just above what the build actually produces, so
 * a real increase has to be argued for rather than absorbed. Measured
 * 2026-09-04:
 *
 *   entry JS gzip     111.2KB
 *   initial CSS gzip   58.0KB
 *   largest route JS   31.2KB gzip
 *   largest asset       0.97MB raw (maplibre, lazy)
 *   largest image       0.76MB raw
 *
 * Two of these are still well short of the audit's stretch targets — entry JS
 * wants 100KB and initial CSS wants 45KB — and initial CSS is the tight one:
 * it has about 1KB of headroom, so the next stylesheet added to the global
 * bundle will fail this check. That is the intended behaviour, and splitting
 * CSS by route is the work that buys the room back.
 *
 * Lower a number when the build gets smaller. Raising one is a decision, and
 * the comment above should say why.
 */
const maxEntryJsGzipKb = Number(
  process.env.PONDBRIDGE_MAX_ENTRY_JS_GZIP_KB ||
    process.env.PONDBRIDGE_MAX_MAIN_JS_GZIP_KB ||
    115
);
const maxInitialCssGzipKb = Number(
  process.env.PONDBRIDGE_MAX_INITIAL_CSS_GZIP_KB || 59
);
const maxRouteJsGzipKb = Number(
  process.env.PONDBRIDGE_MAX_ROUTE_JS_GZIP_KB || 35
);
const maxLargestAssetRawMb = Number(process.env.PONDBRIDGE_MAX_LARGEST_ASSET_MB || 1.1);
const maxLargestImageRawMb = Number(process.env.PONDBRIDGE_MAX_LARGEST_IMAGE_MB || 0.8);

/**
 * Vendor libraries that are imported at the moment a feature is used, not as
 * part of any route's bundle.
 *
 * The route budget exists to stop a page costing too much to open. A chunk
 * nobody downloads until they open the map, or press play on a video, does not
 * make any page heavier -- it would just make the budget unmeetable for a
 * feature that cannot be built smaller.
 */
function isOnDemandVendorChunk(file = "") {
  return /^(?:vendor-)?maplibre(?:-gl)?-/i.test(file) || /^(?:vendor-)?hls-/i.test(file);
}

function formatKb(bytes = 0) {
  return `${(bytes / 1024).toFixed(1)}KB`;
}

function formatMb(bytes = 0) {
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}

async function gzipSize(buffer) {
  return new Promise((resolve, reject) => {
    zlib.gzip(buffer, (error, result) => {
      if (error) return reject(error);
      return resolve(result.length);
    });
  });
}

async function run() {
  const indexHtml = await fs.readFile(distIndexPath, "utf8");
  const files = await fs.readdir(distAssetsDir);
  if (!files.length) {
    throw new Error("No web build assets found. Run `npm run build` first.");
  }

  const assetRows = [];
  for (const file of files) {
    const abs = path.join(distAssetsDir, file);
    const stat = await fs.stat(abs);
    if (!stat.isFile()) continue;
    const rawBytes = stat.size;
    const buffer = await fs.readFile(abs);
    const gzBytes = await gzipSize(buffer);
    assetRows.push({ file, rawBytes, gzBytes });
  }

  const jsAssets = assetRows
    .filter((row) => row.file.endsWith(".js"))
    .sort((a, b) => b.rawBytes - a.rawBytes);

  const largestJs = jsAssets[0] || null;
  const entryScriptName =
    indexHtml.match(/<script[^>]+src=["'][^"']*\/([^/"']+\.js)["']/i)?.[1] || "";
  const entryJs = assetRows.find((row) => row.file === entryScriptName) || null;
  const initialCssNames = [
    ...indexHtml.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]+href=["'][^"']*\/([^/"']+\.css)["']/gi)
  ].map((match) => match[1]);
  const initialCssRows = initialCssNames
    .map((file) => assetRows.find((row) => row.file === file))
    .filter(Boolean);
  const initialCssGzipBytes = initialCssRows.reduce(
    (total, row) => total + row.gzBytes,
    0
  );
  const largestRouteJs =
    jsAssets.find(
      (row) => row.file !== entryScriptName && !isOnDemandVendorChunk(row.file)
    ) || null;
  const largestAsset = [...assetRows].sort((a, b) => b.rawBytes - a.rawBytes)[0] || null;
  const largestImage = [...assetRows]
    .filter((row) => /\.(png|jpe?g|webp|avif|gif|svg)$/i.test(row.file))
    .sort((a, b) => b.rawBytes - a.rawBytes)[0] || null;

  if (!largestJs || !entryJs || !largestAsset) {
    throw new Error("Unable to locate the entry JS/assets in web build output.");
  }

  console.log(`[perf:web] entry JS: ${entryJs.file} raw=${formatKb(entryJs.rawBytes)} gzip=${formatKb(entryJs.gzBytes)}`);
  if (largestRouteJs) {
    console.log(`[perf:web] largest route JS: ${largestRouteJs.file} raw=${formatKb(largestRouteJs.rawBytes)} gzip=${formatKb(largestRouteJs.gzBytes)}`);
  }
  console.log(`[perf:web] initial CSS: ${initialCssNames.join(", ") || "none"} gzip=${formatKb(initialCssGzipBytes)}`);
  console.log(`[perf:web] largest asset: ${largestAsset.file} raw=${formatMb(largestAsset.rawBytes)} gzip=${formatKb(largestAsset.gzBytes)}`);
  console.log(
    `[perf:web] budgets: entry_js_gzip<=${maxEntryJsGzipKb}KB initial_css_gzip<=${maxInitialCssGzipKb}KB route_js_gzip<=${maxRouteJsGzipKb}KB largest_asset_raw<=${maxLargestAssetRawMb}MB largest_image_raw<=${maxLargestImageRawMb}MB`
  );
  if (largestImage) {
    console.log(`[perf:web] largest image: ${largestImage.file} raw=${formatMb(largestImage.rawBytes)} gzip=${formatKb(largestImage.gzBytes)}`);
  }

  const errors = [];
  if (entryJs.gzBytes > maxEntryJsGzipKb * 1024) {
    errors.push(
      `Entry JS gzip budget exceeded: ${formatKb(entryJs.gzBytes)} > ${maxEntryJsGzipKb}KB`
    );
  }
  if (initialCssGzipBytes > maxInitialCssGzipKb * 1024) {
    errors.push(
      `Initial CSS gzip budget exceeded: ${formatKb(initialCssGzipBytes)} > ${maxInitialCssGzipKb}KB`
    );
  }
  if (largestRouteJs && largestRouteJs.gzBytes > maxRouteJsGzipKb * 1024) {
    errors.push(
      `Route JS gzip budget exceeded: ${formatKb(largestRouteJs.gzBytes)} > ${maxRouteJsGzipKb}KB`
    );
  }
  if (largestAsset.rawBytes > maxLargestAssetRawMb * 1024 * 1024) {
    errors.push(
      `Largest asset raw budget exceeded: ${formatMb(largestAsset.rawBytes)} > ${maxLargestAssetRawMb}MB`
    );
  }
  if (largestImage && largestImage.rawBytes > maxLargestImageRawMb * 1024 * 1024) {
    errors.push(
      `Largest image raw budget exceeded: ${formatMb(largestImage.rawBytes)} > ${maxLargestImageRawMb}MB`
    );
  }

  if (errors.length) {
    for (const error of errors) {
      console.error(`[perf:web] ${error}`);
    }
    process.exit(1);
  }
}

run().catch((error) => {
  console.error("[perf:web] failed:", error?.message || error);
  process.exit(1);
});
