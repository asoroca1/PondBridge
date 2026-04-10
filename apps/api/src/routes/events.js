import { Router } from "express";
import { requireTenantAuthScope } from "../middleware/tenantAccess.js";
import { EventModel, EventRsvpModel, ProfileModel } from "../db/models/index.js";
import { logTenantEvent } from "../services/analytics.js";
import {
  buildRsvpSummaryMap,
  createEventError,
  isEventsModuleEnabled,
  normalizeEventRsvpStatus,
  serializeEvent
} from "../services/events.js";

const router = Router({ mergeParams: true });

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

async function loadEventResponseContext(tenantId, userId, events = []) {
  const eventIds = events.map((item) => String(item?._id || item?.id || "")).filter(Boolean);
  if (!eventIds.length) {
    return {
      rsvpSummaryByEventId: new Map(),
      rsvpByEventId: new Map()
    };
  }

  const [allRsvps, myRsvps] = await Promise.all([
    EventRsvpModel.find(tenantId, { eventId: { $in: eventIds } }),
    EventRsvpModel.find(tenantId, { eventId: { $in: eventIds }, userId })
  ]);

  return {
    rsvpSummaryByEventId: buildRsvpSummaryMap(allRsvps),
    rsvpByEventId: new Map(myRsvps.map((item) => [String(item?.eventId || ""), item]))
  };
}

router.get("/", async (req, res) => {
  const events = await EventModel.find(
    req.tenant._id,
    { status: { $in: ["published", "canceled"] } },
    { sort: { startsAt: 1 }, limit: 200 }
  );
  const { rsvpSummaryByEventId, rsvpByEventId } = await loadEventResponseContext(
    req.tenant._id,
    req.user.id,
    events
  );

  const now = new Date();
  const items = events.map((event) =>
    serializeEvent(event, {
      now,
      rsvpSummary: rsvpSummaryByEventId.get(String(event?._id || event?.id || "")),
      myRsvp: rsvpByEventId.get(String(event?._id || event?.id || ""))
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

  const [rsvps, myRsvp] = await Promise.all([
    EventRsvpModel.find(req.tenant._id, { eventId }),
    EventRsvpModel.findOne(req.tenant._id, { eventId, userId: req.user.id })
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
      myRsvp
    })
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
  if (!profile) {
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

  const patch = {
    eventId,
    profileId: String(profile?._id || profile?.id || ""),
    userId: req.user.id,
    status,
    respondedAt: new Date()
  };

  const rsvp = existing
    ? await EventRsvpModel.update(existing._id, patch)
    : await EventRsvpModel.create({
        tenantId: req.tenant._id,
        ...patch
      });

  await logTenantEvent({
    tenantId: req.tenant._id,
    userId: req.user.id,
    eventType: "event_rsvp_updated",
    metadata: { eventId, status }
  }).catch(() => {});

  const rsvps = await EventRsvpModel.find(req.tenant._id, { eventId });
  return res.json({
    ok: true,
    item: serializeEvent(event, {
      now: new Date(),
      rsvpSummary: buildRsvpSummaryMap(rsvps).get(eventId),
      myRsvp: rsvp
    })
  });
});

export default router;
