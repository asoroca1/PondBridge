import { Router } from "express";
import { isValidObjectId, generateObjectId } from "../utils/objectId.js";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireTenant } from "../middleware/tenantContext.js";
import { enforceTenantScope } from "../middleware/enforceTenantScope.js";
import { requireTenantModule } from "../middleware/requireFeature.js";
import {
  ActivityItemModel,
  PhotoModel,
  NewsletterModel,
  ConversationModel,
  MessageModel,
  ForumModel,
  ForumPostModel,
  ProfileModel,
  UserModel,
  CityGeoModel
} from "../db/models/index.js";
import {
  createPresignedUpload,
  uploadBufferToR2,
  createPresignedDownloadUrl,
  deleteObjectFromR2
} from "../services/objectStorage.js";
import { buildTenantEmailBranding, sendBulkTransactionalEmail } from "../services/email.js";
import { broadcastTemplate } from "../services/emailTemplates.js";
import { cityKey, geocodeCity } from "../utils/geocode.js";
import { isAllowedCorsOrigin } from "../config/cors.js";
import { sanitizeText } from "../utils/sanitize.js";
import {
  canonicalizeCityName,
  canonicalizeCountryName,
  composeCityState,
  normalizeLocationToken,
  parseCityStateDetailed
} from "../utils/location.js";
import { ensureProfileForUser } from "../services/profileCompletion.js";
import {
  normalizeTenantMobileNotificationPrefs,
  resolveAudienceUserIds,
  sendMobileNotificationBatch
} from "../services/mobileNotifications.js";
import { createTtlCache } from "../utils/ttlCache.js";
import {
  canViewProfileContact,
  filterProfileContactFields,
  normalizeProfilePrivacy
} from "../services/profilePrivacy.js";
import {
  assertConversationDirectContactAllowed,
  assertDirectContactAllowed,
  getMutuallyBlockedUserIds
} from "../services/memberSafety.js";
import {
  MESSAGE_ATTACHMENT_MIME_TYPES,
  MAX_MESSAGE_ATTACHMENT_BYTES,
  advanceReadBy,
  clampReadAt,
  hasConversationMessage,
  normalizeStoredMessageMedia,
  notifyConversationParticipants
} from "../services/messaging.js";
import {
  closeRealtimeRoom,
  emitRealtime,
  evictUserFromRealtimeRoom,
  joinUserSocketsToRealtimeRoom,
  listRealtimeRoomUserIds
} from "../services/socketServer.js";
import {
  clearConversationCaches,
  conversationDetailResponseCache,
  conversationListResponseCache,
  conversationMessagesResponseCache
} from "../services/chatRuntimeCache.js";

const router = Router({ mergeParams: true });
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }
});
const publicUploadPresignLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 80,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: "RATE_LIMITED",
      message: "Too many upload requests. Please wait before trying again."
    }
  }
});
const privateUploadPresignLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 160,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: "RATE_LIMITED",
      message: "Too many upload requests. Please wait before trying again."
    }
  }
});
const CITIES_CACHE_TTL_MS = Math.max(5000, Number(process.env.MAP_CITIES_CACHE_TTL_MS || 60000));
const CITIES_CACHE_PENDING_TTL_MS = Math.max(
  1000,
  Number(process.env.MAP_CITIES_PENDING_CACHE_TTL_MS || 4000)
);
const CITY_PEOPLE_CACHE_TTL_MS = Math.max(
  5000,
  Number(process.env.MAP_CITY_PEOPLE_CACHE_TTL_MS || 120000)
);
const MAP_CITY_PROFILE_LIMIT = Math.max(500, Number(process.env.MAP_CITY_PROFILE_SCAN_LIMIT || 5000));
const MAP_SYNC_GEOCODE_LIMIT = Math.max(
  0,
  Number(process.env.MAP_SYNC_GEOCODE_LIMIT || (process.env.MAPBOX_TOKEN ? 12 : 1))
);
const CITY_STATE_PARSE_CACHE_LIMIT = Math.max(
  1000,
  Number(process.env.MAP_CITY_STATE_PARSE_CACHE_LIMIT || 6000)
);
const MAP_CITY_PROFILE_SELECT = [
  "id",
  "firstName",
  "lastName",
  "avatarUrl",
  "cityState",
  "industry",
  "currentJobs"
];
const MAP_CITIES_RESPONSE_CACHE_CONTROL = "private, max-age=20, stale-while-revalidate=40";
const MAP_CITY_PEOPLE_RESPONSE_CACHE_CONTROL = "private, max-age=15, stale-while-revalidate=30";
const citiesCacheByTenant = new Map(); // tenantId -> { data, expiresAt, inflight }
const cityPeopleCacheByTenant = new Map(); // tenantId -> Map(cityKey -> { data, expiresAt, inflight })
const geocodeQueue = new Map();
let geocodeWorkerRunning = false;
const parsedCityStateCache = new Map();
const IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml"
]);
const PUBLIC_UPLOAD_SCOPES = new Set(["avatar"]);
const PRIVATE_UPLOAD_SCOPES = new Set(["avatar", "branding-logo", "branding-hero", "event-cover"]);
const PRELAUNCH_PUBLIC_BRANDING_SCOPES = new Set(["branding-logo", "branding-hero"]);
const IMMUTABLE_IMAGE_CACHE_CONTROL = "public, max-age=31536000, immutable";
const PRIVATE_UPLOAD_PROXY_CACHE_CONTROL = "private, max-age=120, stale-while-revalidate=240";
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NEWSLETTER_R2_POINTER_MIME = "application/x.pondbridge.newsletter-r2-pointer+json";
const NEWSLETTER_COVER_R2_POINTER_MIME =
  "application/x.pondbridge.newsletter-cover-r2-pointer+json";
const NEWSLETTER_COVER_MIME_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
const HOME_STATS_CACHE_CONTROL = "private, max-age=20, stale-while-revalidate=40";
const LOCATIONS_STATS_CACHE_CONTROL = "private, max-age=20, stale-while-revalidate=40";
const ACTIVITY_CACHE_CONTROL = "private, max-age=8, stale-while-revalidate=20";
const PHOTO_FEED_CACHE_CONTROL = "private, max-age=8, stale-while-revalidate=20";
const CHAT_CONVERSATIONS_CACHE_CONTROL = "private, max-age=8, stale-while-revalidate=20";
const CHAT_MESSAGES_CACHE_CONTROL = "private, max-age=6, stale-while-revalidate=18";
const FORUMS_CACHE_CONTROL = "private, max-age=8, stale-while-revalidate=20";
const FORUM_POSTS_CACHE_CONTROL = "private, max-age=6, stale-while-revalidate=18";
const homeStatsResponseCache = createTtlCache({ ttlMs: 20_000, maxEntries: 250 });
const locationsStatsResponseCache = createTtlCache({ ttlMs: 20_000, maxEntries: 250 });
const activityResponseCache = createTtlCache({ ttlMs: 8_000, maxEntries: 500 });
const photoFeedResponseCache = createTtlCache({ ttlMs: 8_000, maxEntries: 900 });
const forumsListResponseCache = createTtlCache({ ttlMs: 8_000, maxEntries: 1000 });
const forumDetailResponseCache = createTtlCache({ ttlMs: 8_000, maxEntries: 1200 });
const forumPostsResponseCache = createTtlCache({ ttlMs: 6_000, maxEntries: 1800 });

function tenantReadCacheKey(scope = "", tenantId = "", suffix = "") {
  return [String(scope || "").trim(), String(tenantId || "").trim(), String(suffix || "").trim()].join(":");
}

function clearHomeStatsCaches() {
  homeStatsResponseCache.clear();
  locationsStatsResponseCache.clear();
}

function clearHomeActivityCache() {
  activityResponseCache.clear();
}

function clearPhotoFeedCache() {
  photoFeedResponseCache.clear();
}

function clearForumCaches() {
  forumsListResponseCache.clear();
  forumDetailResponseCache.clear();
  forumPostsResponseCache.clear();
}

function normalizeFileName(fileName = "file") {
  return String(fileName || "file")
    .trim()
    .replace(/[\/\\]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeFileType(fileType = "") {
  return String(fileType || "").trim().toLowerCase();
}

function ensureFileName(fileName = "") {
  const normalized = normalizeFileName(fileName);
  if (!normalized) {
    const error = new Error("fileName is required.");
    error.statusCode = 400;
    error.code = "INVALID_FILE_NAME";
    throw error;
  }
  return normalized;
}

function assertImageContentType(fileType = "", fileName = "") {
  const normalized = normalizeFileType(fileType);
  if (IMAGE_MIME_TYPES.has(normalized)) {
    return normalized;
  }

  const ext = ensureFileName(fileName || "file")
    .split(".")
    .pop()
    ?.toLowerCase();
  const inferred =
    ext === "jpg" || ext === "jpeg"
      ? "image/jpeg"
      : ext === "png"
        ? "image/png"
        : ext === "gif"
          ? "image/gif"
          : ext === "webp"
            ? "image/webp"
            : ext === "svg"
              ? "image/svg+xml"
              : "";

  if (!inferred) {
    const error = new Error("Only image uploads are supported for this endpoint.");
    error.statusCode = 400;
    error.code = "UNSUPPORTED_FILE_TYPE";
    throw error;
  }

  return inferred;
}

function scopeToPrefix(scope = "avatar") {
  const normalized = String(scope || "avatar")
    .trim()
    .toLowerCase();
  if (!PRIVATE_UPLOAD_SCOPES.has(normalized)) {
    const error = new Error("Invalid upload scope.");
    error.statusCode = 400;
    error.code = "INVALID_UPLOAD_SCOPE";
    throw error;
  }
  if (normalized === "branding-logo") return "branding/logos";
  if (normalized === "branding-hero") return "branding/heroes";
  if (normalized === "event-cover") return "events/covers";
  return "profiles/avatars";
}

function ensureBrowserOriginAllowed(req) {
  const origin = String(req.headers.origin || "").trim();
  if (!origin || !isAllowedCorsOrigin(origin)) {
    const error = new Error("Upload origin is not allowed.");
    error.statusCode = 403;
    error.code = "UPLOAD_ORIGIN_FORBIDDEN";
    throw error;
  }
}

async function ensurePublicUploadScopeAllowed(req, scope) {
  if (PUBLIC_UPLOAD_SCOPES.has(scope)) return;
  const onboardingStatus = String(req.tenant?.onboardingStatus || "").trim().toLowerCase();
  if (PRELAUNCH_PUBLIC_BRANDING_SCOPES.has(scope) && onboardingStatus !== "live") return;

  const error = new Error("This upload scope requires an authenticated director session.");
  error.statusCode = 403;
  error.code = "AUTH_REQUIRED";
  throw error;
}

async function buildPresignedImageUpload(req, { allowPublicScopesOnly = true } = {}) {
  const fileName = ensureFileName(req.body?.fileName || "profile.jpg");
  const fileType = assertImageContentType(req.body?.fileType || "", fileName);
  const scope = String(req.body?.scope || "avatar")
    .trim()
    .toLowerCase();
  const prefix = scopeToPrefix(scope);

  if (allowPublicScopesOnly) {
    await ensurePublicUploadScopeAllowed(req, scope);
  }

  return createPresignedUpload({
    tenantSlug: req.tenant.slug,
    prefix,
    fileName,
    fileType,
    objectProxyBaseUrl: buildTenantObjectProxyBaseUrl(req),
    fileSizeBytes: req.body?.fileSize || req.body?.size || 0,
    cacheControl: IMMUTABLE_IMAGE_CACHE_CONTROL,
    allowedContentTypes: [...IMAGE_MIME_TYPES]
  });
}

function asRegex(value = "") {
  const safe = String(value || "").trim();
  if (!safe) return null;
  return new RegExp(safe.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
}

function norm(value = "") {
  return String(value || "").trim();
}

function parseBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return fallback;
  return ["1", "true", "yes", "on"].includes(normalized);
}

function normalizeEmail(value = "") {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(value = "") {
  return EMAIL_REGEX.test(normalizeEmail(value));
}

function escapeHtml(value = "") {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeAttachmentFileName(fileName = "newsletter.pdf") {
  const base = String(fileName || "newsletter.pdf")
    .trim()
    .replace(/[\/\\]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[^\w.\- ()]/g, "");
  return base || "newsletter.pdf";
}

function buildTenantObjectProxyBaseUrl(req) {
  return `${req.protocol}://${req.get("host")}/api/t/${req.tenant.slug}/uploads/object`;
}

function buildConversationAttachmentAccessUrl(req, conversationId) {
  return `${req.protocol}://${req.get("host")}/api/t/${req.tenant.slug}/conversations/${conversationId}/attachments/object`;
}

function buildForumAttachmentAccessUrl(req, forumId) {
  return `${req.protocol}://${req.get("host")}/api/t/${req.tenant.slug}/forums/${forumId}/attachments/object`;
}

function encodeR2Pointer({ key = "", objectUrl = "" } = {}) {
  const payload = {
    version: 1,
    key: String(key || "").trim(),
    objectUrl: String(objectUrl || "").trim()
  };
  return Buffer.from(JSON.stringify(payload), "utf8");
}

function toPointerBuffer(rawValue = null) {
  if (Buffer.isBuffer(rawValue)) return rawValue;
  if (rawValue instanceof Uint8Array) return Buffer.from(rawValue);
  if (rawValue instanceof ArrayBuffer) return Buffer.from(rawValue);

  // Supabase/PostgREST commonly returns bytea as "\\x<hex>" strings.
  if (typeof rawValue === "string") {
    const trimmed = String(rawValue).trim();
    if (!trimmed) return null;
    const hexMatch = trimmed.match(/^\\?x([0-9a-fA-F]+)$/);
    if (hexMatch?.[1]) {
      return Buffer.from(hexMatch[1], "hex");
    }
    return Buffer.from(trimmed, "utf8");
  }

  if (
    rawValue &&
    typeof rawValue === "object" &&
    rawValue.type === "Buffer" &&
    Array.isArray(rawValue.data)
  ) {
    return Buffer.from(rawValue.data);
  }

  return null;
}

function decodeR2Pointer(rawValue = null, expectedMimeType = "", actualMimeType = "") {
  const asBuffer = toPointerBuffer(rawValue);
  if (!asBuffer?.length) return null;
  try {
    const parsed = JSON.parse(asBuffer.toString("utf8"));
    const key = String(parsed?.key || "").trim();
    const objectUrl = String(parsed?.objectUrl || "").trim();
    if (!key || !objectUrl) return null;
    // If MIME is present and unexpected, still accept valid pointer JSON for
    // backward compatibility with legacy rows that stored an incorrect MIME.
    void expectedMimeType;
    void actualMimeType;
    return { key, objectUrl };
  } catch {
    return null;
  }
}

function decodeNewsletterPointer(row = {}) {
  return decodeR2Pointer(row?.pdfData, NEWSLETTER_R2_POINTER_MIME, row?.pdfMimeType);
}

function decodeNewsletterCoverPointer(row = {}) {
  return decodeR2Pointer(row?.coverImageData, NEWSLETTER_COVER_R2_POINTER_MIME, row?.coverImageMimeType);
}

function resolveNewsletterPdfUrl(req, row = {}) {
  const pointer = decodeNewsletterPointer(row);
  if (pointer?.key) {
    return `${buildTenantObjectProxyBaseUrl(req)}?key=${encodeURIComponent(pointer.key)}`;
  }
  return `${req.protocol}://${req.get("host")}/api/t/${req.tenant.slug}/newsletters/${row._id}/file`;
}

function resolveNewsletterCoverUrl(req, row = {}) {
  const pointer = decodeNewsletterCoverPointer(row);
  if (pointer?.key) {
    return `${buildTenantObjectProxyBaseUrl(req)}?key=${encodeURIComponent(pointer.key)}`;
  }
  return "";
}

export function collectTenantNewsletterRecipients({ users = [], profiles = [] } = {}) {
  const userEmailById = new Map();
  const usersWithActiveProfiles = new Set();
  const usersWithDeliverableProfileEmails = new Set();
  const removedUserIds = new Set();
  const recipients = new Set();

  for (const user of users) {
    const userId = String(user?._id || user?.id || "").trim();
    const email = normalizeEmail(user?.email || "");
    const status = String(user?.status || "active").trim().toLowerCase();
    if (!userId || !isValidEmail(email) || status === "inactive" || status === "removed") continue;
    userEmailById.set(userId, email);
  }

  for (const profile of profiles) {
    const userId = String(profile?.userId || "").trim();
    const status = String(profile?.status || "active").trim().toLowerCase();
    if (status === "removed") {
      if (userId) removedUserIds.add(userId);
      continue;
    }

    if (userId) usersWithActiveProfiles.add(userId);

    const profileEmails = Array.isArray(profile?.emails) ? profile.emails : [];
    const firstValidProfileEmail = profileEmails
      .map((item) => normalizeEmail(item))
      .find((email) => isValidEmail(email));

    if (!firstValidProfileEmail) continue;
    recipients.add(firstValidProfileEmail);
    if (userId) usersWithDeliverableProfileEmails.add(userId);
  }

  for (const [userId, email] of userEmailById.entries()) {
    if (removedUserIds.has(userId)) continue;
    if (usersWithActiveProfiles.has(userId) && usersWithDeliverableProfileEmails.has(userId)) continue;
    recipients.add(email);
  }

  return [...recipients];
}

export function buildNewsletterAnnouncementEmail({
  tenantName = "",
  newsletterLabel = "Newsletter",
  title = "",
  season = "",
  year = "",
  archiveUrl = "",
  pdfUrl = "",
  coverImageUrl = ""
} = {}) {
  const safeTenantName = escapeHtml(tenantName || "your network");
  const safeNewsletterLabel = escapeHtml(newsletterLabel || "Newsletter");
  const safeTitle = escapeHtml(title || `${newsletterLabel} update`);
  const safeSeason = escapeHtml(season || "");
  const safeYear = escapeHtml(year || "");
  const safeArchiveUrl = escapeHtml(archiveUrl || "");
  const safePdfUrl = escapeHtml(pdfUrl || "");
  const safeCoverImageUrl = escapeHtml(coverImageUrl || "");
  const emailSubject = `New ${newsletterLabel}: ${title}`.trim();
  const coverMarkup = safeCoverImageUrl
    ? `
        <div style="margin:0 0 20px;">
          <img
            src="${safeCoverImageUrl}"
            alt="${safeTitle} cover"
            style="display:block;width:100%;max-width:560px;height:auto;border-radius:14px;border:1px solid #dbe5f0;"
          />
        </div>
      `
    : "";
  const actionMarkup = safeArchiveUrl || safePdfUrl
    ? `
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;">
          <tr>
            ${safeArchiveUrl ? `<td style="padding:0 12px 12px 0;"><a href="${safeArchiveUrl}" style="display:inline-block;padding:12px 18px;border-radius:999px;background:#153e75;color:#ffffff;text-decoration:none;font-weight:700;">Open in PondBridge</a></td>` : ""}
            ${safePdfUrl ? `<td style="padding:0 0 12px 0;"><a href="${safePdfUrl}" style="display:inline-block;padding:12px 18px;border-radius:999px;background:#edf3fb;color:#153e75;text-decoration:none;font-weight:700;border:1px solid #c9d8ea;">Download PDF</a></td>` : ""}
          </tr>
        </table>
      `
    : "";

  const bodyHtml = `
    ${coverMarkup}
    <p style="margin:0 0 14px;">A new <strong>${safeNewsletterLabel}</strong> has been published for <strong>${safeTenantName}</strong>.</p>
    <p style="margin:0 0 14px;">The PDF is attached to this email so members can open it right away, and the archive link below will take them straight back into PondBridge.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 18px;border:1px solid #dbe5f0;border-radius:12px;background:#f8fbff;">
      <tr>
        <td style="padding:16px 18px;font-size:14px;color:#1f2937;">
          <div style="margin:0 0 8px;"><strong>Title:</strong> ${safeTitle}</div>
          <div style="margin:0 0 8px;"><strong>Season:</strong> ${safeSeason}</div>
          <div style="margin:0;"><strong>Year:</strong> ${safeYear}</div>
        </td>
      </tr>
    </table>
    ${actionMarkup}
    <p style="margin:0 0 10px;font-size:13px;color:#4b5563;">If the buttons above do not open, you can use the attached PDF or copy this archive link into your browser:</p>
    ${safeArchiveUrl ? `<p style="margin:0 0 8px;font-size:13px;"><a href="${safeArchiveUrl}" style="color:#1e5cb3;text-decoration:underline;">${safeArchiveUrl}</a></p>` : ""}
    ${safePdfUrl ? `<p style="margin:0;font-size:13px;color:#6b7280;">Direct PDF link: <a href="${safePdfUrl}" style="color:#1e5cb3;text-decoration:underline;">${safePdfUrl}</a></p>` : ""}
  `;

  return broadcastTemplate({
    tenantName: tenantName || "PondBridge Network",
    subject: emailSubject,
    bodyHtml
  });
}

async function resolveNetworkRecipientEmails(tenantId) {
  const [users, profiles] = await Promise.all([
    UserModel.find(tenantId, {}, { select: ["id", "email", "status"] }),
    ProfileModel.find(tenantId, {}, { select: ["id", "userId", "emails", "status"] })
  ]);

  return collectTenantNewsletterRecipients({ users, profiles });
}

function parseCityState(raw = "") {
  const value = String(raw || "").trim();
  if (!value) return { city: "", state: "" };
  const cacheKey = value.toLowerCase();
  const cached = parsedCityStateCache.get(cacheKey);
  if (cached) return { ...cached };

  let parsed = { city: value, state: "" };
  if (value.includes(",")) {
    const [city, state] = value.split(",", 2).map((part) => String(part || "").trim());
    parsed = { city, state: state.toUpperCase() };
  } else {
    const parts = value.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      const maybeState = parts[parts.length - 1];
      if (/^[A-Za-z]{2,3}$/.test(maybeState)) {
        parsed = {
          city: parts.slice(0, -1).join(" ").trim(),
          state: maybeState.toUpperCase()
        };
      }
    }
  }

  if (parsedCityStateCache.size >= CITY_STATE_PARSE_CACHE_LIMIT) {
    parsedCityStateCache.clear();
  }
  parsedCityStateCache.set(cacheKey, parsed);
  return { ...parsed };
}

function hasCoords(row) {
  return Number.isFinite(Number(row?.lat)) && Number.isFinite(Number(row?.lng));
}

function queueCityGeocode(row) {
  if (!row?.key || (!row?.city && !row?.state)) return;
  if (!geocodeQueue.has(row.key)) geocodeQueue.set(row.key, row);
  void runGeocodeWorker();
}

async function runGeocodeWorker() {
  if (geocodeWorkerRunning) return;
  geocodeWorkerRunning = true;
  let geocodeUpdated = false;
  try {
    while (geocodeQueue.size) {
      const [key, row] = geocodeQueue.entries().next().value || [];
      if (!key || !row) break;
      geocodeQueue.delete(key);

      try {
        const existing = await CityGeoModel.findByKey(key);
        if (hasCoords(existing)) continue;
        const coords = await geocodeCity(row.city, row.state);
        await CityGeoModel.upsert({
          key,
          city: row.city,
          state: row.state,
          lat: Number(coords.lat),
          lng: Number(coords.lng),
          source: coords.source || "unknown"
        });
        geocodeUpdated = true;
      } catch {
        // Ignore individual geocode failures.
      }
    }
  } finally {
    geocodeWorkerRunning = false;
    if (geocodeUpdated) {
      // Fresh city coordinates can unblock map points for any tenant. Force
      // a fast re-query on the next /map/cities request.
      citiesCacheByTenant.clear();
    }
  }
}

async function aggregateCityCounts(tenantId) {
  const rows = await ProfileModel.find(tenantId, { cityState: { $ne: "" } }, { select: ["cityState"] });

  const byKey = new Map();
  for (const row of rows) {
    const parsed = parseCityState(row?.cityState || "");
    const city = norm(parsed.city);
    const state = norm(parsed.state);
    if (!city && !state) continue;

    const key = cityKey(city, state);
    if (!key) continue;

    if (byKey.has(key)) {
      byKey.get(key).count += 1;
    } else {
      byKey.set(key, { key, city, state, count: 1 });
    }
  }

  return [...byKey.values()];
}

function getTenantPeopleCache(tenantId) {
  const id = String(tenantId || "");
  if (!cityPeopleCacheByTenant.has(id)) cityPeopleCacheByTenant.set(id, new Map());
  return cityPeopleCacheByTenant.get(id);
}

function setTenantPeopleCacheEntry(tenantId, key, entry) {
  const tenantCache = getTenantPeopleCache(tenantId);
  tenantCache.set(key, entry);
  if (tenantCache.size > 300) {
    const oldestKey = tenantCache.keys().next().value;
    if (oldestKey && oldestKey !== key) tenantCache.delete(oldestKey);
  }
}

function invalidateMapCaches(tenantId) {
  const id = String(tenantId || "");
  if (!id) return;
  citiesCacheByTenant.delete(id);
  cityPeopleCacheByTenant.delete(id);
}

function locationKeys({ city = "", state = "" } = {}) {
  const c = norm(city);
  const s = norm(state);
  const keys = new Set();
  const add = (a, b) => {
    const key = cityKey(a, b);
    if (key) keys.add(key);
  };
  add(c, s);
  add(c, "");
  add("", s);
  return keys;
}

function sanitizeLikeToken(value = "") {
  return String(value || "").trim().replace(/[%_]/g, "");
}

async function loadMapProfilesForCity(tenantId, { city = "", state = "" } = {}) {
  const normalizedCity = sanitizeLikeToken(city);
  const normalizedState = sanitizeLikeToken(state).toUpperCase();
  const run = (filter) =>
    ProfileModel.find(tenantId, filter, {
      select: MAP_CITY_PROFILE_SELECT,
      limit: MAP_CITY_PROFILE_LIMIT
    });

  if (normalizedCity && normalizedState) {
    const exactRows = await run({ cityState: { $ilike: `${normalizedCity},%${normalizedState}` } });
    if (exactRows.length) return exactRows;
  }

  if (normalizedCity) {
    const cityRows = await run({ cityState: { $ilike: `%${normalizedCity}%` } });
    if (cityRows.length) return cityRows;
  }

  if (normalizedState) {
    const stateRows = await run({ cityState: { $ilike: `%${normalizedState}%` } });
    if (stateRows.length) return stateRows;
  }

  return run({ cityState: { $ne: "" } });
}

function mapCityPerson(profile) {
  const id = String(profile._id || profile.id || "").trim();
  if (!id) return null;
  const jobs = Array.isArray(profile.currentJobs) ? profile.currentJobs : [];
  const firstJob = jobs.find((job) => job && (job.title || job.role || job.company)) || {};
  const currentJob = String(
    profile.currentJob || profile.currentJobTitle || firstJob.title || firstJob.role || ""
  ).trim();
  const company = String(profile.currentCompany || profile.company || firstJob.company || "").trim();
  return {
    _id: id,
    id,
    firstName: profile.firstName || "",
    lastName: profile.lastName || "",
    uploads: { photoUrl: profile.avatarUrl || "" },
    photoUrl: profile.avatarUrl || "",
    industry: String(profile.industry || profile.primaryIndustry || "").trim(),
    currentJob,
    company
  };
}

function normalizeIdentityName(value = "") {
  return String(value || "").trim();
}

function deriveNameFromEmail(email = "") {
  const local = String(email || "").trim().toLowerCase().split("@")[0] || "";
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (!parts.length) return { firstName: "", lastName: "" };
  const cap = (word = "") => word.slice(0, 1).toUpperCase() + word.slice(1);
  return {
    firstName: cap(parts[0] || ""),
    lastName: cap(parts.slice(1).join(" "))
  };
}

function resolveLegacyNameFallback(identity = {}, fallbackEmail = "") {
  const claims = identity?.claims || {};
  const firstName = normalizeIdentityName(
    claims.first_name || claims.given_name || claims.firstName || identity.firstName || ""
  );
  const lastName = normalizeIdentityName(
    claims.last_name || claims.family_name || claims.lastName || identity.lastName || ""
  );
  if (firstName || lastName) return { firstName, lastName };
  return deriveNameFromEmail(identity?.email || fallbackEmail || "");
}

function normalizeYearStints(value = null, { includeAgeGroup = false } = {}) {
  const validYear = (raw = "") => {
    const year = String(raw || "").trim();
    return /^\d{4}$/.test(year) ? year : "";
  };
  const normalizeAgeGroup = (raw = "") => String(raw || "").trim();
  const stints = [];

  const pushStint = (entry = {}) => {
    const startYear = validYear(entry.startYear || entry.firstYear || entry.yearStart || "");
    const endYear = validYear(entry.endYear || entry.lastYear || entry.yearEnd || "");
    if (!startYear || !endYear) return;
    const startNum = Number(startYear);
    const endNum = Number(endYear);
    if (!Number.isFinite(startNum) || !Number.isFinite(endNum)) return;
    const normalized = {
      startYear: String(Math.min(startNum, endNum)),
      endYear: String(Math.max(startNum, endNum))
    };
    if (includeAgeGroup) {
      const sharedAgeGroup = normalizeAgeGroup(entry.ageGroup || entry.group || "");
      const startAgeGroup = normalizeAgeGroup(
        entry.startAgeGroup || entry.firstGroup || entry.ageGroupStart || sharedAgeGroup || ""
      );
      const endAgeGroup = normalizeAgeGroup(
        entry.endAgeGroup || entry.lastGroup || entry.ageGroupEnd || sharedAgeGroup || ""
      );
      if (startAgeGroup) normalized.startAgeGroup = startAgeGroup;
      if (endAgeGroup) normalized.endAgeGroup = endAgeGroup;
      if (startAgeGroup && endAgeGroup && startAgeGroup === endAgeGroup) {
        normalized.ageGroup = startAgeGroup;
      } else if (sharedAgeGroup) {
        normalized.ageGroup = sharedAgeGroup;
      }
    }
    stints.push(normalized);
  };

  if (Array.isArray(value)) {
    value.forEach((entry) => pushStint(entry));
  } else if (value && typeof value === "object") {
    if (Array.isArray(value.stints)) {
      value.stints.forEach((entry) => pushStint(entry));
    } else if (value.firstYear || value.lastYear || value.startYear || value.endYear) {
      pushStint(value);
    }
  }

  const deduped = [];
  const seen = new Set();
  stints
    .sort((a, b) => Number(a.startYear) - Number(b.startYear) || Number(a.endYear) - Number(b.endYear))
    .forEach((entry) => {
      const startAgeGroupKey = includeAgeGroup ? String(entry.startAgeGroup || entry.ageGroup || "").trim().toLowerCase() : "";
      const endAgeGroupKey = includeAgeGroup ? String(entry.endAgeGroup || entry.ageGroup || "").trim().toLowerCase() : "";
      const key = `${entry.startYear}-${entry.endYear}-${startAgeGroupKey}-${endAgeGroupKey}`;
      if (seen.has(key)) return;
      seen.add(key);
      deduped.push(entry);
    });

  if (includeAgeGroup && value && typeof value === "object" && deduped.length) {
    const firstGroup = normalizeAgeGroup(value.firstGroup || "");
    const lastGroup = normalizeAgeGroup(value.lastGroup || "");
    if (firstGroup && !deduped[0].startAgeGroup) {
      deduped[0].startAgeGroup = firstGroup;
    }
    if (lastGroup && !deduped[deduped.length - 1].endAgeGroup) {
      deduped[deduped.length - 1].endAgeGroup = lastGroup;
    }
    deduped.forEach((entry) => {
      const startAgeGroup = normalizeAgeGroup(entry.startAgeGroup || "");
      const endAgeGroup = normalizeAgeGroup(entry.endAgeGroup || "");
      if (startAgeGroup && endAgeGroup && startAgeGroup === endAgeGroup) {
        entry.ageGroup = startAgeGroup;
      } else if (!entry.ageGroup && (startAgeGroup || endAgeGroup)) {
        entry.ageGroup = startAgeGroup || endAgeGroup;
      }
      if (!entry.startAgeGroup && entry.ageGroup) entry.startAgeGroup = entry.ageGroup;
      if (!entry.endAgeGroup && entry.ageGroup) entry.endAgeGroup = entry.ageGroup;
    });
  } else if (includeAgeGroup) {
    deduped.forEach((entry) => {
      const ageGroup = normalizeAgeGroup(entry.ageGroup || "");
      if (!entry.startAgeGroup && ageGroup) entry.startAgeGroup = ageGroup;
      if (!entry.endAgeGroup && ageGroup) entry.endAgeGroup = ageGroup;
    });
  }

  return deduped;
}

function normalizeCamperYears(value = {}) {
  const input = value && typeof value === "object" ? value : {};
  let stints = normalizeYearStints(value, { includeAgeGroup: true });
  const validYear = (year = "") => (/^\d{4}$/.test(String(year || "").trim()) ? String(year || "").trim() : "");

  let firstYear = validYear(input.firstYear || "");
  let lastYear = validYear(input.lastYear || "");

  if (!stints.length && (firstYear || lastYear)) {
    if (!firstYear) firstYear = lastYear;
    if (!lastYear) lastYear = firstYear;
    if (firstYear && lastYear) {
      const startNum = Math.min(Number(firstYear), Number(lastYear));
      const endNum = Math.max(Number(firstYear), Number(lastYear));
      stints = [
        {
          startYear: String(startNum),
          endYear: String(endNum),
          ...(String(input.firstGroup || "").trim()
            ? { startAgeGroup: String(input.firstGroup || "").trim() }
            : {}),
          ...(String(input.lastGroup || "").trim()
            ? { endAgeGroup: String(input.lastGroup || "").trim() }
            : {}),
          ...(String(input.firstGroup || input.lastGroup || "").trim()
            ? { ageGroup: String(input.firstGroup || input.lastGroup || "").trim() }
            : {})
        }
      ];
    }
  }

  if (stints.length) {
    firstYear = stints[0].startYear;
    lastYear = stints[stints.length - 1].endYear;
  }

  const firstGroup = String(
    stints[0]?.startAgeGroup || stints[0]?.ageGroup || input.firstGroup || ""
  ).trim();
  const lastGroup = String(
    stints[stints.length - 1]?.endAgeGroup || stints[stints.length - 1]?.ageGroup || input.lastGroup || ""
  ).trim();

  return {
    firstYear,
    firstGroup,
    lastYear,
    lastGroup,
    stints
  };
}

function normalizeStaffYears(value = {}) {
  return { stints: normalizeYearStints(value) };
}

function normalizeRoleList(value = []) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  const ordered = [];
  const seen = new Set();
  values.forEach((entry) => {
    const role = String(entry || "").trim();
    const key = role.toLowerCase();
    if (!role || seen.has(key)) return;
    seen.add(key);
    ordered.push(role);
  });
  return ordered;
}

function resolveProfileNickname(profile = {}) {
  const socials = profile?.socials && typeof profile.socials === "object" ? profile.socials : {};
  return String(profile?.nickname || socials?.nickname || socials?.campNickname || "").trim();
}

function normalizeCollegeMajors(value = []) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => sanitizeText(String(entry || "").trim()));
}

function extractEducationRows(value = []) {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => ({
      college: sanitizeText(String(row?.college || "").trim()),
      major: sanitizeText(String(row?.major || "").trim()),
      year: sanitizeText(String(row?.year || "").trim())
    }))
    .filter((row) => row.college || row.major || row.year);
}

function profileToLegacy(profile, { identity = {}, fallbackEmail = "", viewer = {} } = {}) {
  if (!profile) return null;
  const emailVisible = canViewProfileContact(profile, "email", viewer);
  profile = filterProfileContactFields(profile, viewer);
  const { city: cityPart, state: statePart } = parseCityState(profile.cityState || "");
  const socials = profile?.socials && typeof profile.socials === "object" ? profile.socials : {};
  const collegeMajors = normalizeCollegeMajors(
    Array.isArray(socials.collegeMajors)
      ? socials.collegeMajors
      : Array.isArray(socials.educationMajors)
      ? socials.educationMajors
      : []
  );
  const roleList = normalizeRoleList([profile.roleAtCamp, ...(Array.isArray(socials.roles) ? socials.roles : [])]);
  const primaryRole = roleList[0] || "";
  const camperYears = normalizeCamperYears(socials.camperYears || profile.camperYears || {});
  const staffYears = normalizeStaffYears(socials.staffYears || profile.staffYears || {});
  const fallbackNames = resolveLegacyNameFallback(identity, fallbackEmail);
  const firstName = String(profile.firstName || fallbackNames.firstName || "").trim();
  const lastName = String(profile.lastName || fallbackNames.lastName || "").trim();
  const email = String(
    profile?.emails?.find(Boolean) || (emailVisible ? fallbackEmail : "") || ""
  )
    .trim()
    .toLowerCase();
  const phone = String(profile?.phones?.find(Boolean) || "").trim();

  return {
    ...profile,
    id: String(profile._id),
    firstName,
    lastName,
    nickname: resolveProfileNickname(profile),
    email,
    phone,
    city: String(cityPart || "").trim(),
    state: String(statePart || "").trim().toUpperCase(),
    roleAtCamp: primaryRole,
    uploads: {
      photoUrl: profile.avatarUrl || "",
      pdfs: []
    },
    social: {
      linkedin: String(socials.linkedin || "").trim(),
      instagram: String(socials.instagram || "").trim(),
      facebook: String(socials.facebook || "").trim()
    },
    camperYears,
    staffYears,
    roles: roleList,
    collegeMajors,
    education: (profile.colleges || []).map((college, idx) => ({
      college,
      year: profile.collegeYears?.[idx] || "",
      major: collegeMajors?.[idx] || ""
    }))
  };
}

function parseCityStateFromBody(body = {}) {
  const direct = String(body.cityState || "").trim();
  if (direct) {
    return composeCityState(parseCityStateDetailed(direct));
  }
  const state = String(body.state || "").trim().toUpperCase();
  const country = canonicalizeCountryName(String(body.country || "").trim());
  const city = canonicalizeCityName(String(body.city || "").trim(), {
    state,
    country
  });
  return composeCityState({ city, state, country });
}

function toSet(values = []) {
  return new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean)
  );
}

function overlapCount(aSet, bSet) {
  if (!aSet?.size || !bSet?.size) return 0;
  let count = 0;
  for (const value of aSet) {
    if (bSet.has(value)) count += 1;
  }
  return count;
}

function topCompanies(profile = {}) {
  return toSet((profile.currentJobs || []).map((job) => String(job?.company || "").trim()));
}

function scoreSimilarity(target, candidate) {
  let score = 0;
  const reasons = [];

  const targetRole = String(target?.roleAtCamp || "").trim().toLowerCase();
  const candidateRole = String(candidate?.roleAtCamp || "").trim().toLowerCase();
  if (targetRole && candidateRole && targetRole === candidateRole) {
    score += 4;
    reasons.push("role");
  }

  const targetIndustry = String(target?.industry || "").trim().toLowerCase();
  const candidateIndustry = String(candidate?.industry || "").trim().toLowerCase();
  if (targetIndustry && candidateIndustry && targetIndustry === candidateIndustry) {
    score += 4;
    reasons.push("industry");
  }

  const targetCity = String(target?.cityState || "").trim().toLowerCase();
  const candidateCity = String(candidate?.cityState || "").trim().toLowerCase();
  if (targetCity && candidateCity && targetCity === candidateCity) {
    score += 3;
    reasons.push("location");
  }

  const collegeOverlap = overlapCount(toSet(target?.colleges), toSet(candidate?.colleges));
  if (collegeOverlap > 0) {
    score += Math.min(4, collegeOverlap * 2);
    reasons.push("college");
  }

  const companyOverlap = overlapCount(topCompanies(target), topCompanies(candidate));
  if (companyOverlap > 0) {
    score += Math.min(4, companyOverlap * 2);
    reasons.push("company");
  }

  const targetSchool = String(target?.highSchool || "").trim().toLowerCase();
  const candidateSchool = String(candidate?.highSchool || "").trim().toLowerCase();
  if (targetSchool && candidateSchool && targetSchool === candidateSchool) {
    score += 1;
    reasons.push("school");
  }

  return { score, reasons };
}

function profileToSuggestion(profile = {}) {
  const id = String(profile._id || profile.id || "").trim();
  if (!id) return null;
  return {
    _id: id,
    id,
    firstName: profile.firstName || "",
    lastName: profile.lastName || "",
    nickname: resolveProfileNickname(profile),
    uploads: { photoUrl: profile.avatarUrl || "" },
    photoUrl: profile.avatarUrl || "",
    currentJobs: Array.isArray(profile.currentJobs) ? profile.currentJobs : []
  };
}

export function buildSuggestionResults({ primaryProfiles = [], fallbackProfiles = [], limit = 5 } = {}) {
  const resolvedLimit = Math.min(Math.max(Number(limit || 5), 1), 20);
  const items = [];
  const seenIds = new Set();

  function appendProfile(profile) {
    const suggestion = profileToSuggestion(profile);
    if (!suggestion) return;
    const id = String(suggestion._id || suggestion.id || "").trim();
    if (!id || seenIds.has(id)) return;
    seenIds.add(id);
    items.push(suggestion);
  }

  for (const profile of Array.isArray(primaryProfiles) ? primaryProfiles : []) {
    appendProfile(profile);
    if (items.length >= resolvedLimit) return items;
  }

  const sortedFallback = [...(Array.isArray(fallbackProfiles) ? fallbackProfiles : [])].sort(
    (a, b) => new Date(b?.createdAt || 0).getTime() - new Date(a?.createdAt || 0).getTime()
  );

  for (const profile of sortedFallback) {
    appendProfile(profile);
    if (items.length >= resolvedLimit) return items;
  }

  return items;
}

function activityToClient(item = {}) {
  const ts = item?.ts || item?.createdAt || new Date().toISOString();
  return {
    id: String(item?._id || item?.id || ""),
    type: String(item?.type || "announcement.post"),
    message: String(item?.message || ""),
    actor: {
      id: String(item?.actor?.id || item?.actorUserId || ""),
      name: String(item?.actor?.name || "")
    },
    target: item?.target || {},
    pinned: Boolean(item?.pinned),
    pinnedAt: item?.pinnedAt ? new Date(item.pinnedAt).toISOString() : null,
    ts: new Date(ts).toISOString()
  };
}

function photoToClient(photo = {}, currentUserId = "") {
  const likes = Array.isArray(photo.likes) ? photo.likes : [];
  const comments = Array.isArray(photo.comments) ? photo.comments : [];
  const ownerId = String(photo.ownerId || photo.userId || "");
  return {
    _id: String(photo._id),
    id: String(photo._id),
    ownerId,
    userId: ownerId,
    ownerName: photo.ownerName || "",
    imageUrl: photo.imageUrl || "",
    thumbUrl: photo.thumbUrl || photo.imageUrl || "",
    caption: photo.caption || "",
    captionMentions: photo.captionMentions || [],
    likes: likes.length,
    commentsCount: comments.length,
    mine: currentUserId ? ownerId === String(currentUserId) : false,
    createdAt: photo.createdAt ? new Date(photo.createdAt).toISOString() : new Date().toISOString()
  };
}

function commentToClient(comment = {}, resolvedAvatarUrl = "") {
  return {
    _id: String(comment._id || generateObjectId()),
    authorId: String(comment.authorId || ""),
    authorName: String(comment.authorName || ""),
    authorAvatarUrl: String(comment.authorAvatarUrl || resolvedAvatarUrl || ""),
    text: String(comment.text || ""),
    commentMentions: Array.isArray(comment.commentMentions) ? comment.commentMentions : [],
    createdAt: comment.createdAt ? new Date(comment.createdAt).toISOString() : new Date().toISOString()
  };
}

function isCampAdmin(user = {}) {
  const roles = Array.isArray(user?.roles) ? user.roles : [];
  return roles.includes("super_admin") || roles.includes("tenant_admin") || roles.includes("admin");
}

function asObjectId(id) {
  const value = String(id || "").trim();
  return isValidObjectId(value) ? value : null;
}

async function resolveTenantUserId(tenantId, candidateId = "") {
  const id = asObjectId(candidateId);
  if (!id) return null;

  const directUser = await UserModel.findOne(tenantId, { _id: id });
  if (directUser?._id) return String(directUser._id);

  const profile = await ProfileModel.findOne(tenantId, { _id: id });
  const profileUserId = asObjectId(profile?.userId);
  if (!profileUserId) return null;

  const mappedUser = await UserModel.findOne(tenantId, { _id: profileUserId });
  if (!mappedUser?._id) return null;
  return String(mappedUser._id);
}

function asMedia(body = {}) {
  if (!body || typeof body !== "object") return null;
  const url = String(body.url || "").trim();
  if (!url) return null;
  return {
    url,
    key: String(body.key || "").trim(),
    mime: String(body.mime || "").trim(),
    name: String(body.name || "").trim(),
    size: Number.isFinite(Number(body.size)) ? Number(body.size) : 0
  };
}

function normalizeMessageKind(raw = "") {
  const kind = String(raw || "text").trim().toLowerCase();
  if (kind === "text" || kind === "image" || kind === "file") return kind;
  return "text";
}

function normalizeEntityId(value = "") {
  const id = String(value || "").trim();
  if (!id || id === "undefined" || id === "null") return "";
  return id;
}

function readAtFor(conversation = {}, userId = "") {
  const rows = Array.isArray(conversation.readBy) ? conversation.readBy : [];
  const found = rows.find((row) => String(row?.userId || "") === String(userId || ""));
  if (!found?.lastReadAt) return null;
  const date = new Date(found.lastReadAt);
  return Number.isFinite(date.getTime()) ? date : null;
}

function conversationToClient(conversation = {}, userId = "") {
  const conversationId = normalizeEntityId(conversation?._id || conversation?.id);
  if (!conversationId) return null;
  const lastMessage = conversation?.lastMessage || null;
  const lastMessageAt = conversation?.lastMessageAt || lastMessage?.createdAt || conversation?.updatedAt || new Date();
  const readAt = readAtFor(conversation, userId);
  const unread =
    hasConversationMessage(conversation) &&
    (readAt && lastMessageAt ? new Date(lastMessageAt).getTime() > readAt.getTime() : true);
  const previewText = String(
    lastMessage?.text ||
      (lastMessage?.kind === "image" ? "Photo" : lastMessage?.kind === "file" ? "File attachment" : "")
  ).trim();

  return {
    _id: conversationId,
    id: conversationId,
    type: String(conversation.type || "dm"),
    participantIds: Array.isArray(conversation.participantIds)
      ? conversation.participantIds.map((entry) => normalizeEntityId(entry)).filter(Boolean)
      : [],
    members: Array.isArray(conversation.members)
      ? conversation.members.map((member) => ({
          userId: normalizeEntityId(member.userId || ""),
          role: member.role || "member"
        })).filter((member) => member.userId)
      : [],
    name: String(conversation.name || ""),
    createdBy: normalizeEntityId(conversation.createdBy || ""),
    lastMessageAt: new Date(lastMessageAt).toISOString(),
    lastReadAt: readAt ? readAt.toISOString() : null,
    lastMessage: lastMessage
      ? {
          senderId: String(lastMessage.senderId || ""),
          kind: normalizeMessageKind(lastMessage.kind),
          text: String(lastMessage.text || ""),
          media: lastMessage.media || null,
          createdAt: new Date(lastMessage.createdAt || lastMessageAt).toISOString()
        }
      : null,
    lastMessageText: previewText,
    lastMessagePreview: previewText,
    unreadCount: unread ? 1 : 0,
    unread: unread ? 1 : 0,
    unreadMessages: unread ? 1 : 0,
    unreadMessagesCount: unread ? 1 : 0,
    unseenCount: unread ? 1 : 0,
    newCount: unread ? 1 : 0
  };
}

function forumToClient(forum = {}) {
  const forumId = normalizeEntityId(forum?._id || forum?.id);
  if (!forumId) return null;
  return {
    _id: forumId,
    id: forumId,
    name: String(forum.name || ""),
    creatorId: normalizeEntityId(forum.creatorId || forum.createdBy || ""),
    createdBy: normalizeEntityId(forum.createdBy || forum.creatorId || ""),
    memberIds: Array.isArray(forum.memberIds)
      ? forum.memberIds.map((id) => normalizeEntityId(id)).filter(Boolean)
      : [],
    moderators: Array.isArray(forum.moderators)
      ? forum.moderators.map((id) => normalizeEntityId(id)).filter(Boolean)
      : [],
    postsCount: Number(forum.postsCount || 0),
    lastActivityAt: forum.lastActivityAt ? new Date(forum.lastActivityAt).toISOString() : null,
    createdAt: forum.createdAt ? new Date(forum.createdAt).toISOString() : null,
    updatedAt: forum.updatedAt ? new Date(forum.updatedAt).toISOString() : null
  };
}

function messageToClient(message = {}) {
  const messageId = normalizeEntityId(message?._id || message?.id);
  if (!messageId) return null;
  return {
    _id: messageId,
    id: messageId,
    conversationId: normalizeEntityId(message.conversationId || ""),
    senderId: normalizeEntityId(message.senderId || ""),
    kind: normalizeMessageKind(message.kind),
    text: String(message.text || ""),
    media: message.media || null,
    clientMessageId: String(message.clientMessageId || ""),
    createdAt: message.createdAt ? new Date(message.createdAt).toISOString() : new Date().toISOString()
  };
}

function forumPostToClient(post = {}) {
  const postId = normalizeEntityId(post?._id || post?.id);
  if (!postId) return null;
  return {
    _id: postId,
    id: postId,
    forumId: normalizeEntityId(post.forumId || ""),
    authorId: normalizeEntityId(post.authorId || ""),
    createdBy: normalizeEntityId(post.authorId || ""),
    userId: normalizeEntityId(post.authorId || ""),
    kind: normalizeMessageKind(post.kind),
    text: String(post.text || ""),
    media: post.media || null,
    createdAt: post.createdAt ? new Date(post.createdAt).toISOString() : new Date().toISOString()
  };
}

router.use(requireTenant);

async function loadCitySuggestionsForTenant(tenantId, { state = "", country = "", q = "", limit = 25 } = {}) {
  const normalizedState = String(state || "").trim().toUpperCase();
  const normalizedCountry = canonicalizeCountryName(String(country || "").trim());
  const queryToken = normalizeLocationToken(q);
  const effectiveLimit = Math.min(Math.max(Number(limit || 25), 1), 100);

  let filter = { cityState: { $ne: "" } };
  if (normalizedState) {
    filter = { cityState: { $ilike: `%, ${sanitizeLikeToken(normalizedState)}` } };
  } else if (normalizedCountry) {
    filter = { cityState: { $ilike: `%${sanitizeLikeToken(normalizedCountry)}%` } };
  }

  const rows = await ProfileModel.find(tenantId, filter, {
    select: ["cityState"],
    limit: 5000
  });

  const seen = new Set();
  const candidates = [];
  for (const row of rows) {
    const parsed = parseCityStateDetailed(row?.cityState || "");
    if (!parsed.city) continue;
    if (normalizedState && String(parsed.state || "").toUpperCase() !== normalizedState) continue;
    if (
      normalizedCountry &&
      normalizeLocationToken(parsed.country || "") !== normalizeLocationToken(normalizedCountry)
    ) {
      continue;
    }

    const city = canonicalizeCityName(parsed.city, {
      state: normalizedState || parsed.state,
      country: normalizedCountry || parsed.country
    });
    const cityKeyToken = normalizeLocationToken(city);
    if (!cityKeyToken || seen.has(cityKeyToken)) continue;
    if (queryToken && !cityKeyToken.includes(queryToken)) continue;
    seen.add(cityKeyToken);
    candidates.push(city);
  }

  if (queryToken) {
    const aliased = canonicalizeCityName(q, { state: normalizedState, country: normalizedCountry });
    const aliasKey = normalizeLocationToken(aliased);
    if (aliasKey && !seen.has(aliasKey)) {
      seen.add(aliasKey);
      candidates.unshift(aliased);
    }
  }

  candidates.sort((left, right) => {
    const l = normalizeLocationToken(left);
    const r = normalizeLocationToken(right);
    const lp = queryToken ? Number(!l.startsWith(queryToken)) : 0;
    const rp = queryToken ? Number(!r.startsWith(queryToken)) : 0;
    if (lp !== rp) return lp - rp;
    return left.localeCompare(right);
  });

  return candidates.slice(0, effectiveLimit);
}

router.get("/locations/cities", async (req, res) => {
  const state = String(req.query.state || "").trim().toUpperCase();
  const country = String(req.query.country || "").trim();
  const q = String(req.query.q || "").trim();
  const limit = Number(req.query.limit || 25);
  const items = await loadCitySuggestionsForTenant(req.tenant._id, { state, country, q, limit });
  return res.json(items);
});

router.get("/locations/cities/:state", async (req, res) => {
  const state = String(req.params.state || "").trim().toUpperCase();
  if (!state) return res.json([]);
  const items = await loadCitySuggestionsForTenant(req.tenant._id, { state, limit: 100 });
  return res.json(items);
});

router.post("/locations/cities", (_req, res) => {
  return res.status(201).json({ ok: true });
});

router.post("/uploads/presign-public", publicUploadPresignLimiter, async (req, res, next) => {
  try {
    ensureBrowserOriginAllowed(req);
    const presigned = await buildPresignedImageUpload(req, { allowPublicScopesOnly: true });

    return res.json({
      ...presigned,
      publicUrl: presigned.objectUrl
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/uploads/object", async (req, res, next) => {
  try {
    const key = String(req.query?.key || "").trim();
    if (!key) {
      return res.status(400).json({
        error: {
          code: "INVALID_OBJECT_KEY",
          message: "Upload object key is required."
        }
      });
    }

    const expectedPrefix = `${String(req.tenant?.slug || "").trim()}/`;
    if (!expectedPrefix || !key.startsWith(expectedPrefix)) {
      return res.status(403).json({
        error: {
          code: "TENANT_SCOPE_DENIED",
          message: "Object key is outside this tenant scope."
        }
      });
    }

    const signed = await createPresignedDownloadUrl({
      key,
      expiresInSeconds: 600
    });
    res.set("Cache-Control", PRIVATE_UPLOAD_PROXY_CACHE_CONTROL);
    return res.redirect(302, signed.downloadUrl);
  } catch (error) {
    return next(error);
  }
});

router.post("/prelaunch/unlock", (_req, res) => {
  return res.status(410).json({
    error: {
      code: "ENDPOINT_DISABLED",
      message: "Prelaunch unlock is not available on this endpoint."
    }
  });
});

router.get("/prelaunch/status", (req, res) => {
  const unlocked = req.tenant?.status === "active" && req.tenant?.onboardingStatus === "live";
  return res.json({ unlocked, mode: unlocked ? "live" : "locked" });
});

router.use(requireAuth, enforceTenantScope);
router.use("/search", requireTenantModule("search", { message: "Search is disabled for this camp." }));
router.use("/suggestions", requireTenantModule("relatedProfiles", {
  message: "Related profile suggestions are disabled for this camp."
}));
router.use("/photos", requireTenantModule("photoStream", {
  message: "The photo stream is disabled for this camp."
}));
router.use("/conversations", requireTenantModule("chat", {
  message: "Messaging is disabled for this camp."
}));
router.use("/forums", requireTenantModule("chat", {
  message: "Forums are disabled for this camp."
}));
router.use("/newsletters", requireTenantModule("newsletter", {
  message: "The newsletter archive is disabled for this camp."
}));
router.use("/map", requireTenantModule("map", {
  message: "The location map is disabled for this camp."
}));

router.post("/uploads/presign", privateUploadPresignLimiter, async (req, res, next) => {
  try {
    ensureBrowserOriginAllowed(req);
    const presigned = await buildPresignedImageUpload(req, { allowPublicScopesOnly: false });
    return res.json({
      ...presigned,
      publicUrl: presigned.objectUrl
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/me", async (req, res) => {
  const user = await UserModel.findOne(req.tenant._id, { _id: req.user.id });
  const profile = user
    ? await ensureProfileForUser({
        tenantId: req.tenant._id,
        user,
        identity: req.identity || {}
      })
    : await ProfileModel.findOne(req.tenant._id, { userId: req.user.id });
  if (!profile) {
    return res.status(404).json({ error: { code: "PROFILE_NOT_FOUND", message: "Profile not found" } });
  }
  return res.json(
    profileToLegacy(profile, {
      identity: req.identity || {},
      fallbackEmail: user?.email || "",
      viewer: req.user
    })
  );
});

router.put("/me", async (req, res) => {
  const profile = await ProfileModel.findOne(req.tenant._id, { userId: req.user.id });
  if (!profile) {
    return res.status(404).json({ error: { code: "PROFILE_NOT_FOUND", message: "Profile not found" } });
  }

  const incomingPhone = String(req.body?.phone || "").trim();
  const incomingCamperYearsProvided = req.body?.camperYears !== undefined;
  const incomingCamperYears = incomingCamperYearsProvided ? normalizeCamperYears(req.body.camperYears) : null;
  const incomingStaffYearsProvided = req.body?.staffYears !== undefined;
  const incomingStaffYears = incomingStaffYearsProvided ? normalizeStaffYears(req.body.staffYears) : null;
  const incomingRolesProvided = Array.isArray(req.body?.roles) || req.body?.roleAtCamp !== undefined;
  const incomingRoles = incomingRolesProvided
    ? normalizeRoleList(Array.isArray(req.body?.roles) ? req.body.roles : [req.body?.roleAtCamp])
    : [];
  const incomingNicknameProvided =
    req.body?.nickname !== undefined ||
    req.body?.campNickname !== undefined ||
    req.body?.social?.nickname !== undefined ||
    req.body?.socials?.nickname !== undefined ||
    req.body?.socials?.campNickname !== undefined;
  const incomingNickname = incomingNicknameProvided
    ? sanitizeText(
        String(
          req.body?.nickname ??
            req.body?.campNickname ??
            req.body?.social?.nickname ??
            req.body?.socials?.nickname ??
            req.body?.socials?.campNickname ??
            ""
        ).trim()
      )
    : "";
  const incomingEducationRows = Array.isArray(req.body?.education) ? extractEducationRows(req.body.education) : [];
  const incomingCollegeMajorsProvided =
    Array.isArray(req.body?.education) ||
    Array.isArray(req.body?.collegeMajors) ||
    Array.isArray(req.body?.social?.collegeMajors) ||
    Array.isArray(req.body?.socials?.collegeMajors) ||
    Array.isArray(req.body?.social?.educationMajors) ||
    Array.isArray(req.body?.socials?.educationMajors);
  const incomingCollegeMajors = normalizeCollegeMajors(
    Array.isArray(req.body?.collegeMajors)
      ? req.body.collegeMajors
      : incomingEducationRows.length
      ? incomingEducationRows.map((row) => row.major)
      : Array.isArray(req.body?.social?.collegeMajors)
      ? req.body.social.collegeMajors
      : Array.isArray(req.body?.socials?.collegeMajors)
      ? req.body.socials.collegeMajors
      : Array.isArray(req.body?.social?.educationMajors)
      ? req.body.social.educationMajors
      : Array.isArray(req.body?.socials?.educationMajors)
      ? req.body.socials.educationMajors
      : []
  );
  const existingSocials = profile?.socials && typeof profile.socials === "object" ? profile.socials : {};
  const hasSocialPatch = Boolean(req.body.social || req.body.socials);
  const nextSocials =
    hasSocialPatch ||
    incomingCamperYearsProvided ||
    incomingStaffYearsProvided ||
    incomingRolesProvided ||
    incomingNicknameProvided ||
    incomingCollegeMajorsProvided
    ? {
        ...existingSocials,
        ...(hasSocialPatch
          ? {
              linkedin: String(req.body.social?.linkedin || req.body.socials?.linkedin || "").trim(),
              instagram: String(req.body.social?.instagram || req.body.socials?.instagram || "").trim(),
              facebook: String(req.body.social?.facebook || req.body.socials?.facebook || "").trim()
            }
          : {}),
        ...(incomingCamperYearsProvided ? { camperYears: incomingCamperYears } : {}),
        ...(incomingStaffYearsProvided ? { staffYears: incomingStaffYears } : {}),
        ...(incomingRolesProvided ? { roles: incomingRoles } : {}),
        ...(incomingNicknameProvided ? { nickname: incomingNickname, campNickname: incomingNickname } : {}),
        ...(incomingCollegeMajorsProvided
          ? { collegeMajors: incomingCollegeMajors, educationMajors: incomingCollegeMajors }
          : {})
      }
    : undefined;

  const update = {
    firstName: req.body.firstName !== undefined ? sanitizeText(String(req.body.firstName || "").trim()) : undefined,
    lastName: req.body.lastName !== undefined ? sanitizeText(String(req.body.lastName || "").trim()) : undefined,
    cityState: sanitizeText(parseCityStateFromBody(req.body)),
    roleAtCamp: incomingRolesProvided
      ? sanitizeText(String(incomingRoles[0] || "").trim())
      : sanitizeText(String(profile.roleAtCamp || "").trim()),
    phones:
      req.body.phone !== undefined
        ? (incomingPhone ? [incomingPhone] : [])
        : Array.isArray(req.body.phones)
        ? req.body.phones.map((item) => String(item || "").trim()).filter(Boolean)
        : undefined,
    highSchool: req.body.highSchool !== undefined ? sanitizeText(String(req.body.highSchool || "").trim()) : undefined,
    industry: req.body.industry !== undefined ? sanitizeText(String(req.body.industry || "").trim()) : undefined,
    bio: req.body.bio !== undefined ? sanitizeText(String(req.body.bio || "").trim()) : undefined,
    avatarUrl: String(req.body.uploads?.photoUrl || req.body.photoUrl || profile.avatarUrl || "").trim(),
    socials: nextSocials,
    privacy: req.body?.privacy !== undefined ? normalizeProfilePrivacy(req.body.privacy) : undefined,
    colleges: Array.isArray(req.body.education)
      ? incomingEducationRows.map((row) => row.college)
      : undefined,
    collegeYears: Array.isArray(req.body.education)
      ? incomingEducationRows.map((row) => row.year)
      : undefined,
    currentJobs: Array.isArray(req.body.currentJobs)
      ? req.body.currentJobs.map((job) => ({
          role: String(job?.role || "").trim(),
          company: String(job?.company || "").trim(),
          years: String(job?.years || "").trim()
        }))
      : undefined,
    pastJobs: Array.isArray(req.body.pastJobs)
      ? req.body.pastJobs.map((job) => ({
          role: String(job?.role || "").trim(),
          company: String(job?.company || "").trim(),
          years: String(job?.years || "").trim()
        }))
      : undefined
  };

  Object.keys(update).forEach((key) => {
    if (update[key] === undefined) delete update[key];
  });

  const updatedProfile = await ProfileModel.update(profile._id, update);
  invalidateMapCaches(req.tenant?._id);
  clearHomeStatsCaches();

  const updatedUser = await UserModel.findOne(req.tenant._id, { _id: req.user.id });
  if (updatedUser) {
    await UserModel.update(updatedUser._id, { profileId: updatedProfile._id });
  }
  const user = updatedUser
    ? await UserModel.findOne(req.tenant._id, { _id: req.user.id })
    : null;

  return res.json({
    user: {
      ...(profileToLegacy(updatedProfile, {
        identity: req.identity || {},
        fallbackEmail: user?.email || req.user?.email || "",
        viewer: req.user
      }) || {}),
      _id: String(user?._id || req.user.id),
      email: user?.email || updatedProfile.emails?.[0] || ""
    }
  });
});

router.get("/search/users", async (req, res) => {
  const q = String(req.query.q || "").trim();
  const role = String(req.query.role || req.query.cedarRoles || "").trim();
  const industry = String(req.query.industry || req.query.industries || "").trim();
  const city = String(req.query.city || "").trim();
  const state = String(req.query.state || "").trim();
  const limit = Math.min(Math.max(Number(req.query.limit || 48), 1), 100);

  const cityStateFilter = (city || state) ? [city, state].filter(Boolean).join(" ") : "";

  const items = await ProfileModel.search(req.tenant._id, q || "", {
    roleAtCamp: role || null,
    industry: industry || null,
    cityState: cityStateFilter || null,
    limit
  });

  const mapped = items.map((item) => profileToLegacy(item, { viewer: req.user }));
  return res.json({ total: mapped.length, items: mapped, results: mapped });
});

router.get("/search/user/:id", async (req, res) => {
  const id = String(req.params.id || "");
  if (!isValidObjectId(id)) {
    return res.status(400).json({ error: { code: "INVALID_ID", message: "Invalid id" } });
  }

  // Support both profile IDs and app user IDs.
  let item = await ProfileModel.findOne(req.tenant._id, { _id: id });
  let user = null;
  if (!item) {
    item = await ProfileModel.findOne(req.tenant._id, { userId: id });
  }
  if (!item) {
    user = await UserModel.findOne(req.tenant._id, { _id: id });
    const profileId = asObjectId(user?.profileId);
    if (profileId) {
      item = await ProfileModel.findOne(req.tenant._id, { _id: profileId });
    }
  }
  if (!user && item?.userId) {
    user = await UserModel.findOne(req.tenant._id, { _id: item.userId });
  }

  if (!item) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Profile not found" } });
  }

  return res.json({
    user: profileToLegacy(item, {
      fallbackEmail: user?.email || "",
      viewer: req.user
    })
  });
});

router.get("/search/names", async (req, res) => {
  const q = String(req.query.q || "").trim();
  const limit = Math.min(Math.max(Number(req.query.limit || 10), 1), 25);

  const items = await ProfileModel.search(req.tenant._id, q || "", { limit });

  const mapped = items
    .map((profile) => {
      const id = normalizeEntityId(profile?._id || profile?.id);
      const userId = normalizeEntityId(profile?.userId);
      if (!id) return null;
      return {
        id,
        _id: id,
        userId,
        name: `${profile.firstName || ""} ${profile.lastName || ""}`.trim() || "Unknown",
        firstName: profile.firstName,
        lastName: profile.lastName,
        nickname: resolveProfileNickname(profile),
        cityState: profile.cityState || "",
        roleAtCamp: profile.roleAtCamp || "",
        industry: profile.industry || "",
        uploads: { photoUrl: profile.avatarUrl || "" },
        currentJobs: profile.currentJobs || []
      };
    })
    .filter(Boolean);

  return res.json({ items: mapped, results: mapped });
});

router.get("/suggestions", async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit || 5), 1), 20);
  const requestedId = String(req.query.forUserId || "").trim();

  let targetProfile = null;

  if (requestedId && isValidObjectId(requestedId)) {
    targetProfile =
      (await ProfileModel.findOne(req.tenant._id, { _id: requestedId })) ||
      (await ProfileModel.findOne(req.tenant._id, { userId: requestedId }));
  }

  if (!targetProfile) {
    targetProfile = await ProfileModel.findOne(req.tenant._id, { userId: req.user.id });
  }

  if (!targetProfile) {
    return res.status(404).json({ items: [], error: "Target profile not found" });
  }

  const blockedUserIds = new Set(
    await getMutuallyBlockedUserIds(req.tenant._id, req.user.id, { user: req.user })
  );

  const candidates = await ProfileModel.find(req.tenant._id, { _id: { $ne: targetProfile._id } }, {
    select: ["id", "userId", "firstName", "lastName", "avatarUrl", "currentJobs", "roleAtCamp", "industry", "cityState", "colleges", "highSchool", "createdAt"],
    limit: 800
  });
  const visibleCandidates = candidates.filter(
    (candidate) => !blockedUserIds.has(String(candidate?.userId || ""))
  );

  const scored = visibleCandidates
    .map((candidate) => {
      const similarity = scoreSimilarity(targetProfile, candidate);
      return {
        profile: candidate,
        score: similarity.score,
        reasons: similarity.reasons
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return new Date(b.profile.createdAt || 0).getTime() - new Date(a.profile.createdAt || 0).getTime();
    });

  const items = buildSuggestionResults({
    primaryProfiles: scored.slice(0, limit).map((item) => item.profile),
    fallbackProfiles: visibleCandidates,
    limit
  });

  return res.json({ items, forUserId: String(targetProfile._id) });
});

async function readHomeStatsPayload(tenantId = "") {
  const cacheKey = tenantReadCacheKey("stats-home", tenantId);
  const cached = homeStatsResponseCache.get(cacheKey);
  if (cached) return cached;

  const profiles = await ProfileModel.find(tenantId, {}, { select: ["roleAtCamp", "collegeYears"] });

  const totalAlumni = profiles.length;
  const totalStaff = profiles.filter((profile) =>
    /(staff|director|counselor|admin)/i.test(String(profile?.roleAtCamp || ""))
  ).length;

  let latestYear = null;
  for (const profile of profiles) {
    for (const value of profile?.collegeYears || []) {
      const match = String(value || "").match(/\b(19|20)\d{2}\b/g);
      if (!match) continue;
      for (const yearText of match) {
        const year = Number(yearText);
        if (!Number.isFinite(year)) continue;
        if (latestYear === null || year > latestYear) latestYear = year;
      }
    }
  }

  const payload = {
    totalAlumni,
    totalStaff,
    latestYear,
    activeConversations: 0
  };
  homeStatsResponseCache.set(cacheKey, payload);
  return payload;
}

async function readLocationStatsPayload(tenantId = "") {
  const cacheKey = tenantReadCacheKey("stats-locations", tenantId);
  const cached = locationsStatsResponseCache.get(cacheKey);
  if (cached) return cached;

  const rows = await aggregateCityCounts(tenantId);
  const sorted = rows.sort((a, b) => b.count - a.count || a.city.localeCompare(b.city));
  const top = sorted.slice(0, 10).map((row) => ({
    name: [row.city, row.state].filter(Boolean).join(", "),
    count: row.count
  }));
  const payload = {
    totalLocations: rows.length,
    items: top
  };
  locationsStatsResponseCache.set(cacheKey, payload);
  return payload;
}

function clampActivityLimit(raw = 50) {
  return Math.min(Math.max(Number(raw || 50), 1), 200);
}

async function readActivityPayload(tenantId = "", { limit = 50 } = {}) {
  const resolvedLimit = clampActivityLimit(limit);
  const cacheKey = tenantReadCacheKey("activity", tenantId, String(resolvedLimit));
  const cached = activityResponseCache.get(cacheKey);
  if (cached) return cached;

  const rows = await ActivityItemModel.find(tenantId, {}, {
    sort: { pinned: -1, pinnedAt: -1, ts: -1 },
    limit: resolvedLimit
  });
  const payload = rows.map((row) => activityToClient(row));
  activityResponseCache.set(cacheKey, payload);
  return payload;
}

router.get("/home/bootstrap", async (req, res) => {
  const activityLimit = clampActivityLimit(req.query.activityLimit || req.query.limit || 50);
  const [stats, locations, activity] = await Promise.all([
    readHomeStatsPayload(req.tenant._id),
    readLocationStatsPayload(req.tenant._id),
    readActivityPayload(req.tenant._id, { limit: activityLimit })
  ]);

  res.set("Cache-Control", ACTIVITY_CACHE_CONTROL);
  res.set("Vary", "Authorization");
  return res.json({
    stats,
    locations,
    activity,
    limits: {
      activity: activityLimit
    }
  });
});

router.get("/stats/home", async (req, res) => {
  const payload = await readHomeStatsPayload(req.tenant._id);
  res.set("Cache-Control", HOME_STATS_CACHE_CONTROL);
  res.set("Vary", "Authorization");
  return res.json(payload);
});

router.get("/stats/locations", async (req, res) => {
  const payload = await readLocationStatsPayload(req.tenant._id);
  res.set("Cache-Control", LOCATIONS_STATS_CACHE_CONTROL);
  res.set("Vary", "Authorization");
  return res.json(payload);
});

router.get("/activity", async (req, res) => {
  const limit = clampActivityLimit(req.query.limit || 50);
  const payload = await readActivityPayload(req.tenant._id, { limit });
  res.set("Cache-Control", ACTIVITY_CACHE_CONTROL);
  res.set("Vary", "Authorization");
  return res.json(payload);
});

router.post("/activity", async (req, res) => {
  const message = sanitizeText(String(req.body?.message || "").trim());
  if (!message) {
    return res.status(400).json({ error: { code: "MESSAGE_REQUIRED", message: "Message is required" } });
  }

  const actorProfile = await ProfileModel.findOne(req.tenant._id, { userId: req.user.id });
  const actorName = [actorProfile?.firstName, actorProfile?.lastName].filter(Boolean).join(" ").trim() || "Someone";

  const created = await ActivityItemModel.create({
    tenantId: req.tenant._id,
    actorUserId: req.user.id,
    actor: { id: String(req.user.id), name: actorName },
    type: "announcement.post",
    message,
    ts: new Date()
  });

  clearHomeActivityCache();
  return res.status(201).json(activityToClient(created));
});

router.delete("/activity/:id", async (req, res) => {
  const id = String(req.params.id || "");
  if (!isValidObjectId(id)) {
    return res.status(400).json({ error: { code: "INVALID_ID", message: "Invalid activity id" } });
  }

  const existing = await ActivityItemModel.findOne(req.tenant._id, { _id: id });
  if (!existing) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Activity not found" } });
  }

  const isOwner = String(existing.actorUserId || "") === String(req.user.id || "");
  const isAdmin = isCampAdmin(req.user);
  if (!isOwner && !isAdmin) {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "Cannot delete this activity item" } });
  }

  await ActivityItemModel.delete(existing._id);
  clearHomeActivityCache();
  return res.json({ ok: true });
});

router.patch("/activity/:id/pin", async (req, res) => {
  const id = String(req.params.id || "");
  if (!isValidObjectId(id)) {
    return res.status(400).json({ error: { code: "INVALID_ID", message: "Invalid activity id" } });
  }

  const isAdmin = isCampAdmin(req.user);
  if (!isAdmin) {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "Admin access required" } });
  }

  const pinned = Boolean(req.body?.pinned);
  if (pinned) {
    await ActivityItemModel.updateMany(
      req.tenant._id,
      { _id: { $ne: id }, pinned: true },
      { pinned: false, pinnedAt: null }
    );
  }

  const existing = await ActivityItemModel.findOne(req.tenant._id, { _id: id });
  if (!existing) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Activity not found" } });
  }

  const updated = await ActivityItemModel.update(existing._id, {
    pinned,
    pinnedAt: pinned ? new Date() : null
  });

  clearHomeActivityCache();
  return res.json({ id: String(updated._id), pinned: Boolean(updated.pinned) });
});

router.post("/photos/presign", async (req, res, next) => {
  try {
    const fileName = ensureFileName(req.body?.fileName || `photo-${Date.now()}.jpg`);
    const fileType = assertImageContentType(req.body?.fileType || "", fileName);

    const presigned = await createPresignedUpload({
      tenantSlug: req.tenant.slug,
      prefix: `photos/${req.user.id}`,
      fileName,
      fileType,
      objectProxyBaseUrl: buildTenantObjectProxyBaseUrl(req),
      fileSizeBytes: req.body?.fileSize || req.body?.size || 0,
      cacheControl: IMMUTABLE_IMAGE_CACHE_CONTROL,
      allowedContentTypes: [...IMAGE_MIME_TYPES]
    });

    return res.json(presigned);
  } catch (error) {
    return next(error);
  }
});

router.get("/photos", async (req, res) => {
  const sort = String(req.query.sort || "new").toLowerCase();
  const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 50);
  const ownerId = String(req.query.ownerId || "").trim();
  const cacheKey = tenantReadCacheKey(
    "photos",
    req.tenant?._id,
    [String(req.user?.id || ""), sort, String(limit), ownerId].join(":")
  );
  const cached = photoFeedResponseCache.get(cacheKey);
  if (cached) {
    res.set("Cache-Control", PHOTO_FEED_CACHE_CONTROL);
    res.set("Vary", "Authorization");
    return res.json(cached);
  }

  const filter = {};
  if (ownerId) {
    filter.ownerId = ownerId;
  }

  const rows = await PhotoModel.find(req.tenant._id, filter);
  let ordered = rows;
  if (sort === "old") {
    ordered = rows.sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
  } else if (sort === "top") {
    ordered = rows.sort((a, b) => {
      const likesDiff = (b.likes?.length || 0) - (a.likes?.length || 0);
      if (likesDiff !== 0) return likesDiff;
      return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    });
  } else {
    ordered = rows.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  }

  const sliced = ordered.slice(0, limit).map((row) => photoToClient(row, req.user.id));
  const payload = {
    items: sliced,
    nextCursor: null,
    nextPage: null
  };
  photoFeedResponseCache.set(cacheKey, payload);
  res.set("Cache-Control", PHOTO_FEED_CACHE_CONTROL);
  res.set("Vary", "Authorization");
  return res.json(payload);
});

router.post("/photos", async (req, res) => {
  const imageUrl = String(req.body?.imageUrl || "").trim();
  if (!imageUrl) {
    return res.status(400).json({ error: { code: "IMAGE_REQUIRED", message: "imageUrl is required" } });
  }

  const profile = await ProfileModel.findOne(req.tenant._id, { userId: req.user.id });
  const ownerName = [profile?.firstName, profile?.lastName].filter(Boolean).join(" ").trim() || "Member";

  const created = await PhotoModel.create({
    tenantId: req.tenant._id,
    ownerId: req.user.id,
    ownerName,
    imageUrl,
    thumbUrl: String(req.body?.thumbUrl || imageUrl).trim(),
    caption: sanitizeText(String(req.body?.caption || "").trim()),
    captionMentions: Array.isArray(req.body?.captionMentions) ? req.body.captionMentions : []
  });

  await ActivityItemModel.create({
    tenantId: req.tenant._id,
    actorUserId: req.user.id,
    actor: { id: String(req.user.id), name: ownerName },
    type: "photo.upload",
    target: {
      href: "/photo-stream",
      label: "Photo Stream"
    },
    ts: new Date()
  }).catch(() => {});
  clearHomeActivityCache();
  clearPhotoFeedCache();

  return res.status(201).json(photoToClient(created, req.user.id));
});

router.get("/photos/:id/comments", async (req, res) => {
  const id = String(req.params.id || "");
  if (!isValidObjectId(id)) {
    return res.status(400).json({ error: { code: "INVALID_ID", message: "Invalid photo id" } });
  }

  const photo = await PhotoModel.findOne(req.tenant._id, { _id: id });
  if (!photo) return res.status(404).json({ items: [], nextCursor: null });

  const orderedComments = (photo.comments || [])
    .slice()
    .sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());

  const authorIds = [...new Set(
    orderedComments
      .map((comment) => String(comment?.authorId || "").trim())
      .filter(Boolean)
  )];
  const avatarEntries = await Promise.all(
    authorIds.map(async (authorId) => {
      const profile = await ProfileModel.findOne(req.tenant._id, { userId: authorId });
      return [authorId, String(profile?.avatarUrl || "").trim()];
    })
  );
  const avatarByAuthorId = new Map(avatarEntries);

  const items = orderedComments.map((comment) =>
    commentToClient(comment, avatarByAuthorId.get(String(comment?.authorId || "").trim()))
  );
  return res.json({ items, nextCursor: null });
});

router.post("/photos/:id/comments", async (req, res) => {
  const id = String(req.params.id || "");
  const text = sanitizeText(String(req.body?.text || "").trim());
  if (!isValidObjectId(id)) {
    return res.status(400).json({ error: { code: "INVALID_ID", message: "Invalid photo id" } });
  }
  if (!text) {
    return res.status(400).json({ error: { code: "TEXT_REQUIRED", message: "Comment text is required" } });
  }

  const profile = await ProfileModel.findOne(req.tenant._id, { userId: req.user.id });
  const authorName = [profile?.firstName, profile?.lastName].filter(Boolean).join(" ").trim() || "Member";
  const authorAvatarUrl = String(profile?.avatarUrl || "").trim();
  const commentId = generateObjectId();

  await PhotoModel.addComment(id, {
    _id: commentId,
    authorId: req.user.id,
    authorName,
    authorAvatarUrl,
    text,
    commentMentions: Array.isArray(req.body?.commentMentions) ? req.body.commentMentions : []
  });
  clearPhotoFeedCache();

  return res.status(201).json(
    commentToClient({
      _id: commentId,
      authorId: req.user.id,
      authorName,
      authorAvatarUrl,
      text,
      commentMentions: Array.isArray(req.body?.commentMentions) ? req.body.commentMentions : [],
      createdAt: new Date()
    }, authorAvatarUrl)
  );
});

router.delete("/photos/:id/comments/:commentId", async (req, res) => {
  const id = String(req.params.id || "");
  const commentId = String(req.params.commentId || "");
  if (!isValidObjectId(id) || !isValidObjectId(commentId)) {
    return res.status(400).json({ error: { code: "INVALID_ID", message: "Invalid id" } });
  }

  const photo = await PhotoModel.findOne(req.tenant._id, { _id: id });
  if (!photo) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Photo not found" } });

  const comment = (photo.comments || []).find((entry) => String(entry._id) === commentId);
  if (!comment) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Comment not found" } });

  const isOwner = String(comment.authorId || "") === String(req.user.id || "");
  const canModerate = req.user.roles?.includes("tenant_admin") || req.user.roles?.includes("super_admin");
  if (!isOwner && !canModerate) {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "Cannot delete this comment" } });
  }

  await PhotoModel.removeComment(id, commentId);
  clearPhotoFeedCache();

  return res.json({ ok: true });
});

router.post("/photos/:id/like", async (req, res) => {
  const id = String(req.params.id || "");
  if (!isValidObjectId(id)) {
    return res.status(400).json({ error: { code: "INVALID_ID", message: "Invalid photo id" } });
  }

  const photo = await PhotoModel.findOne(req.tenant._id, { _id: id });
  if (!photo) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Photo not found" } });

  const alreadyLiked = (photo.likes || []).some((entry) => String(entry) === String(req.user.id));

  let updated;
  if (alreadyLiked) {
    updated = await PhotoModel.removeLike(id, req.user.id);
  } else {
    updated = await PhotoModel.addLike(id, req.user.id);
  }

  clearPhotoFeedCache();
  return res.json(photoToClient(updated, req.user.id));
});

router.delete("/photos/:id", async (req, res) => {
  const id = String(req.params.id || "");
  if (!isValidObjectId(id)) {
    return res.status(400).json({ error: { code: "INVALID_ID", message: "Invalid photo id" } });
  }

  const photo = await PhotoModel.findOne(req.tenant._id, { _id: id });
  if (!photo) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Photo not found" } });

  const isOwner = String(photo.ownerId || "") === String(req.user.id || "");
  const isAdmin = req.user.roles?.includes("tenant_admin") || req.user.roles?.includes("super_admin");
  if (!isOwner && !isAdmin) {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "Cannot delete this photo" } });
  }

  await PhotoModel.delete(photo._id);
  clearPhotoFeedCache();
  return res.json({ ok: true });
});

router.post("/conversations/dm", async (req, res) => {
  const meId = asObjectId(req.user.id);
  const requestedOtherId = asObjectId(req.body?.userId);
  if (!meId || !requestedOtherId) {
    return res.status(400).json({ error: { code: "INVALID_INPUT", message: "userId is required" } });
  }

  const resolvedOtherId = await resolveTenantUserId(req.tenant._id, req.body?.userId);
  if (!resolvedOtherId) {
    return res.status(404).json({ error: { code: "USER_NOT_FOUND", message: "User not found in this camp" } });
  }
  const otherId = asObjectId(resolvedOtherId);

  if (String(meId) === String(otherId)) {
    return res.status(400).json({ error: { code: "INVALID_INPUT", message: "Cannot DM yourself" } });
  }

  const targetUser = await UserModel.findOne(req.tenant._id, { _id: otherId });
  if (!targetUser) {
    return res.status(404).json({ error: { code: "USER_NOT_FOUND", message: "User not found in this camp" } });
  }

  await assertDirectContactAllowed(req.tenant._id, meId, otherId);

  const pair = [String(meId), String(otherId)].sort();
  let convo = await ConversationModel.findDm(req.tenant._id, pair);

  if (!convo) {
    convo = await ConversationModel.create({
      tenantId: req.tenant._id,
      type: "dm",
      participantIds: pair,
      createdBy: meId,
      lastMessageAt: new Date(),
      members: [
        { userId: meId, role: "owner" },
        { userId: otherId, role: "member" }
      ],
      readBy: [
        { userId: meId, lastReadAt: new Date() },
        { userId: otherId, lastReadAt: new Date(0) }
      ]
    });
    clearConversationCaches();
    await joinUserSocketsToRealtimeRoom(pair, `conversation:${String(convo._id)}`);
    const payload = conversationToClient(convo, req.user.id);
    if (!payload) {
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Unable to create DM" } });
    }
    return res.status(201).json(payload);
  }
  await joinUserSocketsToRealtimeRoom(pair, `conversation:${String(convo._id)}`);
  const payload = conversationToClient(convo, req.user.id);
  if (!payload) {
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Unable to load DM" } });
  }
  return res.json(payload);
});

router.post("/conversations/group", async (req, res) => {
  const meId = asObjectId(req.user.id);
  if (!meId) {
    return res.status(401).json({ error: { code: "AUTH_REQUIRED", message: "Authentication required" } });
  }

  const ids = Array.isArray(req.body?.participantIds) ? req.body.participantIds : [];
  const resolved = await Promise.all(ids.map((value) => resolveTenantUserId(req.tenant._id, value)));
  const unique = [...new Set([String(meId), ...resolved.filter(Boolean).map((id) => String(id))])].filter((id) =>
    isValidObjectId(id)
  );
  if (unique.length < 3) {
    return res.status(400).json({ error: { code: "INVALID_INPUT", message: "Group needs 3+ members" } });
  }

  const userCount = await UserModel.count(req.tenant._id, { _id: { $in: unique } });
  if (userCount !== unique.length) {
    return res.status(400).json({
      error: { code: "INVALID_INPUT", message: "One or more selected users do not belong to this camp" }
    });
  }

  await Promise.all(
    unique
      .filter((userId) => String(userId) !== String(meId))
      .map((userId) => assertDirectContactAllowed(req.tenant._id, meId, userId))
  );

  const name = sanitizeText(String(req.body?.name || "").trim()).slice(0, 100);
  const now = new Date();
  const convo = await ConversationModel.create({
    tenantId: req.tenant._id,
    type: "group",
    participantIds: unique,
    name,
    createdBy: meId,
    lastMessageAt: now,
    members: unique.map((id) => ({ userId: id, role: String(id) === String(meId) ? "owner" : "member" })),
    readBy: unique.map((id) => ({ userId: id, lastReadAt: String(id) === String(meId) ? now : new Date(0) }))
  });

  clearConversationCaches();
  await joinUserSocketsToRealtimeRoom(unique, `conversation:${String(convo._id)}`);
  const payload = conversationToClient(convo, req.user.id);
  if (!payload) {
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Unable to create group" } });
  }
  return res.status(201).json(payload);
});

router.get("/conversations", async (req, res) => {
  const meId = asObjectId(req.user.id);
  if (!meId) return res.json({ items: [] });
  const blockedUserIds = await getMutuallyBlockedUserIds(req.tenant._id, req.user.id, {
    user: req.user
  });
  const blockedSet = new Set(blockedUserIds);
  const cacheKey = tenantReadCacheKey(
    "conversations-list",
    req.tenant?._id,
    [
      String(req.user?.id || ""),
      blockedUserIds.join(","),
      String(req.originalUrl || req.url || "")
    ].join(":")
  );
  const cached = conversationListResponseCache.get(cacheKey);
  if (cached) {
    res.set("Cache-Control", CHAT_CONVERSATIONS_CACHE_CONTROL);
    res.set("Vary", "Authorization");
    return res.json(cached);
  }

  const items = await ConversationModel.findByParticipant(req.tenant._id, meId, { limit: 200 });
  const contactChecks = items.filter((item) => {
    if (String(item?.type || "") !== "dm") return true;
    return !(item?.participantIds || []).some(
      (participantId) => blockedSet.has(String(participantId || ""))
    );
  });
  const participantUserIds = [
    ...new Set(
      contactChecks
        .flatMap((item) => item?.participantIds || [])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  ];
  const participantProfiles = participantUserIds.length
    ? await ProfileModel.find(
        req.tenant._id,
        { userId: { $in: participantUserIds } },
        { select: ["id", "userId", "firstName", "lastName", "avatarUrl"], limit: participantUserIds.length }
      )
    : [];
  const participantProfileByUserId = new Map(
    participantProfiles.map((profile) => [String(profile.userId || ""), profile])
  );
  const payload = {
    items: contactChecks
      .map((item) => {
        const conversation = conversationToClient(item, req.user.id);
        if (!conversation) return null;
        return {
          ...conversation,
          participants: conversation.participantIds.map((userId) => {
            const profile = participantProfileByUserId.get(String(userId));
            return {
              userId: String(userId),
              profileId: String(profile?._id || profile?.id || ""),
              name:
                [profile?.firstName, profile?.lastName].filter(Boolean).join(" ").trim() ||
                "Member",
              avatarUrl: String(profile?.avatarUrl || "")
            };
          })
        };
      })
      .filter(Boolean)
  };
  conversationListResponseCache.set(cacheKey, payload);
  res.set("Cache-Control", CHAT_CONVERSATIONS_CACHE_CONTROL);
  res.set("Vary", "Authorization");
  return res.json(payload);
});

router.get("/conversations/:id", async (req, res) => {
  const id = String(req.params.id || "");
  if (!isValidObjectId(id)) {
    return res.status(400).json({ error: { code: "INVALID_ID", message: "Invalid conversation id" } });
  }
  const cacheKey = tenantReadCacheKey(
    "conversations-detail",
    req.tenant?._id,
    [String(req.user?.id || ""), id].join(":")
  );
  const cached = conversationDetailResponseCache.get(cacheKey);
  if (cached) {
    res.set("Cache-Control", CHAT_CONVERSATIONS_CACHE_CONTROL);
    res.set("Vary", "Authorization");
    return res.json(cached);
  }

  const convo = await ConversationModel.findOne(req.tenant._id, { _id: id, participantIds: { $contains: [req.user.id] } });
  if (!convo) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Conversation not found" } });
  }

  await assertConversationDirectContactAllowed(req.tenant._id, convo, req.user.id);

  const payload = conversationToClient(convo, req.user.id);
  if (!payload) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Conversation not found" } });
  }
  const participantProfiles = payload.participantIds.length
    ? await ProfileModel.find(
        req.tenant._id,
        { userId: { $in: payload.participantIds } },
        { select: ["id", "userId", "firstName", "lastName", "avatarUrl"], limit: payload.participantIds.length }
      )
    : [];
  const participantProfileByUserId = new Map(
    participantProfiles.map((profile) => [String(profile.userId || ""), profile])
  );
  payload.participants = payload.participantIds.map((userId) => {
    const profile = participantProfileByUserId.get(String(userId));
    return {
      userId: String(userId),
      profileId: String(profile?._id || profile?.id || ""),
      name: [profile?.firstName, profile?.lastName].filter(Boolean).join(" ").trim() || "Member",
      avatarUrl: String(profile?.avatarUrl || "")
    };
  });
  conversationDetailResponseCache.set(cacheKey, payload);
  res.set("Cache-Control", CHAT_CONVERSATIONS_CACHE_CONTROL);
  res.set("Vary", "Authorization");
  return res.json(payload);
});

router.patch("/conversations/:id", async (req, res) => {
  const id = String(req.params.id || "");
  if (!isValidObjectId(id)) {
    return res.status(400).json({ error: { code: "INVALID_ID", message: "Invalid conversation id" } });
  }

  const convo = await ConversationModel.findOne(req.tenant._id, { _id: id, participantIds: { $contains: [req.user.id] } });
  if (!convo) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Conversation not found" } });
  if (convo.type !== "group") {
    return res.status(400).json({ error: { code: "INVALID_INPUT", message: "Only groups can be renamed" } });
  }

  const isOwner = (convo.members || []).some(
    (member) => String(member.userId || "") === String(req.user.id) && member.role === "owner"
  );
  if (!isOwner && !isCampAdmin(req.user)) {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "Only group owner can rename" } });
  }

  const name = sanitizeText(String(req.body?.name || "").trim()).slice(0, 100);
  const updated = await ConversationModel.update(convo._id, { name: name || convo.name });

  clearConversationCaches();
  const payload = conversationToClient(updated, req.user.id);
  if (!payload) {
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Unable to rename group" } });
  }
  return res.json(payload);
});

router.post("/conversations/:id/members", async (req, res) => {
  const id = String(req.params.id || "");
  const resolvedTargetId = await resolveTenantUserId(req.tenant._id, req.body?.userId);
  const targetId = asObjectId(resolvedTargetId);
  if (!isValidObjectId(id) || !targetId) {
    return res.status(400).json({ error: { code: "INVALID_INPUT", message: "Valid conversation id and userId required" } });
  }

  const convo = await ConversationModel.findOne(req.tenant._id, { _id: id, participantIds: { $contains: [req.user.id] } });
  if (!convo) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Conversation not found" } });
  if (convo.type !== "group") {
    return res.status(400).json({ error: { code: "INVALID_INPUT", message: "Only groups have members" } });
  }

  const isOwner = (convo.members || []).some(
    (member) => String(member.userId || "") === String(req.user.id) && member.role === "owner"
  );
  if (!isOwner && !isCampAdmin(req.user)) {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "Only group owner can add members" } });
  }

  const targetUser = await UserModel.findOne(req.tenant._id, { _id: targetId });
  if (!targetUser) {
    return res.status(404).json({ error: { code: "USER_NOT_FOUND", message: "User not found in this camp" } });
  }

  await assertDirectContactAllowed(req.tenant._id, req.user.id, targetId);

  const alreadyInGroup = (convo.participantIds || []).some((entry) => String(entry) === String(targetId));
  if (!alreadyInGroup) {
    const participantIds = [...(convo.participantIds || []), targetId];
    const members = [...(convo.members || []), { userId: targetId, role: "member" }];
    const readBy = [...(convo.readBy || [])];
    if (!readBy.some((entry) => String(entry.userId || "") === String(targetId))) {
      readBy.push({ userId: targetId, lastReadAt: new Date(0) });
    }
    const updated = await ConversationModel.update(convo._id, { participantIds, members, readBy });
    await joinUserSocketsToRealtimeRoom([targetId], `conversation:${id}`);
    const payload = conversationToClient(updated, req.user.id);
    if (!payload) {
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Unable to add member" } });
    }
    clearConversationCaches();
    return res.json(payload);
  }
  const payload = conversationToClient(convo, req.user.id);
  if (!payload) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Conversation not found" } });
  }
  return res.json(payload);
});

router.delete("/conversations/:id/members", async (req, res) => {
  const id = String(req.params.id || "");
  const resolvedTargetId = await resolveTenantUserId(req.tenant._id, req.body?.userId);
  const targetId = asObjectId(resolvedTargetId);
  if (!isValidObjectId(id) || !targetId) {
    return res.status(400).json({ error: { code: "INVALID_INPUT", message: "Valid conversation id and userId required" } });
  }

  const convo = await ConversationModel.findOne(req.tenant._id, { _id: id, participantIds: { $contains: [req.user.id] } });
  if (!convo) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Conversation not found" } });
  if (convo.type !== "group") {
    return res.status(400).json({ error: { code: "INVALID_INPUT", message: "Only groups have members" } });
  }

  const isOwner = (convo.members || []).some(
    (member) => String(member.userId || "") === String(req.user.id) && member.role === "owner"
  );
  const isSelf = String(req.user.id) === String(targetId);
  if (!isOwner && !isSelf && !isCampAdmin(req.user)) {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "Only owner can remove other members" } });
  }

  const participantIds = (convo.participantIds || []).filter((entry) => String(entry) !== String(targetId));
  let members = (convo.members || []).filter((entry) => String(entry.userId || "") !== String(targetId));
  const readBy = (convo.readBy || []).filter((entry) => String(entry.userId || "") !== String(targetId));
  if (participantIds.length === 0) {
    return res.status(400).json({
      error: { code: "LAST_GROUP_MEMBER", message: "Delete the group instead of removing its final member" }
    });
  }

  const removedOwner = (convo.members || []).some(
    (member) => String(member.userId || "") === String(targetId) && member.role === "owner"
  );
  let createdBy = convo.createdBy;
  if (removedOwner) {
    const promotedUserId = String(members[0]?.userId || participantIds[0] || "");
    if (members.length === 0) {
      members = participantIds.map((userId, index) => ({
        userId,
        role: index === 0 ? "owner" : "member"
      }));
    }
    members = members.map((member, index) => ({
      ...member,
      role: index === 0 ? "owner" : member.role === "owner" ? "member" : member.role
    }));
    createdBy = promotedUserId;
  }

  const updated = await ConversationModel.update(convo._id, {
    participantIds,
    members,
    readBy,
    createdBy
  });
  evictUserFromRealtimeRoom(targetId, `conversation:${id}`);

  clearConversationCaches();
  const payload = conversationToClient(updated, req.user.id);
  if (!payload) {
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Unable to remove member" } });
  }
  return res.json(payload);
});

router.get("/conversations/:id/messages", async (req, res) => {
  const id = String(req.params.id || "");
  if (!isValidObjectId(id)) {
    return res.status(400).json({ error: { code: "INVALID_ID", message: "Invalid conversation id" } });
  }

  const convo = await ConversationModel.findOne(req.tenant._id, { _id: id, participantIds: { $contains: [req.user.id] } });
  if (!convo) return res.status(403).json({ error: { code: "FORBIDDEN", message: "Not a conversation member" } });
  await assertConversationDirectContactAllowed(req.tenant._id, convo, req.user.id);

  const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 100);
  const cacheKey = tenantReadCacheKey(
    "conversations-messages",
    req.tenant?._id,
    [String(req.user?.id || ""), id, String(limit), String(req.query.cursor || "")].join(":")
  );
  const cached = conversationMessagesResponseCache.get(cacheKey);
  if (cached) {
    res.set("Cache-Control", CHAT_MESSAGES_CACHE_CONTROL);
    res.set("Vary", "Authorization");
    return res.json(cached);
  }
  const where = { conversationId: id, deletedAt: null };
  const cursor = req.query.cursor ? new Date(req.query.cursor) : null;
  if (cursor && Number.isFinite(cursor.getTime())) where.createdAt = { $lt: cursor };

  const docs = await MessageModel.find(req.tenant._id, where, { sort: { createdAt: -1 }, limit });
  const items = docs.slice().reverse().map((doc) => messageToClient(doc)).filter(Boolean);
  const nextCursor = docs.length ? new Date(docs[docs.length - 1].createdAt).toISOString() : null;

  const payload = { items, nextCursor };
  conversationMessagesResponseCache.set(cacheKey, payload);
  res.set("Cache-Control", CHAT_MESSAGES_CACHE_CONTROL);
  res.set("Vary", "Authorization");
  return res.json(payload);
});

router.post("/conversations/:id/messages", async (req, res) => {
  const id = String(req.params.id || "");
  if (!isValidObjectId(id)) {
    return res.status(400).json({ error: { code: "INVALID_ID", message: "Invalid conversation id" } });
  }

  const convo = await ConversationModel.findOne(req.tenant._id, { _id: id, participantIds: { $contains: [req.user.id] } });
  if (!convo) return res.status(403).json({ error: { code: "FORBIDDEN", message: "Not a conversation member" } });
  await assertConversationDirectContactAllowed(req.tenant._id, convo, req.user.id);

  const kind = normalizeMessageKind(req.body?.kind);
  const text = sanitizeText(String(req.body?.text || "").trim());
  const media =
    kind === "text"
      ? null
      : normalizeStoredMessageMedia(asMedia(req.body?.media), {
          tenantSlug: req.tenant.slug,
          scope: "chat",
          entityId: id,
          objectProxyBaseUrl: buildConversationAttachmentAccessUrl(req, id),
          kind
        });
  if (kind === "text" && !text) {
    return res.status(400).json({ error: { code: "INVALID_INPUT", message: "Text required" } });
  }
  if ((kind === "image" || kind === "file") && !media?.url) {
    return res.status(400).json({ error: { code: "INVALID_INPUT", message: "media.url is required" } });
  }

  const clientMessageId = String(req.body?.clientMessageId || "").trim().slice(0, 120);
  if (clientMessageId) {
    const existing = await MessageModel.findOne(req.tenant._id, {
      conversationId: id,
      senderId: req.user.id,
      clientMessageId
    });
    if (existing) {
      const payload = messageToClient(existing);
      if (!payload) {
        return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Unable to load message" } });
      }
      return res.json(payload);
    }
  }

  const created = await MessageModel.create({
    tenantId: req.tenant._id,
    conversationId: id,
    senderId: req.user.id,
    kind,
    text: kind === "text" ? text.slice(0, 4000) : "",
    media: kind !== "text" ? media : null,
    clientMessageId: clientMessageId || undefined,
    createdAt: new Date()
  });

  const lastMessageAt = created.createdAt || new Date();
  await ConversationModel.update(convo._id, {
    lastMessageAt,
    readBy: advanceReadBy(convo.readBy, req.user.id, lastMessageAt),
    lastMessage: {
      senderId: req.user.id,
      kind,
      text: kind === "text" ? created.text : kind === "image" ? "Photo" : "File attachment",
      media: kind !== "text" ? created.media : null,
      createdAt: lastMessageAt
    }
  });

  clearConversationCaches();
  const payload = messageToClient(created);
  if (!payload) {
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Unable to create message" } });
  }
  emitRealtime(`conversation:${id}`, "message:new", payload);
  void notifyConversationParticipants({
    tenant: req.tenant,
    conversation: convo,
    message: created,
    senderId: req.user.id,
    excludeUserIds: listRealtimeRoomUserIds(`conversation:${id}`)
  }).catch((error) => {
    console.error("[messaging] mobile notification error:", error);
  });
  return res.status(201).json(payload);
});

router.post("/conversations/:id/read", async (req, res) => {
  const id = String(req.params.id || "");
  if (!isValidObjectId(id)) {
    return res.status(400).json({ error: { code: "INVALID_ID", message: "Invalid conversation id" } });
  }

  const convo = await ConversationModel.findOne(req.tenant._id, { _id: id, participantIds: { $contains: [req.user.id] } });
  if (!convo) return res.status(403).json({ error: { code: "FORBIDDEN", message: "Not a conversation member" } });

  const nextReadAt = clampReadAt(req.body?.iso, new Date());
  const readBy = advanceReadBy(convo.readBy, req.user.id, nextReadAt);
  await ConversationModel.update(convo._id, { readBy });

  clearConversationCaches();
  return res.json({ ok: true, id, iso: nextReadAt.toISOString() });
});

router.get("/conversations/:id/attachments/object", async (req, res, next) => {
  try {
    const id = String(req.params.id || "");
    const key = String(req.query?.key || "").trim();
    if (!isValidObjectId(id) || !key) {
      return res.status(400).json({
        error: { code: "INVALID_ATTACHMENT", message: "Valid conversation and attachment key required" }
      });
    }
    const conversation = await ConversationModel.findOne(req.tenant._id, {
      _id: id,
      participantIds: { $contains: [req.user.id] }
    });
    if (!conversation) {
      return res.status(403).json({
        error: { code: "FORBIDDEN", message: "Not a conversation member" }
      });
    }
    await assertConversationDirectContactAllowed(req.tenant._id, conversation, req.user.id);
    const expectedPrefix = `${String(req.tenant.slug || "").trim().toLowerCase()}/chat/${id.toLowerCase()}/`;
    if (!key.toLowerCase().startsWith(expectedPrefix)) {
      return res.status(403).json({
        error: { code: "ATTACHMENT_SCOPE_DENIED", message: "Attachment is outside this conversation" }
      });
    }
    const signed = await createPresignedDownloadUrl({ key, expiresInSeconds: 600 });
    res.set("Cache-Control", "private, no-store");
    return res.json(signed);
  } catch (error) {
    return next(error);
  }
});

router.post("/conversations/:id/presign", async (req, res, next) => {
  try {
    const id = String(req.params.id || "");
    const fileName = ensureFileName(req.body?.fileName || "");
    const fileType = normalizeFileType(req.body?.fileType || "");
    if (!isValidObjectId(id)) {
      return res
        .status(400)
        .json({ error: { code: "INVALID_ID", message: "Invalid conversation id" } });
    }

    const convo = await ConversationModel.findOne(req.tenant._id, { _id: id, participantIds: { $contains: [req.user.id] } });
    if (!convo) {
      return res
        .status(403)
        .json({ error: { code: "FORBIDDEN", message: "Not a conversation member" } });
    }

    const presigned = await createPresignedUpload({
      tenantSlug: req.tenant.slug,
      prefix: `chat/${id}`,
      fileName,
      fileType: fileType || undefined,
      objectProxyBaseUrl: buildTenantObjectProxyBaseUrl(req),
      fileSizeBytes: req.body?.fileSize || req.body?.size || 0,
      maxBytes: MAX_MESSAGE_ATTACHMENT_BYTES,
      allowedContentTypes: [...MESSAGE_ATTACHMENT_MIME_TYPES]
    });

    return res.json(presigned);
  } catch (error) {
    return next(error);
  }
});

router.delete("/conversations/:id", async (req, res) => {
  const id = String(req.params.id || "");
  if (!isValidObjectId(id)) {
    return res.status(400).json({ error: { code: "INVALID_ID", message: "Invalid conversation id" } });
  }

  const convo = await ConversationModel.findOne(req.tenant._id, { _id: id });
  if (!convo) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Conversation not found" } });

  const isOwner = String(convo.createdBy || "") === String(req.user.id || "");
  if (!isOwner && !isCampAdmin(req.user)) {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "Cannot delete this conversation" } });
  }

  await MessageModel.deleteMany(req.tenant._id, { conversationId: convo._id });
  await ConversationModel.delete(convo._id);
  emitRealtime(`conversation:${id}`, "conversation:deleted", { id: String(id) });
  closeRealtimeRoom(`conversation:${id}`);
  clearConversationCaches();
  return res.json({ ok: true, id: String(id) });
});

router.post("/forums", async (req, res) => {
  const name = sanitizeText(String(req.body?.name || "").trim()).slice(0, 100);
  if (!name) {
    return res.status(400).json({ error: { code: "INVALID_INPUT", message: "Name required" } });
  }

  try {
    const created = await ForumModel.create({
      tenantId: req.tenant._id,
      name,
      createdBy: req.user.id,
      creatorId: req.user.id,
      memberIds: [req.user.id],
      moderators: [req.user.id],
      postsCount: 0,
      lastActivityAt: new Date()
    });
    clearForumCaches();
    const payload = forumToClient(created);
    if (!payload) {
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Unable to create forum" } });
    }
    return res.status(201).json(payload);
  } catch (error) {
    if (error?.code === 11000 || error?.code === "23505") {
      return res.status(409).json({ error: { code: "CONFLICT", message: "Forum name already exists" } });
    }
    throw error;
  }
});

router.get("/forums", async (req, res) => {
  const mine = String(req.query.mine || "").toLowerCase() === "true";
  const search = String(req.query.search || "").trim();
  const cacheKey = tenantReadCacheKey(
    "forums-list",
    req.tenant?._id,
    [String(req.user?.id || ""), String(req.originalUrl || req.url || "")].join(":")
  );
  const cached = forumsListResponseCache.get(cacheKey);
  if (cached) {
    res.set("Cache-Control", FORUMS_CACHE_CONTROL);
    res.set("Vary", "Authorization");
    return res.json(cached);
  }

  let items;
  if (mine) {
    items = await ForumModel.findByMember(req.tenant._id, req.user.id, { limit: 200 });
    if (search) {
      const rx = asRegex(search);
      items = items.filter((item) => rx && rx.test(item.name || ""));
    }
  } else {
    const filter = {};
    if (search) filter.name = { $ilike: `%${search}%` };
    items = await ForumModel.find(req.tenant._id, filter, { sort: { name: 1 }, limit: 200 });
  }

  const payload = { items: items.map((item) => forumToClient(item)).filter(Boolean) };
  forumsListResponseCache.set(cacheKey, payload);
  res.set("Cache-Control", FORUMS_CACHE_CONTROL);
  res.set("Vary", "Authorization");
  return res.json(payload);
});

router.get("/forums/:id", async (req, res) => {
  const id = String(req.params.id || "");
  if (!isValidObjectId(id)) {
    return res.status(400).json({ error: { code: "INVALID_ID", message: "Invalid forum id" } });
  }
  const cacheKey = tenantReadCacheKey(
    "forums-detail",
    req.tenant?._id,
    [String(req.user?.id || ""), id].join(":")
  );
  const cached = forumDetailResponseCache.get(cacheKey);
  if (cached) {
    res.set("Cache-Control", FORUMS_CACHE_CONTROL);
    res.set("Vary", "Authorization");
    return res.json(cached);
  }

  const forum = await ForumModel.findOne(req.tenant._id, { _id: id });
  if (!forum) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Forum not found" } });
  const payload = forumToClient(forum);
  if (!payload) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Forum not found" } });
  forumDetailResponseCache.set(cacheKey, payload);
  res.set("Cache-Control", FORUMS_CACHE_CONTROL);
  res.set("Vary", "Authorization");
  return res.json(payload);
});

router.post("/forums/:id/join", async (req, res) => {
  const id = String(req.params.id || "");
  if (!isValidObjectId(id)) {
    return res.status(400).json({ error: { code: "INVALID_ID", message: "Invalid forum id" } });
  }

  const existing = await ForumModel.findOne(req.tenant._id, { _id: id });
  if (!existing) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Forum not found" } });

  await ForumModel.addMember(existing._id, req.user.id);
  const forum = await ForumModel.update(existing._id, { lastActivityAt: new Date() });
  clearForumCaches();
  const payload = forumToClient(forum);
  if (!payload) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Forum not found" } });
  return res.json(payload);
});

router.post("/forums/:id/leave", async (req, res) => {
  const id = String(req.params.id || "");
  if (!isValidObjectId(id)) {
    return res.status(400).json({ error: { code: "INVALID_ID", message: "Invalid forum id" } });
  }

  const existing = await ForumModel.findOne(req.tenant._id, { _id: id });
  if (!existing) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Forum not found" } });

  await ForumModel.removeMember(existing._id, req.user.id);
  const forum = await ForumModel.update(existing._id, { lastActivityAt: new Date() });
  evictUserFromRealtimeRoom(req.user.id, `forum:${id}`);
  clearForumCaches();
  const payload = forumToClient(forum);
  if (!payload) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Forum not found" } });
  return res.json(payload);
});

router.get("/forums/:id/posts", async (req, res) => {
  const id = String(req.params.id || "");
  if (!isValidObjectId(id)) {
    return res.status(400).json({ error: { code: "INVALID_ID", message: "Invalid forum id" } });
  }

  const forum = await ForumModel.findOne(req.tenant._id, { _id: id });
  if (!forum) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Forum not found" } });

  const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 100);
  const cacheKey = tenantReadCacheKey(
    "forums-posts",
    req.tenant?._id,
    [String(req.user?.id || ""), id, String(limit), String(req.query.cursor || "")].join(":")
  );
  const cached = forumPostsResponseCache.get(cacheKey);
  if (cached) {
    res.set("Cache-Control", FORUM_POSTS_CACHE_CONTROL);
    res.set("Vary", "Authorization");
    return res.json(cached);
  }
  const where = { forumId: id, deletedAt: null };
  const cursor = req.query.cursor ? new Date(req.query.cursor) : null;
  if (cursor && Number.isFinite(cursor.getTime())) where.createdAt = { $lt: cursor };

  const docs = await ForumPostModel.find(req.tenant._id, where, { sort: { createdAt: -1 }, limit });
  const items = docs.slice().reverse().map((post) => forumPostToClient(post)).filter(Boolean);
  const nextCursor = docs.length ? new Date(docs[docs.length - 1].createdAt).toISOString() : null;
  const payload = { items, nextCursor };
  forumPostsResponseCache.set(cacheKey, payload);
  res.set("Cache-Control", FORUM_POSTS_CACHE_CONTROL);
  res.set("Vary", "Authorization");
  return res.json(payload);
});

router.post("/forums/:id/posts", async (req, res) => {
  const id = String(req.params.id || "");
  if (!isValidObjectId(id)) {
    return res.status(400).json({ error: { code: "INVALID_ID", message: "Invalid forum id" } });
  }

  const forum = await ForumModel.findOne(req.tenant._id, { _id: id });
  if (!forum) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Forum not found" } });

  const isMember = (forum.memberIds || []).some((entry) => String(entry) === String(req.user.id));
  if (!isMember) {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "Join forum to post" } });
  }

  const kind = normalizeMessageKind(req.body?.kind);
  const text = sanitizeText(String(req.body?.text || "").trim());
  const media =
    kind === "text"
      ? null
      : normalizeStoredMessageMedia(asMedia(req.body?.media), {
          tenantSlug: req.tenant.slug,
          scope: "forums",
          entityId: id,
          objectProxyBaseUrl: buildForumAttachmentAccessUrl(req, id),
          kind
        });
  if (kind === "text" && !text) {
    return res.status(400).json({ error: { code: "INVALID_INPUT", message: "Text required" } });
  }
  if ((kind === "image" || kind === "file") && !media?.url) {
    return res.status(400).json({ error: { code: "INVALID_INPUT", message: "media.url is required" } });
  }

  const rawClientPostId = String(req.body?.clientPostId || "").trim();
  const clientPostId = rawClientPostId ? asObjectId(rawClientPostId) : null;
  if (rawClientPostId && !clientPostId) {
    return res.status(400).json({
      error: { code: "INVALID_INPUT", message: "clientPostId must be a valid client-generated id" }
    });
  }
  if (clientPostId) {
    const existing = await ForumPostModel.findOne(req.tenant._id, {
      _id: clientPostId,
      forumId: id,
      authorId: req.user.id
    });
    if (existing) {
      const existingPayload = forumPostToClient(existing);
      if (!existingPayload) {
        return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Unable to load post" } });
      }
      return res.json(existingPayload);
    }
  }

  let created;
  try {
    created = await ForumPostModel.create({
      ...(clientPostId ? { _id: clientPostId } : {}),
      tenantId: req.tenant._id,
      forumId: id,
      authorId: req.user.id,
      kind,
      text: kind === "text" ? text.slice(0, 8000) : "",
      media: kind !== "text" ? media : null,
      createdAt: new Date()
    });
  } catch (error) {
    if ((error?.code === "23505" || error?.code === 11000) && clientPostId) {
      const existing = await ForumPostModel.findOne(req.tenant._id, {
        _id: clientPostId,
        forumId: id,
        authorId: req.user.id
      });
      const existingPayload = forumPostToClient(existing);
      if (existingPayload) return res.json(existingPayload);
    }
    throw error;
  }

  await ForumModel.update(forum._id, {
    postsCount: Number(forum.postsCount || 0) + 1,
    lastActivityAt: new Date()
  });

  clearForumCaches();
  const payload = forumPostToClient(created);
  if (!payload) {
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Unable to create post" } });
  }
  emitRealtime(`forum:${id}`, "forum:post:new", payload);
  return res.status(201).json(payload);
});

router.post("/forums/:id/presign", async (req, res, next) => {
  try {
    const id = String(req.params.id || "");
    const fileName = ensureFileName(req.body?.fileName || "");
    const fileType = normalizeFileType(req.body?.fileType || "");
    if (!isValidObjectId(id)) {
      return res.status(400).json({ error: { code: "INVALID_ID", message: "Invalid forum id" } });
    }

    const forum = await ForumModel.findOne(req.tenant._id, { _id: id });
    if (!forum) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Forum not found" } });
    const isMember = (forum.memberIds || []).some((entry) => String(entry) === String(req.user.id));
    if (!isMember) {
      return res.status(403).json({ error: { code: "FORBIDDEN", message: "Join forum to upload" } });
    }

    const presigned = await createPresignedUpload({
      tenantSlug: req.tenant.slug,
      prefix: `forums/${id}`,
      fileName,
      fileType: fileType || undefined,
      objectProxyBaseUrl: buildTenantObjectProxyBaseUrl(req),
      fileSizeBytes: req.body?.fileSize || req.body?.size || 0,
      maxBytes: MAX_MESSAGE_ATTACHMENT_BYTES,
      allowedContentTypes: [...MESSAGE_ATTACHMENT_MIME_TYPES]
    });

    return res.json(presigned);
  } catch (error) {
    return next(error);
  }
});

router.get("/forums/:id/attachments/object", async (req, res, next) => {
  try {
    const id = String(req.params.id || "");
    const key = String(req.query?.key || "").trim();
    if (!isValidObjectId(id) || !key) {
      return res.status(400).json({
        error: { code: "INVALID_ATTACHMENT", message: "Valid forum and attachment key required" }
      });
    }
    const forum = await ForumModel.findOne(req.tenant._id, { _id: id });
    if (!forum) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "Forum not found" } });
    }
    const expectedPrefix = `${String(req.tenant.slug || "").trim().toLowerCase()}/forums/${id.toLowerCase()}/`;
    if (!key.toLowerCase().startsWith(expectedPrefix)) {
      return res.status(403).json({
        error: { code: "ATTACHMENT_SCOPE_DENIED", message: "Attachment is outside this forum" }
      });
    }
    const signed = await createPresignedDownloadUrl({ key, expiresInSeconds: 600 });
    res.set("Cache-Control", "private, no-store");
    return res.json(signed);
  } catch (error) {
    return next(error);
  }
});

router.delete("/forums/:id", async (req, res) => {
  const id = String(req.params.id || "");
  if (!isValidObjectId(id)) {
    return res.status(400).json({ error: { code: "INVALID_ID", message: "Invalid forum id" } });
  }

  const forum = await ForumModel.findOne(req.tenant._id, { _id: id });
  if (!forum) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Forum not found" } });

  const isCreator = String(forum.createdBy || forum.creatorId || "") === String(req.user.id || "");
  if (!isCreator && !isCampAdmin(req.user)) {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "Cannot delete this forum" } });
  }

  await ForumPostModel.deleteMany(req.tenant._id, { forumId: forum._id });
  await ForumModel.delete(forum._id);
  emitRealtime(`forum:${id}`, "forum:deleted", { id: String(id) });
  closeRealtimeRoom(`forum:${id}`);
  clearForumCaches();
  return res.json({ ok: true, id: String(id) });
});

router.get("/newsletters", async (req, res) => {
  const rows = await NewsletterModel.find(req.tenant._id, {}, { sort: { year: -1, createdAt: -1 } });

  return res.json({
    items: rows.map((row) => ({
      _id: String(row._id),
      id: String(row._id),
      title: row.title || "",
      season: row.season || "",
      year: row.year || null,
      pdfUrl: resolveNewsletterPdfUrl(req, row),
      coverImageUrl: resolveNewsletterCoverUrl(req, row),
      createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null
    }))
  });
});

router.get("/newsletters/:id/file", async (req, res) => {
  const id = String(req.params.id || "");
  if (!isValidObjectId(id)) {
    return res.status(400).json({ error: { code: "INVALID_ID", message: "Invalid newsletter id" } });
  }

  const row = await NewsletterModel.findOne(req.tenant._id, { _id: id });
  if (!row || !row.pdfData) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Newsletter file not found" } });
  }

  const pointer = decodeNewsletterPointer(row);
  if (pointer?.key) {
    return res.redirect(302, `${buildTenantObjectProxyBaseUrl(req)}?key=${encodeURIComponent(pointer.key)}`);
  }

  res.setHeader("Content-Type", row.pdfMimeType || "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `inline; filename=\"${String(row.pdfName || `newsletter-${id}.pdf`).replace(/"/g, "")}\"`
  );
  return res.send(row.pdfData);
});

router.post(
  "/newsletters",
  upload.fields([
    { name: "file", maxCount: 1 },
    { name: "coverImage", maxCount: 1 }
  ]),
  async (req, res) => {
  const isAdmin = isCampAdmin(req.user);
  if (!isAdmin) {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "Admin access required" } });
  }

  const files = req.files && typeof req.files === "object" ? req.files : {};
  const file = Array.isArray(files.file) ? files.file[0] : null;
  const coverImage = Array.isArray(files.coverImage) ? files.coverImage[0] : null;
  if (!file) {
    return res.status(400).json({ error: { code: "FILE_REQUIRED", message: "PDF file is required" } });
  }
  if (file.mimetype !== "application/pdf") {
    return res.status(400).json({ error: { code: "INVALID_FILE", message: "Only PDF uploads are supported" } });
  }
  if (!coverImage) {
    return res.status(400).json({
      error: { code: "COVER_IMAGE_REQUIRED", message: "Cover image is required." }
    });
  }
  if (!NEWSLETTER_COVER_MIME_TYPES.has(String(coverImage.mimetype || "").toLowerCase())) {
    return res.status(400).json({
      error: {
        code: "INVALID_COVER_IMAGE",
        message: "Cover image must be a JPG, PNG, or WEBP file."
      }
    });
  }

  const season = sanitizeText(String(req.body?.season || "").trim());
  const year = Number(req.body?.year || 0);
  if (!season || !Number.isFinite(year) || year < 1900 || year > 2100) {
    return res.status(400).json({ error: { code: "INVALID_METADATA", message: "Season and valid year are required" } });
  }

  const newsletterLabel =
    String(req.tenant?.content?.newsletterName || "Newsletter").trim() || "Newsletter";
  const title = sanitizeText(String(req.body?.title || "").trim()) || `${season} ${year} ${newsletterLabel}`;
  const emailToNetwork = parseBoolean(req.body?.emailToNetwork || req.body?.sendEmailToNetwork, false);
  const uploaded = await uploadBufferToR2({
    tenantSlug: req.tenant.slug,
    prefix: "newsletters",
    fileName: normalizeAttachmentFileName(file.originalname || `${season}-${year}.pdf`),
    fileType: "application/pdf",
    body: file.buffer,
    objectProxyBaseUrl: buildTenantObjectProxyBaseUrl(req),
    allowedContentTypes: ["application/pdf"]
  });
  const uploadedCover = await uploadBufferToR2({
    tenantSlug: req.tenant.slug,
    prefix: "newsletters/covers",
    fileName: normalizeAttachmentFileName(coverImage.originalname || `${season}-${year}-cover.jpg`),
    fileType: String(coverImage.mimetype || "").toLowerCase(),
    body: coverImage.buffer,
    objectProxyBaseUrl: buildTenantObjectProxyBaseUrl(req),
    cacheControl: IMMUTABLE_IMAGE_CACHE_CONTROL,
    allowedContentTypes: [...NEWSLETTER_COVER_MIME_TYPES]
  });
  const created = await NewsletterModel.create({
    tenantId: req.tenant._id,
    title,
    season,
    year,
    pdfName: file.originalname || `${season}-${year}.pdf`,
    pdfMimeType: NEWSLETTER_R2_POINTER_MIME,
    pdfData: encodeR2Pointer({
      key: uploaded.key,
      objectUrl: uploaded.objectUrl
    }),
    coverImageName: coverImage.originalname || `${season}-${year}-cover.jpg`,
    coverImageMimeType: NEWSLETTER_COVER_R2_POINTER_MIME,
    coverImageData: encodeR2Pointer({
      key: uploadedCover.key,
      objectUrl: uploadedCover.objectUrl
    })
  });

  let emailDelivery = {
    requested: emailToNetwork,
    attempted: 0,
    sent: 0,
    failed: 0,
    status: "not_requested",
    message: ""
  };

  if (emailToNetwork) {
    const recipients = await resolveNetworkRecipientEmails(req.tenant._id);
    if (recipients.length === 0) {
      emailDelivery = {
        ...emailDelivery,
        status: "skipped_no_recipients",
        message: "No member emails found in this network."
      };
    } else {
      const networkUrl = `${req.protocol}://${req.get("host")}/t/${req.tenant.slug}/cedar-chest`;
      const { subject, text, html } = buildNewsletterAnnouncementEmail({
        tenantName: req.tenant.name || "PondBridge Network",
        newsletterLabel,
        title,
        season,
        year: String(year),
        archiveUrl: networkUrl,
        pdfUrl: uploaded.objectUrl,
        coverImageUrl: uploadedCover.objectUrl
      });
      const emailBranding = buildTenantEmailBranding(req.tenant);
      const resolvedReplyTo = isValidEmail(req.user?.email || "")
        ? normalizeEmail(req.user.email)
        : emailBranding.replyTo || undefined;

      try {
        const delivery = await sendBulkTransactionalEmail({
          from: emailBranding.from,
          recipients,
          subject,
          text,
          html,
          replyTo: resolvedReplyTo,
          tags: [
            { name: "category", value: "newsletter_pdf" },
            { name: "tenant", value: req.tenant.slug || "tenant" }
          ],
          idempotencyKey: `newsletter/${req.tenant.slug || "tenant"}/${created._id}`,
          maxRecipients: Math.max(1, recipients.length),
          attachments: [
            {
              filename: normalizeAttachmentFileName(file.originalname || `${season}-${year}.pdf`),
              contentType: "application/pdf",
              content: file.buffer
            }
          ]
        });
        const sentCount = Number(delivery?.sentCount || 0);
        const failedCount = Number(delivery?.failedCount || 0);
        const suppressedCount = Number(delivery?.suppressedCount || 0);
        const deliveredWithoutIssues = failedCount === 0 && suppressedCount === 0;
        const summaryParts = [`Newsletter emailed to ${sentCount} member${sentCount === 1 ? "" : "s"}`];
        if (suppressedCount > 0) {
          summaryParts.push(`${suppressedCount} suppressed`);
        }
        if (failedCount > 0) {
          summaryParts.push(`${failedCount} failure${failedCount === 1 ? "" : "s"}`);
        }

        emailDelivery = {
          ...emailDelivery,
          attempted: Number(delivery?.attemptedCount || recipients.length),
          sent: sentCount,
          failed: failedCount + suppressedCount,
          status: deliveredWithoutIssues ? "sent" : sentCount > 0 ? "partial_failure" : "failed",
          message: `${summaryParts.join(", ")}.`
        };
      } catch (error) {
        emailDelivery = {
          ...emailDelivery,
          attempted: recipients.length,
          sent: 0,
          failed: recipients.length,
          status: "failed",
          message: String(error?.message || "Email delivery failed.")
        };
      }
    }
  }

  const mobilePrefs = normalizeTenantMobileNotificationPrefs(req.tenant.notificationPrefs || {});
  if (mobilePrefs.newsletterPublished) {
    const userIds = await resolveAudienceUserIds(req.tenant._id, "all_active_members");
    await sendMobileNotificationBatch({
      tenant: req.tenant,
      userIds,
      createdByUserId: req.user.id,
      kind: "newsletter_published",
      category: "community",
      title: created.title || `${newsletterLabel} published`,
      body: `${newsletterLabel} is now available in the archive.`,
      deepLink: "/cedar-chest",
      data: {
        newsletterId: String(created._id || "")
      }
    }).catch(() => {});
  }

  return res.status(201).json({
    _id: String(created._id),
    id: String(created._id),
    title: created.title,
    season: created.season,
    year: created.year,
    pdfUrl: uploaded.objectUrl,
    coverImageUrl: uploadedCover.objectUrl,
    createdAt: created.createdAt ? new Date(created.createdAt).toISOString() : new Date().toISOString(),
    emailDelivery
  });
}
);

router.delete("/newsletters/:id", async (req, res) => {
  const isAdmin = isCampAdmin(req.user);
  if (!isAdmin) {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "Admin access required" } });
  }

  const id = String(req.params.id || "");
  if (!isValidObjectId(id)) {
    return res.status(400).json({ error: { code: "INVALID_ID", message: "Invalid newsletter id" } });
  }

  const existing = await NewsletterModel.findOne(req.tenant._id, { _id: id });
  if (!existing) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Newsletter not found" } });
  }

  const pointer = decodeNewsletterPointer(existing);
  if (pointer?.key) {
    try {
      await deleteObjectFromR2(pointer.key);
    } catch {
      // Keep delete non-blocking for metadata row.
    }
  }

  const coverPointer = decodeNewsletterCoverPointer(existing);
  if (coverPointer?.key) {
    try {
      await deleteObjectFromR2(coverPointer.key);
    } catch {
      // Keep delete non-blocking for metadata row.
    }
  }

  await NewsletterModel.delete(existing._id);

  return res.json({ ok: true });
});

router.get("/map/cities", async (req, res) => {
  res.set("Cache-Control", MAP_CITIES_RESPONSE_CACHE_CONTROL);
  res.set("Vary", "Authorization");
  const tenantId = String(req.tenant._id);
  const now = Date.now();
  const cached = citiesCacheByTenant.get(tenantId);
  if (cached?.data && now < Number(cached.expiresAt || 0)) {
    return res.json(cached.data);
  }

  if (!cached?.inflight) {
    const inflight = (async () => {
      const counts = await aggregateCityCounts(req.tenant._id);
      if (!counts.length) {
        return {
          cities: [],
          unresolvedCityCount: 0
        };
      }

      const keys = counts.map((row) => row.key);
      const geos = await CityGeoModel.find({ key: { $in: keys } }, { select: ["key", "city", "state", "lat", "lng"] });
      const geoByKey = new Map(geos.map((geo) => [String(geo.key || "").toLowerCase(), geo]));

      const resolved = [];
      const missing = [];

      for (const row of counts) {
        const geo = geoByKey.get(String(row.key || "").toLowerCase());
        if (hasCoords(geo)) {
          resolved.push({
            key: row.key,
            city: row.city,
            state: row.state,
            lat: Number(geo.lat),
            lng: Number(geo.lng),
            count: Number(row.count || 0)
          });
        } else {
          missing.push(row);
        }
      }

      for (const row of missing.slice(0, MAP_SYNC_GEOCODE_LIMIT)) {
        try {
          const coords = await geocodeCity(row.city, row.state);
          await CityGeoModel.upsert({
            key: row.key,
            city: row.city,
            state: row.state,
            lat: Number(coords.lat),
            lng: Number(coords.lng),
            source: coords.source || "unknown"
          });
          resolved.push({
            key: row.key,
            city: row.city,
            state: row.state,
            lat: Number(coords.lat),
            lng: Number(coords.lng),
            count: Number(row.count || 0)
          });
        } catch {
          queueCityGeocode(row);
        }
      }

      for (const row of missing.slice(MAP_SYNC_GEOCODE_LIMIT)) queueCityGeocode(row);

      resolved.sort((a, b) => b.count - a.count || a.city.localeCompare(b.city));
      return {
        cities: resolved,
        unresolvedCityCount: missing.length
      };
    })();

    citiesCacheByTenant.set(tenantId, { data: cached?.data || null, expiresAt: 0, inflight });
  }

  const current = citiesCacheByTenant.get(tenantId);
  let output = Array.isArray(cached?.data)
    ? { cities: cached.data, unresolvedCityCount: 0 }
    : cached?.data && typeof cached.data === "object"
    ? cached.data
    : { cities: [], unresolvedCityCount: 0 };
  try {
    output = await current.inflight;
  } catch (error) {
    console.error("[Map] Failed to resolve city counts", error);
  } finally {
    const unresolvedCount = Number(output?.unresolvedCityCount || 0);
    const ttlMs = unresolvedCount > 0 ? CITIES_CACHE_PENDING_TTL_MS : CITIES_CACHE_TTL_MS;
    citiesCacheByTenant.set(tenantId, {
      data: output,
      expiresAt: Date.now() + ttlMs,
      inflight: null
    });
  }

  return res.json(output);
});

router.get("/map/city/:key", async (req, res) => {
  res.set("Cache-Control", MAP_CITY_PEOPLE_RESPONSE_CACHE_CONTROL);
  res.set("Vary", "Authorization");
  const tenantId = String(req.tenant._id);
  const key = String(req.params.key || "").trim().toLowerCase();
  if (!key) return res.json([]);

  const now = Date.now();
  const tenantCache = getTenantPeopleCache(tenantId);
  const cached = tenantCache.get(key);
  if (Array.isArray(cached?.data) && cached.data.length > 0 && now < Number(cached.expiresAt || 0)) {
    return res.json(cached.data);
  }

  if (!cached?.inflight) {
    const inflight = (async () => {
      const hintCity = String(req.query.city || "").trim();
      const hintState = String(req.query.state || "").trim().toUpperCase();

      let cityHint = hintCity;
      let stateHint = hintState;
      if (!cityHint && !stateHint) {
        const geo = await CityGeoModel.findByKey(key);
        cityHint = String(geo?.city || "").trim();
        stateHint = String(geo?.state || "").trim().toUpperCase();
      }

      const rows = await loadMapProfilesForCity(tenantId, { city: cityHint, state: stateHint });

      let people = rows.filter((profile) => {
        const parsed = parseCityState(profile.cityState || "");
        return locationKeys(parsed).has(key);
      });

      if (!people.length && (cityHint || stateHint)) {
        const hintKeys = locationKeys({ city: cityHint, state: stateHint });
        people = rows.filter((profile) => {
          const parsed = parseCityState(profile.cityState || "");
          const keys = locationKeys(parsed);
          for (const candidate of hintKeys) {
            if (keys.has(candidate)) return true;
          }
          return false;
        });
      }

      return people.map((profile) => mapCityPerson(profile)).filter(Boolean);
    })();

    setTenantPeopleCacheEntry(tenantId, key, {
      data: cached?.data || null,
      expiresAt: 0,
      inflight
    });
  }

  const current = getTenantPeopleCache(tenantId).get(key);
  let output = Array.isArray(cached?.data) ? cached.data : [];
  try {
    output = await current.inflight;
  } catch (error) {
    console.error("[Map] Failed to load city people", error);
  } finally {
    setTenantPeopleCacheEntry(tenantId, key, {
      data: output,
      expiresAt: Date.now() + (Array.isArray(output) && output.length > 0 ? CITY_PEOPLE_CACHE_TTL_MS : 5000),
      inflight: null
    });
  }

  return res.json(output);
});

export default router;
