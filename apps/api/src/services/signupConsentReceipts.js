import {
  AGE_POLICY_VERSION,
  DEFAULT_MEMBER_PRIVACY_VERSION,
  DEFAULT_MEMBER_TERMS_VERSION,
  MINIMUM_MEMBER_AGE
} from "./memberEligibility.js";

export const SIGNUP_CONSENT_RECEIPT_VERSION = 1;
export const SIGNUP_CONSENT_POLICY = Object.freeze({
  version: SIGNUP_CONSENT_RECEIPT_VERSION,
  termsVersion: DEFAULT_MEMBER_TERMS_VERSION,
  privacyVersion: DEFAULT_MEMBER_PRIVACY_VERSION,
  agePolicyVersion: AGE_POLICY_VERSION,
  minimumAge: MINIMUM_MEMBER_AGE
});
const FIELDS = new Set(["version", "accepted", "ageEligibilityConfirmed", "termsVersion", "privacyVersion", "minimumAge", "agePolicyVersion", "acceptedAt"]);
const POLICY_EFFECTIVE_AT = Date.parse(`${AGE_POLICY_VERSION}T00:00:00.000Z`);
const FUTURE_CLOCK_SKEW_MS = 5 * 60_000;

// This is the verified user's self-attestation, never proof of age or authority.
// Only call after reading the actual User via Clerk's Backend API and validating
// primary-email ownership and tenant intent. A client timestamp stays a claim.
export function validateSignupLegalAgreement(value, { now = Date.now() } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !FIELDS.has(key))) return null;
  if (value.version !== SIGNUP_CONSENT_RECEIPT_VERSION || value.accepted !== true || value.ageEligibilityConfirmed !== true ||
      value.termsVersion !== DEFAULT_MEMBER_TERMS_VERSION || value.privacyVersion !== DEFAULT_MEMBER_PRIVACY_VERSION ||
      value.agePolicyVersion !== AGE_POLICY_VERSION || value.minimumAge !== MINIMUM_MEMBER_AGE) return null;
  if (typeof value.acceptedAt !== "string") return null;
  const match = value.acceptedAt.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/);
  if (!match) return null;
  const claimedAt = Date.parse(value.acceptedAt);
  if (!Number.isFinite(claimedAt) || !Number.isFinite(Number(now)) || claimedAt < POLICY_EFFECTIVE_AT || claimedAt > Number(now) + FUTURE_CLOCK_SKEW_MS) return null;
  const canonicalAt = new Date(claimedAt).toISOString();
  if (`${match[1]}.${String(match[2] || "").padEnd(3, "0")}Z` !== canonicalAt) return null;
  return {
    version: SIGNUP_CONSENT_RECEIPT_VERSION,
    accepted: true,
    ageEligibilityConfirmed: true,
    termsVersion: DEFAULT_MEMBER_TERMS_VERSION,
    privacyVersion: DEFAULT_MEMBER_PRIVACY_VERSION,
    minimumAge: MINIMUM_MEMBER_AGE,
    agePolicyVersion: AGE_POLICY_VERSION,
    acceptedAt: canonicalAt
  };
}
