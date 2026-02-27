(async function recoverFromMissingChunk() {
  var retryKey = "pondbridge_chunk_recovery_attempted";
  try {
    if (window.sessionStorage.getItem(retryKey) === "1") {
      return;
    }
    window.sessionStorage.setItem(retryKey, "1");
  } catch {
    // Continue with best effort.
  }

  try {
    var html = await fetch("/", { cache: "no-store", credentials: "same-origin" }).then(function (res) {
      return res.text();
    });
    var match = html.match(/<script type="module"[^>]*src="([^"]+)"/i);
    if (match && match[1]) {
      var src = match[1];
      var suffix = src.indexOf("?") >= 0 ? "&" : "?";
      await import(src + suffix + "pb_recover=" + Date.now());
      return;
    }
  } catch {
    // Fallback below.
  }

  window.location.replace("/?pb_recover=" + Date.now());
})();
