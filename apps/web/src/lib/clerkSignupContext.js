import { isCurrentAcceptedLegalAgreement } from "./legalAgreement.js";

const TENANT_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function buildClerkSignupContext(tenantSlug = "", signupAudience = "member", signupLegalAgreement = null) {
  const normalizedSlug = String(tenantSlug || "").trim().toLowerCase();
  const normalizedAudience = String(signupAudience || "member").trim().toLowerCase();

  if (!TENANT_SLUG_PATTERN.test(normalizedSlug)) return {};

  const context = {
    tenantSlug: normalizedSlug,
    signupAudience: normalizedAudience === "director" ? "director" : "member"
  };

  if (context.signupAudience === "member" && isCurrentAcceptedLegalAgreement(signupLegalAgreement)) {
    context.signupLegalAgreement = signupLegalAgreement;
  }

  return context;
}
