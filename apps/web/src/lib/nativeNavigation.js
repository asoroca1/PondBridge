const RESERVED_TENANT_HOSTS = new Set(["app", "api", "super", "www"]);

function normalizeSlug(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeBaseDomain(value = "") {
  return String(value || "").trim().toLowerCase().replace(/^\.+|\.+$/g, "");
}

function safeInternalPath(pathname = "", search = "", hash = "") {
  const path = String(pathname || "").trim();
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return "";
  if (path === "/super" || path.startsWith("/super/")) return "";
  return `${path}${String(search || "")}${String(hash || "")}`;
}

function tenantSlugFromTrustedHost(hostname = "", baseDomain = "") {
  const host = String(hostname || "").trim().toLowerCase();
  const base = normalizeBaseDomain(baseDomain);
  if (!host || !base || !host.endsWith(`.${base}`)) return "";

  const prefix = host.slice(0, -1 * (base.length + 1));
  const firstLabel = normalizeSlug(prefix.split(".")[0] || "");
  if (!firstLabel || RESERVED_TENANT_HOSTS.has(firstLabel)) return "";
  return firstLabel;
}

function isTrustedWebHost(hostname = "", baseDomain = "") {
  const host = String(hostname || "").trim().toLowerCase();
  const base = normalizeBaseDomain(baseDomain);
  return Boolean(base && (host === base || host.endsWith(`.${base}`)));
}

/**
 * Converts a verified PondBridge universal/custom URL into an in-app route.
 * External hosts, platform-admin routes, malformed paths, and unscoped routes
 * without a remembered camp are intentionally rejected.
 */
export function resolveNativeNavigationTarget(
  value = "",
  { baseDomain = "pondbridgealumni.com", rememberedSlug = "" } = {}
) {
  let parsed;
  try {
    parsed = new URL(String(value || "").trim());
  } catch {
    return "";
  }

  const protocol = String(parsed.protocol || "").toLowerCase();
  const customScheme = protocol === "pondbridge:";
  const trustedWeb = ["https:", "http:"].includes(protocol) && isTrustedWebHost(parsed.hostname, baseDomain);
  if (!customScheme && !trustedWeb) return "";

  let pathname = parsed.pathname || "/";
  if (customScheme) {
    if (String(parsed.hostname || "").toLowerCase() !== "open") return "";
    pathname = parsed.pathname || "/";
  }

  const direct = safeInternalPath(pathname, parsed.search, parsed.hash);
  if (!direct) return "";
  if (pathname === "/email-preferences" || pathname.startsWith("/email-preferences/")) return direct;
  if (pathname === "/t" || pathname.startsWith("/t/")) {
    return /^\/t\/[a-z0-9-]+(?:\/|$)/.test(pathname) ? direct : "";
  }

  const hostTenantSlug = trustedWeb
    ? tenantSlugFromTrustedHost(parsed.hostname, baseDomain)
    : "";
  const tenantSlug = hostTenantSlug || normalizeSlug(rememberedSlug);
  if (!tenantSlug) return "";

  return `/t/${tenantSlug}${direct === "/" ? "" : direct}`;
}

export function tenantSlugFromAppPath(pathname = "") {
  const match = String(pathname || "").match(/^\/t\/([a-z0-9-]+)(?:\/|$)/i);
  return normalizeSlug(match?.[1] || "");
}
