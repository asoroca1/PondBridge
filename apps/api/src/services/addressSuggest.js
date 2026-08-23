/**
 * Address type-ahead for the director onboarding account step.
 *
 * Mapbox is used when a token is configured; otherwise Photon, a free
 * OpenStreetMap geocoder built for type-ahead. Nominatim — which the city
 * geocoder falls back to — is deliberately not an option here: its usage
 * policy forbids autocomplete, and a per-keystroke endpoint is exactly that.
 *
 * When no provider answers, the caller gets an empty list rather than an
 * error. The address fields stay usable by hand, which is the behavior that
 * matters; the popup is an accelerator, not a requirement.
 */

const PHOTON_ENDPOINT = "https://photon.komoot.io/api/";
const MAPBOX_ENDPOINT = "https://api.mapbox.com/geocoding/v5/mapbox.places";
const REQUEST_TIMEOUT_MS = 4000;
const MAX_RESULTS = 5;
const MIN_QUERY_LENGTH = 3;

function text(value = "") {
  return String(value || "").trim();
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function buildSuggestion({ line1, city, state, postalCode, country }) {
  const cleanLine1 = text(line1);
  const cleanCity = text(city);
  if (!cleanLine1 || !cleanCity) return null;

  const locality = [cleanCity, text(state), text(postalCode)]
    .filter(Boolean)
    .join(", ")
    .replace(/, ([^,]+)$/, " $1");

  return {
    label: [cleanLine1, locality, text(country)].filter(Boolean).join(", "),
    address: {
      line1: cleanLine1,
      line2: "",
      city: cleanCity,
      state: text(state),
      postalCode: text(postalCode),
      country: text(country) || "United States"
    }
  };
}

async function suggestWithPhoton(query, country) {
  const params = new URLSearchParams({
    q: query,
    limit: String(MAX_RESULTS * 2),
    lang: "en"
  });
  const payload = await fetchJson(`${PHOTON_ENDPOINT}?${params.toString()}`);
  const features = Array.isArray(payload?.features) ? payload.features : [];

  return features
    .map((feature) => {
      const props = feature?.properties || {};
      // Photon returns a house number and street separately; a result with
      // neither is a city or region, which is not a mailing address.
      const houseNumber = text(props.housenumber);
      const street = text(props.street) || text(props.name);
      if (!street) return null;
      return buildSuggestion({
        line1: [houseNumber, street].filter(Boolean).join(" "),
        city: props.city || props.town || props.village || props.county,
        state: props.state,
        postalCode: props.postcode,
        country: props.country
      });
    })
    .filter(Boolean)
    .filter((item) => (country ? item.address.country === country : true));
}

async function suggestWithMapbox(query, token, country) {
  const params = new URLSearchParams({
    autocomplete: "true",
    types: "address",
    limit: String(MAX_RESULTS),
    access_token: token
  });
  if (country) params.set("country", country);

  const payload = await fetchJson(
    `${MAPBOX_ENDPOINT}/${encodeURIComponent(query)}.json?${params.toString()}`
  );
  const features = Array.isArray(payload?.features) ? payload.features : [];

  return features
    .map((feature) => {
      const context = Array.isArray(feature?.context) ? feature.context : [];
      const part = (prefix) =>
        context.find((entry) => String(entry?.id || "").startsWith(prefix))?.text || "";
      const region = context.find((entry) => String(entry?.id || "").startsWith("region"));
      return buildSuggestion({
        line1: [text(feature.address), text(feature.text)].filter(Boolean).join(" "),
        city: part("place") || part("locality"),
        state: region?.short_code?.split("-")?.[1] || region?.text || "",
        postalCode: part("postcode"),
        country: part("country")
      });
    })
    .filter(Boolean);
}

/**
 * @returns {Promise<{suggestions: Array, provider: string}>}
 */
export async function suggestAddresses(rawQuery = "", { countryCode = "" } = {}) {
  const query = text(rawQuery);
  if (query.length < MIN_QUERY_LENGTH) {
    return { suggestions: [], provider: "none" };
  }

  const token = text(process.env.MAPBOX_TOKEN);
  const normalizedCountry = text(countryCode).toLowerCase();

  if (token) {
    try {
      const suggestions = await suggestWithMapbox(query, token, normalizedCountry);
      return { suggestions: suggestions.slice(0, MAX_RESULTS), provider: "mapbox" };
    } catch {
      // Fall through to the free provider rather than failing the field.
    }
  }

  try {
    const suggestions = await suggestWithPhoton(query, "");
    return { suggestions: suggestions.slice(0, MAX_RESULTS), provider: "photon" };
  } catch {
    return { suggestions: [], provider: "unavailable" };
  }
}
