const LEGAL_TERMS_VERSION = "2026-03-04";
const LEGAL_PRIVACY_VERSION = "2026-03-04";
const MINIMUM_MEMBER_AGE = 14;
const AGE_POLICY_VERSION = "2026-07-14";
const LEGAL_AGREEMENT_VERSION = 1;

function legalAgreementStorageKey(slug = "") {
  const normalizedSlug = String(slug || "").trim().toLowerCase() || "default";
  return `pondbridgeLegalAgreement:${normalizedSlug}`;
}

export function buildAcceptedLegalAgreementPayload({ acceptedAt = "", ageEligibilityConfirmed = false } = {}) {
  const normalizedAcceptedAt = String(acceptedAt || "").trim();
  return {
    version: LEGAL_AGREEMENT_VERSION,
    accepted: true,
    acceptedAt: normalizedAcceptedAt || new Date().toISOString(),
    termsVersion: LEGAL_TERMS_VERSION,
    privacyVersion: LEGAL_PRIVACY_VERSION,
    ageEligibilityConfirmed: Boolean(ageEligibilityConfirmed),
    minimumAge: MINIMUM_MEMBER_AGE,
    agePolicyVersion: AGE_POLICY_VERSION
  };
}

function isValidAcceptedAt(value) {
  const normalized = String(value || "").trim();
  const match = normalized.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/);
  const parsed = Date.parse(normalized);
  return Boolean(match) && Number.isFinite(parsed) &&
    `${match[1]}.${String(match[2] || "").padEnd(3, "0")}Z` === new Date(parsed).toISOString();
}

export function isCurrentAcceptedLegalAgreement(payload) {
  return Boolean(
    payload &&
    typeof payload === "object" &&
    payload.version === LEGAL_AGREEMENT_VERSION &&
    payload.accepted === true &&
    isValidAcceptedAt(payload.acceptedAt) &&
    payload.termsVersion === LEGAL_TERMS_VERSION &&
    payload.privacyVersion === LEGAL_PRIVACY_VERSION &&
    payload.ageEligibilityConfirmed === true &&
    payload.minimumAge === MINIMUM_MEMBER_AGE &&
    payload.agePolicyVersion === AGE_POLICY_VERSION
  );
}

export function readPendingLegalAgreement(slug = "") {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(legalAgreementStorageKey(slug));
    if (!raw) return null;
    let parsed = JSON.parse(raw);
    // The previous storage format had the same explicit policy tuple and age
    // confirmation, but no schema version. Preserve that evidence unchanged.
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && parsed.version === undefined) {
      parsed = { ...parsed, version: LEGAL_AGREEMENT_VERSION };
    }
    if (!isCurrentAcceptedLegalAgreement(parsed)) return null;
    return {
      version: parsed.version,
      accepted: parsed.accepted,
      acceptedAt: String(parsed.acceptedAt).trim(),
      termsVersion: parsed.termsVersion,
      privacyVersion: parsed.privacyVersion,
      ageEligibilityConfirmed: parsed.ageEligibilityConfirmed,
      minimumAge: parsed.minimumAge,
      agePolicyVersion: parsed.agePolicyVersion
    };
  } catch {
    return null;
  }
}

export function setPendingLegalAgreementAccepted(slug = "", { ageEligibilityConfirmed = false } = {}) {
  if (typeof window === "undefined" || !ageEligibilityConfirmed) return null;
  const existing = readPendingLegalAgreement(slug);
  const payload = buildAcceptedLegalAgreementPayload({
    acceptedAt: existing?.acceptedAt,
    ageEligibilityConfirmed: true
  });
  window.sessionStorage.setItem(legalAgreementStorageKey(slug), JSON.stringify(payload));
  return payload;
}

export function clearPendingLegalAgreement(slug = "") {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(legalAgreementStorageKey(slug));
}

export {
  AGE_POLICY_VERSION,
  LEGAL_AGREEMENT_VERSION,
  LEGAL_TERMS_VERSION,
  LEGAL_PRIVACY_VERSION,
  MINIMUM_MEMBER_AGE
};
