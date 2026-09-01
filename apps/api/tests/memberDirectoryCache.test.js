import {
  citiesCacheByTenant,
  cityPeopleCacheByTenant,
  clearMemberDirectoryCaches,
  homeStatsResponseCache,
  locationsStatsResponseCache
} from "../src/services/memberDirectoryCache.js";

const TENANT = "5f87cef25f677d340dca6426";
const OTHER_TENANT = "b42c7e19d5a8406fb3e1c7d4";

function primeCaches() {
  homeStatsResponseCache.set(`stats-home:${TENANT}:`, { totalAlumni: 359 });
  locationsStatsResponseCache.set(`stats-locations:${TENANT}:`, { totalLocations: 143 });
  citiesCacheByTenant.set(TENANT, { data: [{ city: "New York", count: 40 }], expiresAt: Date.now() + 20_000 });
  cityPeopleCacheByTenant.set(TENANT, new Map([["new-york-ny", { data: [], expiresAt: Date.now() + 20_000 }]]));
  citiesCacheByTenant.set(OTHER_TENANT, { data: [], expiresAt: Date.now() + 20_000 });
}

describe("member directory caches", () => {
  beforeEach(() => {
    clearMemberDirectoryCaches();
  });

  // The bug this guards: a director deleted a member and the home page kept
  // showing the pre-delete total, because the admin write cleared only the
  // admin caches and left the member-facing totals in place.
  test("a member write drops the totals the home page reads", () => {
    primeCaches();

    clearMemberDirectoryCaches(TENANT);

    expect(homeStatsResponseCache.get(`stats-home:${TENANT}:`)).toBeNull();
    expect(locationsStatsResponseCache.get(`stats-locations:${TENANT}:`)).toBeNull();
    expect(citiesCacheByTenant.has(TENANT)).toBe(false);
    expect(cityPeopleCacheByTenant.has(TENANT)).toBe(false);
  });

  test("keeps another network's map entries when a tenant is named", () => {
    primeCaches();

    clearMemberDirectoryCaches(TENANT);

    expect(citiesCacheByTenant.has(OTHER_TENANT)).toBe(true);
  });

  test("drops every network's map entries when no tenant is named", () => {
    primeCaches();

    clearMemberDirectoryCaches();

    expect(citiesCacheByTenant.size).toBe(0);
    expect(cityPeopleCacheByTenant.size).toBe(0);
  });
});
