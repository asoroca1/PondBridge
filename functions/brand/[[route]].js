import {
  BRAND_ASSET_ROUTES,
  buildTenantManifest,
  resolveApiBaseUrl,
  resolveTenantIconUrl
} from "../../apps/web/src/lib/tenantBrandAssets.js";

// Tenant branding changes should show up within minutes, but the icon itself is
// requested on every cold page load, so the upstream lookups are cached at the edge.
const TENANT_LOOKUP_TTL_SECONDS = 300;
const ICON_ORIGIN_TTL_SECONDS = 86400;
const BRAND_CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=86400";
// A camp that has not uploaded a logo yet falls back to the platform mark; keep that
// answer short-lived so the first branding save takes effect quickly.
const FALLBACK_CACHE_CONTROL = "public, max-age=60, stale-while-revalidate=600";

async function fetchTenantConfig(apiBase, hostname) {
  const endpoint = `${apiBase}/api/public/tenant-config?host=${encodeURIComponent(hostname)}`;
  try {
    const response = await fetch(endpoint, {
      headers: { accept: "application/json" },
      cf: { cacheTtl: TENANT_LOOKUP_TTL_SECONDS, cacheEverything: true }
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function redirectToDefault(requestUrl, path) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: new URL(path, requestUrl).toString(),
      "Cache-Control": FALLBACK_CACHE_CONTROL
    }
  });
}

function manifestResponse(tenant) {
  return new Response(JSON.stringify(buildTenantManifest(tenant), null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/manifest+json; charset=utf-8",
      "Cache-Control": BRAND_CACHE_CONTROL
    }
  });
}

async function iconResponse(iconUrl, method) {
  const upstream = await fetch(iconUrl, {
    cf: { cacheTtl: ICON_ORIGIN_TTL_SECONDS, cacheEverything: true }
  });
  if (!upstream.ok) return null;

  const headers = new Headers({
    "Content-Type": upstream.headers.get("Content-Type") || "image/png",
    "Cache-Control": BRAND_CACHE_CONTROL,
    "X-Content-Type-Options": "nosniff"
  });

  return new Response(method === "HEAD" ? null : upstream.body, { status: 200, headers });
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const route = BRAND_ASSET_ROUTES[url.pathname];

  // Unknown /brand/* paths must 404 rather than fall through to the SPA rewrite,
  // which would hand the browser an HTML document where an icon was requested.
  if (!route) {
    return new Response("Not found", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" }
    });
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  }

  const tenant = await fetchTenantConfig(resolveApiBaseUrl(env, request.url), url.hostname);

  if (route.kind === "manifest") {
    if (!tenant) return redirectToDefault(url, "/manifest.json");
    return manifestResponse(tenant);
  }

  const iconUrl = tenant ? resolveTenantIconUrl(tenant, route.size) : "";
  if (!iconUrl) return redirectToDefault(url, "/favicon.svg");

  try {
    const response = await iconResponse(iconUrl, request.method);
    if (response) return response;
  } catch {
    // Fall through to the platform mark rather than serving a broken icon.
  }

  return redirectToDefault(url, "/favicon.svg");
}
