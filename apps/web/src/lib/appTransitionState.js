function normalizeValue(value = "") {
  return String(value || "").trim();
}

export function inferTransitionSlug(locationLike = globalThis?.location, storage = globalThis?.localStorage) {
  const pathname = normalizeValue(locationLike?.pathname || "/");
  const pathMatch = pathname.match(/^\/t\/([^/]+)/i);
  if (pathMatch?.[1]) return normalizeValue(pathMatch[1]).toLowerCase();

  const hostname = normalizeValue(locationLike?.hostname).toLowerCase();
  const baseDomain = normalizeValue(import.meta.env.VITE_APP_BASE_DOMAIN || "pondbridgealumni.com").toLowerCase();
  if (baseDomain && hostname.endsWith(`.${baseDomain}`)) {
    const candidate = hostname.slice(0, -1 * (baseDomain.length + 1)).split(".")[0] || "";
    if (candidate && !["www", "app", "api", "super"].includes(candidate)) return candidate;
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
