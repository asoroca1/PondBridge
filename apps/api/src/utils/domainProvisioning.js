import { env } from "../config/env.js";

const RESERVED_SUBDOMAINS = new Set(["www", "app", "api", "super"]);

function stripProtocol(value = "") {
  return String(value || "").trim().replace(/^https?:\/\//i, "");
}

function stripPathAndPort(value = "") {
  const noPath = String(value || "").split("/")[0];
  return noPath.split(":")[0];
}

function sanitizeDomain(value = "") {
  return stripPathAndPort(stripProtocol(value)).trim().toLowerCase();
}

function sanitizeSlug(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function inferProtocolForDomain(domain = "") {
  const safe = sanitizeDomain(domain);
  if (!safe) return "https";
  if (safe === "localhost" || safe.endsWith(".localhost")) return "http";
  return "https";
}

export function isReservedSubdomain(slug = "") {
  return RESERVED_SUBDOMAINS.has(sanitizeSlug(slug));
}

export function defaultTenantDomain(slug = "") {
  const safeSlug = sanitizeSlug(slug);
  if (!safeSlug) return "";
  return `${safeSlug}.${String(env.APP_BASE_DOMAIN || "pondbridgealumni.com").trim().toLowerCase()}`;
}

export function resolveTenantDomain(tenant = {}) {
  const explicit = sanitizeDomain(tenant?.customDomain || "");
  if (explicit) return explicit;
  return defaultTenantDomain(tenant?.slug || "");
}

export function buildTenantUrls(tenant = {}) {
  const domain = resolveTenantDomain(tenant);
  const protocol = inferProtocolForDomain(domain);
  const appUrl = domain ? `${protocol}://${domain}` : "";
  return {
    domain,
    appUrl,
    loginUrl: appUrl ? `${appUrl}/login` : "",
    createAccountUrl: appUrl ? `${appUrl}/create-account` : "",
    directorClaimUrl: appUrl ? `${appUrl}/director-claim` : "",
    directorCreateAccountUrl: appUrl ? `${appUrl}/director-create-account` : "",
    homeUrl: appUrl ? `${appUrl}/home` : ""
  };
}
