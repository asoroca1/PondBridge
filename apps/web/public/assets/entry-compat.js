(async function bootstrapLatestPondBridgeEntry() {
  try {
    const html = await fetch("/", {
      cache: "no-store",
      credentials: "same-origin"
    }).then((res) => res.text());

    const match = html.match(/<script type="module"[^>]*src="([^"]+)"/i);
    const nextSrc = String(match?.[1] || "").trim();
    if (!nextSrc) throw new Error("Missing module entry in index HTML.");

    // Prevent recursion if a stale index still points to this compatibility entry.
    if (/\/assets\/index-(CfC__OOi|B9PGFW4G)\.js/i.test(nextSrc)) {
      throw new Error("Stale index HTML still points at compatibility entry.");
    }

    const separator = nextSrc.includes("?") ? "&" : "?";
    await import(`${nextSrc}${separator}pb_compat=${Date.now()}`);
    return;
  } catch (error) {
    console.error("PondBridge compatibility bootstrap failed", error);
  }

  window.location.replace(`/?pb_compat_retry=${Date.now()}`);
})();
