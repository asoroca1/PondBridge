export function superSearchIncludesDirectors(role = "unknown") {
  return role !== "finance_admin";
}

export function buildSuperSearchTenantItem(
  tenant = {},
  role = "unknown",
  { appBaseDomain = "pondbridgealumni.com" } = {}
) {
  const slug = String(tenant?.slug || "").trim();
  if (role === "finance_admin") {
    return {
      id: `billing_${slug}`,
      type: "billing",
      label: tenant.name,
      meta: "Tenant billing record",
      href: `/super/billing/tenants?search=${encodeURIComponent(slug)}`
    };
  }
  return {
    id: `tenant_${slug}`,
    type: "tenant",
    label: tenant.name,
    meta: tenant.customDomain || `${slug}.${appBaseDomain}`,
    href: `/super/tenants?search=${encodeURIComponent(slug)}`
  };
}
