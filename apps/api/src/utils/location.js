const US_STATE_CODES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA",
  "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM",
  "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA",
  "WV", "WI", "WY"
]);
const US_STATE_NAMES = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut",
  DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho",
  IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine",
  MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri",
  MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico",
  NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee",
  TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia",
  WI: "Wisconsin", WY: "Wyoming"
};

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

const US_STATE_NAME_TO_CODE = new Map(
  Object.entries(US_STATE_NAMES).map(([code, name]) => [normalizeLocationToken(name), code])
);

function normalizeUsStateCode(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const upper = raw.toUpperCase();
  if (US_STATE_CODES.has(upper)) return upper;
  const token = normalizeLocationToken(raw);
  return US_STATE_NAME_TO_CODE.get(token) || "";
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
  const value = String(raw || "").replace(/\s+/g, " ").trim();
  if (!value) return { city: "", state: "", country: "" };

  const fromParts = (cityPart = "", regionPart = "", remainder = []) => {
    const stateCode = normalizeUsStateCode(regionPart);
    if (stateCode) {
      const country = remainder.length
        ? canonicalizeCountryName(remainder[remainder.length - 1] || "")
        : "";
      return {
        city: canonicalizeCityName(cityPart, { state: stateCode, country }),
        state: stateCode,
        country
      };
    }

    const country = canonicalizeCountryName(remainder.length ? remainder[remainder.length - 1] : regionPart);
    return {
      city: canonicalizeCityName(cityPart, { country }),
      state: "",
      country
    };
  };

  const parts = value.split(",").map((piece) => piece.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return fromParts(parts[0] || "", parts[1] || "", parts.slice(2));
  }

  const tokens = value.split(" ").filter(Boolean);
  for (let len = 3; len >= 1; len -= 1) {
    if (tokens.length <= len) continue;
    const maybeState = tokens.slice(tokens.length - len).join(" ");
    const stateCode = normalizeUsStateCode(maybeState);
    if (!stateCode) continue;
    const cityPart = tokens.slice(0, tokens.length - len).join(" ");
    return fromParts(cityPart, stateCode, []);
  }

  if (tokens.length >= 2) {
    const maybeCountry = tokens[tokens.length - 1];
    const aliasedCountry = COUNTRY_ALIASES.get(normalizeLocationToken(maybeCountry));
    if (aliasedCountry) {
      const cityPart = tokens.slice(0, -1).join(" ");
      return fromParts(cityPart, aliasedCountry, []);
    }
  }

  return {
    city: canonicalizeCityName(value),
    state: "",
    country: ""
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
