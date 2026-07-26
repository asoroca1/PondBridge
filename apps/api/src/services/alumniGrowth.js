import { AlumniContactModel } from "../db/models/index.js";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTACT_STATUSES = new Set(["active", "do_not_contact", "archived"]);
export const GROWTH_EMAIL_SEGMENTS = new Set([
  "new_30",
  "inactive_30",
  "inactive_60",
  "inactive_90",
  "profile_incomplete"
]);

function cleanText(value = "", max = 160) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function normalizeEmail(value = "") {
  return String(value || "").trim().toLowerCase();
}

function normalizeLabels(value = [], { maxItems = 12, maxLength = 48 } = {}) {
  const source = Array.isArray(value)
    ? value
    : String(value || "").split(/[,\n]+/g);
  const seen = new Set();
  const output = [];
  for (const item of source) {
    const label = cleanText(item, maxLength);
    const key = label.toLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    output.push(label);
    if (output.length >= maxItems) break;
  }
  return output;
}

function asDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function iso(value) {
  return asDate(value)?.toISOString() || null;
}

function mostRecentDate(values = []) {
  return values
    .map(asDate)
    .filter(Boolean)
    .sort((a, b) => b.getTime() - a.getTime())[0] || null;
}

function profileEmail(profile = {}) {
  return normalizeEmail(Array.isArray(profile?.emails) ? profile.emails[0] : "");
}

function profileCompletionPercent(profile = {}) {
  const checks = [
    profile.firstName,
    profile.lastName,
    profileEmail(profile),
    profile.avatarUrl,
    profile.cityState,
    profile.industry,
    profile.roleAtCamp
  ];
  const complete = checks.filter((value) => String(value || "").trim()).length;
  return Math.round((complete / checks.length) * 100);
}

export function normalizeAlumniContactInput(input = {}) {
  const email = normalizeEmail(input?.email);
  if (!EMAIL_REGEX.test(email)) return null;
  const requestedStatus = String(input?.contactStatus || input?.status || "active")
    .trim()
    .toLowerCase();
  return {
    email,
    firstName: cleanText(input?.firstName || input?.first_name, 80),
    lastName: cleanText(input?.lastName || input?.last_name, 80),
    source: cleanText(input?.source || "director_entry", 48).toLowerCase() || "director_entry",
    contactStatus: CONTACT_STATUSES.has(requestedStatus) ? requestedStatus : "active",
    tags: normalizeLabels(input?.tags),
    campYears: normalizeLabels(input?.campYears || input?.camp_years, {
      maxItems: 30,
      maxLength: 12
    }),
    notes: cleanText(input?.notes, 800)
  };
}

export function filterHeldAlumniRecipients(recipients = [], contacts = []) {
  const heldSet = new Set(
    contacts
      .filter((contact) => String(contact?.contactStatus || "") === "do_not_contact")
      .map((contact) => normalizeEmail(contact?.email))
      .filter(Boolean)
  );
  const normalizedRecipients = [...new Set(
    recipients.map((email) => normalizeEmail(email)).filter((email) => EMAIL_REGEX.test(email))
  )];
  return {
    heldRecipients: normalizedRecipients.filter((email) => heldSet.has(email)),
    deliverableRecipients: normalizedRecipients.filter((email) => !heldSet.has(email))
  };
}

export function hasRequiredEmailTargetingSelection(targeting = {}) {
  const mode = String(targeting?.mode || "all").trim().toLowerCase();
  if (mode === "role") return Array.isArray(targeting.roles) && targeting.roles.length > 0;
  if (mode === "year") return Array.isArray(targeting.years) && targeting.years.length > 0;
  if (mode === "custom") return Array.isArray(targeting.profileIds) && targeting.profileIds.length > 0;
  if (mode === "segment") return GROWTH_EMAIL_SEGMENTS.has(String(targeting.segment || ""));
  return mode === "all";
}

export function isAlumniGrowthStorageUnavailable(error) {
  const code = String(error?.code || "").trim().toUpperCase();
  const message = String(error?.message || "").toLowerCase();
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    (message.includes("alumni_contacts") &&
      (message.includes("does not exist") || message.includes("schema cache"))
    )
  );
}

export async function getAlumniGrowthStorageStatus(tenantId) {
  try {
    await AlumniContactModel.count(String(tenantId || ""), {});
    return { available: true };
  } catch (error) {
    if (isAlumniGrowthStorageUnavailable(error)) {
      return { available: false, reason: "schema_required" };
    }
    return { available: false, reason: "status_unavailable" };
  }
}

export async function upsertAlumniContact({
  tenantId,
  contact,
  actorUserId = null,
  invitationCreated = false,
  invitedAt = new Date()
}) {
  const normalized = normalizeAlumniContactInput(contact);
  if (!normalized) return { status: "invalid", contact: null };
  const existing = await AlumniContactModel.findOne(String(tenantId || ""), {
    email: normalized.email
  });
  const invitePatch = invitationCreated
    ? {
        lastInvitedAt: invitedAt,
        inviteCount: Math.max(0, Number(existing?.inviteCount || 0)) + 1
      }
    : {};

  if (existing) {
    const updated = await AlumniContactModel.update(existing._id, {
      firstName: normalized.firstName || existing.firstName || "",
      lastName: normalized.lastName || existing.lastName || "",
      source: existing.source || normalized.source,
      contactStatus: existing.contactStatus || normalized.contactStatus,
      tags: normalizeLabels([...(existing.tags || []), ...normalized.tags]),
      campYears: normalizeLabels([...(existing.campYears || []), ...normalized.campYears], {
        maxItems: 30,
        maxLength: 12
      }),
      notes: normalized.notes || existing.notes || "",
      ...invitePatch,
      updatedAt: new Date()
    });
    return { status: "updated", contact: updated };
  }

  const created = await AlumniContactModel.create({
    tenantId: String(tenantId || ""),
    ...normalized,
    createdByUserId: actorUserId || null,
    lastInvitedAt: invitationCreated ? invitedAt : null,
    inviteCount: invitationCreated ? 1 : 0
  });
  return { status: "created", contact: created };
}

export async function trackInvitedAlumniContact(options = {}) {
  try {
    return await upsertAlumniContact({ ...options, invitationCreated: true });
  } catch (error) {
    if (isAlumniGrowthStorageUnavailable(error)) {
      return { status: "storage_unavailable", contact: null };
    }
    throw error;
  }
}

function membersByEmail({ users = [], profiles = [] }) {
  const usersById = new Map(users.map((user) => [String(user?._id || user?.id || ""), user]));
  const profilesByUserId = new Map(
    profiles.map((profile) => [String(profile?.userId || ""), profile])
  );
  const map = new Map();
  for (const user of users) {
    const userId = String(user?._id || user?.id || "");
    const profile = profilesByUserId.get(userId) || null;
    const email = normalizeEmail(user?.email || profileEmail(profile));
    if (!email) continue;
    map.set(email, { user, profile });
  }
  for (const profile of profiles) {
    const email = profileEmail(profile);
    if (!email || map.has(email)) continue;
    map.set(email, { user: usersById.get(String(profile?.userId || "")) || null, profile });
  }
  return map;
}

export function resolveGrowthEmailSegment({
  segment = "",
  profiles = [],
  users = [],
  analyticsEvents = [],
  now = new Date()
}) {
  const safeSegment = GROWTH_EMAIL_SEGMENTS.has(String(segment || "").trim().toLowerCase())
    ? String(segment || "").trim().toLowerCase()
    : "";
  if (!safeSegment) return [];
  const usersById = new Map(users.map((user) => [String(user?._id || user?.id || ""), user]));
  const lastEventByUserId = new Map();
  for (const event of analyticsEvents) {
    const userId = String(event?.userId || "").trim();
    const eventAt = asDate(event?.createdAt);
    const current = lastEventByUserId.get(userId);
    if (userId && eventAt && (!current || eventAt > current)) {
      lastEventByUserId.set(userId, eventAt);
    }
  }
  const nowMs = new Date(now).getTime();

  return profiles.filter((profile) => {
    const user = usersById.get(String(profile?.userId || "")) || null;
    if (safeSegment === "profile_incomplete") {
      return profileCompletionPercent(profile) < 75;
    }
    if (safeSegment === "new_30") {
      const joinedAt = asDate(profile?.createdAt || user?.createdAt);
      return Boolean(joinedAt && nowMs - joinedAt.getTime() <= 30 * 24 * 60 * 60 * 1000);
    }
    const days = Number(safeSegment.split("_")[1] || 30);
    const cutoff = nowMs - days * 24 * 60 * 60 * 1000;
    const accountCreatedAt = asDate(user?.createdAt || profile?.createdAt);
    const lastActiveAt = mostRecentDate([
      user?.lastLoginAt,
      lastEventByUserId.get(String(profile?.userId || ""))
    ]);
    return Boolean(
      accountCreatedAt &&
      accountCreatedAt.getTime() < cutoff &&
      (!lastActiveAt || lastActiveAt.getTime() < cutoff)
    );
  });
}

export function buildAlumniGrowthSnapshot({
  contacts = [],
  invites = [],
  users = [],
  profiles = [],
  analyticsEvents = [],
  broadcasts = [],
  now = new Date()
} = {}) {
  const nowDate = new Date(now);
  const nowMs = nowDate.getTime();
  const memberMap = membersByEmail({ users, profiles });
  const joinedEmails = new Set(memberMap.keys());
  const contactMap = new Map();
  for (const contact of contacts) {
    const email = normalizeEmail(contact?.email);
    if (email) contactMap.set(email, contact);
  }

  const invitesByEmail = new Map();
  for (const invite of invites) {
    const email = normalizeEmail(invite?.email);
    if (!email || String(invite?.roleToAssign || "user") !== "user") continue;
    const entries = invitesByEmail.get(email) || [];
    entries.push(invite);
    invitesByEmail.set(email, entries);
  }
  for (const entries of invitesByEmail.values()) {
    entries.sort((a, b) => new Date(b?.createdAt || 0) - new Date(a?.createdAt || 0));
  }

  const knownEmails = new Set([
    ...joinedEmails,
    ...contactMap.keys(),
    ...invitesByEmail.keys()
  ]);
  const invitedEmails = new Set(invitesByEmail.keys());
  const convertedEmails = new Set(
    [...invitedEmails].filter((email) => joinedEmails.has(email))
  );
  const pendingInviteEmails = new Set();
  const expiredInviteEmails = new Set();
  for (const [email, entries] of invitesByEmail.entries()) {
    if (joinedEmails.has(email)) continue;
    const latest = entries[0] || null;
    if (latest && !latest.usedAt && asDate(latest.expiresAt)?.getTime() > nowMs) {
      pendingInviteEmails.add(email);
    } else if (latest && !latest.usedAt) {
      expiredInviteEmails.add(email);
    }
  }

  const neverInvitedEmails = new Set(
    [...contactMap.keys()].filter((email) => !joinedEmails.has(email) && !invitedEmails.has(email))
  );
  const userActivityById = new Map();
  for (const user of users) {
    const userId = String(user?._id || user?.id || "");
    const last = mostRecentDate([user?.lastLoginAt]);
    if (userId && last) userActivityById.set(userId, last);
  }
  for (const event of analyticsEvents) {
    const userId = String(event?.userId || "");
    const eventAt = asDate(event?.createdAt);
    if (!userId || !eventAt) continue;
    const current = userActivityById.get(userId);
    if (!current || eventAt > current) userActivityById.set(userId, eventAt);
  }

  const active7dEmails = new Set();
  for (const [email, member] of memberMap.entries()) {
    const userId = String(member?.user?._id || member?.user?.id || member?.profile?.userId || "");
    const last = userActivityById.get(userId);
    if (last && nowMs - last.getTime() <= 7 * 24 * 60 * 60 * 1000) active7dEmails.add(email);
  }
  const inactive30Profiles = resolveGrowthEmailSegment({
    segment: "inactive_30",
    profiles,
    users,
    analyticsEvents,
    now: nowDate
  });
  const new30Profiles = resolveGrowthEmailSegment({
    segment: "new_30",
    profiles,
    users,
    now: nowDate
  });
  const incompleteProfiles = resolveGrowthEmailSegment({
    segment: "profile_incomplete",
    profiles,
    users,
    now: nowDate
  });

  const lifecycleContacts = [...knownEmails]
    .map((email) => {
      const contact = contactMap.get(email) || {};
      const member = memberMap.get(email) || {};
      const latestInvite = invitesByEmail.get(email)?.[0] || null;
      let lifecycle = "prospect";
      if (contact?.contactStatus === "do_not_contact") lifecycle = "do_not_contact";
      else if (joinedEmails.has(email)) lifecycle = "joined";
      else if (pendingInviteEmails.has(email)) lifecycle = "invited";
      else if (expiredInviteEmails.has(email)) lifecycle = "invite_expired";
      return {
        id: String(contact?._id || contact?.id || ""),
        email,
        firstName: String(contact?.firstName || member?.profile?.firstName || ""),
        lastName: String(contact?.lastName || member?.profile?.lastName || ""),
        lifecycle,
        contactStatus: String(contact?.contactStatus || "active"),
        source: String(contact?.source || (latestInvite ? "invitation" : "director_entry")),
        tags: Array.isArray(contact?.tags) ? contact.tags : [],
        campYears: Array.isArray(contact?.campYears) ? contact.campYears : [],
        notes: String(contact?.notes || ""),
        inviteCount: Math.max(Number(contact?.inviteCount || 0), invitesByEmail.get(email)?.length || 0),
        lastInvitedAt: iso(contact?.lastInvitedAt || latestInvite?.createdAt),
        joinedAt: iso(member?.profile?.createdAt || member?.user?.createdAt),
        lastActiveAt: iso(
          userActivityById.get(String(member?.user?._id || member?.user?.id || member?.profile?.userId || ""))
        )
      };
    })
    .sort((a, b) => {
      const order = { prospect: 0, invite_expired: 1, invited: 2, joined: 3, do_not_contact: 4 };
      return (order[a.lifecycle] ?? 9) - (order[b.lifecycle] ?? 9) || a.email.localeCompare(b.email);
    });

  const sentBroadcasts = broadcasts.filter((item) => item?.status === "sent");
  const sentRecipients = sentBroadcasts.reduce(
    (sum, item) => sum + Math.max(0, Number(item?.recipientCount || 0)),
    0
  );
  const delivered = sentBroadcasts.reduce(
    (sum, item) => sum + Math.max(0, Number(item?.stats?.webhook?.delivered || 0)),
    0
  );
  const conversionRate = invitedEmails.size
    ? Math.round((convertedEmails.size / invitedEmails.size) * 100)
    : 0;
  const weeklyActiveRate = joinedEmails.size
    ? Math.round((active7dEmails.size / joinedEmails.size) * 100)
    : 0;

  return {
    generatedAt: nowDate.toISOString(),
    metrics: {
      knownAlumni: knownEmails.size,
      joinedMembers: joinedEmails.size,
      notJoined: Math.max(0, knownEmails.size - joinedEmails.size),
      neverInvited: neverInvitedEmails.size,
      pendingInvites: pendingInviteEmails.size,
      expiredInvites: expiredInviteEmails.size,
      convertedFromInvite: convertedEmails.size,
      inviteConversionRate: conversionRate,
      activeMembers7d: active7dEmails.size,
      weeklyActiveRate,
      inactiveMembers30d: inactive30Profiles.length,
      newMembers30d: new30Profiles.length,
      incompleteProfiles: incompleteProfiles.length
    },
    funnel: [
      { key: "known", label: "Known alumni", count: knownEmails.size },
      { key: "invited", label: "Invited", count: invitedEmails.size },
      { key: "joined", label: "Joined", count: joinedEmails.size },
      { key: "active", label: "Active this week", count: active7dEmails.size }
    ],
    opportunities: [
      {
        key: "invite_prospects",
        label: "Invite alumni not contacted yet",
        count: neverInvitedEmails.size,
        href: "/admin/invites"
      },
      {
        key: "follow_up_expired",
        label: "Follow up on expired invitations",
        count: expiredInviteEmails.size,
        href: "/admin/invites"
      },
      {
        key: "reengage_inactive",
        label: "Re-engage inactive members",
        count: inactive30Profiles.length,
        href: "/admin/email/compose?audience=inactive_30"
      },
      {
        key: "complete_profiles",
        label: "Help members complete profiles",
        count: incompleteProfiles.length,
        href: "/admin/email/compose?audience=profile_incomplete"
      },
      {
        key: "welcome_new",
        label: "Welcome new members",
        count: new30Profiles.length,
        href: "/admin/email/compose?audience=new_30"
      }
    ],
    marketing: {
      campaignsSent: sentBroadcasts.length,
      recipientDeliveriesRequested: sentRecipients,
      delivered,
      deliveryRate: sentRecipients ? Math.round((delivered / sentRecipients) * 100) : 0
    },
    contacts: lifecycleContacts
  };
}
