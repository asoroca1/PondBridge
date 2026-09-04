function normalizeValue(value = "") {
  return String(value || "").trim();
}

const NON_TENANT_SUBDOMAINS = ["www", "app", "api", "super"];

// The super console belongs to no camp, so there is nothing to brand it with.
function isSuperConsole(locationLike) {
  const pathname = normalizeValue(locationLike?.pathname || "/");
  const hostname = normalizeValue(locationLike?.hostname).toLowerCase();
  const baseDomain = normalizeValue(import.meta.env.VITE_APP_BASE_DOMAIN || "pondbridgealumni.com").toLowerCase();
  return hostname === `super.${baseDomain}` || /^\/super(\/|$)/i.test(pathname);
}

export function inferTransitionSlug(locationLike = globalThis?.location, storage = globalThis?.localStorage) {
  if (isSuperConsole(locationLike)) return "";
  const pathname = normalizeValue(locationLike?.pathname || "/");
  const pathMatch = pathname.match(/^\/t\/([^/]+)/i);
  if (pathMatch?.[1]) return normalizeValue(pathMatch[1]).toLowerCase();

  const hostname = normalizeValue(locationLike?.hostname).toLowerCase();
  const baseDomain = normalizeValue(import.meta.env.VITE_APP_BASE_DOMAIN || "pondbridgealumni.com").toLowerCase();
  let subdomain = "";
  if (baseDomain && hostname.endsWith(`.${baseDomain}`)) {
    subdomain = hostname.slice(0, -1 * (baseDomain.length + 1)).split(".")[0] || "";
    if (subdomain && !NON_TENANT_SUBDOMAINS.includes(subdomain)) return subdomain;
  }

  try {
    return normalizeValue(storage?.getItem?.("pondbridgeTenantSlug")).toLowerCase();
  } catch {
    return "";
  }
}

function readJson(storage, key = "") {
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

export function readTransitionBranding({
  locationLike = globalThis?.location,
  storage = globalThis?.localStorage
} = {}) {
  // Skip all camp caches, including hostname-keyed config and theme entries.
  if (isSuperConsole(locationLike)) {
    return { slug: "", networkName: "PondBridge", logoUrl: "" };
  }
  const slug = inferTransitionSlug(locationLike, storage);
  const hostname = normalizeValue(locationLike?.hostname).toLowerCase();
  const cacheKeys = [
    slug ? `pondbridgeTenantConfig:${slug}` : "",
    hostname ? `pondbridgeTenantConfig:${hostname}` : ""
  ].filter(Boolean);

  let tenant = null;
  for (const key of cacheKeys) {
    const entry = readJson(storage, key);
    if (entry?.payload) {
      tenant = entry.payload;
      break;
    }
  }

  const themeKeys = [
    slug ? `pondbridgeTenantTheme:${slug}` : "",
    hostname ? `pondbridgeTenantTheme:${hostname}` : ""
  ].filter(Boolean);
  let cachedTheme = null;
  for (const key of themeKeys) {
    cachedTheme = readJson(storage, key);
    if (cachedTheme) break;
  }

  const config = tenant?.config || {};
  const content = config?.content || tenant?.content || {};
  const tenantName = normalizeValue(tenant?.name);
  const tenantNetworkName = tenantName
    ? (/alumni\s+network/i.test(tenantName) ? tenantName : `${tenantName} Alumni Network`)
    : "";
  const networkName =
    normalizeValue(content?.networkName || content?.siteTitle) ||
    tenantNetworkName ||
    "PondBridge";

  return {
    slug,
    networkName,
    logoUrl: [
      config?.branding?.logoUrl,
      config?.theme?.logoUrl,
      tenant?.theme?.logoUrl,
      tenant?.branding?.logoUrl,
      cachedTheme?.branding?.logoUrl,
      cachedTheme?.theme?.logoUrl,
      cachedTheme?.logoUrl
    ].map((value) => normalizeValue(value)).find(Boolean) || ""
  };
}
