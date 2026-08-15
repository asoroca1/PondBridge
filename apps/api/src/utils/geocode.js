// Nominatim's usage policy requires a contact that actually reaches someone.
// This previously claimed `support@pondbridge.local`, a domain that does not
// exist, which is the kind of thing they block for.
const NOMINATIM_USER_AGENT = "PondBridge/1.0 (support@pondbridgealumni.com)";
const NOMINATIM_MIN_INTERVAL_MS = 1100;

// Some values members type will never geocode — "Remote", "N/A", a typo. With
// no memory of failures those were retried on every map request, each costing a
// full rate-limit wait and delaying the cities that can resolve.
const FAILURE_BACKOFF_MS = [
  60 * 1000,
  10 * 60 * 1000,
  60 * 60 * 1000,
  24 * 60 * 60 * 1000
];
const failureState = new Map();

let lastNominatimCallAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function cityKey(city = "", state = "") {
  return `${String(city).trim()}-${String(state).trim()}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/** True when this city failed recently and its backoff has not elapsed. */
export function shouldSkipGeocode(key, now = Date.now()) {
  const state = failureState.get(String(key || ""));
  if (!state) return false;
  return now < state.retryAfter;
}

export function recordGeocodeFailure(key, now = Date.now()) {
  const id = String(key || "");
  if (!id) return;
  const previous = failureState.get(id);
  const failures = (previous?.failures || 0) + 1;
  const wait = FAILURE_BACKOFF_MS[Math.min(failures - 1, FAILURE_BACKOFF_MS.length - 1)];
  failureState.set(id, { failures, retryAfter: now + wait });
}

export function clearGeocodeFailure(key) {
  failureState.delete(String(key || ""));
}

export function resetGeocodeFailures() {
  failureState.clear();
}

function buildQuery(city, state) {
  const c = String(city || "").trim();
  const s = String(state || "").trim();
  const parts = [];
  if (c) parts.push(c);
  if (s) parts.push(s.toUpperCase());
  if (/^[A-Z]{2}$/.test(s.toUpperCase())) parts.push("USA");
  return parts.join(", ");
}

async function geocodeWithNominatim(city, state) {
  // Wait only for the remainder of the interval since the last call, rather
  // than a flat second on every lookup whether one is owed or not.
  const owed = NOMINATIM_MIN_INTERVAL_MS - (Date.now() - lastNominatimCallAt);
  if (owed > 0) await sleep(owed);
  lastNominatimCallAt = Date.now();

  const query = encodeURIComponent(buildQuery(city, state));
  const url = `https://nominatim.openstreetmap.org/search?q=${query}&format=json&limit=1&addressdetails=0`;
  const response = await fetch(url, {
    headers: { "User-Agent": NOMINATIM_USER_AGENT }
  });
  if (!response.ok) throw new Error(`Nominatim HTTP ${response.status}`);
  const rows = await response.json();
  if (!Array.isArray(rows) || rows.length < 1) throw new Error("No geocode result");
  return { lat: Number(rows[0].lat), lng: Number(rows[0].lon), source: "nominatim" };
}

async function geocodeWithMapbox(city, state, token) {
  const query = encodeURIComponent(buildQuery(city, state));
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${query}.json?types=place,locality,region&limit=1&access_token=${token}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Mapbox HTTP ${response.status}`);
  const payload = await response.json();
  const first = payload?.features?.[0];
  if (!first?.center) throw new Error("No geocode result");
  return { lat: Number(first.center[1]), lng: Number(first.center[0]), source: "mapbox" };
}

export async function geocodeCity(city, state) {
  const token = process.env.MAPBOX_TOKEN;
  if (token) return geocodeWithMapbox(city, state, token);
  return geocodeWithNominatim(city, state);
}
