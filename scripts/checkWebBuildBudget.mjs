import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";

const rootDir = process.cwd();
const distAssetsDir = path.resolve(rootDir, "apps/web/dist/assets");
const distIndexPath = path.resolve(rootDir, "apps/web/dist/index.html");

const maxEntryJsGzipKb = Number(
  process.env.PONDBRIDGE_MAX_ENTRY_JS_GZIP_KB ||
    process.env.PONDBRIDGE_MAX_MAIN_JS_GZIP_KB ||
    125
);
const maxInitialCssGzipKb = Number(
  process.env.PONDBRIDGE_MAX_INITIAL_CSS_GZIP_KB || 60
);
const maxRouteJsGzipKb = Number(
  process.env.PONDBRIDGE_MAX_ROUTE_JS_GZIP_KB || 50
);
const maxLargestAssetRawMb = Number(process.env.PONDBRIDGE_MAX_LARGEST_ASSET_MB || 2.0);
const maxLargestImageRawMb = Number(process.env.PONDBRIDGE_MAX_LARGEST_IMAGE_MB || 1.0);

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
      (row) =>
        row.file !== entryScriptName &&
        !/^(?:vendor-)?maplibre(?:-gl)?-/i.test(row.file)
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
