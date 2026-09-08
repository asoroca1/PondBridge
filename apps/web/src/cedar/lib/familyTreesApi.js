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

// The stored auth user carries both a user id (`_id`) and the profile id the
// family-tree API keys members on. They are different rows, so anything that
// talks about members has to read the profile id.
export function currentUserProfileId() {
  try {
    const raw = JSON.parse(localStorage.getItem("user") || "null");
    if (!raw) return "";
    return String(
      raw.profileId || raw.profile?.id || raw.profile?._id || ""
    ).trim();
  } catch {
    return "";
  }
}

// API errors come back as { error: { code, message } }; older shapes send a
// plain string. Rendering the object itself is how "[object Object]" happens.
export function apiErrorMessage(data, fallback = "") {
  const err = data?.error;
  if (typeof err === "string" && err.trim()) return err.trim();
  const message = String(err?.message || data?.message || "").trim();
  return message || fallback;
}
