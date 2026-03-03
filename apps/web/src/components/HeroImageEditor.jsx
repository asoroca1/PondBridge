import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  formatHeroImagePositionPercent,
  normalizeHeroImagePosition,
  normalizeHeroImageSize,
  parseHeroImagePosition
} from "@pondbridge/shared";
import "./HeroImageEditor.css";

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

const PREVIEW_META = {
  landing: {
    key: "landing",
    title: "Public Landing Preview",
    subtitle: "Logged-out homepage hero",
    aria: "Open public landing hero editor"
  },
  member: {
    key: "member",
    title: "Member Home Preview",
    subtitle: "Logged-in masthead and welcome panel",
    aria: "Open member home masthead editor"
  }
};

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

  const [isDragging, setIsDragging] = useState(false);
  const [activePreview, setActivePreview] = useState("");
  const dragPointerIdRef = useRef(null);
  const pendingPositionRef = useRef(null);
  const positionFrameRef = useRef(0);
  const modalSurfaceRef = useRef(null);

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

  const closePreviewEditor = useCallback(() => {
    setIsDragging(false);
    dragPointerIdRef.current = null;
    setActivePreview("");
  }, []);

  useEffect(() => {
    if (!activePreview) return undefined;

    const onEscape = (event) => {
      if (String(event.key || "") === "Escape") {
        closePreviewEditor();
      }
    };

    const previousOverflow =
      typeof document !== "undefined" ? String(document.body.style.overflow || "") : "";

    if (typeof document !== "undefined") {
      document.body.style.overflow = "hidden";
    }

    window.addEventListener("keydown", onEscape);
    return () => {
      window.removeEventListener("keydown", onEscape);
      if (typeof document !== "undefined") {
        document.body.style.overflow = previousOverflow;
      }
    };
  }, [activePreview, closePreviewEditor]);

  useEffect(() => {
    if (!activePreview) return undefined;
    const frame = window.requestAnimationFrame(() => {
      modalSurfaceRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activePreview]);

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

  function renderLandingPreview({ interactive = false, modal = false } = {}) {
    return (
      <div
        className={[
          "hero-image-editor__preview-stage",
          "hero-image-editor__preview-stage--landing",
          modal && "hero-image-editor__preview-stage--modal"
        ].filter(Boolean).join(" ")}
      >
        <div className="hero-image-editor__landing-screen" style={heroBackgroundStyle}>
          <div className="hero-image-editor__landing-overlay" />
          {interactive ? (
            <button
              ref={modalSurfaceRef}
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
          ) : null}
          {!hasHeroImage ? (
            <p className="hero-image-editor__empty-state">
              Upload a main photo to enable interactive preview.
            </p>
          ) : null}
          <div className="hero-image-editor__landing-content">
            <h3>Welcome to the {safeCampName} Alumni Network</h3>
            <p>{safeWelcomeBody}</p>
            <div className="hero-image-editor__landing-actions">
              <span className="hero-image-editor__landing-action-btn">Create Account</span>
              <span className="hero-image-editor__landing-action-btn">Login</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  function renderMemberPreview({ interactive = false, modal = false } = {}) {
    return (
      <div
        className={[
          "hero-image-editor__preview-stage",
          "hero-image-editor__preview-stage--member",
          modal && "hero-image-editor__preview-stage--modal"
        ].filter(Boolean).join(" ")}
      >
        <div className="hero-image-editor__nav" style={{ background: brandPrimary }}>
          <div className="hero-image-editor__nav-left">
            {logoUrl ? (
              <img src={logoUrl} alt="" className="hero-image-editor__nav-logo" />
            ) : (
              <span className="hero-image-editor__nav-logo-fallback">
                {safeCampName.slice(0, 1).toUpperCase()}
              </span>
            )}
            <strong className="hero-image-editor__nav-title">{safeCampName}</strong>
          </div>
          <div className="hero-image-editor__nav-right">
            <span className="hero-image-editor__nav-search-pill" />
            <span className="hero-image-editor__nav-avatar">A</span>
            <span className="hero-image-editor__nav-burger">
              <span /><span /><span />
            </span>
          </div>
        </div>

        <div className="hero-image-editor__masthead" style={heroBackgroundStyle}>
          {interactive ? (
            <button
              ref={modalSurfaceRef}
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
          ) : null}
        </div>

        <div className="hero-image-editor__welcome-hero">
          <div className="hero-image-editor__welcome-banner">
            <div className="hero-image-editor__welcome-left">
              <div className="hero-image-editor__member-avatar">A</div>
              <div className="hero-image-editor__welcome-copy">
                <h5 className="hero-image-editor__welcome-title">Welcome back, Aden!</h5>
                <p className="hero-image-editor__welcome-sub">{safeWelcomeBody}</p>
              </div>
            </div>
            <div className="hero-image-editor__welcome-right">
              <div className="hero-image-editor__pulse">
                <strong>Community Pulse</strong>
                <div className="hero-image-editor__pulse-rows">
                  <span className="hero-image-editor__pulse-row">
                    <span className="hero-image-editor__pulse-num">281</span>
                    <span className="hero-image-editor__pulse-label">Alumni</span>
                  </span>
                  <span className="hero-image-editor__pulse-row">
                    <span className="hero-image-editor__pulse-num">124</span>
                    <span className="hero-image-editor__pulse-label">Locations</span>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="hero-image-editor__quick-actions">
          {featureLabels.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      </div>
    );
  }

  const activePreviewMeta = PREVIEW_META[activePreview] || null;
  const modalPortal =
    activePreviewMeta && typeof document !== "undefined"
      ? createPortal(
          <div
            className="hero-image-editor__modal-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                closePreviewEditor();
              }
            }}
          >
            <div
              className="hero-image-editor__modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby={`hero-image-editor-modal-title-${variant}`}
            >
              <header className="hero-image-editor__modal-header">
                <div>
                  <h4 id={`hero-image-editor-modal-title-${variant}`}>{activePreviewMeta.title}</h4>
                  <p>{activePreviewMeta.subtitle}</p>
                </div>
                <button
                  type="button"
                  className="hero-image-editor__modal-close"
                  onClick={closePreviewEditor}
                >
                  Close
                </button>
              </header>
              <div className="hero-image-editor__modal-content">
                {activePreviewMeta.key === PREVIEW_META.landing.key
                  ? renderLandingPreview({ interactive: true, modal: true })
                  : renderMemberPreview({ interactive: true, modal: true })}
              </div>
              <p className="hero-image-editor__modal-hint">
                Use drag/trackpad for quick framing. Arrow keys nudge the photo, and +/- changes zoom.
              </p>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <>
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

        <div className="hero-image-editor__preview-grid">
          <article className="hero-image-editor__preview-card">
            <header>
              <h4>{PREVIEW_META.landing.title}</h4>
              <p>{PREVIEW_META.landing.subtitle}</p>
            </header>
            <button
              type="button"
              className="hero-image-editor__preview-launcher"
              onClick={() => setActivePreview(PREVIEW_META.landing.key)}
              aria-label={PREVIEW_META.landing.aria}
            >
              {renderLandingPreview()}
              <span className="hero-image-editor__preview-launch-label">Click to edit framing</span>
            </button>
          </article>

          <article className="hero-image-editor__preview-card">
            <header>
              <h4>{PREVIEW_META.member.title}</h4>
              <p>{PREVIEW_META.member.subtitle}</p>
            </header>
            <button
              type="button"
              className="hero-image-editor__preview-launcher"
              onClick={() => setActivePreview(PREVIEW_META.member.key)}
              aria-label={PREVIEW_META.member.aria}
            >
              {renderMemberPreview()}
              <span className="hero-image-editor__preview-launch-label">Click to edit framing</span>
            </button>
          </article>
        </div>

        <p className="hero-image-editor__hint">
          Click either preview to open the full editor. In the popup: drag to reposition, use trackpad or wheel to zoom, or use arrow keys and +/- when focused.
        </p>
      </section>
      {modalPortal}
    </>
  );
}
