export const CLERK_PUBLISHABLE_KEY = String(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || "").trim();
const rawMode = String(import.meta.env.VITE_AUTH_PROVIDER || "")
  .trim()
  .toLowerCase();
const hasClerkPublishableKey = Boolean(CLERK_PUBLISHABLE_KEY);
const modeFromEnv = ["legacy", "hybrid", "clerk"].includes(rawMode) ? rawMode : "";

export const AUTH_PROVIDER = modeFromEnv || (hasClerkPublishableKey ? "clerk" : "legacy");
export const CLERK_AUTH_ENABLED = AUTH_PROVIDER === "clerk" || AUTH_PROVIDER === "hybrid";

export function clerkModeRequested({ pathname = "" } = {}) {
  void pathname;
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
