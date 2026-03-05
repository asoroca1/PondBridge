import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router-dom";
import { useTenant } from "../../context/TenantContext.jsx";
import CedarBackground from "../components/CedarBackground";
import CedarSkeleton from "../components/CedarSkeleton.jsx";
import CedarPageHeader from "../components/CedarPageHeader.jsx";
import "./photo-stream.css";
import { API_BASE } from "../lib/api";
import { getToken, authHeaders, displayName, initialsOf, avatarUrl, fmtDate } from "../lib/helpers.js";
import { Images, Heart, MessageCircle, Trash2, X, Upload } from "lucide-react";

const API = API_BASE;
const PHOTO_PREVIEW_WIDTH = 420;
const PHOTO_PREVIEW_HEIGHT = 315;
const PHOTO_EXPORT_WIDTH = 1600;
const PHOTO_EXPORT_HEIGHT = 1200;

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

/** Fetch a user by id (re-uses your search endpoint) */
async function fetchUser(id) {
  const r = await fetch(`${API}/search/user/${id}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!r.ok) throw new Error("user not found");
  const data = await r.json();
  return data.user;
}

/** Tiny component to render a clickable avatar that links to /profile/:id */
function AvatarLink({ userId, name, url, size = 34 }) {
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
    <div className={classBase} style={style}>{initials || "?"}</div>
  );

  if (!userId) {
    return <span className="ps-avatar-link" title={name}>{avatarNode}</span>;
  }

  return (
    <Link to={`/profile/${userId}`} className="ps-avatar-link" title={name}>
      {avatarNode}
    </Link>
  );
}

/* mention-aware render */
function MentionText({ text, mentions = [] }) {
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
          ? <Link key={i} to={`/profile/${g.id}`} className="mention-link">@{g.d || g.v}</Link>
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
  const [previewUrl, setPreviewUrl] = useState("");
  const [imageMeta, setImageMeta] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [stageSize, setStageSize] = useState({ width: PHOTO_PREVIEW_WIDTH, height: PHOTO_PREVIEW_HEIGHT });
  const fileInputRef = useRef(null);
  const stageRef = useRef(null);

  useEffect(() => {
    if (!open) {
      setFile(null);
      setCaption("");
      setBusy(false);
      setPreviewUrl("");
      setImageMeta({ width: 0, height: 0 });
      setZoom(1);
      setOffsetX(0);
      setOffsetY(0);
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
    if (!previewUrl) return undefined;
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
  }, [previewUrl]);

  useEffect(() => {
    if (!file) return;
    setZoom(1);
    setOffsetX(0);
    setOffsetY(0);
  }, [file]);

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

      ctx.fillStyle = "#0b1220";
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

  async function handlePost() {
    if (!file) return;
    try {
      setBusy(true);
      const uploadFile = (await buildUploadFile()) || file;
      const p = await fetch(`${API}/photos/presign`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          fileName: uploadFile.name,
          fileType: uploadFile.type || "image/jpeg",
          fileSize: Number(uploadFile.size || 0)
        })
      });
      if (!p.ok) throw new Error("Presign failed");
      const { uploadUrl, objectUrl, headers } = await p.json();
      const up = await fetch(uploadUrl, {
        method: "PUT",
        ...(headers && typeof headers === "object" ? { headers } : {}),
        body: uploadFile
      });
      if (!up.ok) throw new Error("Upload failed");

      const c = await fetch(`${API}/photos`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ imageUrl: objectUrl, caption, captionMentions: [] })
      });
      if (!c.ok) throw new Error("Create failed");
      const newPost = await c.json();
      onPosted?.(newPost);
      onClose?.();
    } catch (err) {
      alert(err.message || "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="ps-modal" onClick={() => !busy && onClose?.()}>
      <div className="ps-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="ps-modal-head">
          <h2 className="ps-modal-title">Add a Photo</h2>
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
            Choose Photo
          </button>
          <span className="ps-file-name">{file ? file.name : "JPG, PNG, or WEBP"}</span>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="ps-file"
            hidden
          />
        </div>

        {previewUrl ? (
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
          <div className="ps-upload-preview-empty">Photo preview will appear here before posting.</div>
        )}

        <textarea value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Write a caption (use @Name to tag)" maxLength={500} className="ps-textarea" />
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
  const loaderRef = useRef(null);

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
      alert(e.message || "Could not post comment");
    }
  }

  async function deleteComment(id) {
    const ok = confirm("Delete this comment?");
    if (!ok) return;

    const prev = items;
    setItems((p) => p.filter((c) => c._id !== id));
    try {
      const r = await fetch(`${API}/photos/${photoId}/comments/${id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (!r.ok) throw new Error("Delete failed");
    } catch (e) {
      setItems(prev); // revert
      alert(e.message || "Could not delete comment");
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
    </div>
  );
}

/* lightbox */
function Lightbox({ post, onClose, onToggleLike, authorInfo }) {
  const ownerId = post ? String(post.ownerId ?? post.userId ?? post.createdBy ?? "") : "";
  const info = post ? (authorInfo?.[ownerId] || { name: post.ownerName, avatar: "" }) : { name: "", avatar: "" };
  const likesCount = Number(post?.likes || 0);
  const commentsCount = Number(post?.commentsCount || 0);

  useEffect(() => {
    if (!post) return undefined;

    const onKeyDown = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [post, onClose]);

  if (!post || typeof document === "undefined") return null;

  return createPortal(
    <div className="ps-lightbox" onClick={onClose} aria-modal="true" role="dialog">
      <div className="ps-lightbox-card" onClick={(e) => e.stopPropagation()}>
        {/* MEDIA */}
        <div className="ps-lightbox-media">
          <img
            className="ps-lightbox-img"
            src={post.imageUrl}
            alt={post.caption || "Camp photo"}
            decoding="async"
          />
        </div>

        {/* SIDE PANEL */}
        <aside className="ps-lightbox-side">
          <div className="ps-lb-head">
            <div className="ps-owner-row">
              <AvatarLink userId={ownerId} name={info.name || post.ownerName} url={info.avatar} size={34} />
              <div className="ps-owner-meta">
                {ownerId ? (
                  <Link to={`/profile/${ownerId}`} className="ps-name">
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
  const { tenant } = useTenant();
  const navigate = useNavigate();
  const [sort, setSort] = useState("new");
  const [items, setItems] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [nextPage, setNextPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [viewerPost, setViewerPost] = useState(null);
  const loaderRef = useRef(null);

  // cache of poster info: { userId: { name, avatar } }
  const [authorInfo, setAuthorInfo] = useState({});
  const campName = String(tenant?.name || "camp").trim() || "camp";

  // prevent duplicate "initial" fetches in React 18 StrictMode
  const didInitialForSort = useRef(new Set());

  const ensureAuthed = useCallback(() => {
    const t = getToken();
    if (!t) navigate("/login");
    return !!t;
  }, [navigate]);

  // prime author cache for an array of posts
  const primeAuthors = useCallback(async (posts = []) => {
    const ids = [...new Set(
      posts
        .map((p) => String(p.ownerId ?? p.userId ?? p.createdBy ?? ""))
        .filter(Boolean)
    )].filter((id) => !authorInfo[id]);

    for (const id of ids) {
      try {
        const u = await fetchUser(id);
        setAuthorInfo((prev) => ({
          ...prev,
          [id]: { name: displayName(u), avatar: avatarUrl(u) },
        }));
      } catch {
        // ignore
      }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  async function deletePhoto(id) {
    const ok = confirm("Delete this photo?"); if (!ok) return;
    try {
      const r = await fetch(`${API}/photos/${id}`, { method: "DELETE", headers: authHeaders() });
      if (!r.ok) throw new Error("Delete failed");
      setItems(p => p.filter(x => x._id !== id));
      setViewerPost(v => v && v._id === id ? null : v);
    } catch (e) {
      alert(e.message || "Delete failed");
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
          subtitle={`Share old and new camp photos with the ${campName} community. Click a photo to enlarge.`}
        >
          <div className="ps-header-right">
            <SortDropdown value={sort} onChange={setSort} />
            <button className="ps-btn primary" onClick={() => setUploadOpen(true)}>Upload Photo</button>
          </div>
        </CedarPageHeader>

        <div className="ps-feed-grid">
          {items.map(p => {
            const ownerId = String(p.ownerId ?? p.userId ?? p.createdBy ?? "");
            const info = authorInfo[ownerId] || { name: p.ownerName, avatar: "" };
            return (
              <div key={p._id || p.id} className="ps-card">
                <button className="ps-media-wrap" onClick={() => setViewerPost(p)} aria-label="Open photo">
                  <img
                    className="ps-media"
                    src={p.thumbUrl || p.imageUrl}
                    alt={p.caption || "Camp photo"}
                    loading="lazy"
                    decoding="async"
                  />
                </button>

                <div className="ps-card-body">
                  <div className="ps-meta">
                    <div className="ps-meta-left">
                      <AvatarLink userId={ownerId} name={info.name || p.ownerName || "Unknown"} url={info.avatar} />
                      <div className="ps-owner-stack">
                        {ownerId ? (
                          <Link to={`/profile/${ownerId}`} className="ps-name">
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
                    <button className="ps-btn-icon ps-action-pill" onClick={() => toggleLike(p._id)} aria-label="Like this photo">
                      <Heart size={16} strokeWidth={2} />
                      <span>{p.likes || 0}</span>
                    </button>
                    <button className="ps-btn-icon ps-action-pill" onClick={() => setViewerPost(p)} aria-label="View comments">
                      <MessageCircle size={16} strokeWidth={2} />
                      <span>{p.commentsCount || 0}</span>
                    </button>
                    {p.mine && (
                      <button className="ps-btn-icon danger ps-delete-pill" onClick={() => deletePhoto(p._id)} aria-label="Delete photo">
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
        {!loading && items.length === 0 && (
          <div className="ps-empty">{`📷 No photos yet - be the first to share a ${campName} memory.`}</div>
        )}
        {((sort !== "top" && !nextCursor && items.length > 0) || (sort === "top" && !nextPage && items.length > 0)) && <div className="ps-end">You’re all caught up.</div>}
      </div>

      <UploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} onPosted={handlePosted} />
      <Lightbox post={viewerPost} onClose={() => setViewerPost(null)} onToggleLike={toggleLike} authorInfo={authorInfo} />
    </div>
  );
}
