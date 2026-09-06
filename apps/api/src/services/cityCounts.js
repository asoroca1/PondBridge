import { ProfileModel } from "../db/models/ProfileModel.js";
import { cityKey } from "../utils/geocode.js";

const CITY_STATE_PARSE_CACHE_LIMIT = Math.max(
  1000,
  Number(process.env.MAP_CITY_STATE_PARSE_CACHE_LIMIT || 6000)
);
const parsedCityStateCache = new Map();

function norm(value = "") {
  return String(value || "").trim();
}

/**
 * Split a free-text location into city and state.
 *
 *   "Boston, MA"    -> { city: "Boston", state: "MA" }
 *   "a, b, c"       -> { city: "a", state: "B" }   (split(",", 2) keeps two pieces)
 *   "Ann Arbor MI"  -> { city: "Ann Arbor", state: "MI" }
 *   "San Francisco" -> { city: "San Francisco", state: "" }
 */
export function parseCityState(raw = "") {
  const value = String(raw || "").trim();
  if (!value) return { city: "", state: "" };
  const cacheKey = value.toLowerCase();
  const cached = parsedCityStateCache.get(cacheKey);
  if (cached) return { ...cached };

  let parsed = { city: value, state: "" };
  if (value.includes(",")) {
    const [city, state] = value.split(",", 2).map((part) => String(part || "").trim());
    parsed = { city, state: state.toUpperCase() };
  } else {
    const parts = value.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      const maybeState = parts[parts.length - 1];
      if (/^[A-Za-z]{2,3}$/.test(maybeState)) {
        parsed = {
          city: parts.slice(0, -1).join(" ").trim(),
          state: maybeState.toUpperCase()
        };
      }
    }
  }

  if (parsedCityStateCache.size >= CITY_STATE_PARSE_CACHE_LIMIT) {
    parsedCityStateCache.clear();
  }
  parsedCityStateCache.set(cacheKey, parsed);
  return { ...parsed };
}

/**
 * One entry per map pin: `{ key, city, state, count }`.
 *
 * The database groups the free-text column, so what arrives is one row per
 * distinct city string with a count attached — about sixty rows for a camp of
 * three thousand, in one request rather than three pages of every member.
 *
 * The fold below adds each row's count. It used to add one per row, which is the
 * same answer right up until two spellings land on the same pin: "St. Louis, MO"
 * and "St Louis, MO" are two rows and one pin, and counting rows would report
 * two members standing where ninety do.
 */
export async function aggregateCityCounts(tenantId, { hiddenUserIds = null } = {}) {
  const rows = await ProfileModel.cityStateCounts(tenantId, hiddenUserIds);

  const byKey = new Map();
  for (const row of rows) {
    const parsed = parseCityState(row?.cityState || "");
    const city = norm(parsed.city);
    const state = norm(parsed.state);
    if (!city && !state) continue;

    const key = cityKey(city, state);
    if (!key) continue;

    const count = Number(row?.count || 0);
    if (byKey.has(key)) {
      byKey.get(key).count += count;
    } else {
      byKey.set(key, { key, city, state, count });
    }
  }

  return [...byKey.values()];
}
