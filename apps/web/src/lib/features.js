import { hasFeature, normalizeFeatureName } from "@pondbridge/shared";

const FEATURE_TO_MODULE = {
  directorySearch: "search",
  familyTrees: "familyTrees"
};

function resolveTenantPlanTier() {
  // Flagship is the only plan PondBridge sells and it includes every feature.
  return "premium";
}

export function tenantHasFeature(tenant, feature) {
  if (!tenant) return false;

  const normalizedFeature = normalizeFeatureName(feature);
  const features = Array.isArray(tenant.features) ? tenant.features : [];
  const normalizedFeatures = features.map((value) => normalizeFeatureName(value));

  if (normalizedFeatures.includes(normalizedFeature)) {
    return true;
  }

  const moduleKey = FEATURE_TO_MODULE[normalizedFeature];
  if (moduleKey && tenant?.modules?.[moduleKey] === false) {
    return false;
  }

  return hasFeature(resolveTenantPlanTier(), normalizedFeature, tenant.addOns || []);
}
