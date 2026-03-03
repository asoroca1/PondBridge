import { useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useParams } from "react-router-dom";

import CedarBackground from "../components/CedarBackground";
import CedarPageHeader from "../components/CedarPageHeader.jsx";
import { MapPin, RotateCcw, X } from "lucide-react";
import { API_BASE } from "../lib/api";
import { getToken, initialsOf, avatarUrl } from "../lib/helpers.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { useTenant } from "../../context/TenantContext.jsx";
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

function markerSize(count) {
  const n = Number(count || 0);
  if (n >= 20) return 36;
  if (n >= 10) return 30;
  if (n >= 5) return 26;
  return 22;
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
const CITIES_CACHE_KEY = "map:cities:v1";
const CITIES_CACHE_TTL_MS = 5 * 60 * 1000;
const PEOPLE_CACHE_PREFIX = "map:city:people:v1:";
const PEOPLE_CACHE_TTL_MS = 2 * 60 * 1000;

export default function LocationMap() {
  const { slug = "" } = useParams();
  const { getAuthToken } = useAuth();
  const { tenant } = useTenant();
  const alumniWord = resolveAlumniWord(tenant);
  const alumniWordTitle = resolveAlumniWord(tenant, { capitalized: true });

  const mapRef = useRef(null);
  const mapEl = useRef(null);
  const resultsRef = useRef(null);

  const markersRef = useRef([]);
  const selectedMarkerRef = useRef(null);
  const citiesRef = useRef([]);
  const selectedRef = useRef(null);

  const loadedRef = useRef(false);
  const peopleReqRef = useRef(0);
  const peopleCacheRef = useRef(new Map());

  const [cities, setCities] = useState([]);
  const [selected, setSelected] = useState(null);
  const [people, setPeople] = useState([]);
  const [loadingPeople, setLoadingPeople] = useState(false);
  const [loadingCities, setLoadingCities] = useState(true);

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  const totalAlumni = useMemo(
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

  const subtitleText =
    cities.length > 0
      ? `${totalAlumni} ${alumniWord} across ${cities.length} cities`
      : `Explore where your ${alumniWord} network lives around the world.`;

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
      const raw = sessionStorage.getItem(`${PEOPLE_CACHE_PREFIX}${cityKey}`);
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
        sessionStorage.removeItem(`${PEOPLE_CACHE_PREFIX}${cityKey}`);
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
      sessionStorage.setItem(`${PEOPLE_CACHE_PREFIX}${cityKey}`, JSON.stringify(entry));
    } catch {
      // ignore cache write failures
    }
  }

  function clearHighlightedMarker() {
    if (!selectedMarkerRef.current) return;
    selectedMarkerRef.current.classList.remove("is-selected");
    selectedMarkerRef.current.style.zIndex = "";
    selectedMarkerRef.current = null;
  }

  function highlightMarker(el) {
    if (!el) return;
    if (selectedMarkerRef.current && selectedMarkerRef.current !== el) {
      selectedMarkerRef.current.classList.remove("is-selected");
      selectedMarkerRef.current.style.zIndex = "";
    }
    el.classList.add("is-selected");
    el.style.zIndex = "3";
    selectedMarkerRef.current = el;
  }

  function clearMarkers() {
    clearHighlightedMarker();
    for (const marker of markersRef.current) {
      try {
        marker.remove();
      } catch {
        // ignore remove failures
      }
    }
    markersRef.current = [];
  }

  function renderMarkers(list) {
    const map = mapRef.current;
    if (!map) return;

    clearMarkers();

    (list || []).forEach((city, index) => {
      const lat = Number(city.lat);
      const lng = Number(city.lng);
      const count = Number(city.count || 0);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || count <= 0) return;

      const size = markerSize(count);
      const cityKey = String(city.key || "")
        .trim()
        .toLowerCase();
      const label = [city.city, city.state].filter(Boolean).join(", ");

      const el = document.createElement("div");
      el.className = "lm-marker";
      el.dataset.cityKey = cityKey;
      el.style.width = `${size}px`;
      el.style.height = `${size}px`;
      el.style.background = brandPrimary;

      if (count >= 2) {
        const countLabel = document.createElement("span");
        countLabel.className = "lm-marker-count";
        countLabel.textContent = count > 99 ? "99+" : String(count);
        countLabel.style.fontSize = size <= 26 ? "10px" : "12px";
        el.appendChild(countLabel);
      } else {
        const dot = document.createElement("span");
        dot.className = "lm-marker-dot";
        const dotSize = Math.max(6, Math.round(size * 0.28));
        dot.style.width = `${dotSize}px`;
        dot.style.height = `${dotSize}px`;
        el.appendChild(dot);
      }

      const marker = new maplibregl.Marker({ element: el, anchor: "center" })
        .setLngLat([lng, lat])
        .addTo(map);

      setTimeout(() => {
        el.classList.add("is-ready");
      }, index * 20);

      if (selectedRef.current?.key && cityKey === String(selectedRef.current.key).toLowerCase()) {
        highlightMarker(el);
      }

      el.addEventListener("click", () => {
        const sel = {
          key: cityKey,
          city: String(city.city || ""),
          state: String(city.state || ""),
          count,
          lat,
          lng,
        };

        highlightMarker(el);
        setSelected(sel);
        loadPeople(sel);
        map.easeTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 7) });

        setTimeout(() => {
          resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 300);
      });

      let popup = null;
      el.addEventListener("mouseenter", () => {
        if (!label) return;

        popup = new maplibregl.Popup({
          closeButton: false,
          closeOnClick: false,
          offset: 14,
        })
          .setLngLat([lng, lat])
          .setHTML(
            `<div class=\"lm-tip-title\">${escapeHtml(label)}</div><div class=\"lm-tip-meta\">${count} ${escapeHtml(
              alumniWord
            )}</div>`
          )
          .addTo(map);
      });

      el.addEventListener("mouseleave", () => {
        try {
          popup?.remove();
        } catch {
          // ignore popup teardown failures
        }
        popup = null;
      });

      markersRef.current.push(marker);
    });
  }

  useEffect(() => {
    if (!mapEl.current) return;
    if (mapRef.current) return;

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
      clearMarkers();
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      loadedRef.current = false;
    };
  }, [brandPrimary]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoadingCities(true);
      try {
        const cachedRaw = sessionStorage.getItem(CITIES_CACHE_KEY);
        if (cachedRaw) {
          const cached = JSON.parse(cachedRaw);
          const ts = Number(cached?.ts || 0);
          if (Date.now() - ts <= CITIES_CACHE_TTL_MS) {
            const cachedList = normalizeCities(cached?.data || []);
            if (cachedList.length && !cancelled) {
              setCities(cachedList);
              citiesRef.current = cachedList;
              if (loadedRef.current) renderMarkers(cachedList);
            }
          }
        }
      } catch {
        // ignore broken session cache
      }

      try {
        const token = await resolveToken();
        const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
        const res = await fetch(`${API_BASE}/map/cities`, { headers });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();
        const list = normalizeCities(data);

        if (!cancelled) {
          if (list.length === 0 && citiesRef.current.length) return;

          setCities(list);
          citiesRef.current = list;
          try {
            sessionStorage.setItem(
              CITIES_CACHE_KEY,
              JSON.stringify({ ts: Date.now(), data: list })
            );
          } catch {
            // ignore cache write failures
          }

          if (loadedRef.current) renderMarkers(list);
        }
      } catch (error) {
        console.error("Failed to load city map data", error);
        if (!cancelled) {
          if (citiesRef.current.length) return;
          setCities([]);
          citiesRef.current = [];
          if (loadedRef.current) renderMarkers([]);
        }
      } finally {
        if (!cancelled) setLoadingCities(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

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
    clearHighlightedMarker();
    setSelected(null);
    setPeople([]);
  }

  function resetMapView() {
    clearSelection();
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
                <p className="lm-prompt-stat">
                  {totalAlumni} {alumniWord} across {cities.length} cities
                </p>
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
