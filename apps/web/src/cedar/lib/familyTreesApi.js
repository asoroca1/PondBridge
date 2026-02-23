import { API_BASE } from "./api";

const BASE_PATHS = ["/family-trees"];

export async function requestFamilyTrees({
  method = "GET",
  path = "",
  query = null,
  body = null,
  token = "",
} = {}) {
  const cleanPath = path ? (path.startsWith("/") ? path : `/${path}`) : "";

  for (let i = 0; i < BASE_PATHS.length; i += 1) {
    const base = BASE_PATHS[i];
    const qs = query instanceof URLSearchParams ? query.toString() : "";
    const url = `${API_BASE}${base}${cleanPath}${qs ? `?${qs}` : ""}`;

    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body != null) headers["Content-Type"] = "application/json";

    const res = await fetch(url, {
      method,
      headers,
      body: body != null ? JSON.stringify(body) : undefined,
    });

    if (res.status === 404 && i < BASE_PATHS.length - 1) {
      continue;
    }

    return res;
  }

  throw new Error("No Family Trees API endpoint available");
}
