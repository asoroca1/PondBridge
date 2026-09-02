import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  alumniPluralForCampType,
  formatHeroImagePositionPercent,
  normalizeCampType,
  normalizeHeroImagePosition,
  normalizeHeroImageSize,
  parseHeroImagePosition,
  replaceAlumniForCampType
} from "@pondbridge/shared";
import { useDialogFocus } from "./admin/AdminUi.jsx";
import "./HeroImageEditor.css";

const DRAG_CLAMP_MIN = 0;
const DRAG_CLAMP_MAX = 100;
const ZOOM_MIN = 60;
const ZOOM_MAX = 200;
const ZOOM_STEP = 2;
const VIEWPORT_DESKTOP = "desktop";
const VIEWPORT_MOBILE = "mobile";

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
  memberImageUrl = "",
  heroImagePosition = "center center",
  heroImageSize = "cover",
  landingImagePosition = "",
  landingImageSize = "",
  memberImagePosition = "",
  memberImageSize = "",
  logoUrl = "",
  brandPrimary = "var(--neutral-800)",
  campName = "Your Camp",
  campType = "coed",
  welcomeBody = "",
  enabledFeatureLabels = [],
  onChangePosition,
  onChangeSize,
  onChangeLandingPosition,
  onChangeLandingSize,
  onChangeMemberPosition,
  onChangeMemberSize,
  variant = "onboarding",
  className = ""
}) {
  const normalizedCampType = normalizeCampType(campType || "coed");
  const alumniWordTitle = alumniPluralForCampType(normalizedCampType, { capitalized: true });
  const fallbackWelcomeBody = replaceAlumniForCampType(
    "Reconnect with alumni, staff, and directors from every era.",
    normalizedCampType
  );
  const safeCampName = String(campName || "").trim() || "Your Camp";
  const safeWelcomeBody =
    replaceAlumniForCampType(String(welcomeBody || "").trim(), normalizedCampType) || fallbackWelcomeBody;
  // The landing always shows the main photo; the member home shows its own
  // photo when the director uploaded one and otherwise reuses the main photo.
  const landingHeroUrl = String(heroImageUrl || "").trim();
  const memberHeroUrl = String(memberImageUrl || "").trim() || landingHeroUrl;
  const hasLandingImage = Boolean(landingHeroUrl);
  const hasMemberImage = Boolean(memberHeroUrl);
  const landingComposition = useMemo(() => {
    const position = normalizeHeroImagePosition(
      landingImagePosition || heroImagePosition || "center center"
    );
    const { normalizedSize, zoomValue, customZoom } = parseZoom(
      landingImageSize || heroImageSize || "cover"
    );
    return {
      position,
      normalizedSize,
      zoomValue,
      customZoom,
      positionCoords: parseHeroImagePosition(position, { x: 50, y: 50 })
    };
  }, [heroImagePosition, heroImageSize, landingImagePosition, landingImageSize]);
  const memberComposition = useMemo(() => {
    const position = normalizeHeroImagePosition(
      memberImagePosition || heroImagePosition || "center center"
    );
    const { normalizedSize, zoomValue, customZoom } = parseZoom(
      memberImageSize || heroImageSize || "cover"
    );
    return {
      position,
      normalizedSize,
      zoomValue,
      customZoom,
      positionCoords: parseHeroImagePosition(position, { x: 50, y: 50 })
    };
  }, [heroImagePosition, heroImageSize, memberImagePosition, memberImageSize]);
  const featureLabels = useMemo(() => {
    const provided = Array.isArray(enabledFeatureLabels)
      ? enabledFeatureLabels.map((item) => String(item || "").trim()).filter(Boolean)
      : [];
    const fallback = ["Advanced Search", `${alumniWordTitle} Map`, "Chats & Forums", "Cedar Chest"];
    return (provided.length ? provided : fallback).slice(0, 4);
  }, [alumniWordTitle, enabledFeatureLabels]);

  const [isDragging, setIsDragging] = useState(false);
  const [activePreview, setActivePreview] = useState("");
  const [selectedPreview, setSelectedPreview] = useState(PREVIEW_META.landing.key);
  const [previewViewport, setPreviewViewport] = useState(VIEWPORT_DESKTOP);
  const dragPointerIdRef = useRef(null);
  const pendingPositionRef = useRef(null);
  const positionFrameRef = useRef(0);
  const modalSurfaceRef = useRef(null);
  const previewTabRefs = useRef({});
  const activePreviewKey = activePreview === PREVIEW_META.member.key
    ? PREVIEW_META.member.key
    : PREVIEW_META.landing.key;
  const activeComposition = activePreviewKey === PREVIEW_META.member.key
    ? memberComposition
    : landingComposition;
  const hasActiveImage = activePreviewKey === PREVIEW_META.member.key
    ? hasMemberImage
    : hasLandingImage;

  const applyPosition = useCallback(
    (previewKey, nextCoords) => {
      const x = clamp(nextCoords?.x, DRAG_CLAMP_MIN, DRAG_CLAMP_MAX);
      const y = clamp(nextCoords?.y, DRAG_CLAMP_MIN, DRAG_CLAMP_MAX);
      const nextValue = formatHeroImagePositionPercent(x, y);
      if (previewKey === PREVIEW_META.member.key) {
        if (typeof onChangeMemberPosition === "function") {
          onChangeMemberPosition(nextValue);
          return;
        }
      } else if (typeof onChangeLandingPosition === "function") {
        onChangeLandingPosition(nextValue);
        return;
      }
      if (typeof onChangePosition === "function") {
        onChangePosition(nextValue);
      }
    },
    [onChangeLandingPosition, onChangeMemberPosition, onChangePosition]
  );

  const flushPendingPosition = useCallback(() => {
    positionFrameRef.current = 0;
    if (!pendingPositionRef.current) return;
    const { previewKey, x, y } = pendingPositionRef.current;
    pendingPositionRef.current = null;
    applyPosition(previewKey, { x, y });
  }, [applyPosition]);

  const schedulePosition = useCallback(
    (nextCoords, previewKey = PREVIEW_META.landing.key) => {
      pendingPositionRef.current = {
        previewKey,
        x: clamp(nextCoords?.x, DRAG_CLAMP_MIN, DRAG_CLAMP_MAX),
        y: clamp(nextCoords?.y, DRAG_CLAMP_MIN, DRAG_CLAMP_MAX)
      };
      if (positionFrameRef.current) return;
      positionFrameRef.current = window.requestAnimationFrame(flushPendingPosition);
    },
    [flushPendingPosition]
  );

  const applySize = useCallback(
    (previewKey, nextValue) => {
      const normalizedValue = normalizeHeroImageSize(nextValue || "cover");
      if (previewKey === PREVIEW_META.member.key) {
        if (typeof onChangeMemberSize === "function") {
          onChangeMemberSize(normalizedValue);
          return;
        }
      } else if (typeof onChangeLandingSize === "function") {
        onChangeLandingSize(normalizedValue);
        return;
      }
      if (typeof onChangeSize === "function") {
        onChangeSize(normalizedValue);
      }
    },
    [onChangeLandingSize, onChangeMemberSize, onChangeSize]
  );

  const applyZoomValue = useCallback(
    (previewKey, value) => {
      const clamped = Math.round(clamp(value, ZOOM_MIN, ZOOM_MAX));
      applySize(previewKey, `${clamped}%`);
    },
    [applySize]
  );

  const applyZoomDelta = useCallback(
    (previewKey, delta) => {
      const composition = previewKey === PREVIEW_META.member.key ? memberComposition : landingComposition;
      const base = composition.customZoom
        ? composition.zoomValue
        : normalizeZoomFromSize(composition.normalizedSize);
      applyZoomValue(previewKey, base + delta);
    },
    [applyZoomValue, landingComposition, memberComposition]
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
  const dialogRef = useDialogFocus(Boolean(activePreview), closePreviewEditor);

  useEffect(() => {
    if (!activePreview) return undefined;

    const previousOverflow =
      typeof document !== "undefined" ? String(document.body.style.overflow || "") : "";

    if (typeof document !== "undefined") {
      document.body.style.overflow = "hidden";
    }

    return () => {
      if (typeof document !== "undefined") {
        document.body.style.overflow = previousOverflow;
      }
    };
  }, [activePreview, closePreviewEditor]);

  const updatePositionFromPointer = useCallback(
    (event, previewKey) => {
      const frame = event.currentTarget;
      const rect = frame.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const x = ((event.clientX - rect.left) / rect.width) * 100;
      const y = ((event.clientY - rect.top) / rect.height) * 100;
      schedulePosition({ x, y }, previewKey);
    },
    [schedulePosition]
  );

  const onDragStart = useCallback(
    (event) => {
      if (!hasActiveImage) return;
      dragPointerIdRef.current = event.pointerId;
      setIsDragging(true);
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
      updatePositionFromPointer(event, activePreviewKey);
      event.preventDefault();
    },
    [hasActiveImage, updatePositionFromPointer, activePreviewKey]
  );

  const onDragMove = useCallback(
    (event) => {
      if (dragPointerIdRef.current !== event.pointerId) return;
      updatePositionFromPointer(event, activePreviewKey);
      event.preventDefault();
    },
    [activePreviewKey, updatePositionFromPointer]
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
      if (!hasActiveImage) return;
      const direction = event.deltaY < 0 ? 1 : -1;
      applyZoomDelta(activePreviewKey, direction * ZOOM_STEP);
      event.preventDefault();
    },
    [activePreviewKey, applyZoomDelta, hasActiveImage]
  );

  const onPreviewKeyDown = useCallback(
    (event) => {
      if (!hasActiveImage) return;
      const key = String(event.key || "");
      const nudge = event.shiftKey ? 4 : 1;
      const positionCoords = activeComposition.positionCoords;

      if (key === "ArrowLeft") {
        schedulePosition({ x: positionCoords.x - nudge, y: positionCoords.y }, activePreviewKey);
        event.preventDefault();
        return;
      }
      if (key === "ArrowRight") {
        schedulePosition({ x: positionCoords.x + nudge, y: positionCoords.y }, activePreviewKey);
        event.preventDefault();
        return;
      }
      if (key === "ArrowUp") {
        schedulePosition({ x: positionCoords.x, y: positionCoords.y - nudge }, activePreviewKey);
        event.preventDefault();
        return;
      }
      if (key === "ArrowDown") {
        schedulePosition({ x: positionCoords.x, y: positionCoords.y + nudge }, activePreviewKey);
        event.preventDefault();
        return;
      }
      if (key === "+" || key === "=" || key === "Add") {
        applyZoomDelta(activePreviewKey, ZOOM_STEP);
        event.preventDefault();
        return;
      }
      if (key === "-" || key === "_" || key === "Subtract") {
        applyZoomDelta(activePreviewKey, -ZOOM_STEP);
        event.preventDefault();
      }
    },
    [activeComposition.positionCoords, activePreviewKey, applyZoomDelta, hasActiveImage, schedulePosition]
  );

  const resetHeroComposition = useCallback(() => {
    if (typeof onChangeLandingPosition === "function") onChangeLandingPosition("center center");
    if (typeof onChangeLandingSize === "function") onChangeLandingSize("cover");
    if (typeof onChangeMemberPosition === "function") onChangeMemberPosition("center center");
    if (typeof onChangeMemberSize === "function") onChangeMemberSize("cover");
    if (
      typeof onChangeLandingPosition !== "function" &&
      typeof onChangeMemberPosition !== "function" &&
      typeof onChangePosition === "function"
    ) {
      onChangePosition("center center");
    }
    if (
      typeof onChangeLandingSize !== "function" &&
      typeof onChangeMemberSize !== "function" &&
      typeof onChangeSize === "function"
    ) {
      onChangeSize("cover");
    }
  }, [
    onChangeLandingPosition,
    onChangeLandingSize,
    onChangeMemberPosition,
    onChangeMemberSize,
    onChangePosition,
    onChangeSize
  ]);

  const landingBackgroundStyle = useMemo(
    () =>
      hasLandingImage
        ? {
            backgroundImage: backgroundImageValue(landingHeroUrl),
            backgroundPosition: landingComposition.position,
            backgroundSize: landingComposition.normalizedSize
          }
        : undefined,
    [
      hasLandingImage,
      landingHeroUrl,
      landingComposition.normalizedSize,
      landingComposition.position
    ]
  );
  const memberBackgroundStyle = useMemo(
    () =>
      hasMemberImage
        ? {
            backgroundImage: backgroundImageValue(memberHeroUrl),
            backgroundPosition: memberComposition.position,
            backgroundSize: memberComposition.normalizedSize
          }
        : undefined,
    [hasMemberImage, memberHeroUrl, memberComposition.normalizedSize, memberComposition.position]
  );

  const rootClassName = [
    "hero-image-editor",
    `hero-image-editor--${variant}`,
    isDragging ? "is-dragging" : "",
    className
  ]
    .filter(Boolean)
    .join(" ");

  const simulatorStyle = useMemo(
    () => ({ "--brand-primary": brandPrimary }),
    [brandPrimary]
  );

  function onPreviewTabKeyDown(event) {
    const previewKeys = Object.keys(PREVIEW_META);
    const currentIndex = previewKeys.indexOf(selectedPreview);
    let nextIndex = currentIndex;

    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % previewKeys.length;
    else if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + previewKeys.length) % previewKeys.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = previewKeys.length - 1;
    else return;

    event.preventDefault();
    const nextPreview = previewKeys[nextIndex];
    setSelectedPreview(nextPreview);
    previewTabRefs.current[nextPreview]?.focus();
  }

  function renderLandingPreview({ interactive = false, modal = false } = {}) {
    return (
      <div
        className={[
          "hero-image-editor__preview-stage",
          "hero-image-editor__preview-stage--landing",
          modal && "hero-image-editor__preview-stage--modal"
        ].filter(Boolean).join(" ")}
      >
        <div className="hero-image-editor__landing-screen" style={landingBackgroundStyle}>
          <div className="hero-image-editor__landing-overlay" />
          {interactive ? (
            <button
              ref={modalSurfaceRef}
              type="button"
              className={hasLandingImage ? "hero-image-editor__drag-surface is-active" : "hero-image-editor__drag-surface"}
              disabled={!hasLandingImage}
              onPointerDown={onDragStart}
              onPointerMove={onDragMove}
              onPointerUp={finishDrag}
              onPointerCancel={finishDrag}
              onWheel={onPreviewWheel}
              onKeyDown={onPreviewKeyDown}
              aria-label="Adjust public landing hero image with drag and zoom"
            />
          ) : null}
          {!hasLandingImage ? (
            <p className="hero-image-editor__empty-state">
              Upload a main photo to enable interactive preview.
            </p>
          ) : null}
          <div className="hero-image-editor__landing-content">
            <h3>
              Welcome to the {safeCampName} {alumniWordTitle} Network
            </h3>
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

        <div className="hero-image-editor__masthead" style={memberBackgroundStyle}>
          {interactive ? (
            <button
              ref={modalSurfaceRef}
              type="button"
              className={hasMemberImage ? "hero-image-editor__drag-surface is-active" : "hero-image-editor__drag-surface"}
              disabled={!hasMemberImage}
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
                    <span className="hero-image-editor__pulse-label">{alumniWordTitle}</span>
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
              ref={dialogRef}
              className="hero-image-editor__modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby={`hero-image-editor-modal-title-${variant}`}
              tabIndex={-1}
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
      <section className={rootClassName} style={simulatorStyle}>
        <div className="hero-image-editor__header">
          <div>
            <p className="hero-image-editor__label">{label}</p>
            <p className="hero-image-editor__status">
              <span aria-hidden="true" /> Draft changes appear here instantly
            </p>
          </div>
          <button
            type="button"
            className="hero-image-editor__reset"
            onClick={resetHeroComposition}
          >
            Reset to default
          </button>
        </div>

        <div className="hero-image-editor__simulator-toolbar">
          <div className="hero-image-editor__screen-tabs" role="tablist" aria-label="Preview screen">
            {Object.values(PREVIEW_META).map((preview) => (
              <button
                key={preview.key}
                type="button"
                role="tab"
                ref={(node) => {
                  previewTabRefs.current[preview.key] = node;
                }}
                aria-selected={selectedPreview === preview.key}
                tabIndex={selectedPreview === preview.key ? 0 : -1}
                className={selectedPreview === preview.key ? "is-active" : ""}
                onClick={() => setSelectedPreview(preview.key)}
                onKeyDown={onPreviewTabKeyDown}
              >
                {preview.key === PREVIEW_META.landing.key ? "Public landing" : "Member home"}
              </button>
            ))}
          </div>

          <div className="hero-image-editor__viewport-toggle" role="group" aria-label="Preview device">
            <button
              type="button"
              className={previewViewport === VIEWPORT_DESKTOP ? "is-active" : ""}
              aria-pressed={previewViewport === VIEWPORT_DESKTOP}
              onClick={() => setPreviewViewport(VIEWPORT_DESKTOP)}
            >
              Desktop
            </button>
            <button
              type="button"
              className={previewViewport === VIEWPORT_MOBILE ? "is-active" : ""}
              aria-pressed={previewViewport === VIEWPORT_MOBILE}
              onClick={() => setPreviewViewport(VIEWPORT_MOBILE)}
            >
              Mobile
            </button>
          </div>
        </div>

        <div className="hero-image-editor__simulator-canvas">
          <div
            className={`hero-image-editor__browser hero-image-editor__browser--${previewViewport}`}
            aria-label={`${PREVIEW_META[selectedPreview].title}, ${previewViewport} simulation`}
          >
            <div className="hero-image-editor__browser-bar" aria-hidden="true">
              <span className="hero-image-editor__browser-dots"><i /><i /><i /></span>
              <span className="hero-image-editor__browser-address">
                {safeCampName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "your-camp"}.pondbridgealumni.com
              </span>
            </div>
            <button
              type="button"
              className="hero-image-editor__preview-launcher hero-image-editor__simulator-screen"
              onClick={() => setActivePreview(selectedPreview)}
              aria-label={PREVIEW_META[selectedPreview].aria}
            >
              {selectedPreview === PREVIEW_META.landing.key
                ? renderLandingPreview()
                : renderMemberPreview()}
              <span className="hero-image-editor__preview-launch-label">
                Open full preview and adjust photo framing
              </span>
            </button>
          </div>
        </div>

        <p className="hero-image-editor__hint">
          Switch screens and device sizes to review the experience. Open the full preview to drag the photo, zoom with a trackpad or wheel, or use arrow keys and +/- when focused.
        </p>
      </section>
      {modalPortal}
    </>
  );
}
