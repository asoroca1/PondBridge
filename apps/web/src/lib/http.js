import { inferCampSlugFromHost } from "./domain.js";
import { getVolatileAuthToken } from "./authMemory.js";
import { readCachedAuthUser } from "./storage.js";
import { whenAuthSettled } from "./authReadiness.js";
import {
  dispatchAccountConfirmationRequired,
  isAccountConfirmationRequired
} from "./accountConfirmation.js";

const LOCAL_API_FALLBACK = "http://localhost:4000";
const APP_BASE_DOMAIN = String(import.meta.env.VITE_APP_BASE_DOMAIN || "pondbridgealumni.com")
  .trim()
  .toLowerCase();
const NATIVE_API_BASE = normalizeBase(import.meta.env.VITE_NATIVE_API_BASE || "");

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

function isNativeAppRuntime() {
  if (typeof window === "undefined") return false;
  const capacitor = window.Capacitor || null;
  if (!capacitor) return false;
  try {
    if (typeof capacitor.isNativePlatform === "function") {
      return Boolean(capacitor.isNativePlatform());
    }
  } catch {
    // Ignore bridge issues and fall through.
  }
  const platform = String(capacitor.getPlatform?.() || "").trim().toLowerCase();
  return platform === "ios" || platform === "android";
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

  if (isNativeAppRuntime()) {
    if (NATIVE_API_BASE) {
      return NATIVE_API_BASE;
    }
    if (configuredBase && !configuredIsLocal) {
      return configuredBase;
    }
    return fallbackProductionApiBase();
  }

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

  const message = "We couldn’t connect. Check your internet connection and try again in a moment.";
  const wrapped = new Error(message);
  wrapped.code = "API_UNREACHABLE";
  wrapped.requestPath = path;
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

// A page load empties the in-memory token, and route data requests do not wait
// for the auth bootstrap to put it back. A request that loses that race goes out
// with no Authorization header at all, and the 401 it earns is indistinguishable
// from a dead session: the app signed the member out, bounced them to /login and
// reloaded — which reopened the same empty-token window. That is the "random"
// sign-in flash, and on /photo-stream it reproduced every time.
//
// A 401 on a request we sent *unauthenticated* is a race, not an answer about
// the session. Wait briefly for the token the bootstrap is already fetching and
// ask again.
const UNAUTHENTICATED_RETRY_DELAYS_MS = [50, 120, 300, 600];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Only worth waiting when this browser believes it has a session. A genuinely
 * signed-out visitor should get their 401 immediately rather than paying a
 * second of latency on every call.
 */
function expectsAuthenticatedSession() {
  if (getVolatileAuthToken()) return true;
  if (readCachedAuthUser()) return true;
  return Boolean(typeof window !== "undefined" && window?.Clerk?.session);
}

async function waitForLateAuthToken(getToken) {
  for (const delay of UNAUTHENTICATED_RETRY_DELAYS_MS) {
    await sleep(delay);
    const volatileToken = getVolatileAuthToken();
    if (volatileToken) return volatileToken;
    if (typeof getToken === "function") {
      const fromProvider = await Promise.resolve(getToken()).catch(() => "");
      if (fromProvider) return fromProvider;
    }
    const fromClerk = await readBrowserClerkToken();
    if (fromClerk) return fromClerk;
  }
  return "";
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

async function performJsonRequest(url, { method, headers, signal, body, cache }) {
  return fetch(url, {
    method,
    headers,
    credentials: "include",
    signal,
    body,
    ...(cache ? { cache } : {})
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

export async function requestJson(path, { method = "GET", body, token, getToken, headers = {}, signal, cache } = {}) {
  const normalizedPath = String(path || "");
  // `cache: "no-store"` means the caller needs server truth right now, so it
  // skips the local GET memoization as well as the browser HTTP cache.
  const skipResponseCache = String(cache || "") === "no-store";
  const normalizedMethod = String(method || "GET").toUpperCase();
  const isPublicApiPath = normalizedPath.startsWith("/api/public/");
  // The sign-in endpoints are what settle the gate, so they can never wait on
  // it, and nothing on them is authenticated anyway.
  const isAuthPath = normalizedPath.includes("/auth/");

  // Hold authenticated calls until the bootstrap has restored the token. A page
  // load empties it, and a request that goes out in that window earns a 401 that
  // reads as a dead session.
  if (!isPublicApiPath && !isAuthPath) {
    await whenAuthSettled();
  }

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
  const inFlightGetKey = skipResponseCache
    ? ""
    : buildInFlightGetRequestKey({
        method: normalizedMethod,
        path: normalizedPath,
        token: resolvedToken,
        headers: baseHeaders,
        body,
        signal
      });
  if (normalizedMethod !== "GET") {
    clearGetResponseCache();
  } else if (cacheKey && !skipResponseCache) {
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
      cache,
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

    // The request above carried no token and the refresh had nothing to give
    // yet, so this 401 says nothing about whether the member is signed in.
    if (
      response.status === 401 &&
      !isPublicApiPath &&
      !resolvedToken &&
      expectsAuthenticatedSession()
    ) {
      const lateToken = await waitForLateAuthToken(getToken);
      if (lateToken) {
        resolvedToken = lateToken;
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
      if (isAccountConfirmationRequired(payload)) {
        dispatchAccountConfirmationRequired(normalizedPath, payload);
      }
      throw error;
    }

    if (normalizedMethod === "GET" && cacheKey && !skipResponseCache) {
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
