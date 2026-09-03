import {
  alumniPluralForCampType,
  defaultNetworkDisplayNameForCamp,
  normalizeCampType,
  replaceAlumniForCampType
} from "@pondbridge/shared";

const DEFAULT_STAFF_ROLES = ["Camper", "Counselor", "JC", "CIT", "Admin"];
const DEFAULT_AGE_GROUPS = [
  "Super Warrior",
  "Warrior",
  "Freshman",
  "Sophomore",
  "Junior",
  "Intermediate",
  "Senior I",
  "Senior II"
];

function normalizeLabelList(values, fallback = []) {
  const source = Array.isArray(values) ? values : [];
  const seen = new Set();
  const cleaned = [];

  for (const value of source) {
    const label = String(value || "").trim();
    const key = label.toLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    cleaned.push(label);
  }

  return cleaned.length ? cleaned : fallback;
}

export function resolveTenantContent(tenant) {
  return tenant?.config?.content || tenant?.content || {};
}

export function resolveTenantLogoUrl(tenant) {
  const candidates = [
    tenant?.config?.branding?.logoUrl,
    tenant?.config?.theme?.logoUrl,
    tenant?.theme?.logoUrl,
    tenant?.branding?.logoUrl
  ];

  for (const candidate of candidates) {
    const logoUrl = String(candidate || "").trim();
    if (logoUrl) return logoUrl;
  }

  return "";
}

export function resolveCampName(tenant) {
  return String(tenant?.name || "Your Camp").trim() || "Your Camp";
}

export function resolveCampAiName(tenant) {
  const content = resolveTenantContent(tenant);
  const configuredName = String(content.aiAssistantName || "").trim().slice(0, 60);
  if (configuredName) return configuredName;

  const campName = resolveCampName(tenant)
    .replace(/\s+[—-]\s+local staging\b.*$/i, "")
    .replace(/^(?:the\s+)?camp\s+/i, "")
    .trim();
  const baseName = campName || "Camp";
  return /\bai$/i.test(baseName) ? baseName : `${baseName} AI`;
}

export function resolveCampType(tenant) {
  const content = resolveTenantContent(tenant);
  return normalizeCampType(
    content?.campType || tenant?.content?.campType || tenant?.settings?.campType || "coed"
  );
}

export function resolveAlumniWord(tenant, { capitalized = false } = {}) {
  return alumniPluralForCampType(resolveCampType(tenant), { capitalized });
}

export function withCampAlumniTerms(tenant, text = "") {
  return replaceAlumniForCampType(text, resolveCampType(tenant));
}

function defaultNetworkDisplayName(tenant) {
  const campName = resolveCampName(tenant);
  return defaultNetworkDisplayNameForCamp(campName, resolveCampType(tenant));
}

export function resolveNetworkDisplayName(tenant) {
  const content = resolveTenantContent(tenant);
  const fallback = defaultNetworkDisplayName(tenant);
  const configuredName = String(content.networkDisplayName || "").trim();
  const normalizedConfiguredName = configuredName.toLowerCase().replace(/\s+/g, " ");
  const isVendorPlaceholder = [
    "pondbridge",
    "pondbridge network",
    "pondbridge alumni network",
    "pondbridge alumnae network"
  ].includes(normalizedConfiguredName);
  const raw = configuredName && !isVendorPlaceholder ? configuredName : fallback;
  return withCampAlumniTerms(tenant, raw);
}

export function resolveNewsletterLabel(tenant) {
  const content = resolveTenantContent(tenant);
  return String(content.newsletterName || "").trim() || "Newsletter";
}

export function resolveMediaStreamLabel(tenant) {
  const content = resolveTenantContent(tenant);
  return String(content.photoStreamName || "").trim() || "Media Stream";
}

export function resolveSideNavEnabled(tenant) {
  const content = resolveTenantContent(tenant);
  return Boolean(content.sideNavEnabled);
}

export function resolveStaffRoleOptions(tenant) {
  const content = resolveTenantContent(tenant);
  return normalizeLabelList(content.staffRoles, DEFAULT_STAFF_ROLES);
}

export function resolveAgeGroupOptions(tenant) {
  const content = resolveTenantContent(tenant);
  return normalizeLabelList(content.ageGroups, DEFAULT_AGE_GROUPS);
}
