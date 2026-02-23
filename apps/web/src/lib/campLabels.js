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

export function resolveCampName(tenant) {
  return String(tenant?.name || "Your Camp").trim() || "Your Camp";
}

export function resolveNetworkDisplayName(tenant) {
  const content = resolveTenantContent(tenant);
  return (
    String(content.networkDisplayName || "").trim() ||
    `${resolveCampName(tenant)} Alumni Network`
  );
}

export function resolveNewsletterLabel(tenant) {
  const content = resolveTenantContent(tenant);
  return String(content.newsletterName || "").trim() || "Newsletter";
}

export function resolveStaffRoleOptions(tenant) {
  const content = resolveTenantContent(tenant);
  return normalizeLabelList(content.staffRoles, DEFAULT_STAFF_ROLES);
}

export function resolveAgeGroupOptions(tenant) {
  const content = resolveTenantContent(tenant);
  return normalizeLabelList(content.ageGroups, DEFAULT_AGE_GROUPS);
}

