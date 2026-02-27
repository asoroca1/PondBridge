(function recoverFromMissingChunk() {
  var storageKey = "pondbridge_chunk_recovery_ts";
  var now = Date.now();
  var lastAttempt = 0;

  try {
    lastAttempt = Number(window.sessionStorage.getItem(storageKey) || "0");
  } catch {
    lastAttempt = 0;
  }

  // Avoid infinite loops if something else is broken.
  if (lastAttempt && now - lastAttempt < 10000) {
    console.error("PondBridge asset recovery already attempted recently.");
    return;
  }

  try {
    window.sessionStorage.setItem(storageKey, String(now));
  } catch {
    // Ignore storage failures and continue with best-effort recovery.
  }

  var url = new URL(window.location.href);
  url.searchParams.set("pb_refresh", String(now));
  window.location.replace(url.toString());
})();
