export const DEFAULT_MEMBER_TERMS_VERSION = "2026-03-04";
export const DEFAULT_MEMBER_PRIVACY_VERSION = "2026-03-04";
export const MINIMUM_MEMBER_AGE = 14;
export const AGE_POLICY_VERSION = "2026-07-14";

function normalizeBoolean(value = false) {
  if (typeof value === "boolean") return value;
  const normalized = String(value || "").trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
}

export function normalizeMemberLegalAgreement(body = {}, { now = () => new Date() } = {}) {
  const provided = body && typeof body === "object" ? body : {};
  const nested =
    provided.legalAgreement && typeof provided.legalAgreement === "object"
      ? provided.legalAgreement
      : {};
  const accepted = normalizeBoolean(
    provided.legalAgreementAccepted ??
      provided.acceptedLegal ??
      provided.acceptTerms ??
      provided.termsAccepted ??
      nested.accepted
  );
  const rawAcceptedAt = String(nested.acceptedAt || provided.legalAgreementAcceptedAt || "").trim();
  const acceptedAtDate = rawAcceptedAt ? new Date(rawAcceptedAt) : now();
  const acceptedAt = Number.isNaN(acceptedAtDate.getTime())
    ? now().toISOString()
    : acceptedAtDate.toISOString();
  const termsVersion =
    String(
      nested.termsVersion || provided.termsVersion || DEFAULT_MEMBER_TERMS_VERSION
    ).trim() || DEFAULT_MEMBER_TERMS_VERSION;
  const privacyVersion =
    String(
      nested.privacyVersion || provided.privacyVersion || DEFAULT_MEMBER_PRIVACY_VERSION
    ).trim() || DEFAULT_MEMBER_PRIVACY_VERSION;
  const ageEligibilityConfirmed = normalizeBoolean(
    nested.ageEligibilityConfirmed ?? provided.ageEligibilityConfirmed
  );

  return {
    accepted,
    acceptedAt,
    termsVersion,
    privacyVersion,
    ageEligibilityConfirmed,
    minimumAge: MINIMUM_MEMBER_AGE,
    agePolicyVersion: AGE_POLICY_VERSION
  };
}

export function isMemberEligibilityComplete(agreement = {}) {
  return Boolean(agreement?.accepted && agreement?.ageEligibilityConfirmed);
}
