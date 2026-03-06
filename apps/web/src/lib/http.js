import { inferCampSlugFromHost } from "./domain.js";

const LOCAL_API_FALLBACK = "http://localhost:4000";
const APP_BASE_DOMAIN = String(import.meta.env.VITE_APP_BASE_DOMAIN || "pondbridgealumni.com")
  .trim()
  .toLowerCase();

function normalizeBase(value = "") {
  return String(value || "").trim().replace(/\/+$/, "");
}

function isLocalHost(hostname = "") {
  const host = String(hostname || "").trim().toLowerCase();
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host.endsWith(".localhost")
  );
}

function hostFromBaseUrl(base = "") {
  try {
    return new URL(String(base || "")).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function fallbackProductionApiBase() {
  const safeDomain = APP_BASE_DOMAIN || "pondbridgealumni.com";
  return `https://api.${safeDomain}`;
}

function resolveApiBase() {
  const configuredBase = normalizeBase(import.meta.env.VITE_API_BASE || "");
  if (typeof window === "undefined") {
    return configuredBase || LOCAL_API_FALLBACK;
  }

  const browserHost = String(window.location.hostname || "").trim().toLowerCase();
  const onLocalHost = isLocalHost(browserHost);
  const configuredHost = hostFromBaseUrl(configuredBase);
  const configuredIsLocal = isLocalHost(configuredHost);

  if (configuredBase && (!configuredIsLocal || onLocalHost)) {
    return configuredBase;
  }

  if (!onLocalHost) {
    return fallbackProductionApiBase();
  }

  return configuredBase || LOCAL_API_FALLBACK;
}

export const API_BASE = resolveApiBase();
const CLERK_FORCED_REFRESH_COOLDOWN_MS = 1500;
const GET_RESPONSE_CACHE_TTL_MS = 12_000;
const GET_RESPONSE_CACHE_MAX_ENTRIES = 350;
const inFlightGetRequests = new Map();
const successfulGetResponses = new Map();

let forcedRefreshPromise = null;
let lastForcedRefreshAt = 0;

function clonePayload(payload) {
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(payload);
    } catch {
      return payload;
    }
  }
  return payload;
}

function readGetResponseCache(cacheKey = "") {
  const key = String(cacheKey || "");
  if (!key) return null;
  const entry = successfulGetResponses.get(key);
  if (!entry) return null;
  if (Date.now() >= Number(entry.expiresAt || 0)) {
    successfulGetResponses.delete(key);
    return null;
  }
  return clonePayload(entry.payload);
}

function writeGetResponseCache(cacheKey = "", payload = null, ttlMs = GET_RESPONSE_CACHE_TTL_MS) {
  const key = String(cacheKey || "");
  if (!key || payload == null) return;
  if (successfulGetResponses.size >= GET_RESPONSE_CACHE_MAX_ENTRIES) {
    const firstKey = successfulGetResponses.keys().next().value;
    if (firstKey) successfulGetResponses.delete(firstKey);
  }
  successfulGetResponses.set(key, {
    expiresAt: Date.now() + Math.max(1000, Number(ttlMs) || GET_RESPONSE_CACHE_TTL_MS),
    payload: clonePayload(payload)
  });
}

function clearGetResponseCache() {
  successfulGetResponses.clear();
}

function isNetworkFailure(error) {
  const msg = String(error?.message || "").toLowerCase();
  return (
    msg.includes("failed to fetch") ||
    msg.includes("fetch failed") ||
    msg.includes("load failed") ||
    msg.includes("networkerror")
  );
}

function normalizeTransportError(error, path) {
  if (!isNetworkFailure(error)) {
    return error instanceof Error ? error : new Error("Request failed");
  }

  const message = `Could not reach API server at ${API_BASE} while requesting ${path}. Start the API server and refresh.`;
  const wrapped = new Error(message);
  wrapped.code = "API_UNREACHABLE";
  wrapped.cause = error;
  return wrapped;
}

async function readBrowserClerkToken({ forceRefresh = false } = {}) {
  if (typeof window === "undefined") return "";
  const clerk = window?.Clerk;
  const getSessionToken = clerk?.session?.getToken;
  if (typeof getSessionToken !== "function") return "";
  try {
    return (await getSessionToken(forceRefresh ? { skipCache: true } : undefined)) || "";
  } catch {
    return "";
  }
}

async function readBrowserClerkTokenWithSharedForceRefresh() {
  const now = Date.now();
  if (forcedRefreshPromise) return forcedRefreshPromise;
  if (now - lastForcedRefreshAt < CLERK_FORCED_REFRESH_COOLDOWN_MS) {
    return readBrowserClerkToken();
  }

  lastForcedRefreshAt = now;
  forcedRefreshPromise = readBrowserClerkToken({ forceRefresh: true }).finally(() => {
    forcedRefreshPromise = null;
  });
  return forcedRefreshPromise;
}

async function performJsonRequest(url, { method, headers, signal, body }) {
  return fetch(url, {
    method,
    headers,
    credentials: "include",
    signal,
    body
  });
}

function inferTenantSlugForRequest(path = "") {
  if (typeof window === "undefined") return "";
  if (!String(path || "").startsWith("/api/tenants/me")) return "";

  const routeMatch = String(window.location.pathname || "").match(/^\/t\/([^/]+)/i);
  if (routeMatch?.[1]) {
    return decodeURIComponent(routeMatch[1]).trim().toLowerCase();
  }

  return inferCampSlugFromHost(window.location.hostname || "");
}

function normalizeHeaderKey(value = "") {
  return String(value || "").trim().toLowerCase();
}

function buildInFlightGetRequestKey({
  method = "GET",
  path = "",
  token = "",
  headers = {},
  body = null,
  signal = null
} = {}) {
  if (String(method || "GET").toUpperCase() !== "GET") return "";
  if (body != null) return "";
  if (signal) return "";

  const headerFingerprint = Object.entries(headers || {})
    .map(([key, value]) => `${normalizeHeaderKey(key)}:${String(value ?? "").trim()}`)
    .sort()
    .join("|");

  return [
    "GET",
    String(path || ""),
    token ? `auth:${token}` : "anon",
    headerFingerprint
  ].join("::");
}

export async function requestJson(path, { method = "GET", body, token, getToken, headers = {}, signal } = {}) {
  const normalizedPath = String(path || "");
  const normalizedMethod = String(method || "GET").toUpperCase();
  const isPublicApiPath = normalizedPath.startsWith("/api/public/");
  let resolvedToken = token || "";
  if (typeof getToken === "function") {
    try {
      resolvedToken = (await getToken()) || resolvedToken;
    } catch {
      resolvedToken = token || "";
    }
  } else if (!resolvedToken && !isPublicApiPath) {
    const browserToken = await readBrowserClerkToken();
    if (browserToken) resolvedToken = browserToken;
  }

  const baseHeaders = {
    ...headers
  };
  if (!baseHeaders["X-Tenant-Slug"]) {
    const inferredTenantSlug = inferTenantSlugForRequest(path);
    if (inferredTenantSlug) {
      baseHeaders["X-Tenant-Slug"] = inferredTenantSlug;
    }
  }

  if (!(body instanceof FormData) && body != null) {
    baseHeaders["Content-Type"] = "application/json";
  }

  const cacheKey = buildInFlightGetRequestKey({
    method: normalizedMethod,
    path: normalizedPath,
    token: resolvedToken,
    headers: baseHeaders,
    body,
    signal: null
  });
  const inFlightGetKey = buildInFlightGetRequestKey({
    method: normalizedMethod,
    path: normalizedPath,
    token: resolvedToken,
    headers: baseHeaders,
    body,
    signal
  });
  if (normalizedMethod !== "GET") {
    clearGetResponseCache();
  } else if (cacheKey) {
    const cached = readGetResponseCache(cacheKey);
    if (cached !== null) {
      return cached;
    }
  }

  if (inFlightGetKey) {
    const existingRequest = inFlightGetRequests.get(inFlightGetKey);
    if (existingRequest) {
      return existingRequest;
    }
  }

  async function callWithToken(currentToken) {
    const requestHeaders = {
      ...(currentToken ? { Authorization: `Bearer ${currentToken}` } : {}),
      ...baseHeaders
    };
    return performJsonRequest(`${API_BASE}${normalizedPath}`, {
      method: normalizedMethod,
      headers: requestHeaders,
      signal,
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined
    });
  }

  const executeRequest = async () => {
    let response;
    try {
      response = await callWithToken(resolvedToken);
    } catch (error) {
      throw normalizeTransportError(error, normalizedPath);
    }

    if (response.status === 401 && !isPublicApiPath) {
      let refreshedToken =
        typeof getToken === "function" ? await getToken({ forceRefresh: true }).catch(() => "") : "";
      if (!refreshedToken || refreshedToken === resolvedToken) {
        const browserRefreshedToken = await readBrowserClerkTokenWithSharedForceRefresh();
        if (browserRefreshedToken) refreshedToken = browserRefreshedToken;
      }
      if (refreshedToken && refreshedToken !== resolvedToken) {
        resolvedToken = refreshedToken;
        try {
          response = await callWithToken(resolvedToken);
        } catch (error) {
          throw normalizeTransportError(error, normalizedPath);
        }
      }
    }

    const isJson = response.headers.get("content-type")?.includes("application/json");
    const payload = isJson
      ? await response.json().catch(() => ({}))
      : await response.text().catch(() => "");

    if (!response.ok) {
      const message = payload?.error?.message || payload?.message || "Request failed";
      const error = new Error(message);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }

    if (normalizedMethod === "GET" && cacheKey) {
      writeGetResponseCache(cacheKey, payload);
    }

    return payload;
  };

  if (!inFlightGetKey) {
    return executeRequest();
  }

  const sharedRequest = executeRequest().finally(() => {
    inFlightGetRequests.delete(inFlightGetKey);
  });
  inFlightGetRequests.set(inFlightGetKey, sharedRequest);
  return sharedRequest;
}

export async function requestBlob(path, { token } = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: "include"
    });
  } catch (error) {
    throw normalizeTransportError(error, path);
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.error?.message || "Download failed");
  }

  return response.blob();
}
