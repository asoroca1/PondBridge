import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireTenantRoleScope } from "../middleware/tenantAccess.js";
import {
  EventMessageModel,
  EventModel,
  EventRsvpModel,
  ProfileModel,
  TenantAdminAuditLogModel,
  UserModel
} from "../db/models/index.js";
import { sendBulkTransactionalEmail } from "../services/email.js";
import {
  buildEventEmailContent,
  buildRsvpSummaryMap,
  buildEventExcerpt,
  createEventError,
  createRichTextHtml,
  isEventsModuleEnabled,
  normalizeEventMessageKind,
  normalizeEventStatus,
  normalizeEventWritePayload,
  resolveEventSlug,
  serializeEvent,
  serializeEventMessage
} from "../services/events.js";
import {
  normalizeTenantMobileNotificationPrefs,
  resolveAudienceUserIds,
  sendMobileNotificationBatch
} from "../services/mobileNotifications.js";
import { sanitizeText } from "../utils/sanitize.js";

const router = Router({ mergeParams: true });
const eventMessageLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 24,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: "RATE_LIMITED",
      message: "Too many event emails were sent. Please wait before trying again."
    }
  }
});

router.use(...requireTenantRoleScope("tenant_admin"));

async function writeAdminAudit(req, event, metadata = {}) {
  try {
    await TenantAdminAuditLogModel.create({
      tenantId: req.tenant._id,
      actorUserId: req.user.id,
      event,
      metadata
    });
  } catch {
    // Never block admin actions on audit logging failures.
  }
}

function toId(value = "") {
  return String(value || "").trim();
}

function fullName(profile = {}, user = {}) {
  return `${profile?.firstName || ""} ${profile?.lastName || ""}`.trim() || String(user?.email || "Member");
}

async function resolveUniqueEventSlug(tenantId, title = "", eventId = "") {
  const base = resolveEventSlug(title, "event");
  let attempt = base;
  let counter = 2;

  while (attempt) {
    const existing = await EventModel.findOne(tenantId, { slug: attempt });
    if (!existing || toId(existing._id || existing.id) === toId(eventId)) {
      return attempt;
    }
    attempt = `${base}-${counter}`;
    counter += 1;
  }

  return `event-${Date.now()}`;
}

async function buildAdminEventListPayload(tenantId, filter = {}) {
  const events = await EventModel.find(tenantId, filter, { sort: { startsAt: -1 }, limit: 200 });
  const eventIds = events.map((item) => toId(item?._id || item?.id)).filter(Boolean);
  const [rsvps, messages] = await Promise.all([
    eventIds.length ? EventRsvpModel.find(tenantId, { eventId: { $in: eventIds } }) : [],
    eventIds.length ? EventMessageModel.find(tenantId, { eventId: { $in: eventIds } }, { sort: { createdAt: -1 } }) : []
  ]);

  const summaryMap = buildRsvpSummaryMap(rsvps);
  const messageMap = new Map();
  for (const message of messages) {
    const eventId = toId(message?.eventId);
    if (!eventId || messageMap.has(eventId)) continue;
    messageMap.set(eventId, message);
  }

  return events.map((event) => {
    const eventId = toId(event?._id || event?.id);
    const item = serializeEvent(event, {
      now: new Date(),
      rsvpSummary: summaryMap.get(eventId)
    });
    const lastMessage = messageMap.get(eventId);
    return {
      ...item,
      lastMessage: lastMessage ? serializeEventMessage(lastMessage) : null,
      bodyExcerpt: buildEventExcerpt(event?.bodyHtml || "")
    };
  });
}

async function buildEventDetailPayload(tenantId, event) {
  const eventId = toId(event?._id || event?.id);
  const [rsvps, messages] = await Promise.all([
    EventRsvpModel.find(tenantId, { eventId }, { sort: { respondedAt: -1 } }),
    EventMessageModel.find(tenantId, { eventId }, { sort: { createdAt: -1 } })
  ]);

  const profileIds = [...new Set(rsvps.map((item) => toId(item?.profileId)).filter(Boolean))];
  const profiles = profileIds.length
    ? await ProfileModel.find(tenantId, { _id: { $in: profileIds } }, {
        select: ["id", "userId", "firstName", "lastName", "avatarUrl", "emails", "roleAtCamp"]
      })
    : [];
  const userIds = [...new Set(profiles.map((item) => toId(item?.userId)).filter(Boolean))];
  const users = userIds.length
    ? await UserModel.find(tenantId, { _id: { $in: userIds } }, {
        select: ["id", "email"]
      })
    : [];
  const profileById = new Map(profiles.map((item) => [toId(item?._id || item?.id), item]));
  const userById = new Map(users.map((item) => [toId(item?._id || item?.id), item]));

  return {
    item: serializeEvent(event, {
      now: new Date(),
      rsvpSummary: buildRsvpSummaryMap(rsvps).get(eventId)
    }),
    responses: rsvps.slice(0, 80).map((rsvp) => {
      const profile = profileById.get(toId(rsvp?.profileId)) || null;
      const user = userById.get(toId(profile?.userId)) || null;
      return {
        id: toId(rsvp?._id || rsvp?.id),
        profileId: toId(rsvp?.profileId),
        userId: toId(rsvp?.userId),
        fullName: fullName(profile, user),
        email: String(profile?.emails?.find(Boolean) || user?.email || "").trim().toLowerCase(),
        avatarUrl: String(profile?.avatarUrl || "").trim(),
        roleAtCamp: String(profile?.roleAtCamp || "").trim(),
        status: String(rsvp?.status || ""),
        respondedAt: rsvp?.respondedAt ? new Date(rsvp.respondedAt).toISOString() : null
      };
    }),
    messages: messages.map((message) => serializeEventMessage(message))
  };
}

async function loadEventOr404(req, res) {
  const eventId = toId(req.params.eventId);
  const event = await EventModel.findOne(req.tenant._id, { _id: eventId });
  if (!event) {
    res.status(404).json({
      error: { code: "EVENT_NOT_FOUND", message: "Event not found." }
    });
    return null;
  }
  return event;
}

router.get("/", async (req, res) => {
  const status = normalizeEventStatus(req.query.status || "", "");
  const items = await buildAdminEventListPayload(
    req.tenant._id,
    status ? { status } : {}
  );
  return res.json({
    moduleEnabled: isEventsModuleEnabled(req.tenant),
    items
  });
});

router.post("/", async (req, res) => {
  const payload = normalizeEventWritePayload(req.body || {});
  const slug = await resolveUniqueEventSlug(req.tenant._id, payload.title);
  const created = await EventModel.create({
    tenantId: req.tenant._id,
    slug,
    status: "draft",
    ...payload,
    createdByUserId: req.user.id,
    updatedByUserId: req.user.id
  });

  await writeAdminAudit(req, "admin_event_created", {
    eventId: toId(created?._id || created?.id),
    title: created.title
  });

  return res.status(201).json({
    ok: true,
    item: serializeEvent(created, { now: new Date() })
  });
});

router.get("/:eventId", async (req, res) => {
  const event = await loadEventOr404(req, res);
  if (!event) return;
  return res.json(await buildEventDetailPayload(req.tenant._id, event));
});

router.patch("/:eventId", async (req, res) => {
  const event = await loadEventOr404(req, res);
  if (!event) return;

  const mergedInput = {
    title: Object.prototype.hasOwnProperty.call(req.body || {}, "title") ? req.body.title : event.title,
    summary: Object.prototype.hasOwnProperty.call(req.body || {}, "summary") ? req.body.summary : event.summary,
    bodyHtml: Object.prototype.hasOwnProperty.call(req.body || {}, "bodyHtml") ? req.body.bodyHtml : event.bodyHtml,
    coverImageUrl: Object.prototype.hasOwnProperty.call(req.body || {}, "coverImageUrl") ? req.body.coverImageUrl : event.coverImageUrl,
    startsAt: Object.prototype.hasOwnProperty.call(req.body || {}, "startsAt") ? req.body.startsAt : event.startsAt,
    endsAt: Object.prototype.hasOwnProperty.call(req.body || {}, "endsAt") ? req.body.endsAt : event.endsAt,
    timezone: Object.prototype.hasOwnProperty.call(req.body || {}, "timezone") ? req.body.timezone : event.timezone,
    locationName: Object.prototype.hasOwnProperty.call(req.body || {}, "locationName") ? req.body.locationName : event.locationName,
    locationAddress: Object.prototype.hasOwnProperty.call(req.body || {}, "locationAddress") ? req.body.locationAddress : event.locationAddress,
    rsvpDeadlineAt: Object.prototype.hasOwnProperty.call(req.body || {}, "rsvpDeadlineAt") ? req.body.rsvpDeadlineAt : event.rsvpDeadlineAt
  };

  const patch = normalizeEventWritePayload(mergedInput);
  const nextSlug = patch.title && patch.title !== event.title
    ? await resolveUniqueEventSlug(req.tenant._id, patch.title, toId(event?._id || event?.id))
    : String(event.slug || "").trim();

  const updated = await EventModel.update(event._id, {
    ...patch,
    slug: nextSlug,
    updatedByUserId: req.user.id
  });

  await writeAdminAudit(req, "admin_event_updated", {
    eventId: toId(updated?._id || updated?.id),
    title: updated.title
  });

  return res.json({
    ok: true,
    item: serializeEvent(updated, { now: new Date() })
  });
});

router.post("/:eventId/publish", async (req, res) => {
  const event = await loadEventOr404(req, res);
  if (!event) return;
  if (!String(event.title || "").trim()) {
    throw createEventError("Add an event title before publishing.", "EVENT_TITLE_REQUIRED");
  }

  const publishedAt = new Date();
  const updated = await EventModel.update(event._id, {
    status: "published",
    publishedAt,
    updatedByUserId: req.user.id
  });

  await writeAdminAudit(req, "admin_event_published", {
    eventId: toId(updated?._id || updated?.id)
  });

  const prefs = normalizeTenantMobileNotificationPrefs(req.tenant.notificationPrefs || {});
  if (prefs.eventPublished) {
    const userIds = await resolveAudienceUserIds(req.tenant._id, "all_active_members");
    await sendMobileNotificationBatch({
      tenant: req.tenant,
      userIds,
      createdByUserId: req.user.id,
      kind: "event_published",
      category: "events",
      title: updated.title || "New event published",
      body: updated.summary || "A new camp event was just published.",
      deepLink: `/events/${toId(updated?._id || updated?.id)}`,
      data: {
        eventId: toId(updated?._id || updated?.id)
      }
    }).catch(() => {});
  }

  return res.json({
    ok: true,
    item: serializeEvent(updated, { now: new Date() })
  });
});

router.post("/:eventId/unpublish", async (req, res) => {
  const event = await loadEventOr404(req, res);
  if (!event) return;

  const updated = await EventModel.update(event._id, {
    status: "draft",
    publishedAt: null,
    updatedByUserId: req.user.id
  });

  await writeAdminAudit(req, "admin_event_unpublished", {
    eventId: toId(updated?._id || updated?.id)
  });

  return res.json({
    ok: true,
    item: serializeEvent(updated, { now: new Date() })
  });
});

router.post("/:eventId/cancel", async (req, res) => {
  const event = await loadEventOr404(req, res);
  if (!event) return;

  const updated = await EventModel.update(event._id, {
    status: "canceled",
    publishedAt: event.publishedAt || new Date(),
    updatedByUserId: req.user.id
  });

  await writeAdminAudit(req, "admin_event_canceled", {
    eventId: toId(updated?._id || updated?.id)
  });

  const prefs = normalizeTenantMobileNotificationPrefs(req.tenant.notificationPrefs || {});
  if (prefs.eventCanceled) {
    const userIds = await resolveAudienceUserIds(req.tenant._id, "all_active_members");
    await sendMobileNotificationBatch({
      tenant: req.tenant,
      userIds,
      createdByUserId: req.user.id,
      kind: "event_canceled",
      category: "events",
      title: `${updated.title || "Event"} canceled`,
      body: "This event has been canceled. Open the event for the latest details.",
      deepLink: `/events/${toId(updated?._id || updated?.id)}`,
      data: {
        eventId: toId(updated?._id || updated?.id)
      }
    }).catch(() => {});
  }

  return res.json({
    ok: true,
    item: serializeEvent(updated, { now: new Date() })
  });
});

router.get("/:eventId/messages", async (req, res) => {
  const event = await loadEventOr404(req, res);
  if (!event) return;
  const messages = await EventMessageModel.find(req.tenant._id, { eventId: toId(event?._id || event?.id) }, {
    sort: { createdAt: -1 },
    limit: 100
  });
  return res.json({ items: messages.map((message) => serializeEventMessage(message)) });
});

router.post("/:eventId/messages/send", eventMessageLimiter, async (req, res) => {
  const event = await loadEventOr404(req, res);
  if (!event) return;
  if (String(event.status || "").trim().toLowerCase() === "draft") {
    throw createEventError("Publish the event before sending event emails.", "EVENT_NOT_PUBLISHED");
  }

  const kind = normalizeEventMessageKind(req.body?.kind || "", "");
  if (!kind) {
    throw createEventError("Select a valid event message type.", "EVENT_MESSAGE_KIND_INVALID");
  }

  const subject = sanitizeText(String(req.body?.subject || "").trim()).slice(0, 160);
  if (!subject) {
    throw createEventError("Email subject is required.", "EVENT_MESSAGE_SUBJECT_REQUIRED");
  }

  const bodyHtml = createRichTextHtml(req.body?.bodyHtml || "");
  if (!bodyHtml) {
    throw createEventError("Write your event email before sending.", "EVENT_MESSAGE_BODY_REQUIRED");
  }

  const recipientProfileIds = [...new Set(
    (Array.isArray(req.body?.recipientProfileIds) ? req.body.recipientProfileIds : [])
      .map((item) => toId(item))
      .filter(Boolean)
  )].slice(0, 400);

  if (!recipientProfileIds.length) {
    throw createEventError("Select at least one member to email.", "EVENT_RECIPIENTS_REQUIRED");
  }

  const profiles = await ProfileModel.find(req.tenant._id, {
    _id: { $in: recipientProfileIds },
    status: { $ne: "removed" }
  }, {
    select: ["id", "userId", "emails", "firstName", "lastName"]
  });
  if (!profiles.length) {
    throw createEventError("Selected recipients could not be found.", "EVENT_RECIPIENTS_NOT_FOUND");
  }

  const userIds = [...new Set(profiles.map((item) => toId(item?.userId)).filter(Boolean))];
  const users = userIds.length
    ? await UserModel.find(req.tenant._id, { _id: { $in: userIds } }, {
        select: ["id", "email"]
      })
    : [];
  const userById = new Map(users.map((item) => [toId(item?._id || item?.id), item]));

  const recipientEmails = [];
  const keptRecipientProfileIds = [];
  for (const profile of profiles) {
    const user = userById.get(toId(profile?.userId)) || null;
    const email = String(profile?.emails?.find(Boolean) || user?.email || "").trim().toLowerCase();
    if (!email) continue;
    recipientEmails.push(email);
    keptRecipientProfileIds.push(toId(profile?._id || profile?.id));
  }

  if (!recipientEmails.length) {
    throw createEventError("Selected recipients do not have deliverable email addresses.", "EVENT_RECIPIENTS_EMAIL_MISSING");
  }

  const composed = buildEventEmailContent({
    tenant: req.tenant,
    event,
    kind,
    subject,
    bodyHtml
  });
  const delivery = await sendBulkTransactionalEmail({
    from: undefined,
    recipients: recipientEmails,
    replyTo: req.user.email || "",
    subject: composed.subject,
    text: composed.text,
    html: composed.html,
    tags: [
      { name: "category", value: `event_${kind}` },
      { name: "tenant", value: req.tenant.slug || "tenant" }
    ],
    idempotencyKey: `event-message/${req.tenant.slug || "tenant"}/${toId(event?._id || event?.id)}/${Date.now()}`
  });

  const message = await EventMessageModel.create({
    tenantId: req.tenant._id,
    eventId: toId(event?._id || event?.id),
    kind,
    subject,
    bodyHtml,
    recipientProfileIds: keptRecipientProfileIds,
    recipientCount: keptRecipientProfileIds.length,
    deliveryStats: {
      attemptedCount: delivery.attemptedCount,
      sentCount: delivery.sentCount,
      failedCount: delivery.failedCount,
      suppressedCount: delivery.suppressedCount,
      messageIds: delivery.messageIds.slice(0, 20),
      failures: delivery.failures.slice(0, 10)
    },
    sentAt: delivery.sentCount > 0 ? new Date() : null,
    createdByUserId: req.user.id
  });

  await writeAdminAudit(req, "admin_event_email_sent", {
    eventId: toId(event?._id || event?.id),
    messageId: toId(message?._id || message?.id),
    kind,
    recipientCount: keptRecipientProfileIds.length
  });

  return res.json({
    ok: true,
    item: serializeEventMessage(message),
    delivery: {
      attemptedCount: delivery.attemptedCount,
      sentCount: delivery.sentCount,
      failedCount: delivery.failedCount,
      suppressedCount: delivery.suppressedCount
    }
  });
});

export default router;
