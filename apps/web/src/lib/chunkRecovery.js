const CHUNK_UPDATE_EVENT = "pondbridge:asset-update-required";
const CHUNK_UPDATE_KEY_PREFIX = "pondbridge_chunk_update_required";
const CHUNK_UPDATE_PARAM = "pb_update";
const LISTENER_FLAG = "__PONDBRIDGE_CHUNK_LISTENERS_INSTALLED__";

function getBuildMarker() {
  if (typeof window === "undefined") return "server";
  return String(window.__PONDBRIDGE_BUILD__ || "unknown-build");
}

function getUpdateStorageKey() {
  return `${CHUNK_UPDATE_KEY_PREFIX}:${getBuildMarker()}`;
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

/** Only call from an explicit user action. */
export function loadLatestBuild() {
  if (typeof window === "undefined") return;
  dismissChunkUpdateNotice();
  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.set(CHUNK_UPDATE_PARAM, String(Date.now()));
  window.location.assign(nextUrl.toString());
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
