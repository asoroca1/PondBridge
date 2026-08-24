import { EventRsvpModel, ProfileModel, UserModel } from "../db/models/index.js";
import { createEventError, normalizeEventRegistrationRole } from "./events.js";

function toId(value = "") {
  return String(value || "").trim();
}

/**
 * Constraint violations from the RSVP trigger read like database errors. These
 * are the two an admin can actually act on, so they get a plain answer.
 */
export function mapRegistrationPersistenceError(error) {
  const message = String(error?.message || "").toLowerCase();
  if (message.includes("registration capacity")) {
    return createEventError(
      "This event is at its seat limit. Raise the limit before adding anyone else.",
      "EVENT_CAPACITY_REACHED",
      409
    );
  }
  if (message.includes("active registered member")) {
    return createEventError(
      "Only active registered members of this network can be added to an event.",
      "EVENT_REGISTRATION_REQUIRED",
      403
    );
  }
  return error;
}

/** The member must be active, with an active account, in this tenant. */
export async function loadEligibleMemberProfile(tenantId, profileId) {
  const id = toId(profileId);
  if (!id) {
    throw createEventError("Select a member to add.", "EVENT_MEMBER_REQUIRED");
  }

  const profile = await ProfileModel.findOne(tenantId, { _id: id, status: "active" });
  if (!profile) {
    throw createEventError(
      "Select an active registered member from this network.",
      "EVENT_MEMBER_NOT_REGISTERED"
    );
  }

  const user = await UserModel.findOne(tenantId, {
    _id: toId(profile.userId),
    status: "active"
  });
  if (!user) {
    throw createEventError(
      "That member no longer has an active network account.",
      "EVENT_MEMBER_NOT_REGISTERED"
    );
  }

  return profile;
}

/**
 * Puts a member on the event in the role the director picked. Someone added by
 * a director is going — that is the whole point of adding them — so the RSVP
 * status is set to attending rather than left for the member to fill in.
 *
 * Re-adding somebody who is already registered just changes their role, which
 * is what "add them as a presenter" means for a member who already said yes.
 */
export async function upsertAdminRegistration({
  tenantId,
  eventId,
  profileId,
  registrationRole = "presenter",
  actorUserId = ""
}) {
  const profile = await loadEligibleMemberProfile(tenantId, profileId);
  const role = normalizeEventRegistrationRole(registrationRole, "presenter");
  const normalizedProfileId = toId(profile?._id || profile?.id);

  const existing = await EventRsvpModel.findOne(tenantId, {
    eventId: toId(eventId),
    profileId: normalizedProfileId
  });

  const patch = {
    status: "attending",
    registrationRole: role,
    respondedAt: new Date()
  };

  try {
    const saved = existing
      ? await EventRsvpModel.update(existing._id, patch)
      : await EventRsvpModel.create({
          tenantId,
          eventId: toId(eventId),
          profileId: normalizedProfileId,
          userId: toId(profile.userId),
          ...patch
        });
    return { profile, rsvp: saved, role, created: !existing, actorUserId };
  } catch (error) {
    throw mapRegistrationPersistenceError(error);
  }
}

/** Moves someone between presenting and attending without touching their RSVP. */
export async function setRegistrationRole({
  tenantId,
  eventId,
  profileId,
  registrationRole,
  actorUserId = ""
}) {
  const role = normalizeEventRegistrationRole(registrationRole, "attendee");
  const existing = await EventRsvpModel.findOne(tenantId, {
    eventId: toId(eventId),
    profileId: toId(profileId)
  });
  if (!existing) {
    throw createEventError(
      "That member is not registered for this event.",
      "EVENT_REGISTRATION_NOT_FOUND",
      404
    );
  }

  try {
    const saved = await EventRsvpModel.update(existing._id, { registrationRole: role });
    return { rsvp: saved, role, actorUserId };
  } catch (error) {
    throw mapRegistrationPersistenceError(error);
  }
}

/** Takes a member off the event entirely. */
export async function removeRegistration({ tenantId, eventId, profileId }) {
  const existing = await EventRsvpModel.findOne(tenantId, {
    eventId: toId(eventId),
    profileId: toId(profileId)
  });
  if (!existing) {
    throw createEventError(
      "That member is not registered for this event.",
      "EVENT_REGISTRATION_NOT_FOUND",
      404
    );
  }

  await EventRsvpModel.delete(existing._id);
  return { removedRole: normalizeEventRegistrationRole(existing?.registrationRole || "") };
}
