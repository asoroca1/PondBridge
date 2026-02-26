// src/pages/LocationMap.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import CedarBackground from "../components/CedarBackground";
import CedarPageHeader from "../components/CedarPageHeader.jsx";
import { MapPin } from "lucide-react";
import { API_BASE } from "../lib/api";
import { getToken, initialsOf } from "../lib/helpers.js";
import "./location-map.css";

function nameOf(p) {
  const full = [p.firstName, p.lastName].filter(Boolean).join(" ").trim();
  return full || "Alumni Member";
}
function cityLabel(c) {
  return [c.city, c.state].filter(Boolean).join(", ");
}

// same sizing logic as your step expression
function markerSize(count) {
  const n = Number(count || 0);
  if (n >= 20) return 36;
  if (n >= 10) return 30;
  if (n >= 5) return 26;
  return 22;
}

const DEFAULT_VIEW = { center: [-98.5795, 39.8283], zoom: 3.5 }; // USA center
const CITIES_CACHE_KEY = "map:cities:v1";
const CITIES_CACHE_TTL_MS = 5 * 60 * 1000;
const PEOPLE_CACHE_PREFIX = "map:city:people:v1:";
const PEOPLE_CACHE_TTL_MS = 2 * 60 * 1000;

export default function LocationMap() {
  const mapRef = useRef(null);
  const mapEl = useRef(null);

  const markersRef = useRef([]); // store Marker instances so we can remove them
  const citiesRef = useRef([]);  // latest cities for map load race-proof
  const loadedRef = useRef(false);
  const peopleReqRef = useRef(0);
  const peopleCacheRef = useRef(new Map());

  const [cities, setCities] = useState([]);       // [{city,state,lat,lng,count,key}]
  const [selected, setSelected] = useState(null); // selected city object
  const [people, setPeople] = useState([]);       // people for selected city
  const [loadingPeople, setLoadingPeople] = useState(false);
  const brandPrimary = useMemo(() => {
    if (typeof window === "undefined") return "#002b5c";
    const resolved = window.getComputedStyle(document.documentElement).getPropertyValue("--brand-primary").trim();
    return resolved || "#002b5c";
  }, []);

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
        uploads: p.uploads || {},
        photoUrl: p.photoUrl,
      }))
      .filter((p) => p.id);
  }

  function getCachedPeople(cityKey) {
    const now = Date.now();
    const localEntry = peopleCacheRef.current.get(cityKey);
    if (localEntry && now - Number(localEntry.ts || 0) <= PEOPLE_CACHE_TTL_MS) {
      return localEntry.data;
    }

    try {
      const raw = sessionStorage.getItem(`${PEOPLE_CACHE_PREFIX}${cityKey}`);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (now - Number(parsed?.ts || 0) > PEOPLE_CACHE_TTL_MS) return null;
      const normalized = normalizePeople(parsed?.data || []);
      peopleCacheRef.current.set(cityKey, { ts: parsed.ts, data: normalized });
      return normalized;
    } catch {
      return null;
    }
  }

  function setCachedPeople(cityKey, data) {
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

  function clearMarkers() {
    for (const m of markersRef.current) {
      try {
        m.remove();
      } catch {}
    }
    markersRef.current = [];
  }

  function renderMarkers(list) {
    const map = mapRef.current;
    if (!map) return;

    clearMarkers();

    (list || []).forEach((c) => {
      const lat = Number(c.lat);
      const lng = Number(c.lng);
      const count = Number(c.count || 0);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || count <= 0) return;

      const size = markerSize(count);

      const el = document.createElement("div");
      el.style.width = `${size}px`;
      el.style.height = `${size}px`;
      el.style.borderRadius = "999px";
      el.style.background = brandPrimary;
      el.style.border = "2px solid #ffffff";
      el.style.color = "#ffffff";
      el.style.display = "flex";
      el.style.alignItems = "center";
      el.style.justifyContent = "center";
      el.style.fontWeight = "800";
      el.style.fontSize = count >= 10 ? "12px" : "13px";
      el.style.boxShadow = "0 6px 16px rgba(15, 23, 42, 0.18)";
      el.style.cursor = "pointer";
      el.style.userSelect = "none";
      el.textContent = ""

      const marker = new maplibregl.Marker({ element: el, anchor: "center" })
        .setLngLat([lng, lat])
        .addTo(map);

      // Click marker -> select city + load people
      el.addEventListener("click", () => {
        const sel = {
          key: String(c.key || ""),
          city: String(c.city || ""),
          state: String(c.state || ""),
          count,
          lat,
          lng,
        };
        setSelected(sel);
        loadPeople(sel);
        map.easeTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 7) });
      });

      // (optional) hover tooltip
      const label = [c.city, c.state].filter(Boolean).join(", ");
      let popup = null;
      el.addEventListener("mouseenter", () => {
        if (!label) return;
        popup = new maplibregl.Popup({
          closeButton: false,
          closeOnClick: false,
          offset: 14,
        })
          .setLngLat([lng, lat])
          .setHTML(`<div style="font-weight:700;color:#0f172a;">${label}</div>`)
          .addTo(map);
        
      });
      el.addEventListener("mouseleave", () => {
        try {
          popup && popup.remove();
        } catch {}
        popup = null;
      });

      markersRef.current.push(marker);
    });
  }

  /* ------------------------------ Init map ------------------------------ */
  useEffect(() => {
    if (!mapEl.current) return;
    if (mapRef.current) return;

    const el = mapEl.current;
    el.style.height = "60vh";
    el.style.minHeight = "420px";
    el.style.position = "relative";

    const glOK = (() => {
      try {
        const c = document.createElement("canvas");
        return !!(c.getContext("webgl") || c.getContext("experimental-webgl"));
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

    // Raster-only style (no glyphs needed)
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

      // render markers immediately on load (handles fetch-before-load)
      renderMarkers(citiesRef.current);

      // Safari/WebKit nudges
      map.resize();
      requestAnimationFrame(() => map.resize());
      setTimeout(() => map.resize(), 0);
      setTimeout(() => map.resize(), 250);
    });

    map.on("error", (e) => console.error("[Map] runtime/style error:", e?.error || e));

    mapRef.current = map;

    return () => {
      clearMarkers();
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      loadedRef.current = false;
    };
  }, []);

  /* -------------------------- Fetch cities from backend ------------------------- */
  useEffect(() => {
    let cancelled = false;

    (async () => {
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
        const token = getToken() || localStorage.getItem("adminToken") || "";
        const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
        const res = await fetch(`${API_BASE}/map/cities`, { headers });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        // accept numbers OR numeric strings
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

          // if map already loaded, update markers now
          if (loadedRef.current) renderMarkers(list);
        }
      } catch (err) {
        console.error("Failed to load city map data", err);
        if (!cancelled) {
          if (citiesRef.current.length) return;
          setCities([]);
          citiesRef.current = [];
          if (loadedRef.current) renderMarkers([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  /* ------------------------------ Load people list ----------------------------- */
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
      const token = getToken() || localStorage.getItem("adminToken") || "";
      const headers = token ? { Authorization: `Bearer ${token}` } : undefined;

      const params = new URLSearchParams();
      if (citySel?.city) params.set("city", String(citySel.city));
      if (citySel?.state) params.set("state", String(citySel.state));
      const query = params.toString();

      const res = await fetch(`${API_BASE}/map/city/${encodeURIComponent(cityKey)}${query ? `?${query}` : ""}`, {
        headers,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      const cleaned = normalizePeople(data);

      if (reqId === peopleReqRef.current) {
        setPeople(cleaned);
        setCachedPeople(cityKey, cleaned);
      }
    } catch (e) {
      console.error("Failed to load people for city", e);
      if (reqId === peopleReqRef.current) setPeople([]);
    } finally {
      if (reqId === peopleReqRef.current) setLoadingPeople(false);
    }
  }

  function clearSelection() {
    peopleReqRef.current += 1;
    setSelected(null);
    setPeople([]);
    // don’t need to change markers; user can click another
  }

  return (
    <div className="lm-wrap" style={{ position: "relative", minHeight: "100vh" }}>
      <CedarBackground behavior="scroll" opacity={0.9} zIndex={0} />

      <main className="lm-main nav2-page-shell">
        <CedarPageHeader
          icon={<MapPin size={18} />}
          title="Alumni Location Map"
          subtitle="Explore where your alumni network lives around the world."
        />

        <section className="lm-map-card">
          <div className="lm-map" ref={mapEl} />
        </section>

        <section className="lm-results">
          {!selected ? (
            <div className="lm-empty">Click a city circle on the map to see alumni there.</div>
          ) : (
            <>
              <div className="lm-results-head">
                <div className="lm-results-title">
                  <h2>{cityLabel(selected)}</h2>
                  <p>{people.length || selected.count} alumni</p>
                </div>
                <div className="lm-results-actions">
                  <button className="lm-clear-btn" onClick={clearSelection}>
                    Clear
                  </button>
                </div>
              </div>

              {loadingPeople ? (
                <div className="lm-grid">
                  {Array.from({ length: 12 }).map((_, i) => (
                    <div key={i} className="lm-card lm-skel" />
                  ))}
                </div>
              ) : people.length === 0 ? (
                <div className="lm-empty">
                  No visible alumni profile cards were returned for this location.
                </div>
              ) : (
                <div className="lm-grid">
                  {people.map((p) => {
                    const profileId = String(p.id || p._id || p.profileId || p.userId || "").trim();
                    if (!profileId || profileId === "undefined" || profileId === "null") return null;
                    const photo = p.uploads?.photoUrl || p.photoUrl || "";
                    const initials = initialsOf(p);
                    return (
                      <article key={profileId} className="lm-card">
                        {photo ? (
                          <img className="lm-avatar" src={photo} alt={nameOf(p)} />
                        ) : (
                          <div className="lm-avatar lm-initials" aria-label={nameOf(p)}>
                            {initials}
                          </div>
                        )}
                        <div className="lm-name">{nameOf(p)}</div>
                        <div className="lm-actions">
                          <a className="lm-btn primary" href={`/profile/${profileId}`}>
                            View Profile
                          </a>
                          <a className="lm-btn" href={`/chat-rooms?to=${encodeURIComponent(profileId)}`}>
                            Message
                          </a>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </section>
      </main>
    </div>
  );
}
