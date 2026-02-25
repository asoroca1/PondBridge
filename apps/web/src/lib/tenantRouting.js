import { inferCampSlugFromHost, isPotentialCustomTenantHost } from "./domain.js";

function currentPathname() {
  if (typeof window === "undefined") return "";
  return String(window.location.pathname || "");
}

function currentHost() {
  if (typeof window === "undefined") return "";
  return String(window.location.hostname || "");
}

export function shouldUseTenantSlugPrefix(slug = "", { pathname = "", host = "" } = {}) {
  const safeSlug = String(slug || "").trim().toLowerCase();
  if (!safeSlug) return false;

  const activePath = String(pathname || currentPathname());
  if (activePath === `/t/${safeSlug}` || activePath.startsWith(`/t/${safeSlug}/`)) {
    return true;
  }

  if (activePath.startsWith("/t/")) {
    return true;
  }

  const activeHost = String(host || currentHost());
  if (inferCampSlugFromHost(activeHost) || isPotentialCustomTenantHost(activeHost)) {
    return false;
  }

  return true;
}

export function tenantRoute(slug = "", path = "/", options = {}) {
  const normalizedPath = String(path || "").startsWith("/")
    ? String(path || "")
    : `/${String(path || "")}`;
  const safeSlug = String(slug || "").trim().toLowerCase();
  if (!safeSlug) return normalizedPath;
  if (!shouldUseTenantSlugPrefix(safeSlug, options)) return normalizedPath;
  return `/t/${safeSlug}${normalizedPath}`;
}

export function normalizeTenantRouteForHost(slug = "", route = "", options = {}) {
  const safeRoute = String(route || "").trim();
  if (!safeRoute) return "/";
  if (!safeRoute.startsWith("/")) return safeRoute;

  const safeSlug = String(slug || "").trim().toLowerCase();
  if (!safeSlug) return safeRoute;

  const prefix = `/t/${safeSlug}`;
  const usePrefix = shouldUseTenantSlugPrefix(safeSlug, options);
  if (usePrefix) {
    if (safeRoute === prefix || safeRoute.startsWith(`${prefix}/`)) return safeRoute;
    return `${prefix}${safeRoute}`;
  }

  if (safeRoute === prefix) return "/";
  if (safeRoute.startsWith(`${prefix}/`)) {
    return safeRoute.slice(prefix.length) || "/";
  }
  return safeRoute;
}
