import { createTtlCache } from "../utils/ttlCache.js";

/**
 * The directory-search caches: a result page, the name suggestions, and the
 * facets that drive the advanced-search pickers.
 *
 * They live here rather than next to the search routes because the writes that
 * change them happen elsewhere — a member saving their profile, or a director
 * editing the camp's roles in the admin console. When search owned its own
 * caches, a role a director had just added stayed missing from the picker until
 * the two-minute facets entry aged out.
 */
export const searchResponseCache = createTtlCache({ ttlMs: 15_000, maxEntries: 500 });
export const searchNamesResponseCache = createTtlCache({ ttlMs: 15_000, maxEntries: 800 });
// Facets scan the whole directory, so they are cached longer than a result page.
export const searchFacetsResponseCache = createTtlCache({ ttlMs: 120_000, maxEntries: 200 });

/**
 * Call after any write that changes what the directory contains: a profile
 * save, a member added or removed, or a change to the camp's configured roles.
 * Entries are keyed by tenant, so a tenant id drops only that camp's entries;
 * without one every tenant's entries go, which is the safe default for callers
 * that clear a batch of caches at once.
 */
export function clearSearchCaches(tenantId = "") {
  const id = String(tenantId || "").trim();
  // Every search cache key is "<name>:<tenantId>:...", so the second segment scopes it.
  const scope = id ? (key) => key.split(":")[1] === id : null;
  searchResponseCache.clear(scope);
  searchNamesResponseCache.clear(scope);
  searchFacetsResponseCache.clear(scope);
}
