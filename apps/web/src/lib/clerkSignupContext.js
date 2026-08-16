const TENANT_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function buildClerkSignupContext(tenantSlug = "", signupAudience = "member") {
  const normalizedSlug = String(tenantSlug || "").trim().toLowerCase();
  const normalizedAudience = String(signupAudience || "member").trim().toLowerCase();

  if (!TENANT_SLUG_PATTERN.test(normalizedSlug)) return {};

  return {
    tenantSlug: normalizedSlug,
    signupAudience: normalizedAudience === "director" ? "director" : "member"
  };
}
