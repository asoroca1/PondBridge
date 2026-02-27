import { getVolatileAuthToken } from "../../lib/authMemory.js";

/**
 * Shared utility functions for Cedar pages.
 *
 * Centralises auth-header construction, display-name formatting,
 * avatar resolution and date formatting so every page stays in sync.
 */

/* ===== Auth ===== */

function parseJwtExpiry(token = "") {
  const raw = String(token || "").trim();
  if (!raw.includes(".")) return 0;
  const parts = raw.split(".");
  if (parts.length < 2) return 0;
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    const exp = Number(payload?.exp || 0);
    return Number.isFinite(exp) ? exp : 0;
  } catch {
    return 0;
  }
}

/** Retrieve the best stored auth token and avoid stale/expired values. */
export function getToken() {
  const candidates = [
    getVolatileAuthToken() || ""
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  if (!candidates.length) return "";

  const now = Math.floor(Date.now() / 1000);
  const nonExpired = candidates.filter((token) => {
    const exp = parseJwtExpiry(token);
    return exp === 0 || exp > now + 15;
  });
  const pool = nonExpired.length ? nonExpired : candidates;

  let best = pool[0];
  let bestExp = parseJwtExpiry(best);
  for (const token of pool.slice(1)) {
    const exp = parseJwtExpiry(token);
    if (exp > bestExp) {
      best = token;
      bestExp = exp;
    }
  }
  return best;
}

/**
 * Build standard authorisation headers.
 * @param {boolean} json  If true (default), includes Content-Type: application/json.
 */
export function authHeaders(json = true) {
  const t = getToken();
  const h = {};
  if (json) h["Content-Type"] = "application/json";
  if (t) h["Authorization"] = `Bearer ${t}`;
  return h;
}

/* ===== Display helpers ===== */

/**
 * Format a user/person object into a display name.
 * Supports `nickname` and legacy `campNickname` fields.
 * Falls back to "Unnamed" when both names are empty.
 */
export function displayName(u = {}) {
  const nick = String(u?.nickname || u?.campNickname || "").trim();
  const first = (u?.firstName || "").trim();
  const last = (u?.lastName || "").trim();

  if (nick) return `${first} \u201c${nick}\u201d ${last}`.trim();
  return `${first} ${last}`.trim() || "Unnamed";
}

/**
 * Extract up to two initials from a user object or from separate name parts.
 *
 * Accepts EITHER an object `{ firstName, lastName }` as the first argument
 * or individual strings `(first, last, nick)`.
 */
export function initialsOf(firstOrUser = "", last = "", nick = "") {
  let raw;
  if (typeof firstOrUser === "object" && firstOrUser !== null) {
    const u = firstOrUser;
    raw = [u.firstName, u.nickname, u.lastName].filter(Boolean).join(" ");
  } else {
    raw = [firstOrUser, nick, last].filter(Boolean).join(" ");
  }

  // Strip quoted nicknames and non-alpha chars for cleaner initials
  const cleaned = raw
    .replace(/"[^"]*"/g, " ")
    .replace(/\u201c[^\u201d]*\u201d/g, " ")
    .replace(/[^a-zA-Z\s]/g, " ")
    .trim();

  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return (parts[0][0] || "").toUpperCase();

  const first = (parts[0][0] || "").toUpperCase();
  const lastInit = (parts[parts.length - 1][0] || "").toUpperCase();
  return `${first}${lastInit}`;
}

export function isPlaceholderAvatarUrl(value = "") {
  const url = String(value || "").trim().toLowerCase();
  if (!url) return true;
  return (
    url.includes("default-profile") ||
    url.includes("default_avatar") ||
    url.includes("avatar-placeholder") ||
    url.includes("placeholder-avatar") ||
    url.includes("no-avatar")
  );
}

/**
 * Resolve the best available avatar/photo URL from a user object.
 * Checks nested `uploads` bag, flat fields, and common legacy keys.
 */
export function avatarUrl(u = {}) {
  const up = u?.uploads || {};
  const resolved =
    up.photoUrl ||
    up.profilePhoto?.url ||
    u?.photoUrl ||
    u?.profilePhotoUrl ||
    u?.avatarUrl ||
    u?.imageUrl ||
    u?.profilePhoto ||
    "";
  return isPlaceholderAvatarUrl(resolved) ? "" : resolved;
}

/* ===== Date helpers ===== */

/** Format a date value as "Jan 5, 2024". */
export function fmtDate(d) {
  try {
    return new Date(d).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

/** Format a date value as "Jan 5, 2024, 3:45 PM". */
export function fmtDateTime(d) {
  try {
    return new Date(d || Date.now()).toLocaleString([], {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

/**
 * Relative time string: "now", "5m", "3h", "2d", or short date.
 * Useful for chat timestamps and activity feeds.
 */
export function relativeTime(ts) {
  if (!ts) return "";
  const delta = Date.now() - new Date(ts).getTime();
  if (!Number.isFinite(delta)) return "";
  const mins = Math.floor(delta / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" });
}
