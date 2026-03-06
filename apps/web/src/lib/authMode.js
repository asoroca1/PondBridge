export const CLERK_PUBLISHABLE_KEY = String(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || "").trim();
const rawMode = String(import.meta.env.VITE_AUTH_PROVIDER || "")
  .trim()
  .toLowerCase();
const hasClerkPublishableKey = Boolean(CLERK_PUBLISHABLE_KEY);
const modeFromEnv = ["legacy", "hybrid", "clerk"].includes(rawMode) ? rawMode : "";

export const AUTH_PROVIDER = modeFromEnv || (hasClerkPublishableKey ? "clerk" : "legacy");
export const CLERK_AUTH_ENABLED = AUTH_PROVIDER === "clerk" || AUTH_PROVIDER === "hybrid";

function resolvePathname(pathname = "") {
  if (pathname) return String(pathname).trim();
  if (typeof window === "undefined") return "";
  return String(window.location?.pathname || "").trim();
}

function isSuperRoute(pathname = "") {
  const path = String(pathname || "").trim();
  return path === "/super" || path.startsWith("/super/");
}

export function clerkModeRequested({ pathname = "" } = {}) {
  const routePathname = resolvePathname(pathname);
  if (routePathname) {
    // Tenant auth intentionally uses legacy routes to preserve tenant-branded emails.
    return CLERK_AUTH_ENABLED && isSuperRoute(routePathname);
  }
  return CLERK_AUTH_ENABLED;
}

export function clerkUiEnabled({ pathname = "" } = {}) {
  return clerkModeRequested({ pathname }) && hasClerkPublishableKey;
}

export function clerkSdkEnabled() {
  return CLERK_AUTH_ENABLED && hasClerkPublishableKey;
}

export function clerkConfigError() {
  if (!CLERK_AUTH_ENABLED) return "";
  if (hasClerkPublishableKey) return "";
  return "Clerk auth is enabled but VITE_CLERK_PUBLISHABLE_KEY is missing.";
}
