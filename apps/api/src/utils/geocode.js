function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function cityKey(city = "", state = "") {
  return `${String(city).trim()}-${String(state).trim()}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
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
  const query = encodeURIComponent(buildQuery(city, state));
  const url = `https://nominatim.openstreetmap.org/search?q=${query}&format=json&limit=1&addressdetails=0`;
  const response = await fetch(url, {
    headers: { "User-Agent": "PondBridge/1.0 (support@pondbridge.local)" }
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
  await sleep(1100);
  return geocodeWithNominatim(city, state);
}
