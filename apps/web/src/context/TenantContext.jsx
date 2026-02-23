import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { requestJson } from "../lib/http.js";

const TenantContext = createContext(null);

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

function applyTheme(config = {}) {
  const root = document.documentElement;
  const branding = config?.branding || config?.theme || {};
  const fontToken = String(branding.fontToken || "cedar_default");
  const font = FONT_TOKEN_MAP[fontToken] || FONT_TOKEN_MAP.cedar_default;
  const heroImage = branding.heroImageUrl || "";

  root.style.setProperty("--brand-primary", branding.brandPrimary || "#002b5c");
  root.style.setProperty("--brand-secondary", branding.brandSecondary || "#d3dde8");
  root.style.setProperty("--brand-accent", branding.brandAccent || "#f2b134");
  root.style.setProperty("--bg", branding.bg || "#f5f7fa");
  root.style.setProperty("--text", branding.text || "#0f172a");
  root.style.setProperty("--card", branding.card || "#ffffff");
  root.style.setProperty("--font-display", font.display);
  root.style.setProperty("--font-body", font.body);
  root.style.setProperty("--font-family", font.body);
  if (heroImage) root.style.setProperty("--hero-image-url", `url(\"${heroImage}\")`);
  else root.style.removeProperty("--hero-image-url");
}

export function TenantProvider({ slug = "", children }) {
  const [state, setState] = useState({ loading: true, error: "", tenant: null });

  async function fetchTenant(requestedSlug = slug) {
    const normalizedSlug = String(requestedSlug || "").trim().toLowerCase();
    const host = window.location.hostname || "";
    const query = normalizedSlug
      ? `slug=${encodeURIComponent(normalizedSlug)}`
      : `host=${encodeURIComponent(host)}`;

    setState((prev) => ({ ...prev, loading: true, error: "" }));
    try {
      const tenant = await requestJson(`/api/public/tenant-config?${query}`);
      const config = tenant?.config || {};
      const resolvedSlug = String(tenant?.slug || normalizedSlug).trim().toLowerCase();
      applyTheme(config);
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
