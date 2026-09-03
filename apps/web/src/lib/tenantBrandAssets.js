// Pure helpers shared by the app bundle and the Cloudflare Pages Function that
// serves /brand/* . The tab icon has to be correct in the HTML the edge returns —
// swapping it from React runs after first paint, which browsers cache around and
// Safari ignores outright — so the resolution rules live here and are exercised by
// both sides.

export const DEFAULT_APP_NAME = "PondBridge";
export const DEFAULT_ICON_PATH = "/favicon.svg";
export const DEFAULT_MANIFEST_PATH = "/manifest.json";

// 32 for the browser tab, 180 for iOS home screens, 192/512 for the web manifest.
export const APP_ICON_SIZES = Object.freeze([32, 180, 192, 512]);

export const BRAND_ASSET_ROUTES = Object.freeze({
  "/brand/icon-32.png": Object.freeze({ kind: "icon", size: 32 }),
  "/brand/icon-180.png": Object.freeze({ kind: "icon", size: 180 }),
  "/brand/icon-192.png": Object.freeze({ kind: "icon", size: 192 }),
  "/brand/icon-512.png": Object.freeze({ kind: "icon", size: 512 }),
  "/brand/manifest.webmanifest": Object.freeze({ kind: "manifest", size: 0 })
});

export function normalizeAssetUrl(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    return url.toString();
  } catch {
    return "";
  }
}

export function resolveApiBaseUrl(env = {}, requestUrl = "") {
  const configured = String(env?.PONDBRIDGE_API_BASE || env?.VITE_API_BASE || "").trim();
  if (configured) return configured.replace(/\/+$/, "");

  try {
    const { hostname } = new URL(requestUrl);
    const registrable = hostname.split(".").slice(-2).join(".");
    if (registrable) return `https://api.${registrable}`;
  } catch {
    // Fall through to the platform default below.
  }

  return "https://api.pondbridgealumni.com";
}

function readIconUrls(tenant) {
  const branding = tenant?.config?.branding || {};
  const theme = tenant?.theme || {};
  const source = branding.iconUrls || theme.iconUrls || {};
  if (!source || typeof source !== "object") return {};

  const icons = {};
  for (const size of APP_ICON_SIZES) {
    const url = normalizeAssetUrl(source[size] ?? source[String(size)] ?? "");
    if (url) icons[size] = url;
  }
  return icons;
}

export function resolveTenantLogoUrl(tenant) {
  return (
    normalizeAssetUrl(tenant?.config?.branding?.logoUrl) ||
    normalizeAssetUrl(tenant?.theme?.logoUrl)
  );
}

/**
 * The square source a director uploaded specifically to be the tab icon. It is
 * optional: a camp that never sets one keeps using its logo, which is why this is
 * a separate field rather than an overwrite of logoUrl.
 */
export function resolveTenantFaviconUrl(tenant) {
  return (
    normalizeAssetUrl(tenant?.config?.branding?.faviconUrl) ||
    normalizeAssetUrl(tenant?.theme?.faviconUrl)
  );
}

/**
 * Picks the closest generated icon at or above the requested size so the browser
 * never scales a 32px source up into a home-screen tile. Camps branded before the
 * derivatives existed fall back to their own square icon, then their logo, both of
 * which beat the platform "P".
 */
export function resolveTenantIconUrl(tenant, size = 32) {
  const icons = readIconUrls(tenant);
  const available = APP_ICON_SIZES.filter((candidate) => icons[candidate]);
  if (available.length) {
    const atLeast = available.find((candidate) => candidate >= size);
    return icons[atLeast ?? available[available.length - 1]];
  }
  // Derivatives are generated on upload, so only camps branded before they existed
  // reach here. Their own square icon beats their logo, and the logo beats the "P".
  return resolveTenantFaviconUrl(tenant) || resolveTenantLogoUrl(tenant);
}

export function campNetworkTitle(campName = "") {
  const trimmed = String(campName || "").trim();
  if (!trimmed) return DEFAULT_APP_NAME;
  const labeled = /^camp\s+/i.test(trimmed) ? trimmed : `Camp ${trimmed}`;
  return `${labeled} Alumni Network`;
}

export function buildTenantManifest(tenant) {
  const campName = String(tenant?.name || "").trim();
  const theme = tenant?.theme || {};
  const branding = tenant?.config?.branding || {};
  const themeColor = String(branding.brandPrimary || theme.brandPrimary || "#404040").trim();

  return {
    name: campNetworkTitle(campName),
    short_name: campName.slice(0, 24) || DEFAULT_APP_NAME,
    description: campName
      ? `Alumni network for ${campName}.`
      : "Camp network management platform for camps and organizations.",
    start_url: "/",
    display: "standalone",
    background_color: String(theme.bg || "#fafafa").trim(),
    theme_color: themeColor,
    icons: [
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" }
    ]
  };
}
