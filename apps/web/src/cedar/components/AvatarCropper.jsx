// src/components/AvatarCropper.jsx
import { useEffect, useRef, useState } from "react";

export default function AvatarCropper({
  imageFile,
  onPickFile,
  onExport,
  size = 260,              // nominal size; we'll still measure the real stage
}) {
  const [imgUrl, setImgUrl] = useState("");
  const [imgMeta, setImgMeta] = useState({ w: 0, h: 0 }); // natural image size
  const [zoom, setZoom]   = useState(1);
  const [drag, setDrag]   = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy]   = useState(false);

  const imgRef   = useRef(null);
  const stageRef = useRef(null);
  const startRef = useRef({ x: 0, y: 0, dx: 0, dy: 0 });
  const rafRef   = useRef(0);
  const draggingRef = useRef(false);

  // Track actual rendered stage size (CSS pixels)
  const [stageSize, setStageSize] = useState(size);
  useEffect(() => {
    if (!stageRef.current) return;
    const update = () => {
      const rect = stageRef.current.getBoundingClientRect();
      setStageSize(Math.round(rect.width));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(stageRef.current);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  // Load/preview picked file
  useEffect(() => {
    let url;
    if (imageFile) {
      url = URL.createObjectURL(imageFile);
      setImgUrl(url);
      const im = new Image();
      im.onload = () => setImgMeta({ w: im.naturalWidth, h: im.naturalHeight });
      im.src = url;
      setZoom(1);
      setDrag({ x: 0, y: 0 });
    } else {
      setImgUrl("");
      setImgMeta({ w: 0, h: 0 });
    }
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [imageFile]);

  const handleFile = (e) => {
    const f = e.target.files?.[0];
    if (f && f.type.startsWith("image/")) onPickFile(f);
  };

  function getClientXY(e) {
    if (e.touches?.length) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    if (e.changedTouches?.length) return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
    return { x: e.clientX, y: e.clientY };
  }

  function onStart(e) {
    if (!imgUrl) return;
    e.preventDefault();
    const { x, y } = getClientXY(e);
    startRef.current = { x, y, dx: drag.x, dy: drag.y };
    draggingRef.current = true;
    setDragging(true);

    document.addEventListener("mousemove", onMove, { passive: false });
    document.addEventListener("mouseup", onEnd, { passive: false });
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd, { passive: false });
  }

  function onMove(e) {
    if (!draggingRef.current) return;
    e.preventDefault();
    const { x, y } = getClientXY(e);
    const { x: sx, y: sy, dx, dy } = startRef.current;
    const nx = dx + (x - sx);
    const ny = dy + (y - sy);

    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => setDrag({ x: nx, y: ny }));
  }

  function onEnd(e) {
    e.preventDefault();
    draggingRef.current = false;
    setDragging(false);
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onEnd);
    document.removeEventListener("touchmove", onMove);
    document.removeEventListener("touchend", onEnd);
  }

  // Helper used for on-screen preview sizing only (not for export math)
  function coverFit(iw, ih, bw, bh, scale) {
    const r = Math.max(bw / iw, bh / ih) * scale;
    return { w: iw * r, h: ih * r };
  }

  async function exportCropped() {
    if (!imgUrl || !imgRef.current) return;

    try {
      setBusy(true);

      // === 1) Compute the real transform being shown on screen ===
      const iw = imgMeta.w;
      const ih = imgMeta.h;
      const S  = stageSize;                         // CSS px
      const scale = Math.max(S / iw, S / ih) * zoom; // same scale used in preview

      // Image top-left (in stage coords) with drag applied
      const tx = (S - iw * scale) / 2 + drag.x;
      const ty = (S - ih * scale) / 2 + drag.y;

      // === 2) Compute the source rectangle (in original image pixels) ===
      const sx = -tx / scale;
      const sy = -ty / scale;
      const sw = S / scale;
      const sh = S / scale;

      // === 3) Create a high-DPI canvas but keep composition identical ===
      const dpr = Math.min(window.devicePixelRatio || 1, 3); // cap at 3
      const boxPx = Math.round(S * dpr);

      const canvas = document.createElement("canvas");
      canvas.width  = boxPx;
      canvas.height = boxPx;
      const ctx = canvas.getContext("2d");

      // Circular clip
      ctx.save();
      ctx.beginPath();
      ctx.arc(boxPx / 2, boxPx / 2, boxPx / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();

      // Draw exactly what’s on screen (source rect -> full canvas)
      ctx.imageSmoothingQuality = "high";
      const im = imgRef.current;
      ctx.drawImage(im, sx, sy, sw, sh, 0, 0, boxPx, boxPx);
      ctx.restore();

      // === 4) Blob and hand off ===
      const blob = await new Promise((res) => canvas.toBlob(res, "image/png", 0.95));
      if (blob) await onExport(blob);
    } finally {
      setBusy(false);
    }
  }

  // On-screen preview dimensions (CSS pixels)
  const fit = imgUrl
    ? coverFit(imgMeta.w, imgMeta.h, stageSize, stageSize, zoom)
    : { w: 0, h: 0 };

  return (
    <div className="ac-wrap">
      <div
        ref={stageRef}
        className={`ac-stage ${dragging ? "is-dragging" : ""}`}
        style={{ width: size, height: size }}   // your nominal size; we still measure actual
        onMouseDown={onStart}
        onTouchStart={onStart}
        role="img"
        aria-label="Avatar crop area"
      >
        {imgUrl ? (
          <img
            ref={imgRef}
            src={imgUrl}
            alt="crop source"
            draggable="false"
            onDragStart={(e) => e.preventDefault()}
            style={{
              position: "absolute",
              left: `calc(50% + ${drag.x}px)`,
              top: `calc(50% + ${drag.y}px)`,
              width: fit.w + "px",
              height: fit.h + "px",
              transform: "translate(-50%, -50%)",
              transformOrigin: "50% 50%",
              userSelect: "none",
              WebkitUserSelect: "none",
              WebkitUserDrag: "none",
              pointerEvents: "auto",
            }}
          />
        ) : (
          <div className="ac-empty">Choose a photo</div>
        )}
        <div className="ac-mask" />
      </div>

      <div className="ac-controls">
        <label className="ac-slider-label">
          Zoom
          <input
            className="ac-slider"
            type="range"
            min="1"
            max="3"
            step="0.01"
            value={zoom}
            onChange={(e) => setZoom(parseFloat(e.target.value || "1"))}
          />
        </label>

        <div className="ac-actions">
          <label className="ac-btn secondary">
            Choose Photo
            <input type="file" accept="image/*" hidden onChange={handleFile} />
          </label>

          <button
            type="button"
            className="ac-btn primary"
            onClick={exportCropped}
            disabled={!imgUrl || busy}
          >
            {busy ? "Saving…" : "Save Photo"}
          </button>
        </div>
      </div>
    </div>
  );
}
