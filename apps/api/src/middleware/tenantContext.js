import { resolveTenantHint, resolveTenantFromRequest } from "../utils/tenantResolution.js";
import { TenantModel } from "../db/models/index.js";

export function getTenantContext(req) {
  return resolveTenantHint(req, { allowHeaderSlug: true });
}

function readRequestedTenantId(req) {
  const queryTenantId = String(req.query?.tenantId || "").trim();
  if (queryTenantId) return queryTenantId;

  const bodyTenantId = String(req.body?.tenantId || "").trim();
  if (bodyTenantId) return bodyTenantId;

  return String(req.headers["x-tenant-id"] || "").trim();
}

async function resolveFallbackTenantFromAuth(req) {
  const isSuperAdmin = Array.isArray(req.user?.roles) && req.user.roles.includes("super_admin");
  const requestedTenantId = readRequestedTenantId(req);
  const fallbackTenantId = isSuperAdmin && requestedTenantId
    ? requestedTenantId
    : String(req.user?.tenantId || "").trim();

  if (!fallbackTenantId) return null;

  const tenant = await TenantModel.findById(fallbackTenantId);
  if (!tenant) return null;

  return {
    tenant,
    tenantId: String(tenant._id),
    slug: String(tenant.slug || "").trim().toLowerCase(),
    source: isSuperAdmin && requestedTenantId ? "super_admin_param" : "auth_membership",
    host: ""
  };
}

export async function requireTenant(req, res, next) {
  let context = await resolveTenantFromRequest(req, { allowHeaderSlug: true });
  if (!context.tenant && !context.slug && req.user) {
    const fallbackContext = await resolveFallbackTenantFromAuth(req);
    if (fallbackContext) {
      context = fallbackContext;
    }
  }

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
