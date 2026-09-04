import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { normalizeHeroImagePosition, normalizeHeroImageSize, resolveTenantModules } from "@pondbridge/shared";
import { requestJson } from "../lib/http.js";
import { useOptionalAuthToken } from "./AuthContext.jsx";
import { NEUTRAL_RAMP, brandNeutral, readableTextColorOnBrand } from "../lib/colorUtils.js";

const TenantContext = createContext(null);
const TENANT_THEME_CACHE_PREFIX = "pondbridgeTenantTheme:";
const TENANT_CONFIG_CACHE_PREFIX = "pondbridgeTenantConfig:";
const TENANT_CONFIG_CACHE_TTL_MS = 5 * 60 * 1000;

const FONT_TOKEN_MAP = {
  // `cedar_default` is the historical name for the platform default and is kept
  // so existing tenants keep rendering; `default` is the name to use going
  // forward. Both resolve to the same stack.
  default: {
    display: "\"Inter Variable\", Inter, \"Avenir Next\", \"Segoe UI\", sans-serif",
    body: "\"Inter Variable\", Inter, \"Avenir Next\", \"Segoe UI\", sans-serif"
  },
  cedar_default: {
    display: "\"Inter Variable\", Inter, \"Avenir Next\", \"Segoe UI\", sans-serif",
    body: "\"Inter Variable\", Inter, \"Avenir Next\", \"Segoe UI\", sans-serif"
  },
  modern_clean: {
    display: "\"Inter Variable\", Inter, \"Avenir Next\", \"Segoe UI\", sans-serif",
    body: "\"Inter Variable\", Inter, \"Avenir Next\", \"Segoe UI\", sans-serif"
  },
  classic_serif: {
    display: "\"Roboto Slab Variable\", \"Roboto Slab\", Georgia, serif",
    body: "\"Inter Variable\", Inter, \"Avenir Next\", \"Segoe UI\", sans-serif"
  }
};

function normalizeHexColor(value = "", fallback = "#404040") {
  const raw = String(value || "").trim();
  const hex = raw.startsWith("#") ? raw.slice(1) : raw;
  if (/^[0-9a-fA-F]{6}$/.test(hex)) return `#${hex.toLowerCase()}`;
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    const expanded = hex
      .split("")
      .map((char) => `${char}${char}`)
      .join("");
    return `#${expanded.toLowerCase()}`;
  }
  return fallback;
}

function hexToRgb(hex = "#404040") {
  const normalized = normalizeHexColor(hex).replace("#", "");
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16)
  };
}

function rgbToHex({ r, g, b }) {
  const clamp = (channel) => Math.max(0, Math.min(255, Math.round(channel)));
  const toHex = (channel) => clamp(channel).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function mixHex(baseHex, mixHexColor, ratio = 0.2) {
  const base = hexToRgb(baseHex);
  const mix = hexToRgb(mixHexColor);
  const weight = Math.max(0, Math.min(1, Number(ratio) || 0));
  return rgbToHex({
    r: base.r + (mix.r - base.r) * weight,
    g: base.g + (mix.g - base.g) * weight,
    b: base.b + (mix.b - base.b) * weight
  });
}

function rgbaFromHex(hex, alpha = 1) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, Number(alpha) || 0))})`;
}

function applyTheme(config = {}) {
  const root = document.documentElement;
  const branding = config?.branding || config?.theme || {};
  const fontToken = String(branding.fontToken || "cedar_default");
  const font = FONT_TOKEN_MAP[fontToken] || FONT_TOKEN_MAP.cedar_default;
  const heroImage = branding.heroImageUrl || "";
  const heroImagePosition = normalizeHeroImagePosition(
    branding.heroImagePositionLanding || branding.heroImagePosition || ""
  );
  const heroImageSize = normalizeHeroImageSize(
    branding.heroImageSizeLanding || branding.heroImageSize || ""
  );
  const brandPrimary = normalizeHexColor(branding.brandPrimary || "#404040");
  const brandPrimaryHover = mixHex(brandPrimary, "#000000", 0.16);
  const brandPrimaryStrong = mixHex(brandPrimary, "#000000", 0.24);
  const brandPrimarySoft = mixHex(brandPrimary, "#ffffff", 0.46);
  const brandPrimarySoftStrong = mixHex(brandPrimary, "#ffffff", 0.28);
  // Very light brand tints for washes and veils that used to be pale blues.
  const brandPrimaryVeil = mixHex(brandPrimary, "#ffffff", 0.82);
  const brandPrimaryWash = mixHex(brandPrimary, "#ffffff", 0.93);
  const cardBorder = brandNeutral(brandPrimary, { saturation: 16, lightness: 87 });
  const textMuted = brandNeutral(brandPrimary, { saturation: 14, lightness: 42 });
  const brandPrimaryRgb = hexToRgb(brandPrimary);
  const brandOnPrimary = readableTextColorOnBrand(brandPrimary);
  const brandOnPrimaryRgb = hexToRgb(brandOnPrimary);

  root.style.setProperty("--brand-primary", brandPrimary);
  root.style.setProperty("--brand-primary-hover", brandPrimaryHover);
  root.style.setProperty("--brand-primary-strong", brandPrimaryStrong);
  root.style.setProperty("--brand-primary-soft", brandPrimarySoft);
  root.style.setProperty("--brand-primary-soft-strong", brandPrimarySoftStrong);
  root.style.setProperty("--brand-primary-veil", brandPrimaryVeil);
  root.style.setProperty("--brand-primary-wash", brandPrimaryWash);
  root.style.setProperty("--brand-primary-rgb", `${brandPrimaryRgb.r}, ${brandPrimaryRgb.g}, ${brandPrimaryRgb.b}`);
  root.style.setProperty("--brand-on-primary", brandOnPrimary);
  root.style.setProperty("--brand-on-primary-rgb", `${brandOnPrimaryRgb.r}, ${brandOnPrimaryRgb.g}, ${brandOnPrimaryRgb.b}`);
  root.style.setProperty("--brand-primary-shadow", rgbaFromHex(brandPrimary, 0.2));
  root.style.setProperty("--brand-primary-focus", rgbaFromHex(brandPrimary, 0.22));
  root.style.setProperty("--brand-primary-tint", rgbaFromHex(brandPrimary, 0.12));
  root.style.setProperty("--brand-secondary", branding.brandSecondary || "#e6e6e6");
  root.style.setProperty("--brand-accent", branding.brandAccent || "#f2b134");
  root.style.setProperty("--bg", branding.bg || "#fafafa");
  root.style.setProperty("--text", branding.text || "#1c1c1c");
  root.style.setProperty("--text-muted", branding.textMuted || textMuted);
  root.style.setProperty("--card", branding.card || "#ffffff");
  root.style.setProperty("--card-border", branding.cardBorder || cardBorder);

  // Neutral ramp in the brand's own hue. The stylesheet used to hardcode a
  // slate scale, which painted blue-grey chrome onto every non-blue camp.
  for (const [step, stop] of Object.entries(NEUTRAL_RAMP)) {
    root.style.setProperty(`--neutral-${step}`, brandNeutral(brandPrimary, stop));
  }
  root.style.setProperty("--font-display", font.display);
  root.style.setProperty("--font-body", font.body);
  root.style.setProperty("--font-family", font.body);
  root.style.setProperty("--hero-image-position", heroImagePosition);
  root.style.setProperty("--hero-image-size", heroImageSize);
  if (heroImage) root.style.setProperty("--hero-image-url", `url(\"${heroImage}\")`);
  else root.style.removeProperty("--hero-image-url");

  // Browser and OS chrome sit outside the stylesheet, so they have to be set
  // here or every camp keeps the neutral default from index.html.
  const themeColorMeta = document.querySelector('meta[name="theme-color"]');
  if (themeColorMeta) themeColorMeta.setAttribute("content", brandPrimary);

  // The tab icon is the camp's, not the platform's, whenever they have a logo.
  const logo = String(branding.logoUrl || "").trim();
  if (logo) {
    let icon = document.querySelector('link[rel="icon"][data-tenant-icon="true"]');
    if (!icon) {
      icon = document.createElement("link");
      icon.rel = "icon";
      icon.setAttribute("data-tenant-icon", "true");
      document.head.appendChild(icon);
    }
    if (icon.getAttribute("href") !== logo) icon.setAttribute("href", logo);
  }
}

function tenantThemeCacheKey({ slug = "", host = "" } = {}) {
  const normalizedSlug = String(slug || "").trim().toLowerCase();
  const normalizedHost = String(host || "").trim().toLowerCase();
  const key = normalizedSlug || normalizedHost;
  return key ? `${TENANT_THEME_CACHE_PREFIX}${key}` : "";
}

function readCachedThemeConfig({ slug = "", host = "", storage = globalThis?.localStorage } = {}) {
  const key = tenantThemeCacheKey({ slug, host });
  if (!key) return null;
  try {
    const raw = storage?.getItem?.(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function writeCachedThemeConfig({ slug = "", host = "", config = null, storage = globalThis?.localStorage } = {}) {
  const key = tenantThemeCacheKey({ slug, host });
  if (!key || !config || typeof config !== "object") return;
  try {
    storage?.setItem?.(key, JSON.stringify(config));
  } catch {
    // Ignore storage quota/private mode errors.
  }
}

function tenantConfigCacheKey({ slug = "", host = "" } = {}) {
  const normalizedSlug = String(slug || "").trim().toLowerCase();
  const normalizedHost = String(host || "").trim().toLowerCase();
  const key = normalizedSlug || normalizedHost;
  return key ? `${TENANT_CONFIG_CACHE_PREFIX}${key}` : "";
}

function normalizeTenantPayload(tenant = null, fallbackSlug = "") {
  if (!tenant || typeof tenant !== "object") return null;
  const rawConfig = tenant?.config && typeof tenant.config === "object" ? tenant.config : {};
  const modules = resolveTenantModules(
    tenant?.modules && typeof tenant.modules === "object" ? tenant.modules : {}
  );
  const config = {
    ...rawConfig,
    modules: resolveTenantModules(
      rawConfig?.modules && typeof rawConfig.modules === "object" ? rawConfig.modules : {}
    )
  };
  const resolvedSlug = String(tenant?.slug || fallbackSlug || "").trim().toLowerCase();
  return {
    ...tenant,
    slug: resolvedSlug,
    config,
    theme: tenant.theme || config.branding || {},
    content: tenant.content || config.content || {},
    accessSettings: tenant.accessSettings || config.accessRules || {},
    modules
  };
}

function readCachedTenantPayloadEntry({ slug = "", host = "", storage = globalThis?.localStorage } = {}) {
  const key = tenantConfigCacheKey({ slug, host });
  if (!key) return null;
  try {
    const raw = storage?.getItem?.(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const cachedAt = Number(parsed?.cachedAt || 0);
    const payload = parsed?.payload;
    if (!payload || typeof payload !== "object") return null;
    const expired = !cachedAt || Date.now() - cachedAt > TENANT_CONFIG_CACHE_TTL_MS;
    return { payload, cachedAt, expired };
  } catch {
    return null;
  }
}

function writeCachedTenantPayload({ slug = "", host = "", payload = null, storage = globalThis?.localStorage } = {}) {
  const key = tenantConfigCacheKey({ slug, host });
  if (!key || !payload || typeof payload !== "object") return;
  try {
    storage?.setItem?.(
      key,
      JSON.stringify({
        cachedAt: Date.now(),
        payload
      })
    );
  } catch {
    // Ignore storage quota/private mode errors.
  }
}

function preloadCriticalTenantImage(url = "") {
  if (typeof document === "undefined") return;
  const href = String(url || "").trim();
  if (!href) return;
  const alreadyPreloaded = [...document.querySelectorAll('link[rel="preload"][as="image"]')]
    .some((link) => String(link.getAttribute("href") || "").trim() === href);
  if (alreadyPreloaded) return;

  const preload = document.createElement("link");
  preload.rel = "preload";
  preload.as = "image";
  preload.href = href;
  preload.setAttribute("fetchpriority", "high");
  document.head.appendChild(preload);
}

function preloadTenantHero(tenant = null) {
  const branding = tenant?.config?.branding || tenant?.theme || {};
  preloadCriticalTenantImage(branding?.heroImageUrl || "");
}

/**
 * The tenant fetch, lifted out of the component so the race it used to lose is
 * testable. `apps/web` has no jsdom, so an effect-driven test cannot run; this
 * takes its collaborators by injection instead.
 *
 * Every fetch takes a generation number and only the newest one may write.
 * Navigating from camp A to camp B faster than A's response arrives used to let
 * A land last and overwrite B — not only in React state but in `applyTheme`,
 * the host-keyed payload cache and `pondbridgeTenantSlug`, so the wrong camp's
 * branding survived a reload. The provider's old `cancelled` flag could not
 * catch that: it was read after the fetch resolved, by which point every one of
 * those writes had already happened.
 *
 * An AbortController would also save the wasted bytes, but `requestJson` drops
 * out of its shared in-flight GET memo whenever a signal is present, and
 * AuthProviderRuntime asks for this same tenant-config URL on the same load —
 * so aborting would buy a duplicate request on every page load to avoid a
 * response nobody reads. The generation guard is what makes it correct.
 */
export function createTenantFetcher({
  setState,
  request = requestJson,
  theme = applyTheme,
  preloadHero = preloadTenantHero,
  storage = globalThis?.localStorage,
  getHost = () => globalThis?.location?.hostname || ""
} = {}) {
  let generation = 0;

  // `bypassCache` is for the moments where a stale tenant read changes what the
  // app does rather than just how it looks - launch being the big one, since the
  // router sends a director whose tenant still reads "not live" back into the
  // onboarding wizard. It skips the local paint, the in-memory GET memo, and the
  // browser/CDN copy (the cache buster makes it a URL no shared cache holds).
  async function fetchTenant(requestedSlug = "", { bypassCache = false } = {}) {
    const myGeneration = ++generation;
    const isCurrent = () => myGeneration === generation;
    const normalizedSlug = String(requestedSlug || "").trim().toLowerCase();
    const host = getHost();
    const query = normalizedSlug
      ? `slug=${encodeURIComponent(normalizedSlug)}`
      : `host=${encodeURIComponent(host)}`;
    const requestPath = bypassCache
      ? `/api/public/tenant-config?${query}&_=${Date.now()}`
      : `/api/public/tenant-config?${query}`;
    const requestOptions = bypassCache ? { cache: "no-store" } : undefined;

    const cachedEntry = readCachedTenantPayloadEntry({ slug: normalizedSlug, host, storage });
    const cachedPayload = cachedEntry?.payload || null;
    const freshCachedPayload = Boolean(cachedEntry && !cachedEntry.expired);
    if (bypassCache) {
      // Keep whatever is on screen; this refresh is about correctness, not paint.
      setState((prev) => ({ ...prev, loading: false, error: "" }));
    } else if (cachedPayload) {
      const cachedTenant = normalizeTenantPayload(cachedPayload, normalizedSlug);
      const cachedConfig = cachedTenant?.config || {};
      preloadHero(cachedTenant);
      theme(cachedConfig);
      setState({ loading: false, error: "", tenant: cachedTenant });
    } else {
      const cachedConfig = readCachedThemeConfig({ slug: normalizedSlug, host, storage });
      if (cachedConfig) {
        theme(cachedConfig);
      }
      setState((prev) => {
        const previousTenantSlug = String(prev?.tenant?.slug || "").trim().toLowerCase();
        const canKeepPreviousTenant = Boolean(prev?.tenant) && (!normalizedSlug || previousTenantSlug === normalizedSlug);
        if (canKeepPreviousTenant) {
          return { ...prev, loading: false, error: "" };
        }
        return { loading: true, error: "", tenant: null };
      });
    }

    try {
      const tenant = await request(requestPath, requestOptions);
      // A newer tenant has been asked for since this request went out, so this
      // answer describes a camp the user has already left.
      if (!isCurrent()) return;
      const normalizedTenant = normalizeTenantPayload(tenant, normalizedSlug);
      const config = normalizedTenant?.config || {};
      const resolvedSlug = String(normalizedTenant?.slug || normalizedSlug).trim().toLowerCase();
      preloadHero(normalizedTenant);
      theme(config);
      writeCachedThemeConfig({ slug: resolvedSlug, config, storage });
      writeCachedThemeConfig({ host, config, storage });
      writeCachedTenantPayload({ slug: resolvedSlug, payload: tenant, storage });
      writeCachedTenantPayload({ host, payload: tenant, storage });
      if (resolvedSlug) storage?.setItem?.("pondbridgeTenantSlug", resolvedSlug);
      setState({ loading: false, error: "", tenant: normalizedTenant });
    } catch (error) {
      // A stale failure must not clear the tenant the user is now looking at.
      if (!isCurrent()) return;
      if (cachedPayload || freshCachedPayload) {
        setState((prev) => ({ ...prev, loading: false, error: "" }));
      } else {
        setState((prev) => {
          const previousTenantSlug = String(prev?.tenant?.slug || "").trim().toLowerCase();
          const canKeepPreviousTenant = Boolean(prev?.tenant) && (!normalizedSlug || previousTenantSlug === normalizedSlug);
          if (canKeepPreviousTenant) {
            return { ...prev, loading: false, error: "" };
          }
          return { loading: false, error: error.message, tenant: null };
        });
      }
    }
  }

  // Retiring the generation is the cancellation: any response still in flight
  // for the slug we are leaving can no longer write.
  function retire() {
    generation += 1;
  }

  return { fetchTenant, retire };
}

export function TenantProvider({ slug = "", children }) {
  const [state, setState] = useState({ loading: true, error: "", tenant: null });
  // The public tenant config is unauthenticated and cached, so it cannot know
  // who is asking. When a camp runs tiered access the member's own module set
  // has to come from an authenticated response instead, or the navigation
  // offers pages the API will refuse.
  const [viewerModules, setViewerModules] = useState(null);

  const fetcherRef = useRef(null);
  if (!fetcherRef.current) fetcherRef.current = createTenantFetcher({ setState });

  function fetchTenant(requestedSlug = slug, options = {}) {
    return fetcherRef.current.fetchTenant(requestedSlug, options);
  }

  useEffect(() => {
    if (slug) localStorage.setItem("pondbridgeTenantSlug", String(slug || ""));

    fetchTenant(slug);

    return () => {
      fetcherRef.current.retire();
    };
  }, [slug]);

  const token = useOptionalAuthToken();
  const tenantSlug = String(state.tenant?.slug || slug || "").trim().toLowerCase();

  useEffect(() => {
    if (!token || !tenantSlug) {
      setViewerModules(null);
      return undefined;
    }
    let active = true;
    requestJson(`/api/t/${tenantSlug}/me`, { token })
      .then((response) => {
        if (!active) return;
        const modules = response?.viewerModules;
        setViewerModules(modules && typeof modules === "object" ? modules : null);
      })
      .catch(() => {
        // A member who cannot load their own profile keeps the public module
        // set; the API still refuses anything their tier cannot reach.
        if (active) setViewerModules(null);
      });
    return () => {
      active = false;
    };
  }, [tenantSlug, token]);

  // Launch is the one transition the app navigates on, and the redirect it
  // triggers reloads the page before any refetch can land. Writing "live"
  // through to the payload cache means that reload paints a launched tenant
  // instead of the pre-launch copy that would bounce the director back into
  // onboarding. The next fetch overwrites it with the server's own answer.
  function markTenantLive() {
    const normalizedSlug = String(state.tenant?.slug || slug || "").trim().toLowerCase();
    const host = window.location.hostname || "";
    const cachedEntry =
      readCachedTenantPayloadEntry({ slug: normalizedSlug, host }) ||
      readCachedTenantPayloadEntry({ host });
    const basePayload = cachedEntry?.payload || null;
    if (basePayload) {
      const livePayload = { ...basePayload, onboardingStatus: "live" };
      writeCachedTenantPayload({ slug: normalizedSlug, payload: livePayload });
      writeCachedTenantPayload({ host, payload: livePayload });
    }

    setState((prev) =>
      prev.tenant ? { ...prev, tenant: { ...prev.tenant, onboardingStatus: "live" } } : prev
    );
  }

  const value = useMemo(
    () => {
      const tenant = state.tenant;
      // Merge on top of the public answer rather than replacing it, so a camp
      // without tiering (or a member whose /me has not landed yet) keeps
      // exactly the modules it has always had.
      const merged =
        tenant && viewerModules
          ? {
              ...tenant,
              modules: { ...tenant.modules, ...viewerModules },
              config: { ...tenant.config, modules: { ...tenant.config?.modules, ...viewerModules } }
            }
          : tenant;

      return {
        slug: String(state.tenant?.slug || slug || ""),
        tenant: merged,
        loading: state.loading,
        error: state.error,
        refreshTenant: fetchTenant,
        markTenantLive
      };
    },
    [slug, state, viewerModules]
  );

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

export const TenantThemeProvider = TenantProvider;

export function useTenant() {
  const ctx = useContext(TenantContext);
  if (!ctx) throw new Error("useTenant must be used in TenantProvider");
  return ctx;
}
