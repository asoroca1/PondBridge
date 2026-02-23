export type PlanTier = "base" | "premium";

export type FeatureName =
  | "profiles"
  | "directorySearch"
  | "csvExport"
  | "pdfExport"
  | "resumeParsing"
  | "familyTrees"
  | "tenantBrandingBasic"
  | "tenantBrandingAdvanced"
  | "customDomain"
  | "analytics";

export const FEATURE_ALIASES: Record<string, FeatureName> = {
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

export const PLAN_FEATURES: Record<PlanTier, FeatureName[]> = {
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

export function normalizeFeatureName(feature = ""): FeatureName | string {
  const raw = String(feature || "").trim();
  return FEATURE_ALIASES[raw] || raw;
}

export function hasFeature(planTier: PlanTier | string, feature: string, addOns: string[] = []) {
  const normalizedFeature = normalizeFeatureName(feature);
  const normalizedAddOns = Array.isArray(addOns)
    ? addOns.map((value) => normalizeFeatureName(value))
    : [];

  const planFeatures =
    planTier === "premium" ? PLAN_FEATURES.premium : PLAN_FEATURES.base;

  return (
    planFeatures.map((value) => normalizeFeatureName(value)).includes(normalizedFeature) ||
    normalizedAddOns.includes(normalizedFeature)
  );
}

export function listFeaturesForPlan(planTier: PlanTier | string, addOns: string[] = []) {
  const planFeatures = planTier === "premium" ? PLAN_FEATURES.premium : PLAN_FEATURES.base;
  const merged = [...planFeatures, ...(Array.isArray(addOns) ? addOns : [])].map((value) =>
    normalizeFeatureName(value)
  );
  return [...new Set(merged)];
}
