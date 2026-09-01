import { createTtlCache } from "../utils/ttlCache.js";

/**
 * The member-facing caches that hold a headcount: the home page's Community
 * Pulse totals and the alumni map.
 *
 * They live here rather than next to the routes that read them because the
 * writes that change a headcount happen somewhere else entirely — a director
 * removing or deleting a member in the admin console. When each side owned its
 * own caches, the admin write cleared only the admin ones and the member home
 * page kept showing the pre-delete total until the entry aged out.
 */
export const homeStatsResponseCache = createTtlCache({ ttlMs: 20_000, maxEntries: 250 });
export const locationsStatsResponseCache = createTtlCache({ ttlMs: 20_000, maxEntries: 250 });

// tenantId -> { data, expiresAt, inflight }
export const citiesCacheByTenant = new Map();
// tenantId -> Map(cityKey -> { data, expiresAt, inflight })
export const cityPeopleCacheByTenant = new Map();

export function clearHomeStatsCaches() {
  homeStatsResponseCache.clear();
  locationsStatsResponseCache.clear();
}

export function invalidateMapCaches(tenantId = "") {
  const id = String(tenantId || "");
  if (!id) {
    citiesCacheByTenant.clear();
    cityPeopleCacheByTenant.clear();
    return;
  }
  citiesCacheByTenant.delete(id);
  cityPeopleCacheByTenant.delete(id);
}

/**
 * Call after any write that adds, removes, or changes the status of a member.
 * Without a tenant id every tenant's entries are dropped, which is the safe
 * default for callers that clear a batch of caches at once.
 */
export function clearMemberDirectoryCaches(tenantId = "") {
  clearHomeStatsCaches();
  invalidateMapCaches(tenantId);
}
