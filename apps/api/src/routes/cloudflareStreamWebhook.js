import { Router } from "express";

import { PhotoModel } from "../db/models/index.js";
import { toStreamState, verifyWebhookSignature } from "../services/cloudflareStream.js";
import { logLine } from "../services/logger.js";

const router = Router();

/**
 * Cloudflare Stream tells us an encode finished.
 *
 * The body arrives as a raw Buffer because the signature covers the exact bytes
 * sent -- re-serialising parsed JSON would change them and never verify.
 */
router.post("/", async (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body || ""));

  if (!verifyWebhookSignature(raw, req.get("Webhook-Signature"))) {
    logLine("warn", "cloudflare_stream_webhook_rejected", { reason: "bad_signature" });
    return res.status(401).json({ error: { code: "INVALID_SIGNATURE" } });
  }

  let payload = null;
  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch {
    return res.status(400).json({ error: { code: "INVALID_BODY" } });
  }

  const state = toStreamState(payload);
  if (!state.streamUid) return res.status(400).json({ error: { code: "MISSING_UID" } });

  // The notification carries only the Stream uid, so the row it belongs to has
  // to be found without a tenant in hand. The uid is unguessable and the write
  // below stays on the row it found, so the lookup cannot cross camps.
  const photo = await PhotoModel.acrossTenants().findOne({ streamUid: state.streamUid });
  if (!photo) {
    // A video deleted before its encode finished, or one belonging to another
    // environment pointed at the same account. Neither is worth a retry.
    logLine("info", "cloudflare_stream_webhook_unmatched", { uid: state.streamUid });
    return res.json({ ok: true, matched: false });
  }

  await PhotoModel.updateScoped(photo.tenantId, photo._id, {
    streamStatus: state.streamStatus,
    streamPlaybackUrl: state.streamPlaybackUrl,
    ...(state.durationSeconds ? { durationSeconds: state.durationSeconds } : {})
  });

  logLine("info", "cloudflare_stream_webhook_applied", {
    uid: state.streamUid,
    photoId: String(photo._id),
    status: state.streamStatus
  });

  return res.json({ ok: true, matched: true });
});

export default router;
