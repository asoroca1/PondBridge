/**
 * Shared utility functions for Cedar pages.
 *
 * Centralises auth-header construction, display-name formatting,
 * avatar resolution and date formatting so every page stays in sync.
 */

/* ===== Auth ===== */

/** Retrieve the stored auth token (prefers PondBridge key, then legacy keys). */
export function getToken() {
  return (
    localStorage.getItem("pondbridgeToken") ||
    localStorage.getItem("token") ||
    localStorage.getItem("cedarToken") ||
    ""
  );
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

/**
 * Resolve the best available avatar/photo URL from a user object.
 * Checks nested `uploads` bag, flat fields, and common legacy keys.
 */
export function avatarUrl(u = {}) {
  const up = u?.uploads || {};
  return (
    up.photoUrl ||
    up.profilePhoto?.url ||
    u?.photoUrl ||
    u?.profilePhotoUrl ||
    u?.avatarUrl ||
    u?.imageUrl ||
    u?.profilePhoto ||
    ""
  );
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
