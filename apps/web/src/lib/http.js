const rawBase = import.meta.env.VITE_API_BASE || "http://localhost:4000";
export const API_BASE = rawBase.replace(/\/+$/, "");

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

export async function requestJson(path, { method = "GET", body, token, headers = {}, signal } = {}) {
  const requestHeaders = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...headers
  };

  if (!(body instanceof FormData)) {
    requestHeaders["Content-Type"] = "application/json";
  }

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: requestHeaders,
      credentials: "include",
      signal,
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined
    });
  } catch (error) {
    throw normalizeTransportError(error, path);
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
