import { broadcastTemplate } from "./emailTemplates.js";
import { buildTenantEmailBranding } from "./email.js";
import { buildTenantUrls } from "../utils/domainProvisioning.js";
import { sanitizeHtmlContent, sanitizeText } from "../utils/sanitize.js";

export const EVENT_STATUSES = ["draft", "published", "canceled"];
export const EVENT_RSVP_STATUSES = ["attending", "maybe", "not_attending"];
export const EVENT_MESSAGE_KINDS = ["invite", "reminder", "update", "cancellation"];

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
  return tenant?.modules?.events !== false;
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

  return {
    id: String(event?._id || event?.id || ""),
    slug: String(event?.slug || "").trim(),
    status: normalizeEventStatus(event?.status || "", "draft"),
    phase,
    title: String(event?.title || "").trim(),
    summary: String(event?.summary || "").trim(),
    bodyHtml: String(event?.bodyHtml || ""),
    coverImageUrl: String(event?.coverImageUrl || "").trim(),
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
    rsvpClosed
  };
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

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:24px 0;border-collapse:separate;border-spacing:0;">
      <tr>
        <td style="padding:16px 18px;border:1px solid #d7e2ee;border-radius:18px;background:#f8fbff;">
          <p style="margin:0 0 10px;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#5b6f86;">Event</p>
          <h2 style="margin:0 0 12px;font-size:22px;line-height:1.2;color:#10273f;">${escapeHtml(event?.title || "Event")}</h2>
          ${event?.summary ? `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#31465c;">${escapeHtml(event.summary)}</p>` : ""}
          ${startLabel ? `<p style="margin:0 0 8px;font-size:14px;color:#10273f;"><strong>Starts:</strong> ${escapeHtml(startLabel)}</p>` : ""}
          ${endLabel ? `<p style="margin:0 0 8px;font-size:14px;color:#10273f;"><strong>Ends:</strong> ${escapeHtml(endLabel)}</p>` : ""}
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
  const intro = safeKind === "invite"
    ? `<p>You are invited to an upcoming event in ${escapeHtml(branding.networkName)}.</p>`
    : safeKind === "reminder"
    ? `<p>This is a reminder about an upcoming event in ${escapeHtml(branding.networkName)}.</p>`
    : safeKind === "cancellation"
    ? `<p>This event has been canceled. Please see the latest details below.</p>`
    : `<p>There is an update for an upcoming event in ${escapeHtml(branding.networkName)}.</p>`;

  const composedBody = `
    ${intro}
    ${bodyHtml ? String(bodyHtml) : ""}
    ${eventMetaHtml(event)}
    ${ctaUrl ? `<p><a href="${escapeHtml(ctaUrl)}" target="_blank" rel="noopener noreferrer">View event details and RSVP</a></p>` : ""}
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
