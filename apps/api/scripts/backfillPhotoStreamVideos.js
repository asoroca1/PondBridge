/**
 * backfillPhotoStreamVideos.js
 *
 * Sends media-stream clips posted before Cloudflare Stream existed through the
 * same encode new uploads get, so old posts stop being Safari-only too.
 *
 * Safety:
 *   - Dry run by default. Nothing is created or written without --apply.
 *   - Skips any post that already carries a stream uid, so re-runs are cheap
 *     and never pay to encode the same clip twice.
 *   - Touches only rows where media_type = 'video'.
 *   - Ingests one clip at a time with a pause between, so a large camp does not
 *     arrive at Stream as a burst.
 *
 * This one does run against production -- that is where the old posts are. It
 * costs money: every clip it ingests becomes billable stored minutes. Run the
 * dry run first and read the count.
 *
 * Usage:
 *   npm --workspace @pondbridge/api run backfill:photo-stream
 *   npm --workspace @pondbridge/api run backfill:photo-stream -- --slug=cedar
 *   npm --workspace @pondbridge/api run backfill:photo-stream -- --limit=10 --apply
 *
 * Requires supabase/migrations/20260903170000_photo_stream_cloudflare_stream.sql
 * to have run against the target database first.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const { PhotoModel, TenantModel } = await import("../src/db/models/index.js");
const { ingestFromUrl, streamEnabled, STREAM_STATUS } = await import(
  "../src/services/cloudflareStream.js"
);

const PAUSE_BETWEEN_INGESTS_MS = 1000;

function readFlag(name, fallback = "") {
  const hit = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveTenantIds(slug) {
  if (!slug) return null;
  const tenant = await TenantModel.findOne({ slug });
  if (!tenant) throw new Error(`No camp found with slug "${slug}".`);
  return [String(tenant._id)];
}

async function run() {
  const apply = hasFlag("apply");
  const slug = readFlag("slug");
  const limit = Number(readFlag("limit", "0")) || 0;

  if (!streamEnabled()) {
    throw new Error(
      "Cloudflare Stream is not configured. Set CLOUDFLARE_STREAM_API_TOKEN (see docs/CLOUDFLARE_STREAM.md)."
    );
  }

  const tenantIds = await resolveTenantIds(slug);
  const all = await PhotoModel.acrossTenants().find({ mediaType: "video" });
  const scoped = tenantIds
    ? all.filter((photo) => tenantIds.includes(String(photo.tenantId)))
    : all;

  // A post with a uid has already been through this, whatever state it reached.
  const pending = scoped.filter((photo) => !photo.streamUid && photo.imageUrl);
  const targets = limit > 0 ? pending.slice(0, limit) : pending;

  console.log(`[backfill] video posts in scope: ${scoped.length}`);
  console.log(`[backfill] already encoded or missing a source: ${scoped.length - pending.length}`);
  console.log(`[backfill] to ingest: ${targets.length}${limit > 0 ? ` (capped at ${limit})` : ""}`);

  if (!apply) {
    console.log("[backfill] dry run -- nothing was sent to Stream. Re-run with --apply to do it.");
    for (const photo of targets.slice(0, 10)) {
      console.log(`[backfill]   would ingest ${photo._id} (${photo.imageUrl})`);
    }
    if (targets.length > 10) console.log(`[backfill]   ...and ${targets.length - 10} more`);
    return;
  }

  let ingested = 0;
  let failed = 0;
  for (const photo of targets) {
    try {
      const state = await ingestFromUrl(photo.imageUrl, {
        name: `photo-stream-backfill-${photo._id}`,
        meta: { photoId: String(photo._id), tenantId: String(photo.tenantId), backfill: "true" }
      });
      await PhotoModel.updateScoped(photo.tenantId, photo._id, {
        streamUid: state.streamUid,
        streamStatus: state.streamStatus || STREAM_STATUS.PROCESSING,
        streamPlaybackUrl: state.streamPlaybackUrl,
        ...(state.durationSeconds ? { durationSeconds: state.durationSeconds } : {})
      });
      ingested += 1;
      console.log(`[backfill] ingested ${photo._id} -> ${state.streamUid}`);
    } catch (error) {
      failed += 1;
      // The post still plays from its original upload, so a failure here leaves
      // things exactly as they were rather than breaking anything.
      console.error(`[backfill] FAILED ${photo._id}: ${error?.message || error}`);
    }
    await sleep(PAUSE_BETWEEN_INGESTS_MS);
  }

  console.log(`[backfill] done. ingested=${ingested} failed=${failed}`);
  console.log("[backfill] encodes finish asynchronously; the webhook fills in playback URLs.");
}

run().catch((error) => {
  console.error("[backfill] failed:", error?.message || error);
  process.exit(1);
});
