/**
 * Decides whether a visit needs the full auth runtime (Clerk + session
 * bootstrap) or can be served by the signed-out public value alone.
 *
 * Getting this wrong is expensive in both directions: skipping the runtime for
 * a signed-in member shows them a logged-out page, and the correction later
 * used to remount the whole app.
 */

export function isPublicLandingPath(pathname = "") {
  const normalizedPath = String(pathname || "/").replace(/\/+$/, "") || "/";
  return normalizedPath === "/" || /^\/t\/[^/]+$/i.test(normalizedPath);
}

export function needsAuthRuntime({
  pathname = "",
  clerkEnabled = true,
  hasSessionSnapshot = false
} = {}) {
  // Without the Clerk SDK the runtime still carries the legacy provider.
  if (!clerkEnabled) return true;
  if (hasSessionSnapshot) return true;
  return !isPublicLandingPath(pathname);
}
