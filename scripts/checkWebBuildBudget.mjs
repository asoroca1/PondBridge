import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";

const rootDir = process.cwd();
const distAssetsDir = path.resolve(rootDir, "apps/web/dist/assets");

const maxMainJsGzipKb = Number(process.env.PONDBRIDGE_MAX_MAIN_JS_GZIP_KB || 350);
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
  const largestAsset = [...assetRows].sort((a, b) => b.rawBytes - a.rawBytes)[0] || null;
  const largestImage = [...assetRows]
    .filter((row) => /\.(png|jpe?g|webp|avif|gif|svg)$/i.test(row.file))
    .sort((a, b) => b.rawBytes - a.rawBytes)[0] || null;

  if (!largestJs || !largestAsset) {
    throw new Error("Unable to locate JS/assets in web build output.");
  }

  console.log(`[perf:web] largest JS: ${largestJs.file} raw=${formatKb(largestJs.rawBytes)} gzip=${formatKb(largestJs.gzBytes)}`);
  console.log(`[perf:web] largest asset: ${largestAsset.file} raw=${formatMb(largestAsset.rawBytes)} gzip=${formatKb(largestAsset.gzBytes)}`);
  console.log(
    `[perf:web] budgets: main_js_gzip<=${maxMainJsGzipKb}KB largest_asset_raw<=${maxLargestAssetRawMb}MB largest_image_raw<=${maxLargestImageRawMb}MB`
  );
  if (largestImage) {
    console.log(`[perf:web] largest image: ${largestImage.file} raw=${formatMb(largestImage.rawBytes)} gzip=${formatKb(largestImage.gzBytes)}`);
  }

  const errors = [];
  if (largestJs.gzBytes > maxMainJsGzipKb * 1024) {
    errors.push(
      `Main JS gzip budget exceeded: ${formatKb(largestJs.gzBytes)} > ${maxMainJsGzipKb}KB`
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
