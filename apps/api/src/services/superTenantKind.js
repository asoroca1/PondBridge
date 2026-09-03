/**
 * Demo camps versus real clients.
 *
 * The super console is where PondBridge's actual clients are looked after, and
 * for most of 2026 the demo camps built for sales sat in the same list as them
 * — six demos against three clients, so every total the console showed was
 * mostly demo data.
 *
 * This is the one rule that decides which is which. It was previously a private
 * helper inside routes/super.js used only to hide these camps from support
 * admins and to gate hard deletes.
 */
const DEMO_TENANT_PATTERN = /(^|[-_.\s])(test\d*|sandbox|qa|staging|dev|demo)([-_.\s]|$)/i;

export const TENANT_KINDS = { CLIENT: "client", DEMO: "demo" };

function normalizeDomain(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .split(":")[0];
}

export function isDemoTenant(tenant = {}) {
  const slug = String(tenant?.slug || "").trim().toLowerCase();
  const name = String(tenant?.name || "").trim().toLowerCase();
  const domain = normalizeDomain(tenant?.customDomain || "");
  const status = String(tenant?.status || "").trim().toLowerCase();

  if (status === "sandbox") return true;
  if (domain.endsWith(".pondbridge.test")) return true;
  return (
    DEMO_TENANT_PATTERN.test(slug) ||
    DEMO_TENANT_PATTERN.test(name) ||
    DEMO_TENANT_PATTERN.test(domain)
  );
}

export function tenantKind(tenant = {}) {
  return isDemoTenant(tenant) ? TENANT_KINDS.DEMO : TENANT_KINDS.CLIENT;
}

/**
 * Which camps the console should list. Defaults to clients: the console is a
 * client book first, and demos are reachable through the same control.
 */
export function normalizeTenantKindFilter(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "demo" || normalized === "demos") return TENANT_KINDS.DEMO;
  if (normalized === "all") return "all";
  return TENANT_KINDS.CLIENT;
}

export function applyTenantKindFilter(tenants = [], kindFilter = TENANT_KINDS.CLIENT) {
  if (kindFilter === "all") return tenants;
  return tenants.filter((tenant) => tenantKind(tenant) === kindFilter);
}

export function summarizeTenantKinds(tenants = []) {
  let clients = 0;
  let demos = 0;
  for (const tenant of tenants) {
    if (isDemoTenant(tenant)) demos += 1;
    else clients += 1;
  }
  return { clients, demos, total: clients + demos };
}
