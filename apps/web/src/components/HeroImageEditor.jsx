import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  formatHeroImagePositionPercent,
  heroImagePositionPresets,
  heroImageSizePresets,
  normalizeHeroImagePosition,
  normalizeHeroImageSize,
  parseHeroImagePosition
} from "@pondbridge/shared";
import "./HeroImageEditor.css";

const POSITION_LABELS = {
  "left top": "Top left",
  "center top": "Top center",
  "right top": "Top right",
  "left center": "Center left",
  "center center": "Center",
  "right center": "Center right",
  "left bottom": "Bottom left",
  "center bottom": "Bottom center",
  "right bottom": "Bottom right"
};

const POSITION_SHORT_LABELS = {
  "left top": "TL",
  "center top": "TC",
  "right top": "TR",
  "left center": "CL",
  "center center": "C",
  "right center": "CR",
  "left bottom": "BL",
  "center bottom": "BC",
  "right bottom": "BR"
};

const SIZE_LABELS = {
  cover: "Fill frame",
  contain: "Fit whole photo",
  auto: "Original size",
  "110%": "Slight zoom",
  "125%": "Medium zoom",
  "140%": "Close zoom"
};

const DEFAULT_FEATURE_LABELS = [
  "Advanced Search",
  "Alumni Map",
  "Chats & Forums",
  "Cedar Chest"
];

const DEFAULT_WELCOME_BODY =
  "Reconnect with alumni, staff, and directors from every era.";
const DRAG_CLAMP_MIN = 0;
const DRAG_CLAMP_MAX = 100;
const ZOOM_MIN = 60;
const ZOOM_MAX = 200;
const ZOOM_STEP = 2;

function clamp(value, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return min;
  return Math.max(min, Math.min(max, parsed));
}

function isPercentSize(value = "") {
  return /^\d{2,3}%$/.test(String(value || "").trim());
}

function normalizeZoomFromSize(size = "cover") {
  const normalized = normalizeHeroImageSize(size || "cover");
  if (isPercentSize(normalized)) {
    return clamp(Number.parseInt(normalized.replace("%", ""), 10), ZOOM_MIN, ZOOM_MAX);
  }
  if (normalized === "cover") return 120;
  if (normalized === "contain") return 100;
  return 100;
}

function parseZoom(size = "cover") {
  const normalized = normalizeHeroImageSize(size || "cover");
  return {
    normalizedSize: normalized,
    zoomValue: normalizeZoomFromSize(normalized),
    customZoom: isPercentSize(normalized)
  };
}

function backgroundImageValue(url = "") {
  const value = String(url || "").trim();
  return value ? `url("${value}")` : "";
}

export default function HeroImageEditor({
  label = "Live preview",
  heroImageUrl = "",
  heroImagePosition = "center center",
  heroImageSize = "cover",
  logoUrl = "",
  brandPrimary = "#0f2747",
  campName = "Your Camp",
  welcomeBody = "",
  enabledFeatureLabels = [],
  onChangePosition,
  onChangeSize,
  variant = "onboarding",
  className = ""
}) {
  const safeCampName = String(campName || "").trim() || "Your Camp";
  const safeWelcomeBody = String(welcomeBody || "").trim() || DEFAULT_WELCOME_BODY;
  const hasHeroImage = Boolean(String(heroImageUrl || "").trim());
  const normalizedPosition = normalizeHeroImagePosition(heroImagePosition || "center center");
  const { normalizedSize, zoomValue, customZoom } = useMemo(
    () => parseZoom(heroImageSize || "cover"),
    [heroImageSize]
  );
  const featureLabels = useMemo(() => {
    const provided = Array.isArray(enabledFeatureLabels)
      ? enabledFeatureLabels.map((item) => String(item || "").trim()).filter(Boolean)
      : [];
    return (provided.length ? provided : DEFAULT_FEATURE_LABELS).slice(0, 4);
  }, [enabledFeatureLabels]);

  const positionCoords = useMemo(
    () => parseHeroImagePosition(normalizedPosition, { x: 50, y: 50 }),
    [normalizedPosition]
  );

  const isPresetPosition = heroImagePositionPresets.includes(normalizedPosition);
  const isPresetSize = heroImageSizePresets.includes(normalizedSize);
  const [isDragging, setIsDragging] = useState(false);
  const dragPointerIdRef = useRef(null);
  const pendingPositionRef = useRef(null);
  const positionFrameRef = useRef(0);

  const applyPosition = useCallback(
    (nextCoords) => {
      if (typeof onChangePosition !== "function") return;
      const x = clamp(nextCoords?.x, DRAG_CLAMP_MIN, DRAG_CLAMP_MAX);
      const y = clamp(nextCoords?.y, DRAG_CLAMP_MIN, DRAG_CLAMP_MAX);
      onChangePosition(formatHeroImagePositionPercent(x, y));
    },
    [onChangePosition]
  );

  const flushPendingPosition = useCallback(() => {
    positionFrameRef.current = 0;
    if (!pendingPositionRef.current) return;
    const coords = pendingPositionRef.current;
    pendingPositionRef.current = null;
    applyPosition(coords);
  }, [applyPosition]);

  const schedulePosition = useCallback(
    (nextCoords) => {
      pendingPositionRef.current = {
        x: clamp(nextCoords?.x, DRAG_CLAMP_MIN, DRAG_CLAMP_MAX),
        y: clamp(nextCoords?.y, DRAG_CLAMP_MIN, DRAG_CLAMP_MAX)
      };
      if (positionFrameRef.current) return;
      positionFrameRef.current = window.requestAnimationFrame(flushPendingPosition);
    },
    [flushPendingPosition]
  );

  const applySize = useCallback(
    (nextValue) => {
      if (typeof onChangeSize !== "function") return;
      onChangeSize(normalizeHeroImageSize(nextValue || "cover"));
    },
    [onChangeSize]
  );

  const applyZoomValue = useCallback(
    (value) => {
      const clamped = Math.round(clamp(value, ZOOM_MIN, ZOOM_MAX));
      applySize(`${clamped}%`);
    },
    [applySize]
  );

  const applyZoomDelta = useCallback(
    (delta) => {
      const base = customZoom ? zoomValue : normalizeZoomFromSize(normalizedSize);
      applyZoomValue(base + delta);
    },
    [applyZoomValue, customZoom, normalizedSize, zoomValue]
  );

  useEffect(
    () => () => {
      if (positionFrameRef.current) {
        window.cancelAnimationFrame(positionFrameRef.current);
      }
    },
    []
  );

  const updatePositionFromPointer = useCallback(
    (event) => {
      const frame = event.currentTarget;
      const rect = frame.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const x = ((event.clientX - rect.left) / rect.width) * 100;
      const y = ((event.clientY - rect.top) / rect.height) * 100;
      schedulePosition({ x, y });
    },
    [schedulePosition]
  );

  const onDragStart = useCallback(
    (event) => {
      if (!hasHeroImage) return;
      dragPointerIdRef.current = event.pointerId;
      setIsDragging(true);
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
      updatePositionFromPointer(event);
      event.preventDefault();
    },
    [hasHeroImage, updatePositionFromPointer]
  );

  const onDragMove = useCallback(
    (event) => {
      if (dragPointerIdRef.current !== event.pointerId) return;
      updatePositionFromPointer(event);
      event.preventDefault();
    },
    [updatePositionFromPointer]
  );

  const finishDrag = useCallback((event) => {
    if (dragPointerIdRef.current !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragPointerIdRef.current = null;
    setIsDragging(false);
  }, []);

  const onPreviewWheel = useCallback(
    (event) => {
      if (!hasHeroImage) return;
      const direction = event.deltaY < 0 ? 1 : -1;
      applyZoomDelta(direction * ZOOM_STEP);
      event.preventDefault();
    },
    [applyZoomDelta, hasHeroImage]
  );

  const onPreviewKeyDown = useCallback(
    (event) => {
      if (!hasHeroImage) return;
      const key = String(event.key || "");
      const nudge = event.shiftKey ? 4 : 1;

      if (key === "ArrowLeft") {
        schedulePosition({ x: positionCoords.x - nudge, y: positionCoords.y });
        event.preventDefault();
        return;
      }
      if (key === "ArrowRight") {
        schedulePosition({ x: positionCoords.x + nudge, y: positionCoords.y });
        event.preventDefault();
        return;
      }
      if (key === "ArrowUp") {
        schedulePosition({ x: positionCoords.x, y: positionCoords.y - nudge });
        event.preventDefault();
        return;
      }
      if (key === "ArrowDown") {
        schedulePosition({ x: positionCoords.x, y: positionCoords.y + nudge });
        event.preventDefault();
        return;
      }
      if (key === "+" || key === "=" || key === "Add") {
        applyZoomDelta(ZOOM_STEP);
        event.preventDefault();
        return;
      }
      if (key === "-" || key === "_" || key === "Subtract") {
        applyZoomDelta(-ZOOM_STEP);
        event.preventDefault();
      }
    },
    [applyZoomDelta, hasHeroImage, positionCoords.x, positionCoords.y, schedulePosition]
  );

  const resetHeroComposition = useCallback(() => {
    if (typeof onChangePosition === "function") onChangePosition("center center");
    if (typeof onChangeSize === "function") onChangeSize("cover");
  }, [onChangePosition, onChangeSize]);

  const heroBackgroundStyle = useMemo(
    () =>
      hasHeroImage
        ? {
            backgroundImage: backgroundImageValue(heroImageUrl),
            backgroundPosition: normalizedPosition,
            backgroundSize: normalizedSize
          }
        : undefined,
    [hasHeroImage, heroImageUrl, normalizedPosition, normalizedSize]
  );

  const rootClassName = [
    "hero-image-editor",
    `hero-image-editor--${variant}`,
    isDragging ? "is-dragging" : "",
    className
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={rootClassName}>
      <div className="hero-image-editor__header">
        <p className="hero-image-editor__label">{label}</p>
        <button
          type="button"
          className="hero-image-editor__reset"
          onClick={resetHeroComposition}
        >
          Reset to default
        </button>
      </div>

      <div className="hero-image-editor__controls">
        <label className="hero-image-editor__field">
          Main photo position
          <select
            value={isPresetPosition ? normalizedPosition : "__custom_position__"}
            onChange={(event) => {
              const next = String(event.target.value || "").trim();
              if (next && next !== "__custom_position__") {
                applyPosition(parseHeroImagePosition(next, positionCoords));
              }
            }}
          >
            {heroImagePositionPresets.map((preset) => (
              <option key={preset} value={preset}>
                {POSITION_LABELS[preset] || preset}
              </option>
            ))}
            {!isPresetPosition ? (
              <option value="__custom_position__">
                Custom ({normalizedPosition})
              </option>
            ) : null}
          </select>
        </label>

        <label className="hero-image-editor__field">
          Main photo sizing
          <select
            value={isPresetSize ? normalizedSize : "__custom_size__"}
            onChange={(event) => {
              const next = String(event.target.value || "").trim();
              if (next && next !== "__custom_size__") {
                applySize(next);
              }
            }}
          >
            {heroImageSizePresets.map((preset) => (
              <option key={preset} value={preset}>
                {SIZE_LABELS[preset] || preset}
              </option>
            ))}
            {!isPresetSize ? (
              <option value="__custom_size__">
                Custom ({normalizedSize})
              </option>
            ) : null}
          </select>
        </label>
      </div>

      <div className="hero-image-editor__quick-grid">
        <div className="hero-image-editor__quick-group">
          <span>Position presets</span>
          <div className="hero-image-editor__position-grid">
            {heroImagePositionPresets.map((preset) => (
              <button
                key={preset}
                type="button"
                className={
                  normalizedPosition === preset
                    ? "hero-image-editor__position-btn is-active"
                    : "hero-image-editor__position-btn"
                }
                onClick={() => applyPosition(parseHeroImagePosition(preset, positionCoords))}
                aria-label={`Set position to ${POSITION_LABELS[preset] || preset}`}
              >
                {POSITION_SHORT_LABELS[preset] || preset}
              </button>
            ))}
          </div>
        </div>
        <div className="hero-image-editor__quick-group">
          <span>Zoom presets</span>
          <div className="hero-image-editor__zoom-chip-row">
            {[100, 110, 125, 140, 160].map((zoomPreset) => (
              <button
                key={zoomPreset}
                type="button"
                className={
                  normalizedSize === `${zoomPreset}%`
                    ? "hero-image-editor__zoom-chip is-active"
                    : "hero-image-editor__zoom-chip"
                }
                onClick={() => applyZoomValue(zoomPreset)}
              >
                {zoomPreset}%
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="hero-image-editor__zoom-row">
        <label htmlFor={`hero-image-editor-zoom-${variant}`}>Zoom ({zoomValue}%)</label>
        <input
          id={`hero-image-editor-zoom-${variant}`}
          type="range"
          min={ZOOM_MIN}
          max={ZOOM_MAX}
          step={1}
          value={zoomValue}
          onChange={(event) => applyZoomValue(Number(event.target.value))}
        />
      </div>

      <div className="hero-image-editor__status">
        <span>
          Position: <strong>{normalizedPosition}</strong>
        </span>
        <span>
          Size: <strong>{normalizedSize}</strong>
        </span>
      </div>

      <div className="hero-image-editor__preview-grid">
        <article className="hero-image-editor__preview-card">
          <header>
            <h4>Public Landing Preview</h4>
            <p>Logged-out homepage hero</p>
          </header>
          <div className="hero-image-editor__preview-stage">
            <div className="hero-image-editor__landing-nav" style={{ background: brandPrimary }}>
              <div className="hero-image-editor__landing-brand">
                {logoUrl ? <img src={logoUrl} alt="" /> : <span>{safeCampName.slice(0, 1).toUpperCase()}</span>}
                <strong>{safeCampName} Alumni Network</strong>
              </div>
              <div className="hero-image-editor__landing-actions">
                <span>Create Account</span>
                <span>Login</span>
              </div>
            </div>
            <div className="hero-image-editor__landing-hero" style={heroBackgroundStyle}>
              <div className="hero-image-editor__landing-overlay" />
              <div className="hero-image-editor__landing-copy">
                <span>WELCOME TO THE</span>
                <h3>{safeCampName} Alumni Network</h3>
                <p>{safeWelcomeBody}</p>
              </div>
              <button
                type="button"
                className={hasHeroImage ? "hero-image-editor__drag-surface is-active" : "hero-image-editor__drag-surface"}
                disabled={!hasHeroImage}
                onPointerDown={onDragStart}
                onPointerMove={onDragMove}
                onPointerUp={finishDrag}
                onPointerCancel={finishDrag}
                onWheel={onPreviewWheel}
                onKeyDown={onPreviewKeyDown}
                aria-label="Adjust public landing hero image with drag and zoom"
              />
              {!hasHeroImage ? (
                <p className="hero-image-editor__empty-state">
                  Upload a main photo to enable interactive preview.
                </p>
              ) : null}
            </div>
          </div>
        </article>

        <article className="hero-image-editor__preview-card">
          <header>
            <h4>Member Home Preview</h4>
            <p>Logged-in masthead and welcome panel</p>
          </header>
          <div className="hero-image-editor__preview-stage">
            <div className="hero-image-editor__member-topbar" style={{ background: brandPrimary }} />
            <div className="hero-image-editor__member-masthead" style={heroBackgroundStyle}>
              <div className="hero-image-editor__member-masthead-fade" />
              <button
                type="button"
                className={hasHeroImage ? "hero-image-editor__drag-surface is-active" : "hero-image-editor__drag-surface"}
                disabled={!hasHeroImage}
                onPointerDown={onDragStart}
                onPointerMove={onDragMove}
                onPointerUp={finishDrag}
                onPointerCancel={finishDrag}
                onWheel={onPreviewWheel}
                onKeyDown={onPreviewKeyDown}
                aria-label="Adjust member home masthead image with drag and zoom"
              />
            </div>
            <div className="hero-image-editor__member-welcome">
              <div className="hero-image-editor__member-welcome-main">
                <div className="hero-image-editor__member-avatar">A</div>
                <div>
                  <h5>Welcome back, Aden!</h5>
                  <p>{safeWelcomeBody}</p>
                </div>
              </div>
              <div className="hero-image-editor__member-pulse">
                <strong>Community Pulse</strong>
                <span>281 Alumni</span>
                <span>124 Locations</span>
              </div>
            </div>
            <div className="hero-image-editor__member-quick-actions">
              {featureLabels.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          </div>
        </article>
      </div>

      <p className="hero-image-editor__hint">
        Tip: drag inside either preview to reposition, use mouse wheel/trackpad to zoom, or use arrow keys and +/- when focused.
      </p>
    </section>
  );
}
