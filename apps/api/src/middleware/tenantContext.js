import { resolveTenantHint, resolveTenantFromRequest } from "../utils/tenantResolution.js";

export function getTenantContext(req) {
  return resolveTenantHint(req, { allowHeaderSlug: true });
}

export async function requireTenant(req, res, next) {
  const context = await resolveTenantFromRequest(req, { allowHeaderSlug: true });
  if (!context.slug && !context.host) {
    return res.status(400).json({
      error: {
        code: "TENANT_REQUIRED",
        message: "Tenant slug is required (subdomain, /t/:slug, custom domain host, or x-tenant-slug)."
      }
    });
  }

  if (!context.tenant) {
    return res.status(404).json({
      error: {
        code: "TENANT_NOT_FOUND",
        message: context.slug
          ? `Tenant '${context.slug}' was not found.`
          : `Tenant for host '${context.host || "unknown"}' was not found.`
      }
    });
  }

  req.tenant = context.tenant;
  req.tenantContext = {
    tenantId: context.tenantId,
    slug: context.tenant.slug,
    source: context.source
  };

  if (
    req.user &&
    !req.user.roles.includes("super_admin") &&
    req.user.tenantId &&
    String(req.user.tenantId) !== String(context.tenant._id)
  ) {
    return res.status(403).json({
      error: {
        code: "TENANT_SCOPE_DENIED",
        message: "User does not have access to this tenant."
      }
    });
  }

  return next();
}
