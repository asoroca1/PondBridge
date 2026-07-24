
/**
 * Durable, fail-closed feature rollout middleware.
 * Server-owned rollout records use stable tenant IDs and an immediate kill
 * switch. Missing schema/config never enables a feature.
 */
import { evaluateFeatureRollout } from "../services/featureRollouts.js";

/**
 * Check whether a feature is enabled for a given tenant slug.
 */
export async function isFeatureEnabled(featureName, tenant = {}) {
  const result = await evaluateFeatureRollout(featureName, tenant);
  return result.enabled;
}

/**
 * Express middleware that gates a route behind a feature flag.
 * Returns 404 if the feature is not enabled for the current tenant.
 */
export function requireFeature(featureName) {
  return async (req, res, next) => {
    try {
      const result = await evaluateFeatureRollout(featureName, req.tenant);
      if (result.enabled) return next();
      return res.status(404).json({
        error: { code: "NOT_FOUND", message: "Resource not found" }
      });
    } catch (error) {
      return next(error);
    }
  };
}

/**
 * Force-reload the flags from the environment variable.
 * Useful in tests or after a config change.
 */
export function reloadFeatureFlags() {
  // Retained as a no-op compatibility export for older tests/callers.
}
