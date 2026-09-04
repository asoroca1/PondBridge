import { API_BASE as ROOT_API_BASE, requestJson } from "../../lib/http.js";
import { getToken } from "./helpers.js";

function normalizeBase(raw) {
  let b = String(raw || "").replace(/\/+$/, "");
  if (b.endsWith("/api")) {
    b = b.slice(0, -4).replace(/\/+$/, "");
  }
  return b;
}

function tenantSlugFromPath() {
  const match = window.location.pathname.match(/^\/t\/([^/]+)/i);
  if (match?.[1]) return decodeURIComponent(match[1]);
  return localStorage.getItem("pondbridgeTenantSlug") || "";
}

function resolveTenantApiPath() {
  const slug = tenantSlugFromPath();
  return slug ? `/api/t/${slug}` : "/api/t";
}

function resolveApiBase() {
  return `${normalizeBase(ROOT_API_BASE)}${resolveTenantApiPath()}`;
}

// Use the shared client's session cookies and one-time token refresh for
// mutations made after a page has been open long enough for its JWT to expire.
export function requestTenantJson(path, options = {}) {
  return requestJson(`${resolveTenantApiPath()}${path}`, {
    ...options,
    token: options.token || getToken()
  });
}

// Keep API_BASE call-sites unchanged while resolving tenant slug dynamically.
export const API_BASE = new Proxy(
  {},
  {
    get(_target, prop) {
      const value = resolveApiBase();
      if (prop === Symbol.toPrimitive) return () => value;
      if (prop === "toString" || prop === "valueOf") return () => value;
      const field = value[prop];
      return typeof field === "function" ? field.bind(value) : field;
    }
  }
);

export async function getMe(token) {
  const r = await fetch(`${API_BASE}/me`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!r.ok) throw new Error("Failed to fetch profile");
  const payload = await r.json();
  return payload?.profile || payload;
}
  
