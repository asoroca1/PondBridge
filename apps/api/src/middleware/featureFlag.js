
/**
 * Lightweight feature-flag middleware.
 *
 * Feature flags are tenant-scoped.  The mapping is read from the
 * FEATURE_FLAGS environment variable, which should be a JSON string:
 *
 *   FEATURE_FLAGS='{"new_search_v2":["demo","test1"],"ai_profiles":["*"]}'
 *
 * A tenant slug of "*" means the feature is enabled for all tenants.
 *
 * Usage in a route file:
 *
 *   import { requireFeature } from "../middleware/featureFlag.js";
 *   router.get("/beta-feature", requireFeature("new_search_v2"), handler);
 */

let parsedFlags = null;

function getFlags() {
  if (parsedFlags !== null) return parsedFlags;
  const raw = String(process.env.FEATURE_FLAGS || "").trim();
  if (!raw) {
    parsedFlags = {};
    return parsedFlags;
  }
  try {
    parsedFlags = JSON.parse(raw);
  } catch {
    parsedFlags = {};
  }
  return parsedFlags;
}

/**
 * Check whether a feature is enabled for a given tenant slug.
 */
export function isFeatureEnabled(featureName, tenantSlug = "") {
  const flags = getFlags();
  const allowed = flags[featureName];
  if (!Array.isArray(allowed)) return false;
  if (allowed.includes("*")) return true;
  return allowed.includes(String(tenantSlug || "").trim().toLowerCase());
}

/**
 * Express middleware that gates a route behind a feature flag.
 * Returns 404 if the feature is not enabled for the current tenant.
 */
export function requireFeature(featureName) {
  return (req, res, next) => {
    const tenantSlug = String(
      req.tenant?.slug || req.headers?.["x-tenant-slug"] || ""
    )
      .trim()
      .toLowerCase();

    if (isFeatureEnabled(featureName, tenantSlug)) {
      return next();
    }

    return res.status(404).json({
      error: { code: "NOT_FOUND", message: "Resource not found" }
    });
  };
}

/**
 * Force-reload the flags from the environment variable.
 * Useful in tests or after a config change.
 */
export function reloadFeatureFlags() {
  parsedFlags = null;
}
