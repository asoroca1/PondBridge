import { hasFeature } from "@pondbridge/shared";

const FEATURE_TO_MODULE = {
  familyTrees: "familyTrees",
  directorySearch: "search"
};

export function requireFeature(feature) {
  return function requireFeatureMiddleware(req, res, next) {
    if (req.user?.roles?.includes("super_admin")) return next();

    const plan = req.tenant?.planTier || "base";
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

    if (moduleKey && req.tenant?.modules?.[moduleKey] === false) {
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
