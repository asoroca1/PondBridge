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

  // Preserve the current document. The static recovery module shows an
  // explicit update action instead of forcing an unexplained page reload.
  await import(`/chunk-missing-reload.js?pb_notice=${Date.now()}`).catch(() => {});
})();
