import { TenantModel } from "../src/db/models/index.js";
import {
  isValidTenantDomain,
  normalizeTenantDomain
} from "../src/utils/domainProvisioning.js";

async function run() {
  const tenants = await TenantModel.find(
    {},
    { select: ["id", "name", "slug", "customDomain"], sort: { slug: 1 } }
  );
  const assignments = new Map();
  const invalid = [];

  for (const tenant of tenants) {
    const domain = normalizeTenantDomain(tenant.customDomain || "");
    if (!domain) continue;
    const item = {
      tenantId: String(tenant._id || ""),
      slug: String(tenant.slug || ""),
      name: String(tenant.name || ""),
      domain
    };
    if (!isValidTenantDomain(domain)) invalid.push(item);
    if (!assignments.has(domain)) assignments.set(domain, []);
    assignments.get(domain).push(item);
  }

  const duplicates = Array.from(assignments.entries())
    .filter(([, items]) => items.length > 1)
    .map(([domain, items]) => ({ domain, assignments: items }));

  const summary = {
    checkedTenants: tenants.length,
    assignedDomains: assignments.size,
    invalidDomains: invalid,
    duplicateDomains: duplicates,
    safeToApplyUniqueIndex: invalid.length === 0 && duplicates.length === 0
  };

  console.log(JSON.stringify(summary, null, 2));
  if (!summary.safeToApplyUniqueIndex) process.exitCode = 1;
}

run().catch((error) => {
  console.error("[tenant-domain-audit] failed", String(error?.message || error));
  process.exitCode = 1;
});
