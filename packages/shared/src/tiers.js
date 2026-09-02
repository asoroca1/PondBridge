// Tiered access helpers shared by the API and the web app so both agree on what
// a tier can reach. Deliberately free of any module-catalog import: these
// functions operate on whatever keys they are handed, which keeps them usable
// from index.js without a circular import.

export const MIN_ACCESS_TIERS = 2;
export const MAX_ACCESS_TIERS = 6;

/** A floor of 0 means nobody; anything else is the deepest rank that gets it. */
export function normalizeTierModuleFloors(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const floors = {};
  for (const [key, raw] of Object.entries(source)) {
    const moduleKey = String(key || "").trim();
    if (!moduleKey) continue;
    const floor = Number(raw);
    if (!Number.isFinite(floor)) continue;
    floors[moduleKey] = Math.min(Math.max(Math.trunc(floor), 0), MAX_ACCESS_TIERS);
  }
  return floors;
}

/**
 * Feature access cascades upward: a floor of 3 means tiers 1, 2 and 3 get the
 * module and everyone below loses it. A module with no floor recorded is
 * unrestricted, so existing camps keep every module they already had.
 */
export function resolveModulesForTier(modules = {}, floors = {}, viewerRank = null) {
  const resolved = { ...(modules && typeof modules === "object" ? modules : {}) };
  const rank = Number(viewerRank);
  if (!Number.isFinite(rank) || rank < 1) return resolved;

  const normalized = normalizeTierModuleFloors(floors);
  for (const [moduleKey, floor] of Object.entries(normalized)) {
    if (resolved[moduleKey] === false) continue;
    if (rank > floor) resolved[moduleKey] = false;
  }
  return resolved;
}

/** Plain-English summary of a floor, used by the director-facing grid. */
export function describeTierFloor(floor = 0, bottomRank = 0) {
  const value = Number(floor);
  if (!Number.isFinite(value) || value <= 0) return "Nobody";
  if (bottomRank && value >= bottomRank) return "Every tier";
  if (value === 1) return "Tier 1 only";
  return `Tiers 1-${value}`;
}
