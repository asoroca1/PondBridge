import { isMemberEventsModuleEnabled } from "@pondbridge/shared";
import { broadcastTemplate } from "./emailTemplates.js";
import { buildEmailPalette } from "./brandPalette.js";
import { buildTenantEmailBranding } from "./email.js";
import { buildTenantUrls } from "../utils/domainProvisioning.js";
import { sanitizeHtmlContent, sanitizeText } from "../utils/sanitize.js";

export const EVENT_STATUSES = ["draft", "published", "canceled"];
export const EVENT_RSVP_STATUSES = ["attending", "maybe", "not_attending"];
// How a member signed up: to run the session, or to sit in on it.
export const EVENT_REGISTRATION_ROLES = ["attendee", "presenter"];
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

export function normalizeEventRegistrationRole(value = "", fallback = "attendee") {
  const normalized = String(value || "").trim().toLowerCase();
  return EVENT_REGISTRATION_ROLES.includes(normalized) ? normalized : fallback;
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

  // A session can be opened for registration before anyone has picked a date,
  // so a missing start is allowed. A start that was supplied still has to parse.
  if (startsAt && (!start || Number.isNaN(start.getTime()))) {
    throw createEventError("A valid event start date and time is required.", "EVENT_START_REQUIRED");
  }
  if (end && Number.isNaN(end.getTime())) {
    throw createEventError("End date/time must be valid.", "EVENT_END_INVALID");
  }
  if (end && !start) {
    throw createEventError(
      "Add a start date and time before setting when the event ends.",
      "EVENT_END_WITHOUT_START"
    );
  }
  if (end && start && end <= start) {
    throw createEventError("Event end date/time must be after the start.", "EVENT_END_BEFORE_START");
  }
  if (deadline && Number.isNaN(deadline.getTime())) {
    throw createEventError("RSVP deadline must be valid.", "EVENT_RSVP_DEADLINE_INVALID");
  }
  if (deadline && start && deadline > start) {
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

/**
 * Reports every reason a publish is blocked, not just the first one found.
 *
 * Fixing one blocker only to be told about the next is a poor way to find out
 * what a session needs, so the whole list travels in the message. The first
 * problem still sets the error code, which is what callers switch on.
 */
function assertPublishReady(problems = []) {
  if (!problems.length) return;
  const error = createEventError(
    problems.length === 1
      ? problems[0].message
      : `Before publishing: ${problems.map((problem) => problem.message).join(" · ")}`,
    problems[0].code
  );
  error.details = { problems };
  throw error;
}

export function validateEventPublishReadiness(event = {}, { meetingUrl = "" } = {}) {
  const problems = [];

  if (!String(event?.title || "").trim()) {
    problems.push({ code: "EVENT_TITLE_REQUIRED", message: "Add an event title before publishing." });
  }

  // Dates that contradict each other are reported on their own: until they are
  // sorted out there is nothing dependable to say about the rest of the form.
  validateEventTimeline({
    startsAt: event?.startsAt,
    endsAt: event?.endsAt || null,
    rsvpDeadlineAt: event?.rsvpDeadlineAt || null
  });

  if (normalizeEventType(event?.eventType || "") !== "seminar") {
    assertPublishReady(problems);
    return { ready: true };
  }

  const deliveryMode = normalizeEventDeliveryMode(event?.deliveryMode || "");
  if (!["online", "hybrid"].includes(deliveryMode)) {
    problems.push({
      code: "SEMINAR_DELIVERY_MODE_REQUIRED",
      message: "Info sessions must be online or hybrid."
    });
  }

  // The Topic dropdown and the free-text headline both count as a topic. The
  // form marks the headline optional, so requiring it told directors who had
  // chosen a topic that they had not added one.
  const hasTopic = Boolean(
    normalizeEventTopicCategory(event?.topicCategory || "", "") ||
      String(event?.topicTitle || "").trim()
  );
  if (!hasTopic) {
    problems.push({
      code: "SEMINAR_TOPIC_REQUIRED",
      message: "Choose a topic for this info session."
    });
  }

  // The meeting link is deliberately not required. A camp opens a session for
  // sign-ups first and creates the room later, so members can register before
  // there is anywhere to join. Whoever has registered gets the link when it
  // lands; until then the session says the link is still to come.
  const provider = normalizeMeetingProvider(event?.meetingProvider || "", meetingUrl, "");
  if (provider && meetingUrl && !normalizeSeminarMeetingUrl(meetingUrl, provider)) {
    problems.push({
      code: "SEMINAR_MEETING_URL_INVALID",
      message: "That meeting link does not look like a valid link."
    });
  }

  if (deliveryMode === "hybrid" && !String(event?.locationName || "").trim()) {
    problems.push({
      code: "SEMINAR_HYBRID_LOCATION_REQUIRED",
      message: "Add the in-person location for this hybrid info session."
    });
  }

  assertPublishReady(problems);
  return { ready: true };
}

export function assertSeminarJoinEligibility({
  event = {},
  profile = null,
  rsvp = null,
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
  const isHost = profileId && profileId === String(event?.hostProfileId || "");
  if (!isHost && String(rsvp?.status || "").trim().toLowerCase() !== "attending") {
    throw createEventError(
      "RSVP “Going” before opening the info session room.",
      "SEMINAR_ATTENDING_RSVP_REQUIRED",
      403
    );
  }

  return { profileId, isHost };
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
    totalResponses: 0,
    presenters: 0,
    attendees: 0
  };

  for (const row of Array.isArray(rows) ? rows : []) {
    const status = normalizeEventRsvpStatus(row?.status || "", "");
    if (!status) continue;
    if (status === "attending") summary.attending += 1;
    if (status === "maybe") summary.maybe += 1;
    if (status === "not_attending") summary.notAttending += 1;
    summary.totalResponses += 1;
    // Someone who has declined is not on the roster for either role.
    if (status === "not_attending") continue;
    if (normalizeEventRegistrationRole(row?.registrationRole || "") === "presenter") {
      summary.presenters += 1;
    } else {
      summary.attendees += 1;
    }
  }

  return summary;
}

/**
 * The roster a registered member is allowed to see: everyone who said they are
 * coming or might, presenters first, each in the order they signed up.
 *
 * Members who declined are left out — they are not part of the session, and
 * publishing "who said no" to the whole network is not the point of the list.
 */
export function buildRegistrationRoster(rows = [], profilesById = new Map()) {
  const registered = (Array.isArray(rows) ? rows : []).filter(
    (row) => normalizeEventRsvpStatus(row?.status || "", "") !== "not_attending"
  );

  const byRoleThenTime = (left, right) => {
    const leftRole = normalizeEventRegistrationRole(left?.registrationRole || "");
    const rightRole = normalizeEventRegistrationRole(right?.registrationRole || "");
    if (leftRole !== rightRole) return leftRole === "presenter" ? -1 : 1;
    return new Date(left?.respondedAt || 0).getTime() - new Date(right?.respondedAt || 0).getTime();
  };

  return registered.sort(byRoleThenTime).map((row) => {
    const profileId = String(row?.profileId || "");
    const profile = profilesById.get(profileId) || null;
    return {
      profileId,
      fullName:
        `${profile?.firstName || ""} ${profile?.lastName || ""}`.trim() || "Camp member",
      avatarUrl: String(profile?.avatarUrl || "").trim(),
      roleAtCamp: String(profile?.roleAtCamp || "").trim(),
      industry: String(profile?.industry || "").trim(),
      registrationRole: normalizeEventRegistrationRole(row?.registrationRole || ""),
      status: normalizeEventRsvpStatus(row?.status || ""),
      respondedAt: row?.respondedAt ? new Date(row.respondedAt).toISOString() : null
    };
  });
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
    totalResponses: 0,
    presenters: 0,
    attendees: 0
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
  const hostProfile = options.hostProfile || null;
  const isHost = Boolean(
    options.viewerProfileId &&
      String(options.viewerProfileId) === String(event?.hostProfileId || "")
  );
  // A session can be published before its room exists, so the caller tells us
  // whether a link is on file. Without one there is nothing to hand out, and
  // offering the button would only produce an error.
  const hasMeetingLink = options.hasMeetingLink !== false;
  const canRequestJoinLink = Boolean(
    isOnlineSeminar &&
      event?.status === "published" &&
      hasMeetingLink &&
      (isHost || myRsvp?.status === "attending")
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
    host: hostProfile
      ? {
          id: String(hostProfile?._id || hostProfile?.id || "").trim(),
          fullName: `${hostProfile?.firstName || ""} ${hostProfile?.lastName || ""}`.trim() || "Camp member",
          avatarUrl: String(hostProfile?.avatarUrl || "").trim(),
          roleAtCamp: String(hostProfile?.roleAtCamp || "").trim(),
          industry: String(hostProfile?.industry || "").trim()
        }
      : null,
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
    // A session can be published for sign-ups before anyone picks a time.
    scheduled: Boolean(event?.startsAt),
    myRsvp: myRsvp
      ? {
          id: String(myRsvp?._id || myRsvp?.id || ""),
          status: normalizeEventRsvpStatus(myRsvp?.status || ""),
          registrationRole: normalizeEventRegistrationRole(myRsvp?.registrationRole || ""),
          respondedAt: myRsvp?.respondedAt ? new Date(myRsvp.respondedAt).toISOString() : null
        }
      : null,
    // The roster is only ever passed in once the viewer has registered; see the
    // event detail route, which is where that check lives.
    ...(Array.isArray(options.roster) ? { roster: options.roster } : {}),
    path: eventPath(event?._id || event?.id || ""),
    rsvpClosed,
    meetingAccess: isOnlineSeminar
      ? {
          accessPolicy: EVENT_MEETING_ACCESS_POLICY,
          requiresRegistration: true,
          requiresAttendingRsvp: true,
          isHost,
          canRequestJoinLink,
          hasMeetingLink,
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

function eventMetaHtml(event = {}, palette = null) {
  // Falls back to the neutral default when no camp brand is supplied.
  const P = palette || buildEmailPalette();
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
    ? "Seminar"
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
        <td style="padding:16px 18px;border:1px solid ${P.border};border-radius:18px;background:${P.wash};">
          <p style="margin:0 0 10px;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${P.textMuted};">${eventTypeLabel}</p>
          <h2 style="margin:0 0 12px;font-size:22px;line-height:1.2;color:${P.text};">${escapeHtml(event?.title || "Event")}</h2>
          ${event?.summary ? `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:${P.text};">${escapeHtml(event.summary)}</p>` : ""}
          ${startLabel
            ? `<p style="margin:0 0 8px;font-size:14px;color:${P.text};"><strong>Starts:</strong> ${escapeHtml(startLabel)}</p>`
            // An undated session is open for sign-ups; saying so beats an email
            // that simply has no date on it.
            : `<p style="margin:0 0 8px;font-size:14px;color:${P.text};"><strong>Starts:</strong> Date to be announced</p>`}
          ${endLabel ? `<p style="margin:0 0 8px;font-size:14px;color:${P.text};"><strong>Ends:</strong> ${escapeHtml(endLabel)}</p>` : ""}
          ${event?.topicTitle ? `<p style="margin:0 0 8px;font-size:14px;color:${P.text};"><strong>Topic:</strong> ${escapeHtml(event.topicTitle)}</p>` : ""}
          ${deliveryLabel ? `<p style="margin:0 0 8px;font-size:14px;color:${P.text};"><strong>Format:</strong> ${escapeHtml(deliveryLabel)}</p>` : ""}
          ${event?.locationName ? `<p style="margin:0 0 8px;font-size:14px;color:${P.text};"><strong>Location:</strong> ${escapeHtml(event.locationName)}</p>` : ""}
          ${event?.locationAddress ? `<p style="margin:0;font-size:14px;color:${P.textMuted};">${escapeHtml(event.locationAddress)}</p>` : ""}
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
  // The camp's own colour, so an event email matches its network.
  const palette = buildEmailPalette(branding.brandPrimary);
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
    ${eventMetaHtml(event, palette)}
    ${ctaUrl ? `<p><a href="${escapeHtml(ctaUrl)}" target="_blank" rel="noopener noreferrer">View ${scheduleNoun} details and RSVP</a></p>` : ""}
  `;

  return broadcastTemplate({
    tenantName: branding.networkName,
    subject: String(subject || "").trim(),
    bodyHtml: composedBody,
    unsubscribeUrl: "",
    brandPrimary: branding.brandPrimary
  });
}

export function buildEventExcerpt(bodyHtml = "") {
  return sanitizeText(stripHtml(bodyHtml)).slice(0, 220);
}
