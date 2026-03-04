const CHUNK_RECOVERY_PARAM = "pb_recover";
const CHUNK_RECOVERY_KEY_PREFIX = "pondbridge_chunk_recovery_state";
const CHUNK_RECOVERY_MAX_ATTEMPTS = 3;
const CHUNK_RECOVERY_ATTEMPT_TTL_MS = 5 * 60 * 1000;

function getBuildMarker() {
  if (typeof window === "undefined") return "server";
  return String(window.__PONDBRIDGE_BUILD__ || "unknown-build");
}

function getRecoveryStorageKey() {
  return `${CHUNK_RECOVERY_KEY_PREFIX}:${getBuildMarker()}`;
}

function getRouteRecoveryKey() {
  if (typeof window === "undefined") return "server-route";
  return String(window.location.pathname || "/");
}

function readRecoveryState() {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.sessionStorage.getItem(getRecoveryStorageKey());
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeRecoveryState(nextState = {}) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(getRecoveryStorageKey(), JSON.stringify(nextState));
  } catch {
    // Best effort only.
  }
}

function extractErrorMessage(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value?.message === "string") return value.message;
  if (typeof value?.reason?.message === "string") return value.reason.message;
  return String(value);
}

export function isLikelyMissingChunkError(errorLike) {
  const message = extractErrorMessage(errorLike).toLowerCase();
  if (!message) return false;

  return (
    message.includes("failed to fetch dynamically imported module") ||
    message.includes("importing a module script failed") ||
    message.includes("error loading dynamically imported module") ||
    message.includes("loading chunk") ||
    message.includes("chunkloaderror")
  );
}

export function recoverFromMissingChunk(errorLike) {
  if (typeof window === "undefined") return false;
  if (!isLikelyMissingChunkError(errorLike)) return false;

  const routeKey = getRouteRecoveryKey();
  const state = readRecoveryState();
  const prev = state[routeKey] && typeof state[routeKey] === "object" ? state[routeKey] : {};
  const lastAttemptAt = Number(prev.lastAttemptAt || 0);
  const now = Date.now();
  const stale = !lastAttemptAt || now - lastAttemptAt > CHUNK_RECOVERY_ATTEMPT_TTL_MS;
  const attemptCount = stale ? 0 : Number(prev.attemptCount || 0);

  if (attemptCount >= CHUNK_RECOVERY_MAX_ATTEMPTS) return false;

  state[routeKey] = {
    attemptCount: attemptCount + 1,
    lastAttemptAt: now
  };
  writeRecoveryState(state);

  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.set(CHUNK_RECOVERY_PARAM, String(now));
  window.location.replace(nextUrl.toString());
  return true;
}

export function installChunkRecoveryListeners() {
  if (typeof window === "undefined") return;

  const onWindowError = (event) => {
    const errorLike = event?.error || event?.message || event;
    recoverFromMissingChunk(errorLike);
  };

  const onUnhandledRejection = (event) => {
    recoverFromMissingChunk(event?.reason || event);
  };

  window.addEventListener("error", onWindowError);
  window.addEventListener("unhandledrejection", onUnhandledRejection);
}
