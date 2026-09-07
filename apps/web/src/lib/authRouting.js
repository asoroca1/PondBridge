/**
 * When a Clerk-signed-in visitor has no tenant-scoped member yet, the app sends
 * them to /auth/callback to finish signing in. That is right on a real sign-in
 * and wrong during a background session refresh, where `user` goes null for a
 * moment and comes straight back — the member sees a sign-in flash and
 * "Finalizing sign-in..." on an ordinary click.
 *
 * The guard against that used to be a `useRef` in the component that renders
 * the tenant routes. Refs do not survive unmounting, and that component is
 * mounted under three different layouts, so any route change that swapped
 * layouts forgot the member had ever resolved and the flash came back.
 *
 * The cached member is the durable form of the same fact: it is written
 * whenever a session resolves, and cleared by logout and by any 401. If this
 * browser holds one for this camp, a momentary gap is a refresh — not a
 * sign-in that needs finishing.
 */

export function normalizeTenantKey(value = "") {
  return String(value || "").trim().toLowerCase();
}

/**
 * Has this browser already resolved a member for this camp?
 *
 * Scoped to the camp on purpose: arriving at a second camp with the first
 * camp's member cached is a real sign-in for the second one, and does need
 * the callback.
 */
export function hasResolvedMemberForTenant({ cachedUser = null, slug = "" } = {}) {
  if (!cachedUser) return false;
  if (Array.isArray(cachedUser.roles) && cachedUser.roles.includes("super_admin")) return true;
  const wanted = normalizeTenantKey(slug);
  if (!wanted) return false;
  return normalizeTenantKey(cachedUser.tenantSlug) === wanted;
}

export function shouldFinishTenantSignIn({
  clerkMode = false,
  isAuthenticated = false,
  user = null,
  onAuthBootstrapRoute = false,
  resolvedUserOnce = false,
  cachedUser = null,
  slug = ""
} = {}) {
  if (!clerkMode || !isAuthenticated) return false;
  if (user) return false;
  if (onAuthBootstrapRoute) return false;
  if (resolvedUserOnce) return false;
  return !hasResolvedMemberForTenant({ cachedUser, slug });
}
