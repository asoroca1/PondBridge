import { hasFeature, normalizeFeatureName } from "@pondbridge/shared";

const FEATURE_TO_MODULE = {
  directorySearch: "search",
  familyTrees: "familyTrees"
};

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

  return hasFeature(tenant.planTier || "base", normalizedFeature, tenant.addOns || []);
}
