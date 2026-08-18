import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import CedarBackground from "../components/CedarBackground";
import CedarPageHeader from "../components/CedarPageHeader.jsx";
import { MapPin, RotateCcw, X } from "lucide-react";
import { API_BASE } from "../lib/api";
import { getToken, initialsOf, avatarUrl } from "../lib/helpers.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { useTenant } from "../../context/TenantContext.jsx";
import { formatMappedAlumniSummary } from "../../lib/alumniTotals.js";
import { resolveAlumniWord } from "../../lib/campLabels.js";
import { tenantRoute } from "../../lib/tenantRouting.js";
import "./location-map.css";

function nameOf(p) {
  const full = [p.firstName, p.lastName].filter(Boolean).join(" ").trim();
  return full || "Camp Member";
}

function cityLabel(c) {
  return [c.city, c.state].filter(Boolean).join(", ");
}

const CLUSTER_SOURCE_ID = "lm-cities";
const CLUSTER_LAYER_ID = "lm-cluster";
const CITY_LAYER_ID = "lm-city";

function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = (value) => (Number(value) * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function computeRegionFocus(cities = []) {
  const list = (Array.isArray(cities) ? cities : [])
    .map((city) => ({
      ...city,
      lat: Number(city?.lat),
      lng: Number(city?.lng),
      count: Number(city?.count || 0),
    }))
    .filter((city) => Number.isFinite(city.lat) && Number.isFinite(city.lng) && city.count > 0);

  if (!list.length) return null;

  if (list.length === 1) {
    const only = list[0];
    return {
      center: [only.lng, only.lat],
      zoom: 8,
      maxZoom: 8,
      bounds: null,
    };
  }

  const radiusKm = list.length >= 120 ? 260 : list.length >= 60 ? 320 : 420;
  let bestCluster = null;

  for (const anchor of list) {
    const members = [];
    let totalCount = 0;
    let weightedDistance = 0;

    for (const candidate of list) {
      const distanceKm = haversineKm(anchor.lat, anchor.lng, candidate.lat, candidate.lng);
      if (distanceKm <= radiusKm) {
        members.push(candidate);
        totalCount += candidate.count;
        weightedDistance += distanceKm * candidate.count;
      }
    }

    const score = {
      anchor,
      members,
      totalCount,
      weightedDistance: totalCount > 0 ? weightedDistance / totalCount : Number.POSITIVE_INFINITY,
    };

    if (
      !bestCluster ||
      score.totalCount > bestCluster.totalCount ||
      (score.totalCount === bestCluster.totalCount && anchor.count > bestCluster.anchor.count) ||
      (
        score.totalCount === bestCluster.totalCount &&
        anchor.count === bestCluster.anchor.count &&
        score.weightedDistance < bestCluster.weightedDistance
      )
    ) {
      bestCluster = score;
    }
  }

  const clusterMembers = bestCluster?.members?.length
    ? bestCluster.members
    : [bestCluster?.anchor].filter(Boolean);

  let weightedLat = 0;
  let weightedLng = 0;
  let totalWeight = 0;

  for (const city of clusterMembers) {
    const weight = Math.max(1, Number(city.count || 0));
    weightedLat += city.lat * weight;
    weightedLng += city.lng * weight;
    totalWeight += weight;
  }

  const centerLat = totalWeight > 0 ? weightedLat / totalWeight : clusterMembers[0].lat;
  const centerLng = totalWeight > 0 ? weightedLng / totalWeight : clusterMembers[0].lng;

  const lats = clusterMembers.map((city) => city.lat);
  const lngs = clusterMembers.map((city) => city.lng);
  const maxDistanceKm = clusterMembers.reduce(
    (max, city) => Math.max(max, haversineKm(centerLat, centerLng, city.lat, city.lng)),
    0
  );

  if (clusterMembers.length === 1 || maxDistanceKm <= 25) {
    return {
      center: [centerLng, centerLat],
      zoom: maxDistanceKm <= 8 ? 9.2 : 8,
      maxZoom: maxDistanceKm <= 8 ? 9.2 : 8,
      bounds: null,
    };
  }

  const latPad = Math.max(0.35, (Math.max(...lats) - Math.min(...lats)) * 0.22);
  const lngPad = Math.max(0.45, (Math.max(...lngs) - Math.min(...lngs)) * 0.22);
  const maxZoom =
    maxDistanceKm <= 75 ? 7.4 : maxDistanceKm <= 160 ? 6.5 : maxDistanceKm <= 320 ? 5.6 : 4.8;

  return {
    center: [centerLng, centerLat],
    zoom: maxZoom,
    maxZoom,
    bounds: {
      minLng: Math.min(...lngs) - lngPad,
      minLat: Math.min(...lats) - latPad,
      maxLng: Math.max(...lngs) + lngPad,
      maxLat: Math.max(...lats) + latPad,
    },
  };
}

function escapeHtml(value = "") {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const DEFAULT_VIEW = { center: [-98.5795, 39.8283], zoom: 3.5 };
const CITIES_CACHE_PREFIX = "map:cities:v2:";
const CITIES_CACHE_TTL_MS = 5 * 60 * 1000;
const PEOPLE_CACHE_PREFIX = "map:city:people:v2:";
const PEOPLE_CACHE_TTL_MS = 2 * 60 * 1000;
const CITY_SYNC_RETRY_LIMIT = 8;
const CITY_SYNC_RETRY_BASE_DELAY_MS = 1500;

export default function LocationMap() {
  const { slug = "" } = useParams();
  const { getAuthToken } = useAuth();
  const { tenant } = useTenant();
  const alumniWord = resolveAlumniWord(tenant);
  const alumniWordTitle = resolveAlumniWord(tenant, { capitalized: true });

  const maplibreRuntimeRef = useRef(null);
  const mapRef = useRef(null);
  const mapEl = useRef(null);
  const resultsRef = useRef(null);

  const interactionsBoundRef = useRef(false);
  const citiesRef = useRef([]);
  const selectedRef = useRef(null);

  const loadedRef = useRef(false);
  const peopleReqRef = useRef(0);
  const peopleCacheRef = useRef(new Map());
  const cityRefreshAttemptsRef = useRef(0);
  const cityRefreshTimerRef = useRef(null);
  const hasLoadedCitiesOnceRef = useRef(false);
  const autoFocusedRef = useRef(false);

  const [cities, setCities] = useState([]);
  const [selected, setSelected] = useState(null);
  const [people, setPeople] = useState([]);
  const [loadingPeople, setLoadingPeople] = useState(false);
  const [loadingCities, setLoadingCities] = useState(true);
  const [pendingCityGeocodes, setPendingCityGeocodes] = useState(0);
  const [networkAlumni, setNetworkAlumni] = useState(0);
  const [mapRuntimeReady, setMapRuntimeReady] = useState(false);
  const [mapRuntimeError, setMapRuntimeError] = useState("");

  const tenantCacheSuffix = useMemo(
    () => String(slug || "").trim().toLowerCase() || "default",
    [slug]
  );
  const citiesCacheKey = useMemo(
    () => `${CITIES_CACHE_PREFIX}${tenantCacheSuffix}`,
    [tenantCacheSuffix]
  );
  const peopleCachePrefix = useMemo(
    () => `${PEOPLE_CACHE_PREFIX}${tenantCacheSuffix}:`,
    [tenantCacheSuffix]
  );

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  // Only members with a city we could place show up on a pin. Reporting that
  // subset as the network total made this page contradict the home page, so
  // the two numbers stay distinct and the subtitle says which is which.
  const mappedAlumni = useMemo(
    () => cities.reduce((sum, city) => sum + Number(city?.count || 0), 0),
    [cities]
  );

  const brandPrimary = useMemo(() => {
    if (typeof window === "undefined") return "#002b5c";
    const resolved = window
      .getComputedStyle(document.documentElement)
      .getPropertyValue("--brand-primary")
      .trim();
    return resolved || "#002b5c";
  }, []);

  const mappedSummary = formatMappedAlumniSummary({
    mapped: mappedAlumni,
    total: networkAlumni,
    cities: cities.length,
    alumniWord
  });

  const subtitleText =
    cities.length > 0
      ? pendingCityGeocodes > 0
        ? `${mappedSummary} • mapping ${pendingCityGeocodes} more`
        : mappedSummary
      : `Explore where your ${alumniWord} network lives around the world.`;

  const preferredMapFocus = useMemo(() => computeRegionFocus(cities), [cities]);

  useEffect(() => {
    let cancelled = false;
    if (maplibreRuntimeRef.current) {
      setMapRuntimeReady(true);
      return () => {};
    }

    (async () => {
      try {
        await import("maplibre-gl/dist/maplibre-gl.css");
        const module = await import("maplibre-gl");
        if (cancelled) return;
        maplibreRuntimeRef.current = module?.default || module;
        setMapRuntimeReady(true);
        setMapRuntimeError("");
      } catch (error) {
        if (cancelled) return;
        console.error("Failed to load map runtime", error);
        setMapRuntimeReady(false);
        setMapRuntimeError("Map could not load right now. Refresh and try again.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function resolveToken() {
    if (typeof getAuthToken === "function") {
      try {
        const fresh = await getAuthToken();
        if (fresh) return String(fresh).trim();
      } catch {
        // fall through to volatile token fallback
      }
    }
    return getToken() || "";
  }

  function normalizeCities(raw) {
    return (Array.isArray(raw) ? raw : raw?.cities || [])
      .map((d) => ({
        ...d,
        lat: Number(d.lat),
        lng: Number(d.lng),
        count: Number(d.count),
      }))
      .filter((d) => d && Number.isFinite(d.lat) && Number.isFinite(d.lng) && d.count > 0);
  }

  function normalizePeople(raw) {
    const arr = Array.isArray(raw) ? raw : raw?.people || raw?.items || raw?.users || [];
    return arr
      .map((p) => ({
        id: p.id || p._id,
        firstName: p.firstName || "",
        lastName: p.lastName || "",
        photoUrl: avatarUrl(p),
        industry: p.industry || p.primaryIndustry || "",
        currentJob: p.currentJob || p.currentJobTitle || "",
        company: p.currentCompany || p.company || "",
      }))
      .filter((p) => p.id);
  }

  function getCachedPeople(cityKey) {
    const now = Date.now();
    const localEntry = peopleCacheRef.current.get(cityKey);
    if (
      localEntry &&
      Array.isArray(localEntry.data) &&
      localEntry.data.length > 0 &&
      now - Number(localEntry.ts || 0) <= PEOPLE_CACHE_TTL_MS
    ) {
      return localEntry.data;
    }

    try {
      const raw = sessionStorage.getItem(`${peopleCachePrefix}${cityKey}`);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (now - Number(parsed?.ts || 0) > PEOPLE_CACHE_TTL_MS) return null;
      const normalized = normalizePeople(parsed?.data || []);
      if (!normalized.length) return null;
      peopleCacheRef.current.set(cityKey, { ts: parsed.ts, data: normalized });
      return normalized;
    } catch {
      return null;
    }
  }

  function setCachedPeople(cityKey, data) {
    if (!Array.isArray(data) || data.length === 0) {
      try {
        sessionStorage.removeItem(`${peopleCachePrefix}${cityKey}`);
      } catch {
        // ignore cache removal failures
      }
      peopleCacheRef.current.delete(cityKey);
      return;
    }
    const entry = { ts: Date.now(), data };
    peopleCacheRef.current.set(cityKey, entry);
    if (peopleCacheRef.current.size > 80) {
      const firstKey = peopleCacheRef.current.keys().next().value;
      if (firstKey && firstKey !== cityKey) peopleCacheRef.current.delete(firstKey);
    }
    try {
      sessionStorage.setItem(`${peopleCachePrefix}${cityKey}`, JSON.stringify(entry));
    } catch {
      // ignore cache write failures
    }
  }

  /**
   * One clustered source instead of a DOM marker per city. At 135 cities the
   * old approach drew 135 overlapping pins that nearly all read "1", so the
   * shape of the network was invisible; clusters merge them by proximity and
   * carry the total alumni underneath, not the number of cities.
   */
  function bindClusterInteractions(map) {
    if (interactionsBoundRef.current) return;
    interactionsBoundRef.current = true;

    // A cluster is an invitation to zoom, not a selection.
    map.on("click", CLUSTER_LAYER_ID, (event) => {
      const feature = event.features?.[0];
      const clusterId = feature?.properties?.cluster_id;
      if (clusterId == null) return;
      map.getSource(CLUSTER_SOURCE_ID).getClusterExpansionZoom(clusterId).then((zoom) => {
        map.easeTo({ center: feature.geometry.coordinates, zoom });
      }).catch(() => {});
    });

    map.on("click", CITY_LAYER_ID, (event) => {
      const feature = event.features?.[0];
      if (!feature) return;
      const [lng, lat] = feature.geometry.coordinates;
      const sel = {
        key: String(feature.properties.cityKey || ""),
        city: String(feature.properties.city || ""),
        state: String(feature.properties.state || ""),
        count: Number(feature.properties.count || 0),
        lat,
        lng
      };
      setSelected(sel);
      loadPeople(sel);
      map.easeTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 8) });
      setTimeout(() => {
        resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 300);
    });

    let hoverPopup = null;
    const closePopup = () => {
      hoverPopup?.remove();
      hoverPopup = null;
    };

    map.on("mouseenter", CITY_LAYER_ID, (event) => {
      map.getCanvas().style.cursor = "pointer";
      const feature = event.features?.[0];
      const label = String(feature?.properties?.label || "");
      if (!label) return;
      const count = Number(feature.properties.count || 0);
      const maplibregl = maplibreRuntimeRef.current;
      if (!maplibregl) return;
      closePopup();
      hoverPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 16 })
        .setLngLat(feature.geometry.coordinates)
        .setHTML(
          `<div class="lm-tip-title">${escapeHtml(label)}</div>` +
          `<div class="lm-tip-meta">${count} ${escapeHtml(alumniWord)}</div>`
        )
        .addTo(map);
    });

    map.on("mouseleave", CITY_LAYER_ID, () => {
      map.getCanvas().style.cursor = "";
      closePopup();
    });

    for (const layer of [CLUSTER_LAYER_ID]) {
      map.on("mouseenter", layer, () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = ""; });
    }
  }

  function renderMarkers(list) {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    const features = (list || [])
      .map((city) => {
        const lat = Number(city.lat);
        const lng = Number(city.lng);
        const count = Number(city.count || 0);
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || count <= 0) return null;
        return {
          type: "Feature",
          geometry: { type: "Point", coordinates: [lng, lat] },
          properties: {
            cityKey: String(city.key || "").trim().toLowerCase(),
            city: String(city.city || ""),
            state: String(city.state || ""),
            label: [city.city, city.state].filter(Boolean).join(", "),
            count
          }
        };
      })
      .filter(Boolean);

    const data = { type: "FeatureCollection", features };
    const existing = map.getSource(CLUSTER_SOURCE_ID);
    if (existing) {
      existing.setData(data);
      return;
    }

    map.addSource(CLUSTER_SOURCE_ID, {
      type: "geojson",
      data,
      cluster: true,
      clusterMaxZoom: 9,
      clusterRadius: 46,
      // Clusters report people, not pins — "12" should mean twelve alumni.
      clusterProperties: { total: ["+", ["get", "count"]] }
    });

    const circleSize = (field) => [
      "interpolate", ["linear"], ["max", ["get", field], 1],
      1, 15,
      5, 20,
      20, 27,
      75, 34
    ];

    map.addLayer({
      id: CLUSTER_LAYER_ID,
      type: "circle",
      source: CLUSTER_SOURCE_ID,
      filter: ["has", "point_count"],
      paint: {
        "circle-color": brandPrimary,
        "circle-radius": circleSize("total"),
        "circle-opacity": 0.92,
        "circle-stroke-width": 2,
        "circle-stroke-color": "#ffffff"
      }
    });

    map.addLayer({
      id: CITY_LAYER_ID,
      type: "circle",
      source: CLUSTER_SOURCE_ID,
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-color": brandPrimary,
        "circle-radius": circleSize("count"),
        "circle-opacity": 0.92,
        "circle-stroke-width": ["case", ["==", ["get", "cityKey"], ["literal", ""]], 2, 2],
        "circle-stroke-color": "#ffffff"
      }
    });

    for (const [id, filter, field] of [
      [`${CLUSTER_LAYER_ID}-count`, ["has", "point_count"], "total"],
      [`${CITY_LAYER_ID}-count`, ["!", ["has", "point_count"]], "count"]
    ]) {
      map.addLayer({
        id,
        type: "symbol",
        source: CLUSTER_SOURCE_ID,
        filter,
        layout: {
          "text-field": [
            "case",
            [">", ["get", field], 99], "99+",
            ["to-string", ["get", field]]
          ],
          "text-font": ["Open Sans Bold", "Noto Sans Bold"],
          "text-size": 12,
          "text-allow-overlap": true
        },
        paint: { "text-color": "#ffffff" }
      });
    }

    bindClusterInteractions(map);
  }

  function focusMapOnPreferredRegion(focus, { animate = true } = {}) {
    const map = mapRef.current;
    const maplibregl = maplibreRuntimeRef.current;
    if (!map || !focus) return;

    if (focus.bounds && maplibregl?.LngLatBounds) {
      const bounds = new maplibregl.LngLatBounds(
        [focus.bounds.minLng, focus.bounds.minLat],
        [focus.bounds.maxLng, focus.bounds.maxLat]
      );
      map.fitBounds(bounds, {
        padding: { top: 56, right: 44, bottom: 44, left: 44 },
        maxZoom: focus.maxZoom || 7.2,
        duration: animate ? 900 : 0,
      });
      return;
    }

    map.easeTo({
      center: focus.center || DEFAULT_VIEW.center,
      zoom: Number.isFinite(focus.zoom) ? focus.zoom : DEFAULT_VIEW.zoom,
      duration: animate ? 900 : 0,
    });
  }

  useEffect(() => {
    if (!mapRuntimeReady) return;
    if (!mapEl.current) return;
    if (mapRef.current) return;
    const maplibregl = maplibreRuntimeRef.current;
    if (!maplibregl) return;

    const el = mapEl.current;

    const glOK = (() => {
      try {
        const canvas = document.createElement("canvas");
        return !!(canvas.getContext("webgl") || canvas.getContext("experimental-webgl"));
      } catch {
        return false;
      }
    })();

    if (!glOK) {
      const msg = document.createElement("div");
      msg.style.cssText =
        "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-weight:700;color:#334155;background:#fff;";
      msg.textContent = "WebGL is disabled. Enable it to view the map.";
      el.appendChild(msg);
      return;
    }

    const style = {
      version: 8,
      sources: {
        cartoLight: {
          type: "raster",
          tiles: [
            "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
            "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
            "https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
          ],
          tileSize: 256,
          attribution: "© OpenStreetMap contributors, © CARTO",
        },
      },
      // A raster style carries no glyphs, and MapLibre silently drops any text
      // layer without them — which is why the counts have to come from a font
      // source even though the basemap is images.
      glyphs: "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf",
      layers: [{ id: "cartoLight", type: "raster", source: "cartoLight" }],
    };

    const map = new maplibregl.Map({
      container: el,
      style,
      center: DEFAULT_VIEW.center,
      zoom: DEFAULT_VIEW.zoom,
      attributionControl: true,
      antialias: false,
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");

    map.on("load", () => {
      loadedRef.current = true;
      renderMarkers(citiesRef.current);
      if (!selectedRef.current && citiesRef.current.length && !autoFocusedRef.current) {
        const focus = computeRegionFocus(citiesRef.current);
        if (focus) {
          autoFocusedRef.current = true;
          focusMapOnPreferredRegion(focus, { animate: false });
        }
      }

      map.resize();
      requestAnimationFrame(() => map.resize());
      setTimeout(() => map.resize(), 0);
      setTimeout(() => map.resize(), 250);
    });

    map.on("error", (event) => {
      console.error("[Map] runtime/style error:", event?.error || event);
    });

    mapRef.current = map;

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      loadedRef.current = false;
      interactionsBoundRef.current = false;
    };
  }, [brandPrimary, mapRuntimeReady]);

  useEffect(() => {
    let cancelled = false;

    const clearRetryTimer = () => {
      if (cityRefreshTimerRef.current) {
        window.clearTimeout(cityRefreshTimerRef.current);
        cityRefreshTimerRef.current = null;
      }
    };

    const scheduleRetry = () => {
      if (cancelled) return;
      if (cityRefreshAttemptsRef.current >= CITY_SYNC_RETRY_LIMIT) return;
      clearRetryTimer();
      cityRefreshAttemptsRef.current += 1;
      const delay = Math.min(5000, CITY_SYNC_RETRY_BASE_DELAY_MS * cityRefreshAttemptsRef.current);
      cityRefreshTimerRef.current = window.setTimeout(() => {
        void loadCities({ allowSessionCache: false, bypassHttpCache: true });
      }, delay);
    };

    const loadCities = async ({ allowSessionCache = true, bypassHttpCache = false } = {}) => {
      if (!cancelled && !hasLoadedCitiesOnceRef.current) {
        setLoadingCities(true);
      }

      if (allowSessionCache) {
        try {
          const cachedRaw = sessionStorage.getItem(citiesCacheKey);
          if (cachedRaw) {
            const cached = JSON.parse(cachedRaw);
            const ts = Number(cached?.ts || 0);
            if (Date.now() - ts <= CITIES_CACHE_TTL_MS) {
              const cachedList = normalizeCities(cached?.data || []);
              const cachedPending = Math.max(0, Number(cached?.data?.unresolvedCityCount || 0));
              const cachedTotal = Math.max(0, Number(cached?.data?.totalAlumni || 0));
              if (cachedList.length && !cancelled) {
                setCities(cachedList);
                citiesRef.current = cachedList;
                setPendingCityGeocodes(cachedPending);
                setNetworkAlumni(cachedTotal);
                if (loadedRef.current) renderMarkers(cachedList);
                if (loadedRef.current && !selectedRef.current && !autoFocusedRef.current) {
                  const focus = computeRegionFocus(cachedList);
                  if (focus) {
                    autoFocusedRef.current = true;
                    focusMapOnPreferredRegion(focus, { animate: false });
                  }
                }
              }
            }
          }
        } catch {
          // ignore broken session cache
        }
      }

      try {
        const token = await resolveToken();
        const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
        const url = bypassHttpCache
          ? `${API_BASE}/map/cities?refresh=${Date.now()}`
          : `${API_BASE}/map/cities`;
        const res = await fetch(url, { headers });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();
        const list = normalizeCities(data);
        const unresolvedCityCount = Math.max(0, Number(data?.unresolvedCityCount || 0));

        if (!cancelled) {
          setPendingCityGeocodes(unresolvedCityCount);
          setNetworkAlumni(Math.max(0, Number(data?.totalAlumni || 0)));

          if (list.length === 0 && citiesRef.current.length === 0) {
            setCities([]);
            citiesRef.current = [];
            if (loadedRef.current) renderMarkers([]);
          } else if (list.length > 0) {
            setCities(list);
            citiesRef.current = list;
            try {
              sessionStorage.setItem(citiesCacheKey, JSON.stringify({ ts: Date.now(), data }));
            } catch {
              // ignore cache write failures
            }
            if (loadedRef.current) renderMarkers(list);
            if (loadedRef.current && !selectedRef.current && !autoFocusedRef.current) {
              const focus = computeRegionFocus(list);
              if (focus) {
                autoFocusedRef.current = true;
                focusMapOnPreferredRegion(focus, { animate: false });
              }
            }
          }

          if (unresolvedCityCount > 0) {
            scheduleRetry();
          } else {
            cityRefreshAttemptsRef.current = 0;
            clearRetryTimer();
          }
        }
      } catch (error) {
        console.error("Failed to load city map data", error);
        if (!cancelled && citiesRef.current.length === 0) {
          setCities([]);
          citiesRef.current = [];
          setPendingCityGeocodes(0);
          if (loadedRef.current) renderMarkers([]);
        }
      } finally {
        if (!cancelled && !hasLoadedCitiesOnceRef.current) {
          hasLoadedCitiesOnceRef.current = true;
          setLoadingCities(false);
        }
      }
    };

    clearRetryTimer();
    cityRefreshAttemptsRef.current = 0;
    hasLoadedCitiesOnceRef.current = false;
    autoFocusedRef.current = false;
    peopleCacheRef.current = new Map();
    void loadCities({ allowSessionCache: true, bypassHttpCache: false });

    return () => {
      cancelled = true;
      clearRetryTimer();
    };
  }, [citiesCacheKey]);

  async function loadPeople(citySel) {
    const reqId = ++peopleReqRef.current;
    const cityKey = String(citySel?.key || "").trim();
    if (!cityKey) {
      setPeople([]);
      setLoadingPeople(false);
      return;
    }

    const cachedPeople = getCachedPeople(cityKey);
    if (cachedPeople) {
      setPeople(cachedPeople);
      setLoadingPeople(false);
      return;
    }

    try {
      setLoadingPeople(true);
      setPeople([]);
      const token = await resolveToken();
      const headers = token ? { Authorization: `Bearer ${token}` } : undefined;

      const params = new URLSearchParams();
      if (citySel?.city) params.set("city", String(citySel.city));
      if (citySel?.state) params.set("state", String(citySel.state));
      const query = params.toString();

      const res = await fetch(
        `${API_BASE}/map/city/${encodeURIComponent(cityKey)}${query ? `?${query}` : ""}`,
        {
          headers,
        }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      const cleaned = normalizePeople(data);

      if (reqId === peopleReqRef.current) {
        setPeople(cleaned);
        setCachedPeople(cityKey, cleaned);
      }
    } catch (error) {
      console.error("Failed to load people for city", error);
      if (reqId === peopleReqRef.current) setPeople([]);
    } finally {
      if (reqId === peopleReqRef.current) setLoadingPeople(false);
    }
  }

  function clearSelection() {
    peopleReqRef.current += 1;
    setSelected(null);
    setPeople([]);
  }

  function resetMapView() {
    clearSelection();
    if (preferredMapFocus) {
      focusMapOnPreferredRegion(preferredMapFocus);
      return;
    }
    mapRef.current?.easeTo({ center: DEFAULT_VIEW.center, zoom: DEFAULT_VIEW.zoom });
  }

  const skeletonCount = Math.max(3, Math.min(Number(selected?.count || 6), 12));

  return (
    <div className="lm-wrap">
      <CedarBackground behavior="scroll" opacity={0.9} zIndex={0} />

      <main className="lm-main nav2-page-shell">
        <CedarPageHeader
          icon={<MapPin size={18} />}
          title={`${alumniWordTitle} Location Map`}
          subtitle={subtitleText}
        >
          <button type="button" className="lm-reset-view-btn" onClick={resetMapView}>
            <RotateCcw size={14} />
            Reset view
          </button>
        </CedarPageHeader>

        <section className="lm-map-card">
          <div className="lm-map" ref={mapEl} />
          {!mapRuntimeReady && !mapRuntimeError ? (
            <div className="lm-map-runtime-state" role="status" aria-live="polite">
              <span className="lm-prompt-spinner" aria-hidden="true" />
              <p>Loading map...</p>
            </div>
          ) : null}
          {mapRuntimeError ? (
            <div className="lm-map-runtime-state is-error" role="alert">
              <p>{mapRuntimeError}</p>
            </div>
          ) : null}
        </section>

        <section className="lm-results" ref={resultsRef}>
          {!selected ? (
            loadingCities ? (
              <div className="lm-prompt lm-prompt-loading">
                <span className="lm-prompt-spinner" aria-hidden="true" />
                <p>{`Loading ${alumniWord} locations...`}</p>
              </div>
            ) : cities.length === 0 ? (
              <div className="lm-prompt lm-prompt-empty">
                <MapPin size={36} className="lm-prompt-icon" aria-hidden="true" />
                <h3>No locations mapped yet</h3>
                <p>
                  {`${alumniWordTitle} locations will appear here as members add city and state to their profiles.`}
                </p>
              </div>
            ) : (
              <div className="lm-prompt">
                <MapPin size={36} className="lm-prompt-icon" aria-hidden="true" />
                <h3>Select a city to explore</h3>
                <p>{`Click any pin on the map to see ${alumniWord} who live there.`}</p>
                <p className="lm-prompt-stat">{mappedSummary}</p>
              </div>
            )
          ) : (
            <div className="lm-results-panel">
              <div className="lm-results-head">
                <div className="lm-results-title">
                  <h2>{cityLabel(selected)}</h2>
                  <p>
                    {people.length || Number(selected.count || 0)} {alumniWord}
                  </p>
                </div>
                <div className="lm-results-actions">
                  <button type="button" className="lm-clear-btn" onClick={clearSelection}>
                    <X size={14} />
                    Clear selection
                  </button>
                </div>
              </div>

              {loadingPeople ? (
                <div className="lm-grid">
                  {Array.from({ length: skeletonCount }).map((_, index) => (
                    <div
                      key={index}
                      className="lm-card lm-skel"
                      style={{ animationDelay: `${index * 0.04}s` }}
                    />
                  ))}
                </div>
              ) : people.length === 0 ? (
                <div className="lm-empty">
                  {`No visible ${alumniWord} profile cards were returned for this location.`}
                </div>
              ) : (
                <div className="lm-grid">
                  {people.map((person, index) => {
                    const profileId = String(
                      person.id || person._id || person.profileId || person.userId || ""
                    ).trim();
                    if (!profileId || profileId === "undefined" || profileId === "null")
                      return null;

                    const photo = avatarUrl(person);
                    const initials = initialsOf(person);
                    const profileHref = tenantRoute(slug, `/profile/${profileId}`);
                    const dmHref = tenantRoute(
                      slug,
                      `/chat-rooms?to=${encodeURIComponent(profileId)}`
                    );

                    const roleText = [person.currentJob, person.company]
                      .filter(Boolean)
                      .join(" at ");

                    return (
                      <article
                        key={profileId}
                        className="lm-card"
                        style={{ animationDelay: `${index * 0.04}s` }}
                      >
                        {photo ? (
                          <img className="lm-avatar" src={photo} alt={nameOf(person)} />
                        ) : (
                          <div className="lm-avatar lm-initials" aria-label={nameOf(person)}>
                            {initials}
                          </div>
                        )}

                        <div className="lm-name" title={nameOf(person)}>
                          {nameOf(person)}
                        </div>

                        {(person.industry || roleText) && (
                          <div className="lm-meta">
                            {person.industry && (
                              <span className="lm-industry-pill" title={person.industry}>
                                {person.industry}
                              </span>
                            )}
                            {roleText && (
                              <span className="lm-role" title={roleText}>
                                {roleText}
                              </span>
                            )}
                          </div>
                        )}

                        <div className="lm-actions">
                          <a className="lm-btn primary" href={profileHref}>
                            View Profile
                          </a>
                          <a className="lm-btn" href={dmHref}>
                            Message
                          </a>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
