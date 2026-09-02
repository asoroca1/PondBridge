import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireTenantAuthScope } from "../middleware/tenantAccess.js";
import {
  EventJoinAccessLogModel,
  EventMeetingDetailModel,
  EventModel,
  EventRsvpModel,
  ProfileModel
} from "../db/models/index.js";
import { logTenantEvent } from "../services/analytics.js";
import {
  assertSeminarJoinEligibility,
  buildRsvpSummaryMap,
  createEventError,
  isEventsModuleEnabled,
  normalizeEventRsvpStatus,
  normalizeSeminarMeetingUrl,
  serializeEvent
} from "../services/events.js";
import {
  loadPresenterProfileMap,
  loadPresenterProfiles
} from "../services/eventPresenters.js";

const router = Router({ mergeParams: true });
const eventJoinLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: "RATE_LIMITED",
      message: "Too many info session join attempts. Please wait a few minutes and try again."
    }
  }
});

router.use(...requireTenantAuthScope);
router.use((req, res, next) => {
  if (isEventsModuleEnabled(req.tenant)) return next();
  return res.status(403).json({
    error: {
      code: "EVENTS_MODULE_DISABLED",
      message: "This camp has disabled events."
    }
  });
});

function isAdminUser(user = {}) {
  const roles = Array.isArray(user?.roles) ? user.roles : [];
  return roles.includes("tenant_admin") || roles.includes("super_admin");
}

function mapRsvpPersistenceError(error) {
  const message = String(error?.message || "").toLowerCase();
  if (message.includes("registration capacity")) {
    throw createEventError(
      "This event has reached its registration capacity.",
      "EVENT_CAPACITY_REACHED",
      409
    );
  }
  if (message.includes("active registered member of the event tenant")) {
    throw createEventError(
      "Only active registered network members can RSVP.",
      "EVENT_REGISTRATION_REQUIRED",
      403
    );
  }
  throw error;
}

async function loadEventResponseContext(tenantId, userId, events = []) {
  const eventIds = events.map((item) => String(item?._id || item?.id || "")).filter(Boolean);
  if (!eventIds.length) {
    return {
      rsvpSummaryByEventId: new Map(),
      rsvpByEventId: new Map(),
      presentersByEventId: new Map(),
      viewerProfile: null
    };
  }

  const [allRsvps, myRsvps, presentersByEventId, viewerProfile] = await Promise.all([
    EventRsvpModel.find(tenantId, { eventId: { $in: eventIds } }),
    EventRsvpModel.find(tenantId, { eventId: { $in: eventIds }, userId }),
    loadPresenterProfileMap(tenantId, eventIds),
    ProfileModel.findByUserId(tenantId, userId)
  ]);

  return {
    rsvpSummaryByEventId: buildRsvpSummaryMap(allRsvps),
    rsvpByEventId: new Map(myRsvps.map((item) => [String(item?.eventId || ""), item])),
    presentersByEventId,
    viewerProfile
  };
}

router.get("/", async (req, res) => {
  const events = await EventModel.find(
    req.tenant._id,
    { status: { $in: ["published", "canceled"] } },
    { sort: { startsAt: 1 }, limit: 200 }
  );
  const {
    rsvpSummaryByEventId,
    rsvpByEventId,
    presentersByEventId,
    viewerProfile
  } = await loadEventResponseContext(
    req.tenant._id,
    req.user.id,
    events
  );

  const now = new Date();
  const items = events.map((event) =>
    serializeEvent(event, {
      now,
      rsvpSummary: rsvpSummaryByEventId.get(String(event?._id || event?.id || "")),
      myRsvp: rsvpByEventId.get(String(event?._id || event?.id || "")),
      presenters: presentersByEventId.get(String(event?._id || event?.id || "")) || [],
      viewerProfileId: String(viewerProfile?._id || viewerProfile?.id || "")
    })
  );
  const upcoming = items.filter((item) => item.phase !== "past");
  const past = items.filter((item) => item.phase === "past").sort((a, b) =>
    new Date(b.startsAt || 0).getTime() - new Date(a.startsAt || 0).getTime()
  );

  return res.json({
    featured: upcoming[0] || null,
    upcoming,
    past,
    items
  });
});

router.get("/:eventId", async (req, res) => {
  const eventId = String(req.params.eventId || "").trim();
  const event = await EventModel.findOne(req.tenant._id, { _id: eventId });
  if (!event) {
    return res.status(404).json({
      error: { code: "EVENT_NOT_FOUND", message: "Event not found." }
    });
  }

  if (!isAdminUser(req.user) && !["published", "canceled"].includes(String(event.status || "").trim().toLowerCase())) {
    return res.status(404).json({
      error: { code: "EVENT_NOT_FOUND", message: "Event not found." }
    });
  }

  const [rsvps, myRsvp, viewerProfile, presenters] = await Promise.all([
    EventRsvpModel.find(req.tenant._id, { eventId }),
    EventRsvpModel.findOne(req.tenant._id, { eventId, userId: req.user.id }),
    ProfileModel.findByUserId(req.tenant._id, req.user.id),
    loadPresenterProfiles(req.tenant._id, eventId)
  ]);

  await logTenantEvent({
    tenantId: req.tenant._id,
    userId: req.user.id,
    eventType: "event_detail_viewed",
    metadata: { eventId }
  }).catch(() => {});

  return res.json({
    item: serializeEvent(event, {
      now: new Date(),
      rsvpSummary: buildRsvpSummaryMap(rsvps).get(eventId),
      myRsvp,
      presenters,
      viewerProfileId: String(viewerProfile?._id || viewerProfile?.id || "")
    })
  });
});

router.post("/:eventId/join", eventJoinLimiter, async (req, res) => {
  const eventId = String(req.params.eventId || "").trim();
  const event = await EventModel.findOne(req.tenant._id, { _id: eventId });
  if (!event || String(event.status || "").trim().toLowerCase() !== "published") {
    return res.status(404).json({
      error: { code: "EVENT_NOT_FOUND", message: "Info session not found." }
    });
  }

  const profile = await ProfileModel.findByUserId(req.tenant._id, req.user.id);
  const [myRsvp, presenters] = await Promise.all([
    EventRsvpModel.findOne(req.tenant._id, { eventId, userId: req.user.id }),
    loadPresenterProfiles(req.tenant._id, eventId)
  ]);
  const { profileId } = assertSeminarJoinEligibility({
    event,
    profile,
    rsvp: myRsvp,
    presenterProfileIds: presenters.map((item) => String(item?._id || item?.id || "")),
    now: new Date()
  });

  const meetingDetail = await EventMeetingDetailModel.findOne(req.tenant._id, { eventId });
  const storedMeetingUrl = String(meetingDetail?.meetingUrl || "").trim();
  if (!storedMeetingUrl) {
    throw createEventError(
      "The info session room is not available yet. Please check back closer to the start time.",
      "SEMINAR_MEETING_NOT_READY",
      503
    );
  }
  const meetingUrl = normalizeSeminarMeetingUrl(
    storedMeetingUrl,
    String(event.meetingProvider || "")
  );

  await EventJoinAccessLogModel.create({
    tenantId: req.tenant._id,
    eventId,
    profileId,
    userId: req.user.id,
    accessType: "meeting_link_opened",
    accessedAt: new Date()
  });

  await logTenantEvent({
    tenantId: req.tenant._id,
    userId: req.user.id,
    eventType: "seminar_join_link_opened",
    metadata: { eventId, meetingProvider: String(event.meetingProvider || "") }
  }).catch(() => {});

  res.set("Cache-Control", "no-store");
  return res.json({
    ok: true,
    eventId,
    meetingProvider: String(event.meetingProvider || ""),
    meetingUrl
  });
});

router.put("/:eventId/rsvp", async (req, res) => {
  const eventId = String(req.params.eventId || "").trim();
  const event = await EventModel.findOne(req.tenant._id, { _id: eventId });
  if (!event || String(event.status || "").trim().toLowerCase() === "draft") {
    return res.status(404).json({
      error: { code: "EVENT_NOT_FOUND", message: "Event not found." }
    });
  }

  if (String(event.status || "").trim().toLowerCase() === "canceled") {
    throw createEventError("This event has been canceled and can no longer accept RSVP changes.", "EVENT_CANCELED", 400);
  }

  if (event.rsvpDeadlineAt && new Date(event.rsvpDeadlineAt) < new Date()) {
    throw createEventError("The RSVP deadline for this event has passed.", "EVENT_RSVP_CLOSED", 400);
  }

  const profile = await ProfileModel.findByUserId(req.tenant._id, req.user.id);
  if (!profile || String(profile.status || "").trim().toLowerCase() !== "active") {
    return res.status(404).json({
      error: { code: "PROFILE_NOT_FOUND", message: "Your profile could not be found." }
    });
  }

  const status = normalizeEventRsvpStatus(req.body?.status || "", "");
  if (!status) {
    throw createEventError("Select a valid RSVP status.", "EVENT_RSVP_INVALID");
  }

  const existing = await EventRsvpModel.findOne(req.tenant._id, {
    eventId,
    userId: req.user.id
  });

  if (
    status === "attending" &&
    existing?.status !== "attending" &&
    Number.isInteger(Number(event.capacity)) &&
    Number(event.capacity) > 0
  ) {
    const attendingCount = await EventRsvpModel.count(req.tenant._id, {
      eventId,
      status: "attending"
    });
    if (attendingCount >= Number(event.capacity)) {
      throw createEventError(
        "This event has reached its registration capacity.",
        "EVENT_CAPACITY_REACHED",
        409
      );
    }
  }

  const patch = {
    eventId,
    profileId: String(profile?._id || profile?.id || ""),
    userId: req.user.id,
    status,
    respondedAt: new Date()
  };

  let rsvp;
  try {
    rsvp = existing
      ? await EventRsvpModel.update(existing._id, patch)
      : await EventRsvpModel.create({
          tenantId: req.tenant._id,
          ...patch
        });
  } catch (persistenceError) {
    mapRsvpPersistenceError(persistenceError);
  }

  await logTenantEvent({
    tenantId: req.tenant._id,
    userId: req.user.id,
    eventType: "event_rsvp_updated",
    metadata: { eventId, status }
  }).catch(() => {});

  const [rsvps, presenters] = await Promise.all([
    EventRsvpModel.find(req.tenant._id, { eventId }),
    loadPresenterProfiles(req.tenant._id, eventId)
  ]);
  return res.json({
    ok: true,
    item: serializeEvent(event, {
      now: new Date(),
      rsvpSummary: buildRsvpSummaryMap(rsvps).get(eventId),
      myRsvp: rsvp,
      presenters,
      viewerProfileId: String(profile?._id || profile?.id || "")
    })
  });
});

export default router;
