import { isMemberEligibilityComplete } from "./memberEligibility.js";

export function recoveredRequestRequiresConsent(request = {}) {
  const socials = request?.profilePayload?.socials || {};
  return Boolean(request?.recoveredClerkUserId && !isMemberEligibilityComplete(socials.legalAgreement));
}

// HTTP normalizers strip reserved provenance. Only a server-created row can
// restore it, and consent-only retries must retain the verified signup names.
export function preserveSignupRecoveryConsent(existingRequest, profilePayload, body) {
  const recovery = existingRequest?.profilePayload?.socials?.signupRecovery;
  if (!existingRequest?.recoveredClerkUserId || recovery?.clerkUserId !== existingRequest.recoveredClerkUserId) return profilePayload;
  const existing = existingRequest.profilePayload || {};
  const preserved = { ...profilePayload };
  const aliases = {
    firstName: ["firstName"], lastName: ["lastName"], phones: ["phones", "phone"],
    cityState: ["cityState", "city", "state", "country"], roleAtCamp: ["roles", "roleAtCamp"],
    highSchool: ["highSchool"], colleges: ["colleges", "education"], collegeYears: ["collegeYears", "education"],
    currentJobs: ["currentJobs"], pastJobs: ["pastJobs"], industry: ["industry"], bio: ["bio"],
    avatarUrl: ["uploads", "avatarUrl", "photoUrl"]
  };
  if (body) for (const [field, keys] of Object.entries(aliases)) {
    if (!keys.some((key) => Object.hasOwn(body, key))) {
      preserved[field] = existing[field] ?? existingRequest[field] ?? profilePayload[field];
    }
  }
  const submittedSocials = body && !["socials", "social", "roles", "roleAtCamp", "nickname", "campNickname", "camperYears", "collegeMajors", "education"].some((key) => Object.hasOwn(body, key))
    ? (profilePayload.socials?.legalAgreement ? { legalAgreement: profilePayload.socials.legalAgreement } : {})
    : profilePayload.socials || {};
  const socials = { ...(existing.socials || {}), ...submittedSocials };
  return { ...preserved, socials: { ...socials,
    signupRecovery: { ...recovery, requiresConsent: !isMemberEligibilityComplete(socials.legalAgreement) }
  } };
}
