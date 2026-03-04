const LEGAL_TERMS_VERSION = "2026-03-04";
const LEGAL_PRIVACY_VERSION = "2026-03-04";

function legalAgreementStorageKey(slug = "") {
  const normalizedSlug = String(slug || "").trim().toLowerCase() || "default";
  return `pondbridgeLegalAgreement:${normalizedSlug}`;
}

export function buildAcceptedLegalAgreementPayload({ acceptedAt = "" } = {}) {
  const normalizedAcceptedAt = String(acceptedAt || "").trim();
  return {
    accepted: true,
    acceptedAt: normalizedAcceptedAt || new Date().toISOString(),
    termsVersion: LEGAL_TERMS_VERSION,
    privacyVersion: LEGAL_PRIVACY_VERSION
  };
}

export function readPendingLegalAgreement(slug = "") {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(legalAgreementStorageKey(slug));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.accepted) return null;
    return buildAcceptedLegalAgreementPayload({
      acceptedAt: parsed.acceptedAt
    });
  } catch {
    return null;
  }
}

export function setPendingLegalAgreementAccepted(slug = "") {
  if (typeof window === "undefined") return;
  const payload = buildAcceptedLegalAgreementPayload();
  window.sessionStorage.setItem(legalAgreementStorageKey(slug), JSON.stringify(payload));
}

export function clearPendingLegalAgreement(slug = "") {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(legalAgreementStorageKey(slug));
}

export { LEGAL_TERMS_VERSION, LEGAL_PRIVACY_VERSION };
