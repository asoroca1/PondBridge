import { requireTenant } from "./tenantContext.js";
import { requireAuth, requireIdentity } from "./requireAuth.js";
import { enforceTenantScope } from "./enforceTenantScope.js";
import { requireRole } from "./requireRole.js";

export const requireTenantIdentityScope = [requireIdentity, requireTenant, enforceTenantScope];
export const requireTenantAuthScope = [requireAuth, requireTenant, enforceTenantScope];

export function requireTenantRoleScope(...roles) {
  return [...requireTenantAuthScope, requireRole(...roles)];
}
