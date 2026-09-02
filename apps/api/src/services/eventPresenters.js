import {
  EventModel,
  EventPresenterModel,
  EventRsvpModel,
  ProfileModel,
  UserModel
} from "../db/models/index.js";
import { createEventError } from "./events.js";

const PRESENTER_PROFILE_SELECT = [
  "id",
  "userId",
  "firstName",
  "lastName",
  "avatarUrl",
  "roleAtCamp",
  "industry",
  "emails",
  "status"
];

function toId(value = "") {
  return String(value || "").trim();
}

function mapCapacityError(error) {
  const message = String(error?.message || "").toLowerCase();
  if (message.includes("registration capacity")) {
    return createEventError(
      "This event is at its seat limit, so the presenter could not be marked as going. Raise the seat limit and try again.",
      "EVENT_CAPACITY_REACHED",
      409
    );
  }
  if (message.includes("active registered member")) {
    return createEventError(
      "Presenters must be active registered members of this network.",
      "EVENT_PRESENTER_NOT_REGISTERED"
    );
  }
  return error;
}

/**
 * A presenter must be an active member with an active account — the same bar
 * the database trigger enforces, checked here so the admin gets a readable
 * message instead of a constraint violation.
 */
export async function loadEligiblePresenterProfile(tenantId, profileId) {
  const id = toId(profileId);
  if (!id) {
    throw createEventError("Select a member to add as a presenter.", "EVENT_PRESENTER_REQUIRED");
  }

  const profile = await ProfileModel.findOne(tenantId, { _id: id, status: "active" });
  if (!profile) {
    throw createEventError(
      "Select an active registered member from this network as a presenter.",
      "EVENT_PRESENTER_NOT_REGISTERED"
    );
  }

  const user = await UserModel.findOne(tenantId, {
    _id: toId(profile.userId),
    status: "active"
  });
  if (!user) {
    throw createEventError(
      "That member no longer has an active network account.",
      "EVENT_PRESENTER_NOT_REGISTERED"
    );
  }

  return profile;
}

/** Validates a whole presenter list before anything is written. */
export async function assertPresentersEligible(tenantId, profileIds = []) {
  const profiles = [];
  for (const profileId of Array.isArray(profileIds) ? profileIds : []) {
    profiles.push(await loadEligiblePresenterProfile(tenantId, profileId));
  }
  return profiles;
}

export async function loadPresenterRows(tenantId, eventId) {
  return EventPresenterModel.find(
    tenantId,
    { eventId: toId(eventId) },
    { sort: { sortOrder: 1, createdAt: 1 } }
  );
}

/** Ordered presenter profiles for one event, ready for serializeEvent. */
export async function loadPresenterProfiles(tenantId, eventId) {
  const rows = await loadPresenterRows(tenantId, eventId);
  const profileIds = rows.map((row) => toId(row?.profileId)).filter(Boolean);
  if (!profileIds.length) return [];

  const profiles = await ProfileModel.find(tenantId, { _id: { $in: profileIds } }, {
    select: PRESENTER_PROFILE_SELECT
  });
  const profileById = new Map(profiles.map((item) => [toId(item?._id || item?.id), item]));
  return profileIds.map((id) => profileById.get(id)).filter(Boolean);
}

/** Ordered presenter profiles for many events at once, keyed by event id. */
export async function loadPresenterProfileMap(tenantId, eventIds = []) {
  const ids = [...new Set((Array.isArray(eventIds) ? eventIds : []).map(toId).filter(Boolean))];
  if (!ids.length) return new Map();

  const rows = await EventPresenterModel.find(
    tenantId,
    { eventId: { $in: ids } },
    { sort: { sortOrder: 1, createdAt: 1 } }
  );
  if (!rows.length) return new Map();

  const profileIds = [...new Set(rows.map((row) => toId(row?.profileId)).filter(Boolean))];
  const profiles = profileIds.length
    ? await ProfileModel.find(tenantId, { _id: { $in: profileIds } }, {
        select: PRESENTER_PROFILE_SELECT
      })
    : [];
  const profileById = new Map(profiles.map((item) => [toId(item?._id || item?.id), item]));

  const map = new Map();
  for (const row of rows) {
    const eventId = toId(row?.eventId);
    const profile = profileById.get(toId(row?.profileId));
    if (!eventId || !profile) continue;
    const current = map.get(eventId) || [];
    current.push(profile);
    map.set(eventId, current);
  }
  return map;
}

/**
 * events.host_profile_id mirrors the first presenter. Everything that reads a
 * host — publish readiness, seminar emails, the host index — keeps working
 * without knowing the presenter table exists.
 */
export async function syncEventHostProfileId(tenantId, eventId, { actorUserId = "" } = {}) {
  const rows = await loadPresenterRows(tenantId, eventId);
  const nextHostProfileId = toId(rows[0]?.profileId) || null;
  const event = await EventModel.findOne(tenantId, { _id: toId(eventId) });
  if (!event) return null;
  if (toId(event.hostProfileId) === toId(nextHostProfileId)) return event;

  return EventModel.update(event._id, {
    hostProfileId: nextHostProfileId,
    ...(actorUserId ? { updatedByUserId: actorUserId } : {})
  });
}

async function markPresenterAttending({ tenantId, eventId, profile }) {
  const profileId = toId(profile?._id || profile?.id);
  const existing = await EventRsvpModel.findOne(tenantId, { eventId: toId(eventId), profileId });
  if (existing) {
    if (String(existing.status || "").trim().toLowerCase() !== "attending") {
      await EventRsvpModel.update(existing._id, { status: "attending", respondedAt: new Date() });
    }
    // The member already had an RSVP of their own, so removing them as a
    // presenter later must not delete it.
    return false;
  }

  await EventRsvpModel.create({
    tenantId,
    eventId: toId(eventId),
    profileId,
    userId: toId(profile?.userId),
    status: "attending",
    respondedAt: new Date()
  });
  return true;
}

/**
 * Adds one presenter and marks them as going. If the RSVP cannot be written
 * (usually a full seat limit) the presenter row is rolled back so the two
 * never drift apart.
 */
export async function addEventPresenter({ tenantId, eventId, profileId, actorUserId = "" }) {
  const profile = await loadEligiblePresenterProfile(tenantId, profileId);
  const normalizedProfileId = toId(profile?._id || profile?.id);
  const rows = await loadPresenterRows(tenantId, eventId);

  if (rows.some((row) => toId(row?.profileId) === normalizedProfileId)) {
    throw createEventError(
      "That member is already a presenter for this event.",
      "EVENT_PRESENTER_DUPLICATE",
      409
    );
  }

  const sortOrder = rows.reduce((max, row) => Math.max(max, Number(row?.sortOrder) || 0), -1) + 1;
  const created = await EventPresenterModel.create({
    tenantId,
    eventId: toId(eventId),
    profileId: normalizedProfileId,
    userId: toId(profile.userId),
    sortOrder,
    rsvpCreated: false,
    addedByUserId: toId(actorUserId)
  }).catch((error) => {
    throw mapCapacityError(error);
  });

  let rsvpCreated = false;
  try {
    rsvpCreated = await markPresenterAttending({ tenantId, eventId, profile });
  } catch (error) {
    await EventPresenterModel.delete(created._id).catch(() => {});
    throw mapCapacityError(error);
  }

  if (rsvpCreated) {
    await EventPresenterModel.update(created._id, { rsvpCreated: true }).catch(() => {});
  }
  await syncEventHostProfileId(tenantId, eventId, { actorUserId });
  return { profile, rsvpCreated };
}

/**
 * Removes a presenter. Their RSVP goes too, but only if adding them is what
 * created it — an RSVP the member made themselves is left alone.
 */
export async function removeEventPresenter({ tenantId, eventId, profileId, actorUserId = "" }) {
  const normalizedProfileId = toId(profileId);
  const row = await EventPresenterModel.findOne(tenantId, {
    eventId: toId(eventId),
    profileId: normalizedProfileId
  });
  if (!row) {
    throw createEventError(
      "That member is not a presenter for this event.",
      "EVENT_PRESENTER_NOT_FOUND",
      404
    );
  }

  await EventPresenterModel.delete(row._id);

  if (row.rsvpCreated) {
    const rsvp = await EventRsvpModel.findOne(tenantId, {
      eventId: toId(eventId),
      profileId: normalizedProfileId
    });
    if (rsvp) await EventRsvpModel.delete(rsvp._id);
  }

  await syncEventHostProfileId(tenantId, eventId, { actorUserId });
  return { removedRsvp: Boolean(row.rsvpCreated) };
}

/** Drops someone from the guest list entirely, presenter role included. */
export async function removeEventAttendee({ tenantId, eventId, profileId, actorUserId = "" }) {
  const normalizedProfileId = toId(profileId);
  const [rsvp, presenterRow] = await Promise.all([
    EventRsvpModel.findOne(tenantId, { eventId: toId(eventId), profileId: normalizedProfileId }),
    EventPresenterModel.findOne(tenantId, { eventId: toId(eventId), profileId: normalizedProfileId })
  ]);

  if (!rsvp && !presenterRow) {
    throw createEventError(
      "That member is not on this event's list.",
      "EVENT_RSVP_NOT_FOUND",
      404
    );
  }

  if (rsvp) await EventRsvpModel.delete(rsvp._id);
  if (presenterRow) {
    await EventPresenterModel.delete(presenterRow._id);
    await syncEventHostProfileId(tenantId, eventId, { actorUserId });
  }

  return { removedPresenter: Boolean(presenterRow) };
}

/**
 * Replaces the whole presenter list in the order given — what the composer
 * sends when an event is created or edited.
 */
export async function setEventPresenters({ tenantId, eventId, profileIds = [], actorUserId = "" }) {
  const desired = (Array.isArray(profileIds) ? profileIds : []).map(toId).filter(Boolean);
  const rows = await loadPresenterRows(tenantId, eventId);
  const rowByProfileId = new Map(rows.map((row) => [toId(row?.profileId), row]));

  for (const row of rows) {
    if (desired.includes(toId(row?.profileId))) continue;
    await removeEventPresenter({
      tenantId,
      eventId,
      profileId: toId(row?.profileId),
      actorUserId
    }).catch(() => {});
  }

  for (const [index, profileId] of desired.entries()) {
    const existing = rowByProfileId.get(profileId);
    if (existing) {
      if (Number(existing.sortOrder) !== index) {
        await EventPresenterModel.update(existing._id, { sortOrder: index });
      }
      continue;
    }
    const profile = await loadEligiblePresenterProfile(tenantId, profileId);
    const created = await EventPresenterModel.create({
      tenantId,
      eventId: toId(eventId),
      profileId,
      userId: toId(profile.userId),
      sortOrder: index,
      rsvpCreated: false,
      addedByUserId: toId(actorUserId)
    }).catch((error) => {
      throw mapCapacityError(error);
    });

    let rsvpCreated = false;
    try {
      rsvpCreated = await markPresenterAttending({ tenantId, eventId, profile });
    } catch (error) {
      await EventPresenterModel.delete(created._id).catch(() => {});
      throw mapCapacityError(error);
    }
    if (rsvpCreated) {
      await EventPresenterModel.update(created._id, { rsvpCreated: true }).catch(() => {});
    }
  }

  await syncEventHostProfileId(tenantId, eventId, { actorUserId });
  return loadPresenterProfiles(tenantId, eventId);
}
