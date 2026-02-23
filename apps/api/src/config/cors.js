import { env } from "./env.js";

function tryParseOrigin(origin) {
  try {
    const parsed = new URL(origin);
    return {
      origin: parsed.origin,
      hostname: parsed.hostname.toLowerCase()
    };
  } catch {
    return null;
  }
}

function isBaseDomainMatch(hostname, baseDomain) {
  const safeHost = String(hostname || "").toLowerCase();
  const safeBase = String(baseDomain || "").toLowerCase();
  if (!safeHost || !safeBase) return false;
  return safeHost === safeBase || safeHost.endsWith(`.${safeBase}`);
}

export function isAllowedCorsOrigin(origin) {
  if (!origin) return true;

  const parsed = tryParseOrigin(origin);
  if (!parsed) return false;

  if (env.FRONTEND_ORIGINS.includes(parsed.origin)) return true;

  if (env.CORS_ALLOW_SUBDOMAIN_ORIGINS && isBaseDomainMatch(parsed.hostname, env.APP_BASE_DOMAIN)) {
    return true;
  }

  if (env.CUSTOM_DOMAIN_ALLOWLIST.includes(parsed.hostname)) {
    return true;
  }

  return false;
}

export function corsOriginDelegate(origin, callback) {
  if (isAllowedCorsOrigin(origin)) {
    return callback(null, true);
  }

  return callback(null, false);
}
