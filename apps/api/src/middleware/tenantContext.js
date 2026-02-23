import { TenantModel } from "../db/models/index.js";
import { env } from "../config/env.js";

function stripPort(host = "") {
  return String(host).split(":")[0].toLowerCase();
}

function requestHost(req) {
  const forwarded = String(req.headers["x-forwarded-host"] || "")
    .split(",")[0]
    .trim();
  if (forwarded) return stripPort(forwarded);
  return stripPort(req.headers.host || "");
}

function extractSlugFromHost(host = "") {
  const safeHost = stripPort(host);
  if (!safeHost) return "";
  const reservedSubdomains = new Set(["www", "app", "api", "super"]);

  if (safeHost.endsWith(`.${env.APP_BASE_DOMAIN}`)) {
    const prefix = safeHost.slice(0, -1 * (env.APP_BASE_DOMAIN.length + 1));
    if (prefix) {
      const candidate = prefix.split(".")[0];
      if (!reservedSubdomains.has(candidate)) return candidate;
    }
  }

  if (safeHost.endsWith(".localhost")) {
    const prefix = safeHost.replace(".localhost", "");
    if (prefix && prefix !== "localhost") {
      const candidate = prefix.split(".")[0];
      if (!reservedSubdomains.has(candidate)) return candidate;
    }
  }

  return "";
}

export function getTenantContext(req) {
  const fromParam = String(req.params.slug || "").trim().toLowerCase();
  if (fromParam) return { slug: fromParam, source: "path_param" };

  const pathMatch = req.originalUrl.match(/\/t\/([^/]+)/i);
  const fromPath = pathMatch?.[1]?.trim().toLowerCase() || "";
  if (fromPath) return { slug: fromPath, source: "url_prefix" };

  const host = requestHost(req);
  const fromHost = extractSlugFromHost(host || "");
  if (fromHost) return { slug: fromHost, source: "subdomain" };

  const fromHeader = String(req.headers["x-tenant-slug"] || "").trim().toLowerCase();
  if (fromHeader) return { slug: fromHeader, source: "header" };

  return { slug: "", source: "missing", host };
}

export async function requireTenant(req, res, next) {
  const context = getTenantContext(req);
  let tenant = null;
  let source = context.source;
  if (context.slug) {
    tenant = await TenantModel.findBySlug(context.slug);
  } else if (context.host) {
    tenant = await TenantModel.findByDomain(context.host);
    if (tenant) source = "domain";
  } else {
    return res.status(400).json({
      error: {
        code: "TENANT_REQUIRED",
        message: "Tenant slug is required (subdomain, /t/:slug, custom domain host, or x-tenant-slug)."
      }
    });
  }

  if (!tenant) {
    return res.status(404).json({
      error: {
        code: "TENANT_NOT_FOUND",
        message: context.slug
          ? `Tenant '${context.slug}' was not found.`
          : `Tenant for host '${context.host || "unknown"}' was not found.`
      }
    });
  }

  req.tenant = tenant;
  req.tenantContext = {
    tenantId: String(tenant._id),
    slug: tenant.slug,
    source
  };

  if (
    req.user &&
    !req.user.roles.includes("super_admin") &&
    req.user.tenantId &&
    String(req.user.tenantId) !== String(tenant._id)
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
