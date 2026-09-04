import crypto from "node:crypto";

import { env } from "../config/env.js";
import { logLine } from "./logger.js";

const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";
const REQUEST_TIMEOUT_MS = 15000;

/**
 * A clip uploaded from a phone is whatever the phone felt like producing --
 * usually HEVC in a QuickTime container, which only Safari can decode. Handing
 * it to Stream gets back H.264/HLS that every browser plays, so this module is
 * the one place that knows how to ask.
 */

export const STREAM_STATUS = Object.freeze({
  PENDING: "pending",
  PROCESSING: "processing",
  READY: "ready",
  ERROR: "error"
});

export function streamEnabled() {
  return Boolean(env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_STREAM_API_TOKEN);
}

function withTimeout(ms = REQUEST_TIMEOUT_MS) {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

async function streamRequest(method, path, body) {
  if (!streamEnabled()) throw new Error("Cloudflare Stream is not configured");

  const response = await fetch(
    `${CLOUDFLARE_API_BASE}/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/stream${path}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${env.CLOUDFLARE_STREAM_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: withTimeout()
    }
  );

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.success === false) {
    const messages = Array.isArray(payload?.errors)
      ? payload.errors.map((item) => item?.message || JSON.stringify(item)).join("; ")
      : `HTTP ${response.status}`;
    throw new Error(`Cloudflare Stream ${method} ${path} failed: ${messages}`);
  }
  return payload?.result || {};
}

/**
 * The customer subdomain is stable per account but only ever comes back on a
 * video, so remember the first one we see rather than pinning it in config.
 */
let cachedCustomerSubdomain = "";

function rememberSubdomain(video = {}) {
  const fromPlayback = String(video?.playback?.hls || "");
  const match = fromPlayback.match(/^https:\/\/([^/]+)\//i);
  if (match?.[1]) cachedCustomerSubdomain = match[1];
}

export function customerSubdomain() {
  return env.CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN || cachedCustomerSubdomain || "";
}

/**
 * Normalise a Stream video into the handful of fields a post actually stores.
 * `readyToStream` goes true as soon as one quality level exists, which is the
 * moment playback starts working -- waiting for every rendition would leave the
 * post looking stuck for no benefit.
 */
export function toStreamState(video = {}) {
  const state = String(video?.status?.state || "").toLowerCase();
  const ready = Boolean(video?.readyToStream) || state === "ready";
  let status = STREAM_STATUS.PROCESSING;
  if (state === "error") status = STREAM_STATUS.ERROR;
  else if (ready) status = STREAM_STATUS.READY;

  rememberSubdomain(video);

  return {
    streamUid: String(video?.uid || ""),
    streamStatus: status,
    streamPlaybackUrl: String(video?.playback?.hls || ""),
    streamThumbUrl: String(video?.thumbnail || ""),
    durationSeconds: Number(video?.duration) > 0 ? Number(video.duration) : 0,
    // Stream reports its own reason on failure; keep it for the uploader.
    streamError: status === STREAM_STATUS.ERROR
      ? String(video?.status?.errorReasonText || "Video could not be processed")
      : ""
  };
}

/**
 * Ask Stream to pull a file we have already stored. Copying by URL keeps the
 * browser's upload path untouched -- the bytes still go straight to R2 over a
 * presigned PUT, and Stream fetches them from there.
 */
export async function ingestFromUrl(url, { name = "", meta = {}, requireSignedURLs = false } = {}) {
  const source = String(url || "").trim();
  if (!source) throw new Error("A source URL is required");

  const video = await streamRequest("POST", "/copy", {
    url: source,
    meta: { name: name || source.split("/").pop() || "video", ...meta },
    // A chat attachment is private, so its encode must not be watchable by
    // anyone holding the Stream id. Playback then needs a token per view.
    ...(requireSignedURLs ? { requireSignedURLs: true } : {})
  });
  return toStreamState(video);
}

/**
 * Mint a short-lived playback token for a video that requires signed URLs.
 *
 * The caller is responsible for deciding the viewer is allowed to watch --
 * this only turns that decision into something Stream will honour.
 *
 * Uses Stream's own /token endpoint rather than a locally held signing key.
 * Cloudflare suggests a signing key past roughly a thousand tokens a day; a
 * camp's chat traffic is nowhere near that, and this avoids us storing and
 * rotating a private key.
 */
export async function createPlaybackToken(uid, { expiresInSeconds = 3600 } = {}) {
  const id = String(uid || "").trim();
  if (!id) throw new Error("A video uid is required");

  // Stream caps a token's life at 24h from signing.
  const ttl = Math.min(Math.max(Number(expiresInSeconds) || 3600, 60), 86_400);
  const exp = Math.floor(Date.now() / 1000) + ttl;

  const result = await streamRequest("POST", `/${encodeURIComponent(id)}/token`, { exp });
  const token = String(result?.token || "");
  if (!token) throw new Error("Cloudflare Stream returned no playback token");

  const host = customerSubdomain();
  return {
    token,
    expiresAt: new Date(exp * 1000).toISOString(),
    // Without a known subdomain the caller cannot build a URL; surfacing an
    // empty string is clearer than guessing one that 404s.
    manifestUrl: host ? `https://${host}/${token}/manifest/video.m3u8` : ""
  };
}

export async function getVideo(uid) {
  const id = String(uid || "").trim();
  if (!id) throw new Error("A video uid is required");
  const video = await streamRequest("GET", `/${encodeURIComponent(id)}`);
  return toStreamState(video);
}

export async function deleteVideo(uid) {
  const id = String(uid || "").trim();
  if (!id) return false;
  try {
    await streamRequest("DELETE", `/${encodeURIComponent(id)}`);
    return true;
  } catch (error) {
    // A post can be deleted while its video is mid-encode, and a missing video
    // is the outcome we wanted anyway.
    logLine("warn", "cloudflare_stream_delete_failed", { uid: id, message: error?.message });
    return false;
  }
}

/**
 * Point the account's single webhook subscription at us. Stream allows only one
 * per account, so this overwrites whatever was there -- it is an operator
 * action, not something a request path should call.
 */
export async function subscribeWebhook(notificationUrl) {
  const url = String(notificationUrl || "").trim();
  if (!url) throw new Error("A notification URL is required");
  const result = await streamRequest("PUT", "/webhook", { notificationUrl: url });
  return String(result?.secret || "");
}

/**
 * Verify the `Webhook-Signature: time=<unix>,sig1=<hex>` header Stream sends.
 * The signed payload is the timestamp, a dot, then the raw body exactly as it
 * arrived -- re-serialising parsed JSON would change the bytes and never match.
 */
export function verifyWebhookSignature(rawBody, signatureHeader, { toleranceSeconds = 300 } = {}) {
  const secret = env.CLOUDFLARE_STREAM_WEBHOOK_SECRET;
  if (!secret) return false;

  const parts = String(signatureHeader || "")
    .split(",")
    .map((part) => part.trim().split("="))
    .reduce((acc, [key, value]) => (key ? { ...acc, [key]: value } : acc), {});

  const timestamp = String(parts.time || "");
  const signature = String(parts.sig1 || "");
  if (!timestamp || !signature) return false;

  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > toleranceSeconds) return false;

  const body = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody || "");
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");

  const expectedBuffer = Buffer.from(expected, "utf8");
  const providedBuffer = Buffer.from(signature, "utf8");
  if (expectedBuffer.length !== providedBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}
