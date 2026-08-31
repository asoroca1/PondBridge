import { resolveTenantDomain } from "./domainProvisioning.js";

// Short-lived in-process cache for the unauthenticated tenant lookups. Tenant
// records change rarely once a network is live, but they change constantly
// while a director is still in onboarding, so every write path invalidates the
// entries for that tenant instead of letting them age out.
const PUBLIC_RESPONSE_CACHE_TTL_MS = 60 * 1000;
const PUBLIC_RESPONSE_CACHE_MAX_ENTRIES = 300;
const CACHED_PUBLIC_ENDPOINTS = ["tenant-config", "tenant-status"];

const publicResponseCache = new Map();

export function publicResponseCacheKey(endpoint = "", lookup = "", value = "") {
  const normalizedEndpoint = String(endpoint || "").trim().toLowerCase();
  const normalizedLookup = String(lookup || "").trim().toLowerCase();
  const normalizedValue = String(value || "").trim().toLowerCase();
  if (!normalizedEndpoint || !normalizedLookup || !normalizedValue) return "";
  return `${normalizedEndpoint}:${normalizedLookup}:${normalizedValue}`;
}

export function readPublicResponseCache(cacheKey = "") {
  if (!cacheKey) return null;
  const entry = publicResponseCache.get(cacheKey);
  if (!entry) return null;
  if (Date.now() >= Number(entry.expiresAt || 0)) {
    publicResponseCache.delete(cacheKey);
    return null;
  }
  return entry.payload || null;
}

export function writePublicResponseCache(cacheKey = "", payload = null) {
  if (!cacheKey || !payload || typeof payload !== "object") return;
  if (publicResponseCache.size >= PUBLIC_RESPONSE_CACHE_MAX_ENTRIES) {
    const firstKey = publicResponseCache.keys().next().value;
    if (firstKey) publicResponseCache.delete(firstKey);
  }
  publicResponseCache.set(cacheKey, {
    expiresAt: Date.now() + PUBLIC_RESPONSE_CACHE_TTL_MS,
    payload
  });
}

// Drops every cached public payload for a tenant, by slug and by any host it
// answers on. Called after a tenant write so the next public read reflects it.
export function invalidatePublicTenantCache(tenant = {}) {
  if (!tenant || typeof tenant !== "object") return;

  const lookups = [
    ["slug", tenant.slug],
    ["host", tenant.customDomain],
    ["host", resolveTenantDomain(tenant)]
  ];

  for (const endpoint of CACHED_PUBLIC_ENDPOINTS) {
    for (const [lookup, value] of lookups) {
      const key = publicResponseCacheKey(endpoint, lookup, value);
      if (key) publicResponseCache.delete(key);
    }
  }
}

export function clearPublicResponseCache() {
  publicResponseCache.clear();
}
