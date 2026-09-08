import { tenantRoute } from "./tenantRouting.js";

export const ACCOUNT_CONFIRMATION_REQUIRED_CODE = "ACCOUNT_CONFIRMATION_REQUIRED";
export const ACCOUNT_CONFIRMATION_REQUIRED_EVENT = "pondbridge:account-confirmation-required";

export function accountConfirmationErrorCode(value = null) {
  if (typeof value === "string") return value.split(":", 1)[0].trim().toUpperCase();
  return String(value?.payload?.error?.code || value?.error?.code || value?.code || "")
    .trim()
    .toUpperCase();
}

export function isAccountConfirmationRequired(value = null) {
  return accountConfirmationErrorCode(value) === ACCOUNT_CONFIRMATION_REQUIRED_CODE;
}

export function normalizeAccountConfirmationReturnTo(value = "", slug = "") {
  const raw = String(value || "").trim();
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return "";

  let parsed;
  try {
    parsed = new URL(raw, "https://pondbridge.invalid");
  } catch {
    return "";
  }
  if (parsed.origin !== "https://pondbridge.invalid") return "";

  const safeSlug = String(slug || "").trim().toLowerCase();
  const tenantMatch = parsed.pathname.match(/^\/t\/([^/]+)(?:\/|$)/i);
  if (tenantMatch) {
    let routeSlug = "";
    try {
      routeSlug = decodeURIComponent(tenantMatch[1]).trim().toLowerCase();
    } catch {
      return "";
    }
    if (routeSlug !== safeSlug) return "";
  }

  const path = parsed.pathname.toLowerCase().replace(/\/+$/, "") || "/";
  if (
    path.endsWith("/account-confirmation") ||
    path.endsWith("/auth/callback") ||
    path.endsWith("/login") ||
    path.endsWith("/create-account") ||
    path.endsWith("/request-access")
  ) {
    return "";
  }
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export function buildAccountConfirmationPath(slug = "", returnTo = "") {
  const base = tenantRoute(slug, "/account-confirmation");
  const safeReturnTo = normalizeAccountConfirmationReturnTo(returnTo, slug);
  if (!safeReturnTo) return base;
  const params = new URLSearchParams({ returnTo: safeReturnTo });
  return `${base}?${params.toString()}`;
}

export function dispatchAccountConfirmationRequired(path = "", payload = null) {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
  const match = String(path || "").match(/^\/api\/t\/([^/]+)\//i);
  let tenantSlug = "";
  try {
    tenantSlug = match ? decodeURIComponent(match[1]).trim().toLowerCase() : "";
  } catch {
    tenantSlug = "";
  }
  window.dispatchEvent(new CustomEvent(ACCOUNT_CONFIRMATION_REQUIRED_EVENT, {
    detail: { tenantSlug, nextRoute: String(payload?.error?.nextRoute || payload?.nextRoute || "").trim() }
  }));
}
