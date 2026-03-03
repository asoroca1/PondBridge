const CHUNK_RECOVERY_PARAM = "pb_recover";
const CHUNK_RECOVERY_KEY_PREFIX = "pondbridge_chunk_recovery_attempted";

function getBuildMarker() {
  if (typeof window === "undefined") return "server";
  return String(window.__PONDBRIDGE_BUILD__ || "unknown-build");
}

function getRecoveryStorageKey() {
  return `${CHUNK_RECOVERY_KEY_PREFIX}:${getBuildMarker()}`;
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

  const storageKey = getRecoveryStorageKey();
  try {
    if (window.sessionStorage.getItem(storageKey) === "1") {
      return false;
    }
    window.sessionStorage.setItem(storageKey, "1");
  } catch {
    // Proceed with best effort.
  }

  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.set(CHUNK_RECOVERY_PARAM, String(Date.now()));
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
