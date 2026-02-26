import { ProfileModel, UserModel } from "../db/models/index.js";

function normalizeEmail(value = "") {
  return String(value || "").trim().toLowerCase();
}

function normalizeName(value = "") {
  return String(value || "").trim();
}

function deriveClaimNameParts(identity = {}) {
  const claims = identity?.claims || {};
  const firstName =
    normalizeName(claims.first_name || claims.given_name || claims.firstName || identity.firstName || "") || "";
  const lastName =
    normalizeName(claims.last_name || claims.family_name || claims.lastName || identity.lastName || "") || "";
  return { firstName, lastName };
}

function deriveNameFromEmail(email = "") {
  const local = normalizeEmail(email).split("@")[0] || "";
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  const cap = (word = "") => word.slice(0, 1).toUpperCase() + word.slice(1);
  return {
    firstName: cap(parts[0] || ""),
    lastName: cap(parts.slice(1).join(" "))
  };
}

function deriveNameParts(identity = {}) {
  const { firstName, lastName } = deriveClaimNameParts(identity);

  if (firstName || lastName) return { firstName: firstName || "Member", lastName: lastName || "" };

  const email = normalizeEmail(identity?.email || "");
  if (!email) return { firstName: "Member", lastName: "" };
  const local = email.split("@")[0] || "member";
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "Member", lastName: "" };
  const first = parts[0] || "Member";
  const last = parts.slice(1).join(" ");
  const cap = (word = "") => word.slice(0, 1).toUpperCase() + word.slice(1);
  return { firstName: cap(first), lastName: cap(last) };
}

async function syncProfileIdentityFields({ tenantId, profile, identity = {}, user = {} }) {
  if (!tenantId || !profile?._id) return profile;

  const explicitNames = deriveClaimNameParts(identity);
  const identityEmail = normalizeEmail(identity?.email || user?.email || "");
  const emailDerivedNames = deriveNameFromEmail(identityEmail);
  const currentFirstName = normalizeName(profile.firstName || "");
  const currentLastName = normalizeName(profile.lastName || "");
  const currentFirstIsFallback =
    !currentFirstName ||
    currentFirstName.toLowerCase() === "member" ||
    (emailDerivedNames.firstName &&
      currentFirstName.toLowerCase() === emailDerivedNames.firstName.toLowerCase() &&
      (!currentLastName ||
        currentLastName.toLowerCase() === String(emailDerivedNames.lastName || "").toLowerCase()));
  const currentLastIsFallback = !currentLastName || currentLastName.toLowerCase() === "member";

  const patch = {};

  if (explicitNames.firstName && currentFirstIsFallback && currentFirstName !== explicitNames.firstName) {
    patch.firstName = explicitNames.firstName;
  }
  if (explicitNames.lastName && (currentLastIsFallback || currentFirstIsFallback) && currentLastName !== explicitNames.lastName) {
    patch.lastName = explicitNames.lastName;
  }

  if (identityEmail && !(Array.isArray(profile.emails) && profile.emails.some(Boolean))) {
    patch.emails = [identityEmail];
  }

  if (Object.keys(patch).length === 0) return profile;
  return ProfileModel.update(profile._id, patch);
}

export function profileCompletionPercent(profile = {}) {
  const checks = [
    Boolean(profile?.firstName),
    Boolean(profile?.lastName),
    Array.isArray(profile?.emails) && profile.emails.some(Boolean),
    Array.isArray(profile?.phones) && profile.phones.some(Boolean),
    Boolean(profile?.cityState),
    Boolean(profile?.roleAtCamp),
    Boolean(profile?.highSchool),
    Array.isArray(profile?.colleges) && profile.colleges.some(Boolean),
    Array.isArray(profile?.currentJobs) && profile.currentJobs.length > 0,
    Boolean(profile?.bio)
  ];

  const filled = checks.filter(Boolean).length;
  return Math.round((filled / checks.length) * 100);
}

export function isProfileComplete(profile = {}, minPercent = 100) {
  return profileCompletionPercent(profile) >= Math.max(0, Math.min(100, Number(minPercent || 100)));
}

export async function ensureProfileForUser({ tenantId, user, identity = {} }) {
  if (!tenantId || !user?._id) return null;
  const direct = user.profileId
    ? await ProfileModel.findOne(tenantId, { _id: user.profileId })
    : null;
  if (direct) {
    return syncProfileIdentityFields({ tenantId, profile: direct, identity, user });
  }

  const existing = await ProfileModel.findByUserId(tenantId, user._id);
  if (existing) {
    if (!user.profileId || String(user.profileId) !== String(existing._id)) {
      await UserModel.update(user._id, { profileId: existing._id });
      user.profileId = existing._id;
    }
    return syncProfileIdentityFields({ tenantId, profile: existing, identity, user });
  }

  const names = deriveNameParts(identity);
  const email = normalizeEmail(identity?.email || user.email || "");
  const profile = await ProfileModel.create({
    tenantId,
    userId: user._id,
    firstName: names.firstName || "Member",
    lastName: names.lastName || "",
    emails: email ? [email] : [],
    phones: [],
    cityState: "",
    roleAtCamp: "",
    highSchool: "",
    colleges: [],
    collegeYears: [],
    currentJobs: [],
    pastJobs: [],
    industry: "",
    socials: {},
    avatarUrl: "",
    bio: "",
    status: "active",
    flaggedReason: ""
  });

  await UserModel.update(user._id, { profileId: profile._id });
  user.profileId = profile._id;
  return profile;
}
