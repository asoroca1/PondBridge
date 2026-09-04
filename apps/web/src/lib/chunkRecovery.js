const CHUNK_UPDATE_EVENT = "pondbridge:asset-update-required";
const CHUNK_UPDATE_KEY_PREFIX = "pondbridge_chunk_update_required";
const CHUNK_AUTO_RECOVERY_KEY_PREFIX = "pondbridge_chunk_auto_recovery";
const CHUNK_UPDATE_PARAM = "pb_update";
const LISTENER_FLAG = "__PONDBRIDGE_CHUNK_LISTENERS_INSTALLED__";
const NAVIGATION_FLAG = "__PONDBRIDGE_CHUNK_RECOVERY_NAVIGATING__";
const AUTO_RECOVERY_WINDOW_MS = 5 * 60 * 1000;

function getBuildMarker() {
  if (typeof window === "undefined") return "server";
  return String(window.__PONDBRIDGE_BUILD__ || "unknown-build");
}

function getUpdateStorageKey() {
  return `${CHUNK_UPDATE_KEY_PREFIX}:${getBuildMarker()}`;
}

function getAutoRecoveryStorageKey() {
  return `${CHUNK_AUTO_RECOVERY_KEY_PREFIX}:${getBuildMarker()}`;
}

function extractErrorMessage(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value?.message === "string") return value.message;
  if (typeof value?.reason?.message === "string") return value.reason.message;
  return String(value);
}

function currentRoute() {
  if (typeof window === "undefined") return "/";
  return `${window.location.pathname || "/"}${window.location.search || ""}${window.location.hash || ""}`;
}

function writeUpdateNotice(notice) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(getUpdateStorageKey(), JSON.stringify(notice));
  } catch {
    // The in-memory event below still keeps the active screen informed.
  }
}

function latestBuildUrl(timestamp = Date.now()) {
  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.set(CHUNK_UPDATE_PARAM, String(timestamp));
  return nextUrl;
}

function hasRecentAutoRecoveryAttempt(now = Date.now()) {
  try {
    const attemptedAt = Number(
      window.sessionStorage.getItem(getAutoRecoveryStorageKey()) || 0
    );
    if (
      Number.isFinite(attemptedAt) &&
      attemptedAt > 0 &&
      Math.abs(now - attemptedAt) < AUTO_RECOVERY_WINDOW_MS
    ) {
      return true;
    }
  } catch {
    // The URL marker below still prevents a reload loop when storage is blocked.
  }

  try {
    return new URL(window.location.href).searchParams.has(CHUNK_UPDATE_PARAM);
  } catch {
    return false;
  }
}

function markAutoRecoveryAttempt(attemptedAt) {
  window[NAVIGATION_FLAG] = true;
  try {
    window.sessionStorage.setItem(
      getAutoRecoveryStorageKey(),
      String(attemptedAt)
    );
  } catch {
    // Best effort; the recovery URL also carries a loop-prevention marker.
  }
}

export function isLikelyMissingChunkError(errorLike) {
  const message = extractErrorMessage(errorLike).toLowerCase();
  if (!message) return false;

  return (
    message.includes("failed to fetch dynamically imported module") ||
    message.includes("importing a module script failed") ||
    message.includes("error loading dynamically imported module") ||
    message.includes("loading chunk") ||
    message.includes("chunkloaderror") ||
    // WebKit reports a stale module graph as a link-time SyntaxError rather
    // than a fetch failure: a cached chunk asks a redeployed sibling for an
    // export it no longer has. Safari users used to fall through to the
    // generic error screen because none of the messages above matched.
    message.includes("importing binding name") ||
    message.includes("does not provide an export named") ||
    // A chunk the deployment dropped is answered by the SPA fallback, so the
    // browser parses index.html as a module.
    message.includes("is not a valid javascript mime type") ||
    message.includes("expected a javascript module script")
  );
}

export function readChunkUpdateNotice() {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(getUpdateStorageKey()) || "null");
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function dismissChunkUpdateNotice() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(getUpdateStorageKey());
  } catch {
    // Best effort only.
  }
}

/**
 * Reports a stale/missing lazy asset without navigating the document.
 *
 * This deliberately preserves the current React tree. A previous version
 * called location.replace() here, which made asset failures look like random
 * page refreshes and could discard in-progress work.
 */
export function recoverFromMissingChunk(errorLike) {
  if (typeof window === "undefined" || !isLikelyMissingChunkError(errorLike)) return false;

  const notice = {
    build: getBuildMarker(),
    detectedAt: Date.now(),
    route: currentRoute()
  };
  writeUpdateNotice(notice);

  if (typeof window.CustomEvent === "function") {
    window.dispatchEvent(new window.CustomEvent(CHUNK_UPDATE_EVENT, { detail: notice }));
  }
  return true;
}

/**
 * Recovers once when an actively rendered lazy route is no longer present in
 * the current deployment. Background listeners deliberately do not call this,
 * so prefetch failures cannot cause surprise page refreshes.
 */
export function attemptAutomaticChunkRecovery(errorLike) {
  if (
    typeof window === "undefined" ||
    !isLikelyMissingChunkError(errorLike)
  ) {
    return false;
  }

  recoverFromMissingChunk(errorLike);

  if (
    window[NAVIGATION_FLAG] ||
    globalThis.navigator?.onLine === false
  ) {
    return false;
  }

  const attemptedAt = Date.now();
  if (hasRecentAutoRecoveryAttempt(attemptedAt)) return false;

  const nextUrl = latestBuildUrl(attemptedAt);
  markAutoRecoveryAttempt(attemptedAt);

  if (typeof window.location.replace === "function") {
    window.location.replace(nextUrl.toString());
    return true;
  }
  if (typeof window.location.assign === "function") {
    window.location.assign(nextUrl.toString());
    return true;
  }

  window[NAVIGATION_FLAG] = false;
  return false;
}

/** Only call from an explicit user action. */
export function loadLatestBuild() {
  if (typeof window === "undefined") return;
  dismissChunkUpdateNotice();
  const nextUrl = latestBuildUrl();
  window.location.assign(nextUrl.toString());
}

/**
 * Removes the temporary cache-busting query parameter after the replacement
 * entry bundle has loaded, without adding another history entry.
 */
export function cleanChunkRecoveryUrl() {
  if (typeof window === "undefined") return;

  let currentUrl;
  try {
    currentUrl = new URL(window.location.href);
  } catch {
    return;
  }
  if (!currentUrl.searchParams.has(CHUNK_UPDATE_PARAM)) return;

  dismissChunkUpdateNotice();
  currentUrl.searchParams.delete(CHUNK_UPDATE_PARAM);
  const cleanUrl = `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`;
  window.history?.replaceState?.(window.history.state, "", cleanUrl);
}

export function installChunkRecoveryListeners() {
  if (typeof window === "undefined" || window[LISTENER_FLAG]) return;
  window[LISTENER_FLAG] = true;

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

export { CHUNK_UPDATE_EVENT };
