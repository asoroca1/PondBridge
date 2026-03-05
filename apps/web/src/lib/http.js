import { inferCampSlugFromHost } from "./domain.js";

const rawBase = import.meta.env.VITE_API_BASE || "http://localhost:4000";
export const API_BASE = rawBase.replace(/\/+$/, "");
const CLERK_FORCED_REFRESH_COOLDOWN_MS = 1500;
const inFlightGetRequests = new Map();

let forcedRefreshPromise = null;
let lastForcedRefreshAt = 0;

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

  const inFlightGetKey = buildInFlightGetRequestKey({
    method,
    path: normalizedPath,
    token: resolvedToken,
    headers: baseHeaders,
    body,
    signal
  });
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
      method,
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
