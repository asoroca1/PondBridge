import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireTenantAuthScope } from "../middleware/tenantAccess.js";
import { getSupabaseAdmin } from "../db/supabaseAdmin.js";
import { CityGeoModel } from "../db/models/index.js";
import { cityKey, geocodeCity } from "../utils/geocode.js";
import {
  canonicalizeCityName,
  canonicalizeCountryName,
  isUsStateCode
} from "../utils/location.js";

const router = Router({ mergeParams: true });
router.use(...requireTenantAuthScope);

const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `geo-search:${req.ip}:${req.params?.slug || ""}`
});

const addLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `geo-add:${req.ip}:${req.params?.slug || ""}`,
  message: {
    error: { code: "RATE_LIMITED", message: "Too many city add requests." }
  }
});

const countryNames =
  typeof Intl !== "undefined" && typeof Intl.DisplayNames === "function"
    ? new Intl.DisplayNames(["en"], { type: "region" })
    : null;

function countryLabel(code) {
  const trimmed = String(code || "").trim().toUpperCase();
  if (!trimmed) return "";
  try {
    return countryNames?.of(trimmed) || trimmed;
  } catch {
    return trimmed;
  }
}

function serializeCity(row) {
  if (!row) return null;
  const state = String(row.state || "").trim();
  const country = String(row.country || "").trim().toUpperCase();
  const label =
    country === "US" && state
      ? `${row.city}, ${state}`
      : `${row.city}, ${countryLabel(country)}`;
  return {
    key: row.key,
    city: row.city,
    state,
    country,
    population: Number(row.population) || 0,
    label
  };
}

router.get("/cities", searchLimiter, async (req, res) => {
  const query = String(req.query.q || "").trim();
  const limit = Math.max(1, Math.min(25, Number(req.query.limit) || 10));
  if (query.length < 2) return res.json({ results: [] });

  const prefix = query.replace(/%/g, "");
  const { data, error } = await getSupabaseAdmin()
    .from("city_geo")
    .select("key, city, state, country, population")
    .ilike("city", `${prefix}%`)
    .order("population", { ascending: false })
    .limit(limit);

  if (error) {
    return res.status(500).json({ error: { code: "CITY_SEARCH_FAILED", message: error.message } });
  }
  return res.json({ results: (data || []).map(serializeCity).filter(Boolean) });
});

router.post("/cities", addLimiter, async (req, res) => {
  const rawCity = String(req.body?.city || "").trim();
  const rawState = String(req.body?.state || "").trim();
  const rawCountry = String(req.body?.country || "").trim();
  if (!rawCity) {
    return res.status(400).json({ error: { code: "CITY_REQUIRED", message: "City is required." } });
  }

  const countryName = canonicalizeCountryName(rawCountry);
  const countryCode =
    countryName === "United States" || /^us$/i.test(rawCountry) ? "US" : rawCountry.toUpperCase();
  const state = isUsStateCode(rawState) ? rawState.toUpperCase() : rawState;
  const city = canonicalizeCityName(rawCity, { state, country: countryName });
  const key = cityKey(city, state || countryCode);

  const existing = await CityGeoModel.findByKey(key);
  if (existing) {
    return res.json({ city: serializeCity(existing), created: false });
  }

  let lat = null;
  let lng = null;
  let source = "manual";
  try {
    const geo = await geocodeCity(city, state || countryCode);
    if (geo && Number.isFinite(geo.lat) && Number.isFinite(geo.lng)) {
      lat = geo.lat;
      lng = geo.lng;
      source = `manual:${geo.source || "geocoded"}`;
    }
  } catch {
    // Non-fatal: record without coordinates and let a future geocode fill them in.
  }

  const created = await CityGeoModel.create({
    key,
    city,
    state: state || "",
    country: countryCode || "",
    population: 0,
    lat,
    lng,
    source
  });

  return res.status(201).json({ city: serializeCity(created), created: true });
});

export default router;
