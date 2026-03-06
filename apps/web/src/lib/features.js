import { hasFeature, normalizeFeatureName } from "@pondbridge/shared";

const FEATURE_TO_MODULE = {
  directorySearch: "search",
  familyTrees: "familyTrees"
};

function resolveTenantPlanTier(tenant) {
  const billingPlan = String(tenant?.billingPlan || tenant?.billing?.billingPlan || "")
    .trim()
    .toLowerCase();
  if (billingPlan === "founders" || billingPlan === "institutional") return "premium";
  if (billingPlan === "legacy") return "base";
  return String(tenant?.planTier || "").trim().toLowerCase() === "premium" ? "premium" : "base";
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

  return hasFeature(resolveTenantPlanTier(tenant), normalizedFeature, tenant.addOns || []);
}
