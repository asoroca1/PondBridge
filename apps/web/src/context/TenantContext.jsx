import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { normalizeHeroImagePosition, normalizeHeroImageSize, resolveTenantModules } from "@pondbridge/shared";
import { requestJson } from "../lib/http.js";

const TenantContext = createContext(null);
const TENANT_THEME_CACHE_PREFIX = "pondbridgeTenantTheme:";
const TENANT_CONFIG_CACHE_PREFIX = "pondbridgeTenantConfig:";
const TENANT_CONFIG_CACHE_TTL_MS = 5 * 60 * 1000;

const FONT_TOKEN_MAP = {
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

function normalizeHexColor(value = "", fallback = "#002b5c") {
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

function hexToRgb(hex = "#002b5c") {
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

function linearizeSrgbChannel(channel = 0) {
  const normalized = Math.max(0, Math.min(255, Number(channel) || 0)) / 255;
  if (normalized <= 0.04045) return normalized / 12.92;
  return ((normalized + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex = "#002b5c") {
  const { r, g, b } = hexToRgb(hex);
  return (
    0.2126 * linearizeSrgbChannel(r) +
    0.7152 * linearizeSrgbChannel(g) +
    0.0722 * linearizeSrgbChannel(b)
  );
}

function contrastRatio(baseHex = "#002b5c", candidateHex = "#ffffff") {
  const base = relativeLuminance(baseHex);
  const candidate = relativeLuminance(candidateHex);
  const brightest = Math.max(base, candidate);
  const darkest = Math.min(base, candidate);
  return (brightest + 0.05) / (darkest + 0.05);
}

function readableTextColorOnBrand(brandHex = "#002b5c") {
  const light = "#ffffff";
  const dark = "#0f172a";
  return contrastRatio(brandHex, light) >= contrastRatio(brandHex, dark) ? light : dark;
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
  const brandPrimary = normalizeHexColor(branding.brandPrimary || "#002b5c");
  const brandPrimaryHover = mixHex(brandPrimary, "#000000", 0.16);
  const brandPrimaryStrong = mixHex(brandPrimary, "#000000", 0.24);
  const brandPrimarySoft = mixHex(brandPrimary, "#ffffff", 0.46);
  const brandPrimarySoftStrong = mixHex(brandPrimary, "#ffffff", 0.28);
  const cardBorder = mixHex(brandPrimary, "#dfe6ef", 0.84);
  const textMuted = mixHex(brandPrimary, "#64748b", 0.74);
  const brandPrimaryRgb = hexToRgb(brandPrimary);
  const brandOnPrimary = readableTextColorOnBrand(brandPrimary);
  const brandOnPrimaryRgb = hexToRgb(brandOnPrimary);

  root.style.setProperty("--brand-primary", brandPrimary);
  root.style.setProperty("--brand-primary-hover", brandPrimaryHover);
  root.style.setProperty("--brand-primary-strong", brandPrimaryStrong);
  root.style.setProperty("--brand-primary-soft", brandPrimarySoft);
  root.style.setProperty("--brand-primary-soft-strong", brandPrimarySoftStrong);
  root.style.setProperty("--brand-primary-rgb", `${brandPrimaryRgb.r}, ${brandPrimaryRgb.g}, ${brandPrimaryRgb.b}`);
  root.style.setProperty("--brand-on-primary", brandOnPrimary);
  root.style.setProperty("--brand-on-primary-rgb", `${brandOnPrimaryRgb.r}, ${brandOnPrimaryRgb.g}, ${brandOnPrimaryRgb.b}`);
  root.style.setProperty("--brand-primary-shadow", rgbaFromHex(brandPrimary, 0.2));
  root.style.setProperty("--brand-primary-focus", rgbaFromHex(brandPrimary, 0.22));
  root.style.setProperty("--brand-primary-tint", rgbaFromHex(brandPrimary, 0.12));
  root.style.setProperty("--brand-secondary", branding.brandSecondary || "#d3dde8");
  root.style.setProperty("--brand-accent", branding.brandAccent || "#f2b134");
  root.style.setProperty("--bg", branding.bg || "#f5f7fa");
  root.style.setProperty("--text", branding.text || "#0f172a");
  root.style.setProperty("--text-muted", branding.textMuted || textMuted);
  root.style.setProperty("--card", branding.card || "#ffffff");
  root.style.setProperty("--card-border", branding.cardBorder || cardBorder);
  root.style.setProperty("--font-display", font.display);
  root.style.setProperty("--font-body", font.body);
  root.style.setProperty("--font-family", font.body);
  root.style.setProperty("--hero-image-position", heroImagePosition);
  root.style.setProperty("--hero-image-size", heroImageSize);
  if (heroImage) root.style.setProperty("--hero-image-url", `url(\"${heroImage}\")`);
  else root.style.removeProperty("--hero-image-url");
}

function tenantThemeCacheKey({ slug = "", host = "" } = {}) {
  const normalizedSlug = String(slug || "").trim().toLowerCase();
  const normalizedHost = String(host || "").trim().toLowerCase();
  const key = normalizedSlug || normalizedHost;
  return key ? `${TENANT_THEME_CACHE_PREFIX}${key}` : "";
}

function readCachedThemeConfig({ slug = "", host = "" } = {}) {
  const key = tenantThemeCacheKey({ slug, host });
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function writeCachedThemeConfig({ slug = "", host = "", config = null } = {}) {
  const key = tenantThemeCacheKey({ slug, host });
  if (!key || !config || typeof config !== "object") return;
  try {
    localStorage.setItem(key, JSON.stringify(config));
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

function readCachedTenantPayloadEntry({ slug = "", host = "" } = {}) {
  const key = tenantConfigCacheKey({ slug, host });
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
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

function writeCachedTenantPayload({ slug = "", host = "", payload = null } = {}) {
  const key = tenantConfigCacheKey({ slug, host });
  if (!key || !payload || typeof payload !== "object") return;
  try {
    localStorage.setItem(
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

export function TenantProvider({ slug = "", children }) {
  const [state, setState] = useState({ loading: true, error: "", tenant: null });

  async function fetchTenant(requestedSlug = slug) {
    const normalizedSlug = String(requestedSlug || "").trim().toLowerCase();
    const host = window.location.hostname || "";
    const query = normalizedSlug
      ? `slug=${encodeURIComponent(normalizedSlug)}`
      : `host=${encodeURIComponent(host)}`;

    const cachedEntry = readCachedTenantPayloadEntry({ slug: normalizedSlug, host });
    const cachedPayload = cachedEntry?.payload || null;
    const freshCachedPayload = Boolean(cachedEntry && !cachedEntry.expired);
    if (cachedPayload) {
      const cachedTenant = normalizeTenantPayload(cachedPayload, normalizedSlug);
      const cachedConfig = cachedTenant?.config || {};
      preloadTenantHero(cachedTenant);
      applyTheme(cachedConfig);
      setState({ loading: false, error: "", tenant: cachedTenant });
    } else {
      const cachedConfig = readCachedThemeConfig({ slug: normalizedSlug, host });
      if (cachedConfig) {
        applyTheme(cachedConfig);
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
      const tenant = await requestJson(`/api/public/tenant-config?${query}`);
      const normalizedTenant = normalizeTenantPayload(tenant, normalizedSlug);
      const config = normalizedTenant?.config || {};
      const resolvedSlug = String(normalizedTenant?.slug || normalizedSlug).trim().toLowerCase();
      preloadTenantHero(normalizedTenant);
      applyTheme(config);
      writeCachedThemeConfig({ slug: resolvedSlug, config });
      writeCachedThemeConfig({ host, config });
      writeCachedTenantPayload({ slug: resolvedSlug, payload: tenant });
      writeCachedTenantPayload({ host, payload: tenant });
      if (resolvedSlug) localStorage.setItem("pondbridgeTenantSlug", resolvedSlug);
      setState({ loading: false, error: "", tenant: normalizedTenant });
    } catch (error) {
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

  useEffect(() => {
    let cancelled = false;
    if (slug) localStorage.setItem("pondbridgeTenantSlug", String(slug || ""));

    fetchTenant(slug).then(() => {
      if (cancelled) return;
    });

    return () => {
      cancelled = true;
    };
  }, [slug]);

  const value = useMemo(
    () => ({
      slug: String(state.tenant?.slug || slug || ""),
      tenant: state.tenant,
      loading: state.loading,
      error: state.error,
      refreshTenant: fetchTenant
    }),
    [slug, state]
  );

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

export const TenantThemeProvider = TenantProvider;

export function useTenant() {
  const ctx = useContext(TenantContext);
  if (!ctx) throw new Error("useTenant must be used in TenantProvider");
  return ctx;
}
