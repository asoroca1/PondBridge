export const FEATURE_ALIASES = {
  profiles: "profiles",
  directory_search: "directorySearch",
  directorySearch: "directorySearch",
  admin_csv_export: "csvExport",
  csvExport: "csvExport",
  admin_pdf_export: "pdfExport",
  pdfExport: "pdfExport",
  resume_parsing: "resumeParsing",
  resumeParsing: "resumeParsing",
  family_trees: "familyTrees",
  familyTrees: "familyTrees",
  tenant_theming_basic: "tenantBrandingBasic",
  tenantBrandingBasic: "tenantBrandingBasic",
  tenant_theming_advanced: "tenantBrandingAdvanced",
  tenantBrandingAdvanced: "tenantBrandingAdvanced",
  custom_domain: "customDomain",
  customDomain: "customDomain",
  analytics: "analytics"
};

export const PLAN_FEATURES = {
  base: ["profiles", "directorySearch", "csvExport", "tenantBrandingBasic"],
  premium: [
    "profiles",
    "directorySearch",
    "csvExport",
    "pdfExport",
    "resumeParsing",
    "familyTrees",
    "tenantBrandingAdvanced",
    "customDomain",
    "analytics"
  ]
};

export function normalizeFeatureName(feature = "") {
  const raw = String(feature || "").trim();
  return FEATURE_ALIASES[raw] || raw;
}

export function hasFeature(planTier, feature, addOns = []) {
  const normalizedFeature = normalizeFeatureName(feature);
  const normalizedAddOns = Array.isArray(addOns)
    ? addOns.map((value) => normalizeFeatureName(value))
    : [];

  const plan = (PLAN_FEATURES[planTier] || PLAN_FEATURES.base).map((value) =>
    normalizeFeatureName(value)
  );

  return plan.includes(normalizedFeature) || normalizedAddOns.includes(normalizedFeature);
}

export function listFeaturesForPlan(planTier, addOns = []) {
  const planFeatures = PLAN_FEATURES[planTier] || PLAN_FEATURES.base;
  const merged = [...planFeatures, ...(Array.isArray(addOns) ? addOns : [])].map((value) =>
    normalizeFeatureName(value)
  );

  return [...new Set(merged)];
}
