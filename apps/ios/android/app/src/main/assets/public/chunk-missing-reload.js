(function showPondBridgeUpdateNotice() {
  var noticeId = "pondbridge-static-update-notice";

  function loadLatestBuild() {
    var nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("pb_update", String(Date.now()));
    window.location.assign(nextUrl.toString());
  }

  function renderNotice() {
    if (document.getElementById(noticeId)) return;

    var notice = document.createElement("aside");
    notice.id = noticeId;
    notice.setAttribute("role", "status");
    notice.style.cssText = [
      "position:fixed",
      "z-index:2147483647",
      "right:16px",
      "bottom:16px",
      "width:min(420px,calc(100vw - 32px))",
      "box-sizing:border-box",
      "padding:16px",
      "border:1px solid #c8d8eb",
      "border-radius:16px",
      "background:#fff",
      "color:#0f172a",
      "font:14px/1.45 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif",
      "box-shadow:0 20px 50px rgba(15,23,42,.2)"
    ].join(";");

    var title = document.createElement("strong");
    title.textContent = "A PondBridge update is ready";
    title.style.display = "block";

    var copy = document.createElement("p");
    copy.textContent = "This screen will stay open. Update when you are ready.";
    copy.style.margin = "5px 0 12px";

    var button = document.createElement("button");
    button.type = "button";
    button.textContent = "Update now";
    button.style.cssText = "border:0;border-radius:10px;background:#0a4f9e;color:#fff;padding:10px 14px;font:inherit;font-weight:700;cursor:pointer";
    button.addEventListener("click", loadLatestBuild);

    notice.append(title, copy, button);
    document.body.appendChild(notice);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", renderNotice, { once: true });
  } else {
    renderNotice();
  }
})();
