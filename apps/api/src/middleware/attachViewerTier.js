import {
  getTierContext,
  getViewerTierRank,
  resolveTenantTierPolicy
} from "../services/memberTiers.js";

/**
 * Resolves the signed-in member's tier once per request so the module guard and
 * the route handlers all read the same answer.
 *
 * A camp without tiering pays a single object lookup: `resolveTenantTierPolicy`
 * reads the tenant's own module flag and settings without touching the
 * database, and everything below is skipped.
 */
export async function attachViewerTier(req, _res, next) {
  req.tierContext = null;
  req.viewerTierRank = null;

  try {
    if (!req.tenant || !req.user?.id) return next();
    if (!resolveTenantTierPolicy(req.tenant).enabled) return next();

    const context = await getTierContext(req.tenant);
    req.tierContext = context;
    if (!context.enabled) return next();

    req.viewerTierRank = await getViewerTierRank(req.tenant, req.user.id, {
      user: req.user,
      context
    });
    return next();
  } catch {
    // Tier resolution must never take the whole request down. Failing open here
    // is safe because every surface still applies its own filter, and failing
    // closed would lock a camp out of its own network on a transient error.
    req.tierContext = null;
    req.viewerTierRank = null;
    return next();
  }
}
