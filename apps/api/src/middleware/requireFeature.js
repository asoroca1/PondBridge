import { hasFeature, resolveTenantModules } from "@pondbridge/shared";
import { resolveTenantFeatureTier } from "../services/billingState.js";

const FEATURE_TO_MODULE = {
  familyTrees: "familyTrees",
  directorySearch: "search"
};

export function requireFeature(feature) {
  return function requireFeatureMiddleware(req, res, next) {
    if (req.user?.roles?.includes("super_admin")) return next();

    const plan = resolveTenantFeatureTier(req.tenant);
    const addOns = req.tenant?.addOns || [];
    const moduleKey = FEATURE_TO_MODULE[feature];

    if (!hasFeature(plan, feature, addOns)) {
      return res.status(403).json({
        error: {
          code: "FEATURE_BLOCKED_BY_PLAN",
          message: `Feature '${feature}' is not enabled for plan '${plan}'.`
        }
      });
    }

    if (moduleKey && resolveTenantModules(req.tenant?.modules || {})[moduleKey] === false) {
      return res.status(403).json({
        error: {
          code: "MODULE_DISABLED",
          message: `This camp has disabled '${moduleKey}' in setup.`
        }
      });
    }

    return next();
  };
}

export function requireTenantModule(moduleKey, { message = "" } = {}) {
  const normalizedModuleKey = String(moduleKey || "").trim();
  if (!normalizedModuleKey) {
    throw new Error("requireTenantModule requires a module key.");
  }

  return function requireTenantModuleMiddleware(req, res, next) {
    if (req.user?.roles?.includes("super_admin")) return next();

    // Missing legacy settings remain enabled for existing camps. Shared
    // dependency resolution also prevents Search/Related Profiles from
    // bypassing a disabled Directory module.
    const modules = resolveTenantModules(req.tenant?.modules || {});
    if (modules[normalizedModuleKey] !== false) return next();

    return res.status(403).json({
      error: {
        code: "MODULE_DISABLED",
        module: normalizedModuleKey,
        message: message || `This camp has disabled '${normalizedModuleKey}'.`
      }
    });
  };
}
