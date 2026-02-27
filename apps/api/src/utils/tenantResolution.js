import { env } from "../config/env.js";
import { TenantModel } from "../db/models/index.js";

const RESERVED_SUBDOMAINS = new Set(["www", "app", "api", "super"]);

function stripPort(value = "") {
  return String(value || "").trim().toLowerCase().split(":")[0];
}

function normalizeHost(value = "") {
  return stripPort(String(value || "").replace(/^https?:\/\//i, "").split("/")[0]);
}

function hasIpv4Shape(host = "") {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(String(host || ""));
}

function shouldIgnoreCandidate(candidate = "") {
  const normalized = String(candidate || "").trim().toLowerCase();
  return !normalized || RESERVED_SUBDOMAINS.has(normalized);
}

export function extractTenantSlugFromHost(host = "") {
  const normalizedHost = normalizeHost(host);
  if (!normalizedHost || normalizedHost === "localhost" || hasIpv4Shape(normalizedHost)) return "";

  if (normalizedHost.endsWith(".localhost")) {
    const localPrefix = normalizedHost.slice(0, -".localhost".length);
    const localCandidate = String(localPrefix.split(".")[0] || "").trim().toLowerCase();
    return shouldIgnoreCandidate(localCandidate) ? "" : localCandidate;
  }

  const suffixes = [...(env.TENANT_HOST_SUFFIXES || [])]
    .map((value) => normalizeHost(value))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  for (const suffix of suffixes) {
    if (normalizedHost === suffix) continue;
    if (!normalizedHost.endsWith(`.${suffix}`)) continue;
    const prefix = normalizedHost.slice(0, -1 * (suffix.length + 1));
    const candidate = String(prefix.split(".")[0] || "").trim().toLowerCase();
    if (!shouldIgnoreCandidate(candidate)) return candidate;
  }

  return "";
}

function readHostFromRequest(req) {
  const forwarded = String(req.headers["x-forwarded-host"] || "")
    .split(",")[0]
    .trim();
  if (forwarded) return normalizeHost(forwarded);
  return normalizeHost(req.headers.host || "");
}

function readSlugFromPath(req) {
  const fromParam = String(req.params?.slug || "").trim().toLowerCase();
  if (fromParam) return { slug: fromParam, source: "path_param" };

  const pathLike = String(req.originalUrl || req.url || "");
  const match = pathLike.match(/\/t\/([^/?#]+)/i);
  const fromPath = String(match?.[1] || "").trim().toLowerCase();
  if (fromPath) return { slug: fromPath, source: "url_prefix" };

  return { slug: "", source: "missing" };
}

export function resolveTenantHint(req, { allowHeaderSlug = true } = {}) {
  const pathContext = readSlugFromPath(req);
  if (pathContext.slug) {
    return {
      slug: pathContext.slug,
      source: pathContext.source,
      host: readHostFromRequest(req)
    };
  }

  const host = readHostFromRequest(req);
  const fromHost = extractTenantSlugFromHost(host);
  if (fromHost) {
    return { slug: fromHost, source: "subdomain", host };
  }

  if (allowHeaderSlug) {
    const fromHeader = String(req.headers["x-tenant-slug"] || "").trim().toLowerCase();
    if (fromHeader) {
      return { slug: fromHeader, source: "header", host };
    }
  }

  return { slug: "", source: "missing", host };
}

export async function resolveTenantFromRequest(req, { allowHeaderSlug = true } = {}) {
  const hint = resolveTenantHint(req, { allowHeaderSlug });
  if (hint.slug) {
    const tenant = await TenantModel.findBySlug(hint.slug);
    return {
      tenant,
      tenantId: tenant ? String(tenant._id) : "",
      slug: hint.slug,
      source: hint.source,
      host: hint.host || ""
    };
  }

  if (hint.host) {
    const tenant = await TenantModel.findByDomain(hint.host);
    return {
      tenant,
      tenantId: tenant ? String(tenant._id) : "",
      slug: tenant ? String(tenant.slug || "").trim().toLowerCase() : "",
      source: tenant ? "domain" : hint.source,
      host: hint.host
    };
  }

  return {
    tenant: null,
    tenantId: "",
    slug: "",
    source: hint.source,
    host: ""
  };
}
