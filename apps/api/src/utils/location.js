const US_STATE_CODES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA",
  "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM",
  "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA",
  "WV", "WI", "WY"
]);

const CITY_ALIASES_GLOBAL = new Map([
  ["nyc", "New York"],
  ["new york city", "New York"],
  ["san fran", "San Francisco"],
  ["sf", "San Francisco"],
  ["philly", "Philadelphia"],
  ["vegas", "Las Vegas"],
  ["nola", "New Orleans"]
]);

const CITY_ALIASES_BY_STATE = new Map([
  ["CA|la", "Los Angeles"],
  ["CA|l a", "Los Angeles"],
  ["CA|l.a.", "Los Angeles"],
  ["DC|washington dc", "Washington"],
  ["DC|washington d c", "Washington"],
  ["DC|d c", "Washington"],
  ["DC|d.c.", "Washington"]
]);

const COUNTRY_ALIASES = new Map([
  ["usa", "United States"],
  ["u s a", "United States"],
  ["us", "United States"],
  ["u s", "United States"],
  ["united states of america", "United States"],
  ["uk", "United Kingdom"],
  ["u k", "United Kingdom"],
  ["great britain", "United Kingdom"],
  ["uae", "United Arab Emirates"],
  ["u a e", "United Arab Emirates"]
]);

export function normalizeLocationToken(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toTitleCase(value = "") {
  const smallWords = new Set(["and", "or", "the", "of", "de", "da", "la", "le"]);
  return String(value || "")
    .trim()
    .split(/\s+/)
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (index > 0 && smallWords.has(lower)) return lower;
      return lower.slice(0, 1).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

export function canonicalizeCountryName(input = "") {
  const raw = String(input || "").replace(/\s+/g, " ").trim();
  if (!raw) return "";
  const key = normalizeLocationToken(raw);
  if (COUNTRY_ALIASES.has(key)) return COUNTRY_ALIASES.get(key) || "";
  return toTitleCase(raw);
}

export function canonicalizeCityName(input = "", { state = "", country = "" } = {}) {
  const raw = String(input || "").replace(/\s+/g, " ").trim();
  if (!raw) return "";

  const stateCode = String(state || "").trim().toUpperCase();
  const token = normalizeLocationToken(raw);
  const stateAliasKey = `${stateCode}|${token}`;
  if (CITY_ALIASES_BY_STATE.has(stateAliasKey)) {
    return CITY_ALIASES_BY_STATE.get(stateAliasKey) || "";
  }
  if (CITY_ALIASES_GLOBAL.has(token)) {
    return CITY_ALIASES_GLOBAL.get(token) || "";
  }

  const countryName = canonicalizeCountryName(country);
  if (
    countryName === "United States" &&
    stateCode === "DC" &&
    (token === "washington dc" || token === "washington d c" || token === "d c")
  ) {
    return "Washington";
  }

  return toTitleCase(raw);
}

export function parseCityStateDetailed(raw = "") {
  const parts = String(raw || "")
    .split(",")
    .map((piece) => piece.trim())
    .filter(Boolean);

  const city = canonicalizeCityName(parts[0] || "");
  if (parts.length < 2) return { city, state: "", country: "" };

  const second = String(parts[1] || "").trim();
  const secondUpper = second.toUpperCase();
  if (US_STATE_CODES.has(secondUpper)) {
    const country = parts.length >= 3 ? canonicalizeCountryName(parts[parts.length - 1] || "") : "";
    return {
      city: canonicalizeCityName(city, { state: secondUpper, country }),
      state: secondUpper,
      country
    };
  }

  const country = canonicalizeCountryName(parts[parts.length - 1] || second);
  return {
    city: canonicalizeCityName(city, { country }),
    state: "",
    country
  };
}

export function composeCityState({ city = "", state = "", country = "" } = {}) {
  const normalizedState = String(state || "").trim().toUpperCase();
  const normalizedCountry = canonicalizeCountryName(country);
  const normalizedCity = canonicalizeCityName(city, {
    state: normalizedState,
    country: normalizedCountry
  });

  if (!normalizedCity && !normalizedState && !normalizedCountry) return "";
  if (normalizedState) return [normalizedCity, normalizedState].filter(Boolean).join(", ");
  return [normalizedCity, normalizedCountry].filter(Boolean).join(", ");
}

export function isUsStateCode(value = "") {
  return US_STATE_CODES.has(String(value || "").trim().toUpperCase());
}
