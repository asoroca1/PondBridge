import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router-dom";
import { useTenant } from "../../context/TenantContext.jsx";
import { tenantRoute } from "../../lib/tenantRouting.js";
import CedarBackground from "../components/CedarBackground";
import CedarSkeleton from "../components/CedarSkeleton.jsx";
import CedarPageHeader from "../components/CedarPageHeader.jsx";
import "./photo-stream.css";
import { API_BASE } from "../lib/api";
import { getToken, authHeaders, displayName, initialsOf, avatarUrl, fmtDate } from "../lib/helpers.js";
import { isVideoFile, isVideoPost, formatDuration } from "../lib/photoMedia.js";
import InitialsMark from "../../components/InitialsMark.jsx";
import { ModalConfirm, useDialogFocus } from "../../components/admin/AdminUi.jsx";
import { useConfirmDialog } from "../../components/admin/useConfirmDialog.js";
import { Images, Heart, MessageCircle, Trash2, X, Upload, Play } from "lucide-react";

const API = API_BASE;
const PHOTO_PREVIEW_WIDTH = 420;
const PHOTO_PREVIEW_HEIGHT = 315;
const PHOTO_EXPORT_WIDTH = 1600;
const PHOTO_EXPORT_HEIGHT = 1200;
// Matches MAX_PHOTO_STREAM_VIDEO_BYTES on the API, so an oversized clip is
// rejected here instead of after a long upload.
const MAX_VIDEO_BYTES = 300 * 1024 * 1024;
const VIDEO_POSTER_WIDTH = 1280;
const MEDIA_ACCEPT = "image/*,video/mp4,video/quicktime,video/webm";
const SEARCH_USER_CACHE_TTL_MS = 20_000;
const SEARCH_USER_CACHE_MAX_ENTRIES = 600;
const searchUserCache = new Map();
const searchUserInFlight = new Map();

/* ========= helpers ========= */

function getCurrentUserId() {
  try {
    const u = JSON.parse(localStorage.getItem("user") || "null");
    return u?._id || u?.id || null;
  } catch {
    return null;
  }
}

function getCurrentUserAvatar() {
  try {
    const u = JSON.parse(localStorage.getItem("user") || "null");
    return avatarUrl(u);
  } catch {
    return "";
  }
}

function readFileAsImage(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Could not read selected image."));
    };
    image.src = objectUrl;
  });
}

function canvasToBlob(canvas, type = "image/jpeg", quality = 0.9) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

/**
 * Grab the frame a <video> is currently showing as a JPEG.
 * The source is a local blob URL, so the canvas stays untainted and readable.
 * Returns null when the browser cannot decode the clip (HEVC .mov outside
 * Safari, most often) — the post still goes up, just without a cover frame.
 */
async function captureVideoPoster(video) {
  const width = Number(video?.videoWidth || 0);
  const height = Number(video?.videoHeight || 0);
  if (!width || !height) return null;

  const scale = Math.min(1, VIDEO_POSTER_WIDTH / width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  try {
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  } catch {
    return null;
  }

  const blob = await canvasToBlob(canvas, "image/jpeg", 0.85);
  if (!blob) return null;
  return new File([blob], `cover-${Date.now()}.jpg`, { type: "image/jpeg" });
}

/** Presign, PUT to R2, and hand back the URL the post should point at. */
async function uploadStreamFile(file) {
  const presignRes = await fetch(`${API}/photos/presign`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      fileName: file.name,
      fileType: file.type || "application/octet-stream",
      fileSize: Number(file.size || 0)
    })
  });
  if (!presignRes.ok) throw new Error("Presign failed");
  const { uploadUrl, objectUrl, headers } = await presignRes.json();

  const up = await fetch(uploadUrl, {
    method: "PUT",
    ...(headers && typeof headers === "object" ? { headers } : {}),
    body: file
  });
  if (!up.ok) throw new Error("Upload failed");
  return objectUrl;
}

function readCachedSearchUser(id = "") {
  const key = String(id || "").trim();
  if (!key) return null;
  const cached = searchUserCache.get(key);
  if (!cached) return null;
  if (Date.now() >= Number(cached.expiresAt || 0)) {
    searchUserCache.delete(key);
    return null;
  }
  return cached.user || null;
}

function writeCachedSearchUser(id = "", user = null) {
  const key = String(id || "").trim();
  if (!key || !user) return;
  if (searchUserCache.size >= SEARCH_USER_CACHE_MAX_ENTRIES) {
    const firstKey = searchUserCache.keys().next().value;
    if (firstKey) searchUserCache.delete(firstKey);
  }
  searchUserCache.set(key, {
    expiresAt: Date.now() + SEARCH_USER_CACHE_TTL_MS,
    user
  });
}

/** Fetch a user by id (re-uses your search endpoint) */
async function fetchUser(id) {
  const safeId = String(id || "").trim();
  if (!safeId) throw new Error("user not found");

  const cached = readCachedSearchUser(safeId);
  if (cached) return cached;

  const inFlight = searchUserInFlight.get(safeId);
  if (inFlight) return inFlight;

  const pending = (async () => {
    const r = await fetch(`${API}/search/user/${safeId}`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!r.ok) throw new Error("user not found");
    const data = await r.json();
    const user = data?.user || null;
    if (user) {
      writeCachedSearchUser(safeId, user);
      const profileId = String(user?._id || user?.id || "").trim();
      const userId = String(user?.userId || "").trim();
      if (profileId && profileId !== safeId) writeCachedSearchUser(profileId, user);
      if (userId && userId !== safeId && userId !== profileId) writeCachedSearchUser(userId, user);
    }
    return user;
  })().finally(() => {
    searchUserInFlight.delete(safeId);
  });

  searchUserInFlight.set(safeId, pending);
  return pending;
}

/** Tiny component to render a clickable avatar that links to /profile/:id */
function AvatarLink({ userId, name, url, size = 34 }) {
  const { slug } = useTenant();
  const initials = initialsOf(name);
  const style = { width: size, height: size, fontSize: size * 0.4 };
  const classBase = "ps-avatar";
  const avatarNode = url ? (
    <img
      className={`${classBase} ps-avatar-img`}
      src={url}
      alt={name || "avatar"}
      style={style}
      loading="lazy"
      decoding="async"
    />
  ) : (
    <div className={classBase} style={style}><InitialsMark value={initials || "?"} /></div>
  );

  if (!userId) {
    return <span className="ps-avatar-link" title={name}>{avatarNode}</span>;
  }

  return (
    <Link to={tenantRoute(slug, `/profile/${userId}`)} className="ps-avatar-link" title={name}>
      {avatarNode}
    </Link>
  );
}

/* mention-aware render */
function MentionText({ text, mentions = [] }) {
  const { slug } = useTenant();
  if (!text) return null;
  if (!mentions.length) return <span>{text}</span>;
  const segs = []; let cur = 0;
  const sorted = [...mentions].sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
  for (const m of sorted) {
    const s = Math.max(0, m.start ?? 0), e = Math.max(s, m.end ?? s);
    if (s > cur) segs.push({ t: "t", v: text.slice(cur, s) });
    segs.push({ t: "m", v: text.slice(s, e), id: m.profileId, d: m.display });
    cur = e;
  }
  if (cur < text.length) segs.push({ t: "t", v: text.slice(cur) });
  return (
    <>
      {segs.map((g, i) =>
        g.t === "m" && g.id
          ? <Link key={i} to={tenantRoute(slug, `/profile/${g.id}`)} className="mention-link">@{g.d || g.v}</Link>
          : <span key={i}>{g.v}</span>
      )}
    </>
  );
}

// keep arrays unique by _id / id
function uniqById(list = []) {
  const seen = new Set();
  const out = [];
  for (const x of list) {
    const id = x?._id || x?.id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(x);
  }
  return out;
}

/* sort */
function SortDropdown({ value, onChange }) {
  return (
    <label className="ps-sort-wrap">
      <span className="ps-sort-label">Sort</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="ps-select" aria-label="Sort photo stream">
        <option value="new">Newest</option>
        <option value="old">Oldest</option>
        <option value="top">Most Liked</option>
      </select>
    </label>
  );
}

/* upload modal */
function UploadModal({ open, onClose, onPosted }) {
  const [file, setFile] = useState(null);
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [imageMeta, setImageMeta] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [stageSize, setStageSize] = useState({ width: PHOTO_PREVIEW_WIDTH, height: PHOTO_PREVIEW_HEIGHT });
  const [videoDuration, setVideoDuration] = useState(0);
  const [coverUrl, setCoverUrl] = useState("");
  const coverFileRef = useRef(null);
  const fileInputRef = useRef(null);
  const stageRef = useRef(null);
  const videoRef = useRef(null);
  const dialogRef = useDialogFocus(open, busy ? undefined : onClose);
  const isVideo = isVideoFile(file);

  useEffect(() => {
    if (!open) {
      setFile(null);
      setCaption("");
      setBusy(false);
      setError("");
      setPreviewUrl("");
      setImageMeta({ width: 0, height: 0 });
      setZoom(1);
      setOffsetX(0);
      setOffsetY(0);
      setVideoDuration(0);
      setCoverUrl("");
      coverFileRef.current = null;
    }
  }, [open]);

  useEffect(() => {
    if (!file) {
      setPreviewUrl("");
      setImageMeta({ width: 0, height: 0 });
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  useEffect(() => {
    if (!previewUrl || isVideo) return undefined;
    let active = true;
    const image = new Image();
    image.onload = () => {
      if (!active) return;
      setImageMeta({
        width: Number(image.naturalWidth || 0),
        height: Number(image.naturalHeight || 0),
      });
    };
    image.src = previewUrl;
    return () => {
      active = false;
    };
  }, [previewUrl, isVideo]);

  useEffect(() => {
    if (!file) return;
    setZoom(1);
    setOffsetX(0);
    setOffsetY(0);
    setVideoDuration(0);
    setCoverUrl("");
    coverFileRef.current = null;
  }, [file]);

  // Object URLs for the captured cover outlive the render that made them.
  useEffect(() => {
    if (!coverUrl) return undefined;
    return () => URL.revokeObjectURL(coverUrl);
  }, [coverUrl]);

  const captureCover = useCallback(async () => {
    const node = videoRef.current;
    if (!node) return null;
    const captured = await captureVideoPoster(node);
    if (!captured) return null;
    coverFileRef.current = captured;
    setCoverUrl(URL.createObjectURL(captured));
    return captured;
  }, []);

  useEffect(() => {
    if (!open || !stageRef.current) return undefined;
    const node = stageRef.current;
    const updateSize = () => {
      const rect = node.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      setStageSize({ width: rect.width, height: rect.height });
    };

    updateSize();
    let ro = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(updateSize);
      ro.observe(node);
    }
    window.addEventListener("resize", updateSize);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", updateSize);
    };
  }, [open, previewUrl]);

  const previewLayout = useMemo(() => {
    const sourceW = Number(imageMeta.width || 0);
    const sourceH = Number(imageMeta.height || 0);
    const targetW = Number(stageSize.width || 0);
    const targetH = Number(stageSize.height || 0);
    if (!sourceW || !sourceH || !targetW || !targetH) return null;

    const baseScale = Math.max(targetW / sourceW, targetH / sourceH);
    const scaledW = sourceW * baseScale * zoom;
    const scaledH = sourceH * baseScale * zoom;
    const maxShiftX = Math.max(0, (scaledW - targetW) / 2);
    const maxShiftY = Math.max(0, (scaledH - targetH) / 2);
    const shiftX = (offsetX / 100) * maxShiftX;
    const shiftY = (offsetY / 100) * maxShiftY;

    return {
      width: scaledW,
      height: scaledH,
      left: (targetW - scaledW) / 2 + shiftX,
      top: (targetH - scaledH) / 2 + shiftY,
    };
  }, [imageMeta.height, imageMeta.width, offsetX, offsetY, stageSize.height, stageSize.width, zoom]);

  const buildUploadFile = useCallback(async () => {
    if (!file) return null;
    try {
      const image = await readFileAsImage(file);
      const sourceW = Number(image.naturalWidth || 0);
      const sourceH = Number(image.naturalHeight || 0);
      if (!sourceW || !sourceH) return file;

      const baseScale = Math.max(PHOTO_EXPORT_WIDTH / sourceW, PHOTO_EXPORT_HEIGHT / sourceH);
      const scaledW = sourceW * baseScale * zoom;
      const scaledH = sourceH * baseScale * zoom;
      const maxShiftX = Math.max(0, (scaledW - PHOTO_EXPORT_WIDTH) / 2);
      const maxShiftY = Math.max(0, (scaledH - PHOTO_EXPORT_HEIGHT) / 2);
      const shiftX = (offsetX / 100) * maxShiftX;
      const shiftY = (offsetY / 100) * maxShiftY;

      const canvas = document.createElement("canvas");
      canvas.width = PHOTO_EXPORT_WIDTH;
      canvas.height = PHOTO_EXPORT_HEIGHT;
      const ctx = canvas.getContext("2d");
      if (!ctx) return file;

      ctx.fillStyle = "#1c1c1c";
      ctx.fillRect(0, 0, PHOTO_EXPORT_WIDTH, PHOTO_EXPORT_HEIGHT);
      ctx.drawImage(
        image,
        (PHOTO_EXPORT_WIDTH - scaledW) / 2 + shiftX,
        (PHOTO_EXPORT_HEIGHT - scaledH) / 2 + shiftY,
        scaledW,
        scaledH
      );

      const blob = await canvasToBlob(canvas, "image/jpeg", 0.92);
      if (!blob) return file;
      const rawName = String(file.name || "photo").replace(/\.[^.]+$/, "");
      return new File([blob], `${rawName}-framed.jpg`, { type: "image/jpeg" });
    } catch {
      return file;
    }
  }, [file, offsetX, offsetY, zoom]);

  function handleSelectFile(nextFile) {
    setError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (nextFile && isVideoFile(nextFile) && Number(nextFile.size || 0) > MAX_VIDEO_BYTES) {
      setFile(null);
      setError(`Videos must be under ${Math.round(MAX_VIDEO_BYTES / (1024 * 1024))}MB.`);
      return;
    }
    setFile(nextFile);
  }

  async function handlePost() {
    if (!file) return;
    try {
      setBusy(true);
      setError("");

      if (isVideo) {
        // Capture the cover from whatever frame is on screen if the uploader
        // never pressed the button themselves.
        const cover = coverFileRef.current || (await captureCover());
        const mediaUrl = await uploadStreamFile(file);
        let thumbUrl = "";
        if (cover) {
          thumbUrl = await uploadStreamFile(cover).catch(() => "");
        }

        const c = await fetch(`${API}/photos`, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({
            imageUrl: mediaUrl,
            thumbUrl,
            mediaType: "video",
            durationSeconds: videoDuration,
            caption,
            captionMentions: []
          })
        });
        if (!c.ok) throw new Error("Create failed");
        const newPost = await c.json();
        onPosted?.(newPost);
        onClose?.();
        return;
      }

      const uploadFile = (await buildUploadFile()) || file;
      const objectUrl = await uploadStreamFile(uploadFile);

      const c = await fetch(`${API}/photos`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ imageUrl: objectUrl, mediaType: "image", caption, captionMentions: [] })
      });
      if (!c.ok) throw new Error("Create failed");
      const newPost = await c.json();
      onPosted?.(newPost);
      onClose?.();
    } catch (err) {
      setError(err.message || "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="ps-modal" onClick={() => !busy && onClose?.()} role="dialog" aria-modal="true" aria-labelledby="ps-upload-title">
      <div ref={dialogRef} className="ps-modal-card" onClick={(e) => e.stopPropagation()} tabIndex={-1}>
        <div className="ps-modal-head">
          <h2 id="ps-upload-title" className="ps-modal-title">Add a Photo or Video</h2>
          <button type="button" className="ps-modal-close-btn" onClick={onClose} disabled={busy} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="ps-upload-file-row">
          <button
            type="button"
            className="ps-btn secondary ps-file-trigger"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
          >
            <Upload size={14} />
            Choose File
          </button>
          <span className="ps-file-name">{file ? file.name : "JPG, PNG, WEBP, MP4, MOV, or WEBM"}</span>
          <input
            ref={fileInputRef}
            type="file"
            accept={MEDIA_ACCEPT}
            onChange={(e) => handleSelectFile(e.target.files?.[0] || null)}
            className="ps-file"
            hidden
          />
        </div>

        {previewUrl && isVideo ? (
          <div className="ps-upload-preview-wrap">
            <div className="ps-upload-preview-stage ps-upload-preview-stage-video">
              <video
                ref={videoRef}
                src={previewUrl}
                className="ps-upload-preview-video"
                controls
                playsInline
                preload="metadata"
                onLoadedMetadata={(e) => {
                  const node = e.currentTarget;
                  setVideoDuration(Number.isFinite(node.duration) ? node.duration : 0);
                  // Frame zero is often black, so open on something representative.
                  try {
                    node.currentTime = Math.min(1, (node.duration || 0) / 2);
                  } catch {
                    /* seeking is best effort */
                  }
                }}
                onSeeked={() => {
                  if (!coverFileRef.current) captureCover();
                }}
              />
            </div>

            <div className="ps-upload-controls" aria-label="Video cover controls">
              <div className="ps-upload-cover-row">
                {coverUrl ? (
                  <img src={coverUrl} alt="Video cover frame" className="ps-upload-cover-thumb" />
                ) : (
                  <div className="ps-upload-cover-thumb ps-upload-cover-thumb-empty">No cover</div>
                )}
                <div className="ps-upload-cover-copy">
                  <span>
                    {coverUrl
                      ? "This frame is the cover in the stream."
                      : "Scrub the video, then pick the frame to use as the cover."}
                  </span>
                  {videoDuration ? (
                    <span className="ps-upload-cover-duration">{formatDuration(videoDuration)}</span>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                className="ps-btn secondary ps-upload-reset"
                onClick={captureCover}
                disabled={busy}
              >
                Use Current Frame
              </button>
            </div>
          </div>
        ) : previewUrl ? (
          <div className="ps-upload-preview-wrap">
            <div className="ps-upload-preview-stage" ref={stageRef}>
              <img
                src={previewUrl}
                alt="Photo preview"
                className="ps-upload-preview-image"
                decoding="async"
                style={
                  previewLayout
                    ? {
                        width: `${previewLayout.width}px`,
                        height: `${previewLayout.height}px`,
                        left: `${previewLayout.left}px`,
                        top: `${previewLayout.top}px`
                      }
                    : undefined
                }
              />
            </div>

            <div className="ps-upload-controls" aria-label="Photo framing controls">
              <label className="ps-upload-control">
                <span>Zoom</span>
                <input
                  type="range"
                  min="100"
                  max="300"
                  step="1"
                  value={Math.round(zoom * 100)}
                  onChange={(e) => setZoom(Number(e.target.value) / 100)}
                />
              </label>
              <label className="ps-upload-control">
                <span>Shift Left/Right</span>
                <input
                  type="range"
                  min="-100"
                  max="100"
                  step="1"
                  value={offsetX}
                  onChange={(e) => setOffsetX(Number(e.target.value))}
                />
              </label>
              <label className="ps-upload-control">
                <span>Shift Up/Down</span>
                <input
                  type="range"
                  min="-100"
                  max="100"
                  step="1"
                  value={offsetY}
                  onChange={(e) => setOffsetY(Number(e.target.value))}
                />
              </label>
              <button
                type="button"
                className="ps-btn secondary ps-upload-reset"
                onClick={() => {
                  setZoom(1);
                  setOffsetX(0);
                  setOffsetY(0);
                }}
              >
                Reset Framing
              </button>
            </div>
          </div>
        ) : (
          <div className="ps-upload-preview-empty">A preview will appear here before posting.</div>
        )}

        <textarea value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Write a caption (use @Name to tag)" maxLength={500} className="ps-textarea" />
        {error ? <div className="ps-inline-error" role="alert">{error}</div> : null}
        <div className="ps-modal-actions">
          <button className="ps-btn secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="ps-btn primary" onClick={handlePost} disabled={!file || busy}>{busy ? "Posting…" : "Post"}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/* comments */
function CommentsPanel({ photoId, canModerate }) {
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState("");
  const [actionError, setActionError] = useState("");
  const loaderRef = useRef(null);
  const { confirm, confirmDialogProps } = useConfirmDialog();

  const myId = getCurrentUserId();
  const myAvatar = getCurrentUserAvatar();

  // Prevent double initial fetch in React 18 StrictMode
  const didInitial = useRef(false);

  const fetchPage = useCallback(
    async (cur) => {
      if (loading) return; // small guard
      try {
        setLoading(true);
        const qs = new URLSearchParams();
        if (cur) qs.set("cursor", cur);

        const r = await fetch(`${API}/photos/${photoId}/comments?${qs}`, {
          headers: authHeaders(),
        });
        if (!r.ok) throw new Error("Comments fetch failed");
        const data = await r.json();

        // ✅ de-dupe when appending
        setItems((prev) => uniqById([...(prev || []), ...(data.items || [])]));
        setCursor(data.nextCursor || null);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    },
    [photoId, loading]
  );

  useEffect(() => {
    // reset state when photo changes
    setItems([]);
    setCursor(null);
    didInitial.current = false;
  }, [photoId]);

  useEffect(() => {
    if (didInitial.current) return;
    didInitial.current = true;
    fetchPage(null);
  }, [fetchPage]);

  useEffect(() => {
    const io = new IntersectionObserver(
      (ents) => {
        if (ents[0].isIntersecting && !loading && cursor) {
          fetchPage(cursor);
        }
      },
      { rootMargin: "300px" }
    );
    if (loaderRef.current) io.observe(loaderRef.current);
    return () => io.disconnect();
  }, [cursor, loading, fetchPage]);

  async function submitComment() {
    const t = (text || "").trim();
    if (!t) return;

    const optimistic = {
      _id: `temp-${Date.now()}`,
      photoId,
      authorId: myId || "me",
      authorName: "You",
      authorAvatarUrl: myAvatar || "",
      text: t,
      commentMentions: [],
      createdAt: new Date().toISOString(),
    };

    // show immediately (and de-dupe just in case)
    setItems((prev) => uniqById([...(prev || []), optimistic]));
    setText("");

    try {
      setActionError("");
      const r = await fetch(`${API}/photos/${photoId}/comments`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ text: t, commentMentions: [] }),
      });
      if (!r.ok) throw new Error("Comment failed");
      const saved = await r.json();

      // replace optimistic with saved (and de-dupe)
      setItems((prev) =>
        uniqById(prev.map((i) => (i._id === optimistic._id ? saved : i)))
      );
    } catch (e) {
      // revert on failure
      setItems((prev) => prev.filter((i) => i._id !== optimistic._id));
      setActionError(e.message || "Could not post comment");
    }
  }

  async function deleteComment(id) {
    const accepted = await confirm({
      title: "Delete this comment?",
      description: "The comment will be permanently removed from this photo.",
      confirmLabel: "Delete comment",
    });
    if (!accepted) return;

    const prev = items;
    setActionError("");
    setItems((p) => p.filter((c) => c._id !== id));
    try {
      const r = await fetch(`${API}/photos/${photoId}/comments/${id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (!r.ok) throw new Error("Delete failed");
    } catch (e) {
      setItems(prev); // revert
      setActionError(e.message || "Could not delete comment");
    }
  }

  const canDelete = (c) =>
    canModerate || (myId && (String(c.authorId) === String(myId) || c.authorId === "me"));

  return (
    <div className="ps-comments">
      <div className="ps-comments-list">
        {!loading && items.length === 0 && (
          <div className="ps-comments-empty">No comments yet. Start the conversation.</div>
        )}
        {items.map((c) => (
          // ✅ rely on stable ids only; no index fallback
          <div key={c._id} className="ps-comment-row">
            <AvatarLink
              userId={c.authorId}
              name={c.authorName}
              url={avatarUrl(c)}
              size={28}
            />
            <div className="ps-comment-body">
              <div className="ps-comment-topline">
                <div className="ps-comment-author">{c.authorName}</div>
                {canDelete(c) && (
                  <button
                    className="ps-btn-icon ps-comment-delete"
                    onClick={() => deleteComment(c._id)}
                    aria-label="Delete comment"
                    title="Delete comment"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
              <div className="ps-comment-text">
                <MentionText text={c.text} mentions={c.commentMentions} />
              </div>
              <div className="ps-comment-date">{fmtDate(c.createdAt)}</div>
            </div>
          </div>
        ))}
        <div ref={loaderRef} style={{ height: 1 }} />
        {loading && <div className="ps-loading">Loading comments…</div>}
      </div>

      <div className="ps-comment-input-row">
        <input
          className="ps-input"
          placeholder="Add a comment…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submitComment()}
        />
        <button className="ps-btn primary" onClick={submitComment}>
          Post
        </button>
      </div>
      {actionError ? <div className="ps-inline-error" role="alert">{actionError}</div> : null}
      <ModalConfirm {...confirmDialogProps} backdropClassName="ps-dialog-over-lightbox" />
    </div>
  );
}

/* lightbox */
function Lightbox({ post, onClose, onToggleLike, authorInfo }) {
  const { slug } = useTenant();
  const ownerId = post ? String(post.ownerId ?? post.userId ?? post.createdBy ?? "") : "";
  const info = post ? (authorInfo?.[ownerId] || { name: post.ownerName, avatar: "" }) : { name: "", avatar: "" };
  const likesCount = Number(post?.likes || 0);
  const commentsCount = Number(post?.commentsCount || 0);
  const dialogRef = useDialogFocus(Boolean(post), onClose);

  useEffect(() => {
    if (!post) return undefined;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [post, onClose]);

  if (!post || typeof document === "undefined") return null;

  return createPortal(
    <div className="ps-lightbox" onClick={onClose} aria-modal="true" role="dialog" aria-label="Post details">
      <div ref={dialogRef} className="ps-lightbox-card" onClick={(e) => e.stopPropagation()} tabIndex={-1}>
        {/* MEDIA */}
        <div className="ps-lightbox-media">
          {isVideoPost(post) ? (
            <video
              className="ps-lightbox-video"
              src={post.imageUrl}
              poster={post.thumbUrl || undefined}
              controls
              autoPlay
              playsInline
              preload="metadata"
            />
          ) : (
            <img
              className="ps-lightbox-img"
              src={post.imageUrl}
              alt={post.caption || "Camp photo"}
              decoding="async"
            />
          )}
        </div>

        {/* SIDE PANEL */}
        <aside className="ps-lightbox-side">
          <div className="ps-lb-head">
            <div className="ps-owner-row">
              <AvatarLink userId={ownerId} name={info.name || post.ownerName} url={info.avatar} size={34} />
              <div className="ps-owner-meta">
                {ownerId ? (
                  <Link to={tenantRoute(slug, `/profile/${ownerId}`)} className="ps-name">
                    {info.name || post.ownerName}
                  </Link>
                ) : (
                  <span className="ps-name">{info.name || post.ownerName}</span>
                )}
                <div className="ps-date">{fmtDate(post.createdAt)}</div>
              </div>
            </div>
            <button className="ps-lightbox-close" onClick={onClose} aria-label="Close">
              <X size={17} />
            </button>
          </div>

          <div className="ps-lb-actions">
            <button className="ps-icon-btn ps-like-btn" onClick={() => onToggleLike?.(post._id)} aria-label="Like this photo" title="Like this photo">
              <Heart size={16} strokeWidth={2} />
              <span className="count">{likesCount}</span>
            </button>
            <div className="ps-stat-pill" title="Comments on this photo">
              <MessageCircle size={16} strokeWidth={2} />
              <span>{commentsCount}</span>
            </div>
          </div>

          {post.caption && (
            <div className="ps-lb-caption">
              <MentionText text={post.caption} mentions={post.captionMentions} />
            </div>
          )}

          <CommentsPanel photoId={post._id} canModerate={!!post.mine} />
        </aside>
      </div>
    </div>,
    document.body
  );
}

/* ========= page ========= */
export default function PhotoStream() {
  const { tenant, slug } = useTenant();
  const navigate = useNavigate();
  const [sort, setSort] = useState("new");
  const [items, setItems] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [nextPage, setNextPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [viewerPost, setViewerPost] = useState(null);
  const [actionError, setActionError] = useState("");
  const loaderRef = useRef(null);
  const { confirm, confirmDialogProps } = useConfirmDialog();

  // cache of poster info: { userId: { name, avatar } }
  const [authorInfo, setAuthorInfo] = useState({});
  const campName = String(tenant?.name || "camp").trim() || "camp";

  // prevent duplicate "initial" fetches in React 18 StrictMode
  const didInitialForSort = useRef(new Set());

  const ensureAuthed = useCallback(() => {
    const t = getToken();
    if (!t) navigate(tenantRoute(slug, "/login"));
    return !!t;
  }, [navigate, slug]);

  // prime author cache for an array of posts
  const primeAuthors = useCallback(async (posts = []) => {
    const ids = [...new Set(
      posts
        .map((p) => String(p.ownerId ?? p.userId ?? p.createdBy ?? ""))
        .filter(Boolean)
    )].filter((id) => !authorInfo[id]);
    if (!ids.length) return;

    const resolved = await Promise.allSettled(
      ids.map(async (id) => [id, await fetchUser(id)])
    );
    const updates = {};
    for (const item of resolved) {
      if (item.status !== "fulfilled") continue;
      const [id, user] = item.value || [];
      if (!id || !user) continue;
      updates[id] = { name: displayName(user), avatar: avatarUrl(user) };
    }
    if (Object.keys(updates).length > 0) {
      setAuthorInfo((prev) => ({ ...prev, ...updates }));
    }
  }, [authorInfo]);

  useEffect(() => {
    if (!ensureAuthed()) return;

    // reset paging state on sort change
    setItems([]); setNextCursor(null); setNextPage(1);

    // Skip second invocation in StrictMode for the same sort value
    if (didInitialForSort.current.has(sort)) return;
    didInitialForSort.current.add(sort);

    fetchPage({ initial: true });
  }, [sort]);

  async function fetchPage({ initial = false } = {}) {
    try {
      if (!ensureAuthed()) return;
      setLoading(true);

      const params = new URLSearchParams();
      params.set("sort", sort);
      params.set("limit", "20");
      if (sort === "top") {
        params.set("page", String(initial ? 1 : nextPage));
      } else if (!initial && nextCursor) {
        params.set("cursor", nextCursor);
      }

      const res = await fetch(`${API}/photos?${params}`, { headers: authHeaders() });
      if (!res.ok) throw new Error("Feed failed");
      const data = await res.json();

      const merged = uniqById([...(items || []), ...((data.items) || [])]);
      setItems(merged);

      // cache author photos/names
      primeAuthors(data.items || []);

      if (sort === "top") {
        setNextPage(data.nextPage || null);
      } else {
        setNextCursor(data.nextCursor || null);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const io = new IntersectionObserver((ents) => {
      if (ents[0].isIntersecting && !loading) {
        if (sort === "top" ? nextPage : nextCursor) fetchPage({});
      }
    }, { rootMargin: "600px" });
    if (loaderRef.current) io.observe(loaderRef.current);
    return () => io.disconnect();
  }, [loading, sort, nextCursor, nextPage]);

  async function toggleLike(id) {
    try {
      setItems(p => p.map(x => x._id === id ? { ...x, likes: (x.likes || 0) + 1 } : x));
      const r = await fetch(`${API}/photos/${id}/like`, { method: "POST", headers: authHeaders() });
      if (!r.ok) throw new Error("Like failed");
      const updated = await r.json();
      setItems(p => p.map(x => x._id === id ? updated : x));
      setViewerPost(v => v && v._id === id ? updated : v);
    } catch (e) { console.error(e); }
  }

  async function deletePhoto(post) {
    const id = post?._id;
    if (!id) return;
    const noun = isVideoPost(post) ? "video" : "photo";
    const accepted = await confirm({
      title: `Delete this ${noun}?`,
      description: `The ${noun} and its comments will be permanently removed from the stream.`,
      confirmLabel: `Delete ${noun}`,
    });
    if (!accepted) return;
    try {
      setActionError("");
      const r = await fetch(`${API}/photos/${id}`, { method: "DELETE", headers: authHeaders() });
      if (!r.ok) throw new Error("Delete failed");
      setItems(p => p.filter(x => x._id !== id));
      setViewerPost(v => v && v._id === id ? null : v);
    } catch (e) {
      setActionError(e.message || "Delete failed");
    }
  }

  function handlePosted(newPost){
    setItems(p => uniqById([newPost, ...(p||[])]));
    primeAuthors([newPost]);
  }

  return (
    <div className="ps-page">
      {/* Cedar background, fixed under everything */}
      <CedarBackground behavior="fixed" opacity={0.9} zIndex={0} />


      <div className="ps-container nav2-page-shell">
        <CedarPageHeader
          className="ps-page-header"
          icon={<Images size={18} />}
          title="Photo Stream"
          subtitle={`Share old and new camp photos and videos with the ${campName} community. Click a post to open it.`}
        >
          <div className="ps-header-right">
            <SortDropdown value={sort} onChange={setSort} />
            <button className="ps-btn primary" onClick={() => setUploadOpen(true)}>Upload</button>
          </div>
        </CedarPageHeader>

        <div className="ps-feed-grid">
          {items.map(p => {
            const ownerId = String(p.ownerId ?? p.userId ?? p.createdBy ?? "");
            const info = authorInfo[ownerId] || { name: p.ownerName, avatar: "" };
            return (
              <div key={p._id || p.id} className="ps-card">
                <button
                  className="ps-media-wrap"
                  onClick={() => setViewerPost(p)}
                  aria-label={isVideoPost(p) ? "Play video" : "Open photo"}
                >
                  {isVideoPost(p) && !p.thumbUrl ? (
                    <div className="ps-media ps-media-placeholder" aria-hidden="true" />
                  ) : (
                    <img
                      className="ps-media"
                      src={p.thumbUrl || p.imageUrl}
                      alt={p.caption || (isVideoPost(p) ? "Camp video" : "Camp photo")}
                      loading="lazy"
                      decoding="async"
                    />
                  )}
                  {isVideoPost(p) ? (
                    <>
                      <span className="ps-play-badge" aria-hidden="true">
                        <Play size={20} strokeWidth={2} fill="currentColor" />
                      </span>
                      {formatDuration(p.durationSeconds) ? (
                        <span className="ps-duration-pill">{formatDuration(p.durationSeconds)}</span>
                      ) : null}
                    </>
                  ) : null}
                </button>

                <div className="ps-card-body">
                  <div className="ps-meta">
                    <div className="ps-meta-left">
                      <AvatarLink userId={ownerId} name={info.name || p.ownerName || "Unknown"} url={info.avatar} />
                      <div className="ps-owner-stack">
                        {ownerId ? (
                          <Link to={tenantRoute(slug, `/profile/${ownerId}`)} className="ps-name">
                            {info.name || p.ownerName || "Unknown"}
                          </Link>
                        ) : (
                          <span className="ps-name">{info.name || p.ownerName || "Unknown"}</span>
                        )}
                        <div className="ps-date">{fmtDate(p.createdAt)}</div>
                      </div>
                    </div>
                  </div>

                  {p.caption && (
                    <div className="ps-caption">
                      <MentionText text={p.caption} mentions={p.captionMentions} />
                    </div>
                  )}

                  <div className="ps-actions">
                    <button className="ps-btn-icon ps-action-pill" onClick={() => toggleLike(p._id)} aria-label={isVideoPost(p) ? "Like this video" : "Like this photo"}>
                      <Heart size={16} strokeWidth={2} />
                      <span>{p.likes || 0}</span>
                    </button>
                    <button className="ps-btn-icon ps-action-pill" onClick={() => setViewerPost(p)} aria-label="View comments">
                      <MessageCircle size={16} strokeWidth={2} />
                      <span>{p.commentsCount || 0}</span>
                    </button>
                    {p.mine && (
                      <button className="ps-btn-icon danger ps-delete-pill" onClick={() => deletePhoto(p)} aria-label={isVideoPost(p) ? "Delete video" : "Delete photo"}>
                        <Trash2 size={15} />
                        <span>Delete</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div ref={loaderRef} style={{ height: 1 }} />
        {loading && <CedarSkeleton.Lines lines={2} />}
        {actionError ? <div className="ps-inline-error" role="alert">{actionError}</div> : null}
        {!loading && items.length === 0 && (
          <div className="ps-empty">{`📷 Nothing here yet - be the first to share a ${campName} memory.`}</div>
        )}
        {((sort !== "top" && !nextCursor && items.length > 0) || (sort === "top" && !nextPage && items.length > 0)) && <div className="ps-end">You’re all caught up.</div>}
      </div>

      <UploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} onPosted={handlePosted} />
      <Lightbox post={viewerPost} onClose={() => setViewerPost(null)} onToggleLike={toggleLike} authorInfo={authorInfo} />
      <ModalConfirm {...confirmDialogProps} />
    </div>
  );
}
