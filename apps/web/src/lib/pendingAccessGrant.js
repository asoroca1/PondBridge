const ACCESS_GRANT_PREFIX = "pondbridgeAccessGrant:";

function grantKey(slug = "") {
  const normalizedSlug = String(slug || "").trim().toLowerCase();
  return normalizedSlug ? `${ACCESS_GRANT_PREFIX}${normalizedSlug}` : "";
}

export function readPendingAccessGrant(slug = "") {
  const key = grantKey(slug);
  if (!key || typeof window === "undefined") return "";
  try {
    return String(window.sessionStorage.getItem(key) || "").trim();
  } catch {
    return "";
  }
}

export function storePendingAccessGrant(slug = "", grant = "") {
  const key = grantKey(slug);
  const normalizedGrant = String(grant || "").trim();
  if (!key || !normalizedGrant || typeof window === "undefined") return false;
  try {
    window.sessionStorage.setItem(key, normalizedGrant);
    return true;
  } catch {
    return false;
  }
}

export function clearPendingAccessGrant(slug = "") {
  const key = grantKey(slug);
  if (!key || typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
}
