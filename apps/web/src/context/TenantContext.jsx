import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { normalizeHeroImagePosition, normalizeHeroImageSize } from "@pondbridge/shared";
import { requestJson } from "../lib/http.js";

const TenantContext = createContext(null);
const TENANT_THEME_CACHE_PREFIX = "pondbridgeTenantTheme:";

const FONT_TOKEN_MAP = {
  cedar_default: {
    display: "\"Roboto Slab\", \"Avenir Next\", serif",
    body: "\"Inter\", \"Avenir Next\", \"Segoe UI\", sans-serif"
  },
  modern_clean: {
    display: "\"Inter\", \"Avenir Next\", \"Segoe UI\", sans-serif",
    body: "\"Inter\", \"Avenir Next\", \"Segoe UI\", sans-serif"
  },
  classic_serif: {
    display: "\"Lora\", \"Roboto Slab\", serif",
    body: "\"Lora\", \"Inter\", serif"
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

function applyTheme(config = {}) {
  const root = document.documentElement;
  const branding = config?.branding || config?.theme || {};
  const fontToken = String(branding.fontToken || "cedar_default");
  const font = FONT_TOKEN_MAP[fontToken] || FONT_TOKEN_MAP.cedar_default;
  const heroImage = branding.heroImageUrl || "";
  const heroImagePosition = normalizeHeroImagePosition(branding.heroImagePosition || "");
  const heroImageSize = normalizeHeroImageSize(branding.heroImageSize || "");
  const brandPrimary = normalizeHexColor(branding.brandPrimary || "#002b5c");
  const brandPrimaryHover = mixHex(brandPrimary, "#000000", 0.16);
  const brandPrimaryStrong = mixHex(brandPrimary, "#000000", 0.24);
  const brandPrimarySoft = mixHex(brandPrimary, "#ffffff", 0.46);
  const brandPrimarySoftStrong = mixHex(brandPrimary, "#ffffff", 0.28);
  const brandPrimaryRgb = hexToRgb(brandPrimary);

  root.style.setProperty("--brand-primary", brandPrimary);
  root.style.setProperty("--brand-primary-hover", brandPrimaryHover);
  root.style.setProperty("--brand-primary-strong", brandPrimaryStrong);
  root.style.setProperty("--brand-primary-soft", brandPrimarySoft);
  root.style.setProperty("--brand-primary-soft-strong", brandPrimarySoftStrong);
  root.style.setProperty("--brand-primary-rgb", `${brandPrimaryRgb.r}, ${brandPrimaryRgb.g}, ${brandPrimaryRgb.b}`);
  root.style.setProperty("--brand-primary-shadow", rgbaFromHex(brandPrimary, 0.2));
  root.style.setProperty("--brand-primary-focus", rgbaFromHex(brandPrimary, 0.22));
  root.style.setProperty("--brand-primary-tint", rgbaFromHex(brandPrimary, 0.12));
  root.style.setProperty("--brand-secondary", branding.brandSecondary || "#d3dde8");
  root.style.setProperty("--brand-accent", branding.brandAccent || "#f2b134");
  root.style.setProperty("--bg", branding.bg || "#f5f7fa");
  root.style.setProperty("--text", branding.text || "#0f172a");
  root.style.setProperty("--card", branding.card || "#ffffff");
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

export function TenantProvider({ slug = "", children }) {
  const [state, setState] = useState({ loading: true, error: "", tenant: null });

  async function fetchTenant(requestedSlug = slug) {
    const normalizedSlug = String(requestedSlug || "").trim().toLowerCase();
    const host = window.location.hostname || "";
    const query = normalizedSlug
      ? `slug=${encodeURIComponent(normalizedSlug)}`
      : `host=${encodeURIComponent(host)}`;

    const cachedConfig = readCachedThemeConfig({ slug: normalizedSlug, host });
    if (cachedConfig) {
      applyTheme(cachedConfig);
    }

    setState((prev) => ({ ...prev, loading: true, error: "" }));
    try {
      const tenant = await requestJson(`/api/public/tenant-config?${query}`);
      const config = tenant?.config || {};
      const resolvedSlug = String(tenant?.slug || normalizedSlug).trim().toLowerCase();
      applyTheme(config);
      writeCachedThemeConfig({ slug: resolvedSlug, config });
      writeCachedThemeConfig({ host, config });
      if (resolvedSlug) localStorage.setItem("pondbridgeTenantSlug", resolvedSlug);
      setState({
        loading: false,
        error: "",
        tenant: {
          ...tenant,
          slug: resolvedSlug,
          config,
          theme: tenant.theme || config.branding || {},
          content: tenant.content || config.content || {},
          accessSettings: tenant.accessSettings || config.accessRules || {},
          modules: tenant.modules || config.modules || {}
        }
      });
    } catch (error) {
      setState({ loading: false, error: error.message, tenant: null });
    }
  }

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, error: "", tenant: null });
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
