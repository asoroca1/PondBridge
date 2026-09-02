import { isMemberEventsModuleEnabled } from "@pondbridge/shared";
import { broadcastTemplate } from "./emailTemplates.js";
import { buildTenantEmailBranding } from "./email.js";
import { buildTenantUrls } from "../utils/domainProvisioning.js";
import { sanitizeHtmlContent, sanitizeText } from "../utils/sanitize.js";

export const EVENT_STATUSES = ["draft", "published", "canceled"];
export const EVENT_RSVP_STATUSES = ["attending", "maybe", "not_attending"];
export const EVENT_MESSAGE_KINDS = ["invite", "reminder", "update", "cancellation"];
export const EVENT_TYPES = ["community", "seminar"];
export const EVENT_DELIVERY_MODES = ["in_person", "online", "hybrid"];
export const EVENT_TOPIC_CATEGORIES = ["", "career", "college", "financial_literacy", "networking", "other"];
export const EVENT_AUDIENCES = [
  "all_members",
  "students",
  "young_alumni",
  "parents",
  "college_applicants",
  "career_explorers"
];
export const EVENT_MEETING_PROVIDERS = ["", "zoom", "microsoft_teams", "google_meet", "other"];
export const EVENT_MEETING_ACCESS_POLICY = "registered_rsvp";

function escapeHtml(value = "") {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeHttpUrl(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    return url.toString();
  } catch {
    return "";
  }
}

function normalizeEnum(value, allowed, fallback) {
  const normalized = String(value || "").trim().toLowerCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

export function normalizeEventType(value = "", fallback = "community") {
  return normalizeEnum(value, EVENT_TYPES, fallback);
}

export function normalizeEventDeliveryMode(value = "", fallback = "in_person") {
  return normalizeEnum(value, EVENT_DELIVERY_MODES, fallback);
}

export function normalizeEventTopicCategory(value = "", fallback = "") {
  return normalizeEnum(value, EVENT_TOPIC_CATEGORIES, fallback);
}

export function normalizeEventAudience(value = "", fallback = "all_members") {
  return normalizeEnum(value, EVENT_AUDIENCES, fallback);
}

export function inferMeetingProvider(meetingUrl = "") {
  const normalizedUrl = normalizeHttpUrl(meetingUrl);
  if (!normalizedUrl) return "";
  const hostname = new URL(normalizedUrl).hostname.toLowerCase();
  if (hostname === "zoom.us" || hostname.endsWith(".zoom.us")) return "zoom";
  if (
    hostname === "teams.microsoft.com" ||
    hostname.endsWith(".teams.microsoft.com") ||
    hostname === "teams.live.com"
  ) {
    return "microsoft_teams";
  }
  if (hostname === "meet.google.com") return "google_meet";
  return "other";
}

export function normalizeMeetingProvider(value = "", meetingUrl = "", fallback = "") {
  const normalized = normalizeEnum(value, EVENT_MEETING_PROVIDERS, "");
  return normalized || inferMeetingProvider(meetingUrl) || fallback;
}

export function normalizeSeminarMeetingUrl(value = "", provider = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw createEventError("Enter a valid meeting link.", "SEMINAR_MEETING_URL_INVALID");
  }

  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw createEventError("Meeting links must use a secure https URL.", "SEMINAR_MEETING_URL_INVALID");
  }

  const normalizedProvider = normalizeMeetingProvider(provider, parsed.toString(), "");
  const hostname = parsed.hostname.toLowerCase();
  const providerMatches =
    normalizedProvider === "zoom"
      ? hostname === "zoom.us" || hostname.endsWith(".zoom.us")
      : normalizedProvider === "microsoft_teams"
        ? hostname === "teams.microsoft.com" ||
          hostname.endsWith(".teams.microsoft.com") ||
          hostname === "teams.live.com"
        : normalizedProvider === "google_meet"
          ? hostname === "meet.google.com"
          : true;

  if (!providerMatches) {
    throw createEventError(
      "The meeting link does not match the selected provider.",
      "SEMINAR_MEETING_PROVIDER_MISMATCH"
    );
  }

  return parsed.toString();
}

function normalizeCapacity(value) {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10000) {
    throw createEventError(
      "Capacity must be a whole number between 1 and 10,000.",
      "EVENT_CAPACITY_INVALID"
    );
  }
  return parsed;
}

export const EVENT_MAX_PRESENTERS = 12;

/**
 * Presenters arrive from the admin UI as profile ids. Order is meaningful --
 * the first presenter is mirrored into events.host_profile_id so the existing
 * publish checks, seminar emails, and host indexes keep working unchanged.
 */
export function normalizePresenterProfileIds(value) {
  const list = Array.isArray(value) ? value : [];
  const seen = new Set();
  const ids = [];
  for (const item of list) {
    const id = sanitizeText(String(item || "").trim()).slice(0, 80);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  if (ids.length > EVENT_MAX_PRESENTERS) {
    throw createEventError(
      `An event can have at most ${EVENT_MAX_PRESENTERS} presenters.`,
      "EVENT_PRESENTERS_LIMIT"
    );
  }
  return ids;
}

export function serializeEventPerson(profile = null) {
  if (!profile) return null;
  const id = String(profile?._id || profile?.id || "").trim();
  if (!id) return null;
  return {
    id,
    fullName: `${profile?.firstName || ""} ${profile?.lastName || ""}`.trim() || "Camp member",
    avatarUrl: String(profile?.avatarUrl || "").trim(),
    roleAtCamp: String(profile?.roleAtCamp || "").trim(),
    industry: String(profile?.industry || "").trim()
  };
}

function slugify(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 72);
}

function stripHtml(value = "") {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .trim();
}

export function createEventError(message, code = "INVALID_EVENT", statusCode = 400, details = null) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  if (details) error.details = details;
  return error;
}

export function isEventsModuleEnabled(tenant = {}) {
  return isMemberEventsModuleEnabled(tenant?.modules?.events);
}

export function normalizeEventStatus(value = "", fallback = "draft") {
  const normalized = String(value || "").trim().toLowerCase();
  return EVENT_STATUSES.includes(normalized) ? normalized : fallback;
}

export function normalizeEventRsvpStatus(value = "", fallback = "attending") {
  const normalized = String(value || "").trim().toLowerCase();
  return EVENT_RSVP_STATUSES.includes(normalized) ? normalized : fallback;
}

export function normalizeEventMessageKind(value = "", fallback = "invite") {
  const normalized = String(value || "").trim().toLowerCase();
  return EVENT_MESSAGE_KINDS.includes(normalized) ? normalized : fallback;
}

export function createRichTextHtml(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/<[a-z][\s\S]*>/i.test(raw)) {
    return sanitizeHtmlContent(raw);
  }

  const blocks = raw
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 200);

  if (!blocks.length) return "";

  return blocks
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br />")}</p>`)
    .join("");
}

export function validateEventTimeline({
  startsAt,
  endsAt = null,
  rsvpDeadlineAt = null
} = {}) {
  const start = startsAt ? new Date(startsAt) : null;
  const end = endsAt ? new Date(endsAt) : null;
  const deadline = rsvpDeadlineAt ? new Date(rsvpDeadlineAt) : null;

  if (!start || Number.isNaN(start.getTime())) {
    throw createEventError("A valid event start date and time is required.", "EVENT_START_REQUIRED");
  }
  if (end && Number.isNaN(end.getTime())) {
    throw createEventError("End date/time must be valid.", "EVENT_END_INVALID");
  }
  if (end && end <= start) {
    throw createEventError("Event end date/time must be after the start.", "EVENT_END_BEFORE_START");
  }
  if (deadline && Number.isNaN(deadline.getTime())) {
    throw createEventError("RSVP deadline must be valid.", "EVENT_RSVP_DEADLINE_INVALID");
  }
  if (deadline && deadline > start) {
    throw createEventError("RSVP deadline must be on or before the event start.", "EVENT_RSVP_DEADLINE_AFTER_START");
  }

  return {
    startsAt: start,
    endsAt: end,
    rsvpDeadlineAt: deadline
  };
}

export function normalizeEventWritePayload(input = {}, { partial = false } = {}) {
  const source = input && typeof input === "object" ? input : {};
  const payload = {};

  if (!partial || Object.prototype.hasOwnProperty.call(source, "title")) {
    payload.title = sanitizeText(String(source.title || "").trim()).slice(0, 140);
    if (!partial && !payload.title) {
      throw createEventError("Event title is required.", "EVENT_TITLE_REQUIRED");
    }
  }

  if (!partial || Object.prototype.hasOwnProperty.call(source, "summary")) {
    payload.summary = sanitizeText(String(source.summary || "").trim()).slice(0, 280);
  }

  if (!partial || Object.prototype.hasOwnProperty.call(source, "bodyHtml")) {
    payload.bodyHtml = createRichTextHtml(source.bodyHtml || "");
  }

  if (!partial || Object.prototype.hasOwnProperty.call(source, "coverImageUrl")) {
    payload.coverImageUrl = normalizeHttpUrl(source.coverImageUrl || "");
  }

  if (!partial || Object.prototype.hasOwnProperty.call(source, "eventType")) {
    payload.eventType = normalizeEventType(source.eventType || "", "community");
  }

  if (!partial || Object.prototype.hasOwnProperty.call(source, "deliveryMode")) {
    payload.deliveryMode = normalizeEventDeliveryMode(source.deliveryMode || "", "in_person");
  }

  if (!partial || Object.prototype.hasOwnProperty.call(source, "topicCategory")) {
    payload.topicCategory = normalizeEventTopicCategory(source.topicCategory || "", "");
  }

  if (!partial || Object.prototype.hasOwnProperty.call(source, "topicTitle")) {
    payload.topicTitle = sanitizeText(String(source.topicTitle || "").trim()).slice(0, 120);
  }

  if (!partial || Object.prototype.hasOwnProperty.call(source, "audience")) {
    payload.audience = normalizeEventAudience(source.audience || "", "all_members");
  }

  if (!partial || Object.prototype.hasOwnProperty.call(source, "meetingProvider")) {
    payload.meetingProvider = normalizeMeetingProvider(
      source.meetingProvider || "",
      source.meetingUrl || "",
      ""
    );
  }

  if (!partial || Object.prototype.hasOwnProperty.call(source, "hostProfileId")) {
    payload.hostProfileId = sanitizeText(String(source.hostProfileId || "").trim()).slice(0, 80) || null;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(source, "capacity")) {
    payload.capacity = normalizeCapacity(source.capacity);
  }

  if (!partial || Object.prototype.hasOwnProperty.call(source, "timezone")) {
    payload.timezone = sanitizeText(String(source.timezone || "").trim()).slice(0, 80) || "America/New_York";
  }

  if (!partial || Object.prototype.hasOwnProperty.call(source, "locationName")) {
    payload.locationName = sanitizeText(String(source.locationName || "").trim()).slice(0, 140);
  }

  if (!partial || Object.prototype.hasOwnProperty.call(source, "locationAddress")) {
    payload.locationAddress = sanitizeText(String(source.locationAddress || "").trim()).slice(0, 240);
  }

  const hasStart = Object.prototype.hasOwnProperty.call(source, "startsAt");
  const hasEnd = Object.prototype.hasOwnProperty.call(source, "endsAt");
  const hasDeadline = Object.prototype.hasOwnProperty.call(source, "rsvpDeadlineAt");
  if (!partial || hasStart || hasEnd || hasDeadline) {
    const { startsAt, endsAt, rsvpDeadlineAt } = validateEventTimeline({
      startsAt: source.startsAt,
      endsAt: source.endsAt || null,
      rsvpDeadlineAt: source.rsvpDeadlineAt || null
    });
    payload.startsAt = startsAt;
    payload.endsAt = endsAt;
    payload.rsvpDeadlineAt = rsvpDeadlineAt;
  }

  return payload;
}

export function validateEventPublishReadiness(event = {}, { meetingUrl = "" } = {}) {
  if (!String(event?.title || "").trim()) {
    throw createEventError("Add an event title before publishing.", "EVENT_TITLE_REQUIRED");
  }

  validateEventTimeline({
    startsAt: event?.startsAt,
    endsAt: event?.endsAt || null,
    rsvpDeadlineAt: event?.rsvpDeadlineAt || null
  });

  if (normalizeEventType(event?.eventType || "") !== "seminar") {
    return { ready: true };
  }

  const deliveryMode = normalizeEventDeliveryMode(event?.deliveryMode || "");
  if (!["online", "hybrid"].includes(deliveryMode)) {
    throw createEventError(
      "Info sessions must be online or hybrid.",
      "SEMINAR_DELIVERY_MODE_REQUIRED"
    );
  }
  if (!String(event?.topicTitle || "").trim()) {
    throw createEventError("Add an info session topic before publishing.", "SEMINAR_TOPIC_REQUIRED");
  }
  if (!String(event?.hostProfileId || "").trim()) {
    throw createEventError(
      "Add at least one registered network member as a presenter for this info session.",
      "SEMINAR_HOST_REQUIRED"
    );
  }
  const provider = normalizeMeetingProvider(event?.meetingProvider || "", meetingUrl, "");
  if (!provider) {
    throw createEventError(
      "Select the info session meeting provider.",
      "SEMINAR_MEETING_PROVIDER_REQUIRED"
    );
  }
  if (!normalizeSeminarMeetingUrl(meetingUrl, provider)) {
    throw createEventError("Add the info session meeting link.", "SEMINAR_MEETING_URL_REQUIRED");
  }
  if (deliveryMode === "hybrid" && !String(event?.locationName || "").trim()) {
    throw createEventError(
      "Add the in-person location for this hybrid info session.",
      "SEMINAR_HYBRID_LOCATION_REQUIRED"
    );
  }

  return { ready: true };
}

export function assertSeminarJoinEligibility({
  event = {},
  profile = null,
  rsvp = null,
  presenterProfileIds = [],
  now = new Date()
} = {}) {
  if (
    normalizeEventType(event?.eventType || "") !== "seminar" ||
    !["online", "hybrid"].includes(normalizeEventDeliveryMode(event?.deliveryMode || ""))
  ) {
    throw createEventError(
      "This event does not have an online info session room.",
      "SEMINAR_JOIN_NOT_AVAILABLE",
      400
    );
  }

  const current = now instanceof Date ? now : new Date(now);
  const endAt = event?.endsAt || event?.startsAt;
  if (endAt && new Date(endAt).getTime() + 4 * 60 * 60 * 1000 < current.getTime()) {
    throw createEventError(
      "This info session has ended and its live meeting link is no longer available.",
      "SEMINAR_ENDED",
      410
    );
  }

  if (!profile || String(profile?.status || "").trim().toLowerCase() !== "active") {
    throw createEventError(
      "Only active registered network members can join info sessions.",
      "SEMINAR_REGISTRATION_REQUIRED",
      403
    );
  }

  const profileId = String(profile?._id || profile?.id || "");
  // Presenters run the room, so they never need to RSVP to their own session.
  const presenterIds = new Set(
    [
      ...(Array.isArray(presenterProfileIds) ? presenterProfileIds : []),
      String(event?.hostProfileId || "")
    ]
      .map((item) => String(item || "").trim())
      .filter(Boolean)
  );
  const isHost = Boolean(profileId && presenterIds.has(profileId));
  if (!isHost && String(rsvp?.status || "").trim().toLowerCase() !== "attending") {
    throw createEventError(
      "RSVP “Going” before opening the info session room.",
      "SEMINAR_ATTENDING_RSVP_REQUIRED",
      403
    );
  }

  return { profileId, isHost, isPresenter: isHost };
}

export function eventPath(eventId = "") {
  return `/events/${encodeURIComponent(String(eventId || "").trim())}`;
}

export function buildEventAppUrl(tenant = {}, eventId = "") {
  const urls = buildTenantUrls(tenant);
  const appUrl = String(urls?.appUrl || "").trim().replace(/\/+$/, "");
  if (!appUrl) return "";
  return `${appUrl}${eventPath(eventId)}`;
}

export function resolveEventSlug(title = "", fallback = "event") {
  return slugify(title) || fallback;
}

export function summarizeRsvpRows(rows = []) {
  const summary = {
    attending: 0,
    maybe: 0,
    notAttending: 0,
    totalResponses: 0
  };

  for (const row of Array.isArray(rows) ? rows : []) {
    const status = normalizeEventRsvpStatus(row?.status || "", "");
    if (!status) continue;
    if (status === "attending") summary.attending += 1;
    if (status === "maybe") summary.maybe += 1;
    if (status === "not_attending") summary.notAttending += 1;
    summary.totalResponses += 1;
  }

  return summary;
}

export function buildRsvpSummaryMap(rows = []) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const eventId = String(row?.eventId || "").trim();
    if (!eventId) continue;
    const current = map.get(eventId) || [];
    current.push(row);
    map.set(eventId, current);
  }

  const summaryMap = new Map();
  for (const [eventId, items] of map.entries()) {
    summaryMap.set(eventId, summarizeRsvpRows(items));
  }
  return summaryMap;
}

export function deriveEventPhase(event = {}, now = new Date()) {
  const start = event?.startsAt ? new Date(event.startsAt) : null;
  const end = event?.endsAt ? new Date(event.endsAt) : start;
  const current = now instanceof Date ? now : new Date(now);

  if (String(event?.status || "").trim().toLowerCase() === "draft") return "draft";
  if (String(event?.status || "").trim().toLowerCase() === "canceled") return "canceled";
  if (!start || Number.isNaN(start.getTime())) return "upcoming";
  if (end && !Number.isNaN(end.getTime()) && end < current) return "past";
  if (start <= current && (!end || end >= current)) return "live";
  return "upcoming";
}

export function serializeEvent(event = {}, options = {}) {
  const summary = options.rsvpSummary || {
    attending: 0,
    maybe: 0,
    notAttending: 0,
    totalResponses: 0
  };
  const myRsvp = options.myRsvp || null;
  const phase = deriveEventPhase(event, options.now || new Date());
  const rsvpDeadlineAt = event?.rsvpDeadlineAt ? new Date(event.rsvpDeadlineAt) : null;
  const rsvpClosed = Boolean(
    rsvpDeadlineAt &&
      !Number.isNaN(rsvpDeadlineAt.getTime()) &&
      rsvpDeadlineAt < (options.now || new Date())
  );
  const eventType = normalizeEventType(event?.eventType || "", "community");
  const deliveryMode = normalizeEventDeliveryMode(event?.deliveryMode || "", "in_person");
  const isOnlineSeminar =
    eventType === "seminar" && ["online", "hybrid"].includes(deliveryMode);
  const presenterProfiles = (Array.isArray(options.presenters) ? options.presenters : [])
    .map((profile) => serializeEventPerson(profile))
    .filter(Boolean);
  // The host is simply the first presenter. Older callers that only load the
  // host profile still get a presenter list of one.
  const hostProfile = options.hostProfile || null;
  const presenters = presenterProfiles.length
    ? presenterProfiles
    : [serializeEventPerson(hostProfile)].filter(Boolean);
  const presenterProfileIds = presenters.length
    ? presenters.map((person) => person.id)
    : [String(event?.hostProfileId || "").trim()].filter(Boolean);
  const viewerProfileId = String(options.viewerProfileId || "").trim();
  const isPresenter = Boolean(viewerProfileId && presenterProfileIds.includes(viewerProfileId));
  const isHost = isPresenter;
  const canRequestJoinLink = Boolean(
    isOnlineSeminar &&
      event?.status === "published" &&
      (isPresenter || myRsvp?.status === "attending")
  );

  const serialized = {
    id: String(event?._id || event?.id || ""),
    slug: String(event?.slug || "").trim(),
    status: normalizeEventStatus(event?.status || "", "draft"),
    phase,
    title: String(event?.title || "").trim(),
    summary: String(event?.summary || "").trim(),
    bodyHtml: String(event?.bodyHtml || ""),
    coverImageUrl: String(event?.coverImageUrl || "").trim(),
    eventType,
    deliveryMode,
    topicCategory: normalizeEventTopicCategory(event?.topicCategory || "", ""),
    topicTitle: String(event?.topicTitle || "").trim(),
    audience: normalizeEventAudience(event?.audience || "", "all_members"),
    meetingProvider: normalizeMeetingProvider(event?.meetingProvider || "", "", ""),
    hostProfileId: String(event?.hostProfileId || "").trim(),
    host: presenters[0] || null,
    presenters,
    presenterProfileIds,
    capacity:
      event?.capacity !== null &&
      event?.capacity !== undefined &&
      Number.isInteger(Number(event.capacity))
        ? Number(event.capacity)
        : null,
    startsAt: event?.startsAt ? new Date(event.startsAt).toISOString() : null,
    endsAt: event?.endsAt ? new Date(event.endsAt).toISOString() : null,
    timezone: String(event?.timezone || "America/New_York").trim(),
    locationName: String(event?.locationName || "").trim(),
    locationAddress: String(event?.locationAddress || "").trim(),
    rsvpDeadlineAt: event?.rsvpDeadlineAt ? new Date(event.rsvpDeadlineAt).toISOString() : null,
    publishedAt: event?.publishedAt ? new Date(event.publishedAt).toISOString() : null,
    createdAt: event?.createdAt ? new Date(event.createdAt).toISOString() : null,
    updatedAt: event?.updatedAt ? new Date(event.updatedAt).toISOString() : null,
    createdByUserId: String(event?.createdByUserId || "").trim(),
    updatedByUserId: String(event?.updatedByUserId || "").trim(),
    counts: summary,
    myRsvp: myRsvp
      ? {
          id: String(myRsvp?._id || myRsvp?.id || ""),
          status: normalizeEventRsvpStatus(myRsvp?.status || ""),
          respondedAt: myRsvp?.respondedAt ? new Date(myRsvp.respondedAt).toISOString() : null
        }
      : null,
    path: eventPath(event?._id || event?.id || ""),
    rsvpClosed,
    meetingAccess: isOnlineSeminar
      ? {
          accessPolicy: EVENT_MEETING_ACCESS_POLICY,
          requiresRegistration: true,
          requiresAttendingRsvp: true,
          isHost,
          isPresenter,
          canRequestJoinLink,
          joinPath: `${eventPath(event?._id || event?.id || "")}/join`
        }
      : null
  };

  if (options.includePrivateMeeting) {
    serialized.meetingUrl = String(options.meetingUrl || "").trim();
  }

  if (Number.isFinite(Number(options.joinAccessCount))) {
    serialized.joinAccessCount = Number(options.joinAccessCount);
  }

  return serialized;
}

export function serializeEventMessage(message = {}) {
  return {
    id: String(message?._id || message?.id || ""),
    eventId: String(message?.eventId || "").trim(),
    kind: normalizeEventMessageKind(message?.kind || ""),
    subject: String(message?.subject || "").trim(),
    bodyHtml: String(message?.bodyHtml || ""),
    recipientProfileIds: Array.isArray(message?.recipientProfileIds) ? message.recipientProfileIds : [],
    recipientCount: Number(message?.recipientCount || 0),
    deliveryStats: message?.deliveryStats && typeof message.deliveryStats === "object" ? message.deliveryStats : {},
    sentAt: message?.sentAt ? new Date(message.sentAt).toISOString() : null,
    createdByUserId: String(message?.createdByUserId || "").trim(),
    createdAt: message?.createdAt ? new Date(message.createdAt).toISOString() : null,
    updatedAt: message?.updatedAt ? new Date(message.updatedAt).toISOString() : null
  };
}

function eventMetaHtml(event = {}) {
  const startsAt = event?.startsAt ? new Date(event.startsAt) : null;
  const endsAt = event?.endsAt ? new Date(event.endsAt) : null;
  const startLabel = startsAt && !Number.isNaN(startsAt.getTime())
    ? startsAt.toLocaleString("en-US", {
        dateStyle: "full",
        timeStyle: "short",
        timeZone: String(event?.timezone || "America/New_York")
      })
    : "";
  const endLabel = endsAt && !Number.isNaN(endsAt.getTime())
    ? endsAt.toLocaleString("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: String(event?.timezone || "America/New_York")
      })
    : "";
  const eventTypeLabel = normalizeEventType(event?.eventType || "") === "seminar"
    ? "Info session"
    : "Event";
  const deliveryLabel =
    event?.deliveryMode === "online"
      ? "Online"
      : event?.deliveryMode === "hybrid"
        ? "Online + in person"
        : "";

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:24px 0;border-collapse:separate;border-spacing:0;">
      <tr>
        <td style="padding:16px 18px;border:1px solid #d7e2ee;border-radius:18px;background:#f8fbff;">
          <p style="margin:0 0 10px;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#5b6f86;">${eventTypeLabel}</p>
          <h2 style="margin:0 0 12px;font-size:22px;line-height:1.2;color:#10273f;">${escapeHtml(event?.title || "Event")}</h2>
          ${event?.summary ? `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#31465c;">${escapeHtml(event.summary)}</p>` : ""}
          ${startLabel ? `<p style="margin:0 0 8px;font-size:14px;color:#10273f;"><strong>Starts:</strong> ${escapeHtml(startLabel)}</p>` : ""}
          ${endLabel ? `<p style="margin:0 0 8px;font-size:14px;color:#10273f;"><strong>Ends:</strong> ${escapeHtml(endLabel)}</p>` : ""}
          ${event?.topicTitle ? `<p style="margin:0 0 8px;font-size:14px;color:#10273f;"><strong>Topic:</strong> ${escapeHtml(event.topicTitle)}</p>` : ""}
          ${deliveryLabel ? `<p style="margin:0 0 8px;font-size:14px;color:#10273f;"><strong>Format:</strong> ${escapeHtml(deliveryLabel)}</p>` : ""}
          ${event?.locationName ? `<p style="margin:0 0 8px;font-size:14px;color:#10273f;"><strong>Location:</strong> ${escapeHtml(event.locationName)}</p>` : ""}
          ${event?.locationAddress ? `<p style="margin:0;font-size:14px;color:#4b6076;">${escapeHtml(event.locationAddress)}</p>` : ""}
        </td>
      </tr>
    </table>
  `;
}

export function buildEventEmailContent({
  tenant,
  event,
  kind = "invite",
  subject = "",
  bodyHtml = ""
} = {}) {
  const branding = buildTenantEmailBranding(tenant);
  const ctaUrl = buildEventAppUrl(tenant, event?._id || event?.id || "");
  const safeKind = normalizeEventMessageKind(kind || "", "invite");
  const scheduleNoun = normalizeEventType(event?.eventType || "") === "seminar"
    ? "info session"
    : "event";
  const intro = safeKind === "invite"
    ? `<p>You are invited to an upcoming ${scheduleNoun} in ${escapeHtml(branding.networkName)}.</p>`
    : safeKind === "reminder"
    ? `<p>This is a reminder about an upcoming ${scheduleNoun} in ${escapeHtml(branding.networkName)}.</p>`
    : safeKind === "cancellation"
    ? `<p>This ${scheduleNoun} has been canceled. Please see the latest details below.</p>`
    : `<p>There is an update for an upcoming ${scheduleNoun} in ${escapeHtml(branding.networkName)}.</p>`;

  const composedBody = `
    ${intro}
    ${bodyHtml ? String(bodyHtml) : ""}
    ${eventMetaHtml(event)}
    ${ctaUrl ? `<p><a href="${escapeHtml(ctaUrl)}" target="_blank" rel="noopener noreferrer">View ${scheduleNoun} details and RSVP</a></p>` : ""}
  `;

  return broadcastTemplate({
    tenantName: branding.networkName,
    subject: String(subject || "").trim(),
    bodyHtml: composedBody,
    unsubscribeUrl: ""
  });
}

export function buildEventExcerpt(bodyHtml = "") {
  return sanitizeText(stripHtml(bodyHtml)).slice(0, 220);
}
