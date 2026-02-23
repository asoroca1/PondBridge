function normalizeBase(raw) {
  let b = raw || (location.hostname === "localhost" ? "http://localhost:4000" : "");
  b = String(b).replace(/\/+$/, "");
  if (b === "/api") b = "";
  return b;
}

function tenantSlugFromPath() {
  const match = window.location.pathname.match(/^\/t\/([^/]+)/i);
  if (match?.[1]) return decodeURIComponent(match[1]);
  return localStorage.getItem("pondbridgeTenantSlug") || "";
}

function resolveApiBase() {
  const slug = tenantSlugFromPath();
  return slug
    ? `${normalizeBase(import.meta.env.VITE_API_BASE)}/api/t/${slug}`
    : `${normalizeBase(import.meta.env.VITE_API_BASE)}/api/t`;
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
  const r = await fetch(`${API_BASE}/profiles/me`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!r.ok) throw new Error("Failed to fetch profile");
  const payload = await r.json();
  return payload?.profile || payload;
}
  
