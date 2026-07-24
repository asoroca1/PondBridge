const DEFAULT_APP_BASE_DOMAIN = "pondbridgealumni.com";
const RESERVED_SUBDOMAINS = new Set(["www", "app", "api", "super"]);
const DEPLOYMENT_PREVIEW_SUFFIXES = [".pages.dev"];

function browserHost() {
  if (typeof window === "undefined") return "";
  return window.location.hostname || "";
}

export function normalizeHost(host = "") {
  return String(host || "").trim().toLowerCase().split(":")[0];
}

export function getAppBaseDomain() {
  return normalizeHost(import.meta.env.VITE_APP_BASE_DOMAIN || DEFAULT_APP_BASE_DOMAIN);
}

function isIpv4Host(host = "") {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);
}

export function isDeploymentPreviewHost(host = browserHost()) {
  const safeHost = normalizeHost(host);
  return DEPLOYMENT_PREVIEW_SUFFIXES.some(
    (suffix) => safeHost === suffix.slice(1) || safeHost.endsWith(suffix)
  );
}

export function inferCampSlugFromHost(host = browserHost()) {
  const safeHost = normalizeHost(host);
  if (!safeHost) return "";
  if (safeHost.endsWith(".localhost")) return safeHost.replace(".localhost", "");

  const baseDomain = getAppBaseDomain();
  if (baseDomain && safeHost.endsWith(`.${baseDomain}`)) {
    const prefix = safeHost.slice(0, -1 * (baseDomain.length + 1));
    const candidate = normalizeHost(prefix.split(".")[0] || "");
    if (candidate && !RESERVED_SUBDOMAINS.has(candidate)) return candidate;
  }

  return "";
}

export function isPotentialCustomTenantHost(host = browserHost()) {
  const safeHost = normalizeHost(host);
  if (
    !safeHost ||
    safeHost === "localhost" ||
    safeHost.endsWith(".localhost") ||
    isIpv4Host(safeHost) ||
    isDeploymentPreviewHost(safeHost)
  ) {
    return false;
  }

  const baseDomain = getAppBaseDomain();
  if (safeHost === baseDomain) return false;
  if (baseDomain && safeHost.endsWith(`.${baseDomain}`)) {
    const prefix = safeHost.slice(0, -1 * (baseDomain.length + 1));
    const firstLabel = normalizeHost(prefix.split(".")[0] || "");
    if (!firstLabel || RESERVED_SUBDOMAINS.has(firstLabel)) return false;
    return false;
  }

  return safeHost.includes(".");
}

export function isSuperSubdomain(host = browserHost()) {
  const safeHost = normalizeHost(host);
  if (!safeHost) return false;
  const baseDomain = getAppBaseDomain();
  return Boolean(baseDomain && safeHost === `super.${baseDomain}`);
}

export function isBaseDomain(host = browserHost()) {
  const safeHost = normalizeHost(host);
  if (!safeHost) return false;
  const baseDomain = getAppBaseDomain();
  return Boolean(baseDomain && (safeHost === baseDomain || safeHost === `www.${baseDomain}`));
}

export function defaultTenantDomain(slug = "") {
  const safeSlug = String(slug || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (!safeSlug) return "";
  const baseDomain = getAppBaseDomain();
  if (!baseDomain) return "";
  return `${safeSlug}.${baseDomain}`;
}
