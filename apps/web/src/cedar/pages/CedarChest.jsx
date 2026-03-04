import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTenant } from "../../context/TenantContext.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { resolveNetworkDisplayName, resolveNewsletterLabel } from "../../lib/campLabels.js";
import CedarBackground from "../components/CedarBackground";
import CedarPageHeader from "../components/CedarPageHeader.jsx";
import { API_BASE } from "../lib/api";
import { getToken, authHeaders, fmtDate } from "../lib/helpers.js";
import "./cedar-chest.css";
import { FileText, Newspaper, Upload, X } from "lucide-react";

const API = API_BASE;
const DEFAULT_SEASONS = ["Winter", "Spring", "Summer", "Fall"];
const COVER_PREVIEW_WIDTH = 220;
const COVER_PREVIEW_HEIGHT = Math.round((COVER_PREVIEW_WIDTH * 4) / 3);
const COVER_EXPORT_WIDTH = 900;
const COVER_EXPORT_HEIGHT = 1200;

function normalizeRoleSet(value = {}) {
  const rawRoles = Array.isArray(value?.roles)
    ? value.roles
    : value?.roles
      ? [value.roles]
      : value?.role
        ? [value.role]
        : [];
  return new Set(
    rawRoles
      .map((role) =>
        String(role || "")
          .trim()
          .toLowerCase()
      )
      .filter(Boolean)
  );
}

function hasDirectorPrivileges(...sources) {
  const allowed = new Set(["tenant_admin", "super_admin", "admin"]);
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    const roles = normalizeRoleSet(source);
    for (const role of roles) {
      if (allowed.has(role)) return true;
    }
  }
  return false;
}

function readJwtRoles() {
  try {
    const token = getToken();
    if (!token) return [];
    const payload = JSON.parse(atob(token.split(".")[1]));
    return Array.isArray(payload?.roles) ? payload.roles : payload?.role ? [payload.role] : [];
  } catch {
    return [];
  }
}

function seasonClassName(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized ? `is-${normalized}` : "";
}

async function parseApiError(response, fallback = "Request failed") {
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  if (contentType.includes("application/json")) {
    const payload = await response.json().catch(() => null);
    const message = payload?.error?.message || payload?.message;
    return message ? String(message) : fallback;
  }
  const text = await response.text().catch(() => "");
  return text ? String(text) : fallback;
}

function openInNewTab(url = "") {
  const target = String(url || "").trim();
  if (!target) return;
  const popup = window.open(target, "_blank", "noopener,noreferrer");
  if (popup) return;
  const anchor = document.createElement("a");
  anchor.href = target;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
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
      reject(new Error("Unable to load image."));
    };
    image.src = objectUrl;
  });
}

function canvasToBlob(canvas, mimeType = "image/jpeg", quality = 0.92) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mimeType, quality);
  });
}

// ===== main page =====
export default function CedarChest() {
  const { tenant } = useTenant();
  const { user: authUser } = useAuth();
  const [newsletters, setNewsletters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [season, setSeason] = useState("");
  const [year, setYear] = useState("");
  const [adminProbeAllowed, setAdminProbeAllowed] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);

  const networkDisplayName = resolveNetworkDisplayName(tenant);
  const newsletterLabel = resolveNewsletterLabel(tenant);

  useEffect(() => {
    let ignore = false;
    async function run() {
      setLoading(true);
      setErr("");
      try {
        const res = await fetch(`${API}/newsletters`, {
          headers: authHeaders(),
        });
        if (!res.ok) throw new Error(await parseApiError(res, "Failed to load newsletters"));
        const j = await res.json();
        if (!ignore) {
          setNewsletters(Array.isArray(j) ? j : j?.items ?? []);
        }
      } catch (error) {
        if (!ignore) setErr(String(error?.message || "Error"));
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    run();
    return () => {
      ignore = true;
    };
  }, []);

  const roleBasedAdmin = useMemo(
    () =>
      hasDirectorPrivileges(authUser, {
        roles: readJwtRoles(),
      }),
    [authUser]
  );

  useEffect(() => {
    let ignore = false;
    if (roleBasedAdmin) {
      setAdminProbeAllowed(true);
      return () => {
        ignore = true;
      };
    }

    async function probe() {
      try {
        const res = await fetch(`${API}/admin/overview`, { headers: authHeaders(false) });
        if (!ignore) setAdminProbeAllowed(res.ok);
      } catch {
        if (!ignore) setAdminProbeAllowed(false);
      }
    }

    probe();
    return () => {
      ignore = true;
    };
  }, [roleBasedAdmin]);

  const isAdmin = roleBasedAdmin || adminProbeAllowed;

  const seasonsInData = useMemo(() => {
    const values = new Set();
    newsletters.forEach((n) => n?.season && values.add(n.season));
    return Array.from(values).sort();
  }, [newsletters]);

  const yearsInData = useMemo(() => {
    const values = new Set();
    newsletters.forEach((n) => n?.year && values.add(String(n.year)));
    return Array.from(values).sort((a, b) => Number(b) - Number(a));
  }, [newsletters]);

  const filtered = useMemo(() => {
    return newsletters
      .filter((n) => (season ? String(n?.season).toLowerCase() === season.toLowerCase() : true))
      .filter((n) => (year ? String(n?.year) === String(year) : true))
      .sort((a, b) => {
        const y = Number(b.year) - Number(a.year);
        if (y !== 0) return y;
        return DEFAULT_SEASONS.indexOf(String(b.season || "")) - DEFAULT_SEASONS.indexOf(String(a.season || ""));
      });
  }, [newsletters, season, year]);

  const requestCloseUploadModal = useCallback(() => {
    if (uploadBusy) return;
    setUploadOpen(false);
  }, [uploadBusy]);

  useEffect(() => {
    if (!uploadOpen) return;
    const onEsc = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      requestCloseUploadModal();
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [uploadOpen, requestCloseUploadModal]);

  function handleDeleted(id) {
    setNewsletters((prev) => prev.filter((x) => (x._id || x.id) !== id));
  }

  const subtitleText = `Seasonal PDF newsletter for the ${networkDisplayName} community.`;

  return (
    <>
      <CedarBackground behavior="fixed" opacity={0.9} zIndex={0} />

      <main className="cc-wrap nav2-page-shell">
        <CedarPageHeader
          icon={<Newspaper size={18} />}
          title={`The ${newsletterLabel}`}
          subtitle={subtitleText}
        >
          <div className="cc-header-tools">
            <div className="cc-filters" role="group" aria-label="Filter newsletters">
              <label className="cc-filter">
                <div className="cc-filter-label">Season</div>
                <select
                  className={season ? "active" : ""}
                  value={season}
                  onChange={(event) => setSeason(event.target.value)}
                >
                  <option value="">All</option>
                  {DEFAULT_SEASONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                  {seasonsInData
                    .filter((s) => !DEFAULT_SEASONS.includes(s))
                    .map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                </select>
              </label>

              <label className="cc-filter">
                <div className="cc-filter-label">Year</div>
                <select
                  className={year ? "active" : ""}
                  value={year}
                  onChange={(event) => setYear(event.target.value)}
                >
                  <option value="">All</option>
                  {yearsInData.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {isAdmin && (
              <button
                type="button"
                className="cc-btn cc-btn-primary cc-upload-trigger"
                onClick={() => setUploadOpen(true)}
              >
                <Upload size={15} />
                Upload Issue
              </button>
            )}
          </div>
        </CedarPageHeader>

        {loading && (
          <section className="cc-grid" aria-label="Loading newsletters">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((idx) => (
              <article key={idx} className="cc-card cc-skel" aria-hidden="true">
                <div className="cc-skel-cover" />
                <div className="cc-skel-title" />
                <div className="cc-skel-date" />
              </article>
            ))}
          </section>
        )}

        {err && !loading && <div className="cc-error">Couldn’t load newsletters: {err}</div>}

        {!loading && !err && (
          <section className="cc-grid" aria-label="Newsletter gallery">
            {filtered.length === 0 ? (
              <div className="cc-empty">
                <FileText size={36} className="cc-empty-icon" />
                <h3 className="cc-empty-title">No newsletters found</h3>
                <p className="cc-empty-text">
                  {season || year
                    ? "Try changing your season or year filter."
                    : "No newsletters have been published yet."}
                </p>
                {(season || year) && (
                  <button
                    type="button"
                    className="cc-btn"
                    onClick={() => {
                      setSeason("");
                      setYear("");
                    }}
                  >
                    Clear filters
                  </button>
                )}
              </div>
            ) : (
              filtered.map((n, index) => (
                <NewsletterCard
                  key={n._id || n.id}
                  item={n}
                  newsletterLabel={newsletterLabel}
                  isAdmin={isAdmin}
                  onDeleted={handleDeleted}
                  index={index}
                />
              ))
            )}
          </section>
        )}
      </main>

      {isAdmin && uploadOpen && (
        <div
          className="cc-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cc-upload-modal-title"
          onClick={requestCloseUploadModal}
        >
          <div className="cc-modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="cc-modal-head">
              <h2 id="cc-upload-modal-title">Upload New Issue</h2>
              <button
                type="button"
                className="cc-modal-close"
                onClick={requestCloseUploadModal}
                disabled={uploadBusy}
                aria-label="Close upload modal"
              >
                <X size={16} />
              </button>
            </div>

            <AdminUpload
              newsletterLabel={newsletterLabel}
              onBusyChange={setUploadBusy}
              onCancel={requestCloseUploadModal}
              onUploaded={(created) => {
                setNewsletters((prev) => [created, ...prev]);
                setUploadOpen(false);
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}

// ===== card =====
function NewsletterCard({ item, newsletterLabel, isAdmin, onDeleted, index = 0 }) {
  const id = item?._id || item?.id;
  const title = item?.title || `${item?.season || ""} ${item?.year || ""} ${newsletterLabel}`.trim();
  const pdfUrl = String(item?.pdfUrl || item?.url || item?.fileUrl || "").trim();
  const coverImageUrl = String(item?.coverImageUrl || "").trim();
  const created = item?.createdAt || item?.created_at;
  const [opening, setOpening] = useState(false);
  const [coverBroken, setCoverBroken] = useState(false);
  const [openErr, setOpenErr] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [delErr, setDelErr] = useState("");

  useEffect(() => {
    setCoverBroken(false);
  }, [coverImageUrl]);

  async function handleOpenPdf() {
    if (!pdfUrl || opening || deleting) return;
    setOpening(true);
    setOpenErr("");
    try {
      if (/\/uploads\/object(?:\?|$)/.test(pdfUrl)) {
        openInNewTab(pdfUrl);
        return;
      }
      const token = String(getToken() || "").trim();
      const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
      let res;
      try {
        res = await fetch(pdfUrl, {
          headers,
          credentials: "include",
        });
      } catch {
        // R2 download redirects can fail CORS for fetch/blob; open directly instead.
        openInNewTab(pdfUrl);
        return;
      }
      if (!res?.ok) {
        throw new Error(res?.status === 401 ? "Your session expired. Please sign in again." : "Failed to load PDF.");
      }

      const blob = await res.blob();
      if (!blob || !blob.size) throw new Error("PDF file is empty.");
      const objectUrl = URL.createObjectURL(blob);
      openInNewTab(objectUrl);
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (error) {
      setOpenErr(String(error?.message || "Failed to load PDF."));
      window.setTimeout(() => setOpenErr(""), 4500);
    } finally {
      setOpening(false);
    }
  }

  async function handleDelete(event) {
    event.stopPropagation();
    if (!isAdmin || !id || deleting) return;
    if (!window.confirm("Delete this newsletter? This cannot be undone.")) return;

    setDeleting(true);
    setDelErr("");
    try {
      const res = await fetch(`${API}/newsletters/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) {
        throw new Error(await parseApiError(res, "Delete failed"));
      }
      onDeleted?.(id);
    } catch (error) {
      setDelErr(String(error?.message || "Delete failed"));
      window.setTimeout(() => setDelErr(""), 4000);
    } finally {
      setDeleting(false);
    }
  }

  const clickable = Boolean(pdfUrl) && !deleting;

  return (
    <article
      className={`cc-card ${clickable ? "is-clickable" : ""}`.trim()}
      style={{ animationDelay: `${index * 0.03}s` }}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? handleOpenPdf : undefined}
      onKeyDown={
        clickable
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                handleOpenPdf();
              }
            }
          : undefined
      }
      aria-busy={opening || deleting}
      aria-label={clickable ? `Open ${title} PDF` : undefined}
    >
      <div className="cc-cover">
        {coverImageUrl && !coverBroken ? (
          <img
            src={coverImageUrl}
            alt={`${title} cover`}
            className="cc-cover-image"
            loading="lazy"
            onError={() => setCoverBroken(true)}
          />
        ) : (
          <div className={`cc-cover-fallback ${seasonClassName(item?.season)}`.trim()}>
            <div className="cc-cover-fallback-season">{String(item?.season || "Newsletter")}</div>
            <div className="cc-cover-fallback-year">{String(item?.year || "")}</div>
          </div>
        )}
      </div>

      <div className="cc-card-caption">
        <div className="cc-card-meta">
          <span className={`cc-chip ${seasonClassName(item?.season)}`.trim()}>{item?.season || "Issue"}</span>
          <span className="cc-year">{item?.year || ""}</span>
          {isAdmin && (
            <button
              type="button"
              className={`cc-card-delete${deleting ? " busy" : ""}`}
              onClick={handleDelete}
              disabled={deleting}
              aria-disabled={deleting}
              title="Delete newsletter"
            >
              {deleting ? "Deleting..." : "Delete"}
            </button>
          )}
        </div>

        <h3 className="cc-card-title">{title}</h3>
        {created && <div className="cc-card-date">Published {fmtDate(created)}</div>}
        {opening && <div className="cc-card-status">Opening PDF...</div>}
        {!pdfUrl && <div className="cc-miss">PDF missing</div>}
        {!!openErr && <div className="cc-error small">{openErr}</div>}
        {!!delErr && <div className="cc-error small">{delErr}</div>}
      </div>
    </article>
  );
}

// ===== admin upload form =====
function AdminUpload({ onUploaded, onBusyChange, onCancel, newsletterLabel = "Newsletter" }) {
  const [title, setTitle] = useState("");
  const [season, setSeason] = useState("");
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [pdf, setPdf] = useState(null);
  const [coverImage, setCoverImage] = useState(null);
  const [coverPreviewUrl, setCoverPreviewUrl] = useState("");
  const [coverMeta, setCoverMeta] = useState({ width: 0, height: 0 });
  const [coverZoom, setCoverZoom] = useState(1);
  const [coverOffsetX, setCoverOffsetX] = useState(0);
  const [coverOffsetY, setCoverOffsetY] = useState(0);
  const [emailToNetwork, setEmailToNetwork] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const fileRef = useRef(null);
  const coverRef = useRef(null);

  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  useEffect(
    () => () => {
      onBusyChange?.(false);
    },
    [onBusyChange]
  );

  useEffect(() => {
    if (!coverImage) {
      setCoverPreviewUrl("");
      setCoverMeta({ width: 0, height: 0 });
      return;
    }

    const url = URL.createObjectURL(coverImage);
    setCoverPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [coverImage]);

  useEffect(() => {
    if (!coverPreviewUrl) return undefined;
    let active = true;
    const image = new Image();
    image.onload = () => {
      if (!active) return;
      setCoverMeta({
        width: Number(image.naturalWidth || 0),
        height: Number(image.naturalHeight || 0),
      });
    };
    image.src = coverPreviewUrl;
    return () => {
      active = false;
    };
  }, [coverPreviewUrl]);

  useEffect(() => {
    setCoverZoom(1);
    setCoverOffsetX(0);
    setCoverOffsetY(0);
  }, [coverImage]);

  const coverPreviewLayout = useMemo(() => {
    const sourceW = Number(coverMeta.width || 0);
    const sourceH = Number(coverMeta.height || 0);
    if (!sourceW || !sourceH) return null;
    const baseScale = Math.max(COVER_PREVIEW_WIDTH / sourceW, COVER_PREVIEW_HEIGHT / sourceH);
    const scaledW = sourceW * baseScale * coverZoom;
    const scaledH = sourceH * baseScale * coverZoom;
    const maxShiftX = Math.max(0, (scaledW - COVER_PREVIEW_WIDTH) / 2);
    const maxShiftY = Math.max(0, (scaledH - COVER_PREVIEW_HEIGHT) / 2);
    const shiftX = (coverOffsetX / 100) * maxShiftX;
    const shiftY = (coverOffsetY / 100) * maxShiftY;
    return {
      width: scaledW,
      height: scaledH,
      left: (COVER_PREVIEW_WIDTH - scaledW) / 2 + shiftX,
      top: (COVER_PREVIEW_HEIGHT - scaledH) / 2 + shiftY,
    };
  }, [coverMeta.height, coverMeta.width, coverOffsetX, coverOffsetY, coverZoom]);

  const buildCoverUploadFile = useCallback(async () => {
    if (!coverImage) return null;
    try {
      const image = await readFileAsImage(coverImage);
      const sourceW = Number(image.naturalWidth || 0);
      const sourceH = Number(image.naturalHeight || 0);
      if (!sourceW || !sourceH) return coverImage;

      const baseScale = Math.max(COVER_EXPORT_WIDTH / sourceW, COVER_EXPORT_HEIGHT / sourceH);
      const scaledW = sourceW * baseScale * coverZoom;
      const scaledH = sourceH * baseScale * coverZoom;
      const maxShiftX = Math.max(0, (scaledW - COVER_EXPORT_WIDTH) / 2);
      const maxShiftY = Math.max(0, (scaledH - COVER_EXPORT_HEIGHT) / 2);
      const shiftX = (coverOffsetX / 100) * maxShiftX;
      const shiftY = (coverOffsetY / 100) * maxShiftY;

      const canvas = document.createElement("canvas");
      canvas.width = COVER_EXPORT_WIDTH;
      canvas.height = COVER_EXPORT_HEIGHT;
      const ctx = canvas.getContext("2d");
      if (!ctx) return coverImage;

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, COVER_EXPORT_WIDTH, COVER_EXPORT_HEIGHT);
      ctx.drawImage(
        image,
        (COVER_EXPORT_WIDTH - scaledW) / 2 + shiftX,
        (COVER_EXPORT_HEIGHT - scaledH) / 2 + shiftY,
        scaledW,
        scaledH
      );

      const blob = await canvasToBlob(canvas, "image/jpeg", 0.92);
      if (!blob) return coverImage;
      const rawName = String(coverImage.name || "cover").replace(/\.[^.]+$/, "");
      return new File([blob], `${rawName}-cover.jpg`, { type: "image/jpeg" });
    } catch {
      return coverImage;
    }
  }, [coverImage, coverOffsetX, coverOffsetY, coverZoom]);

  async function handleSubmit(event) {
    event.preventDefault();
    if (!pdf) {
      setMsg("Please choose a PDF.");
      return;
    }
    if (!coverImage) {
      setMsg("Please choose a cover image (JPG, PNG, or WEBP).");
      return;
    }
    if (!season || !year) {
      setMsg("Season and year are required.");
      return;
    }

    setBusy(true);
    setMsg("");
    let timeoutMs = 3000;

    try {
      const fd = new FormData();
      if (title) fd.append("title", title);
      fd.append("season", season);
      fd.append("year", String(year));
      fd.append("emailToNetwork", String(emailToNetwork));
      fd.append("file", pdf);
      const preparedCoverImage = await buildCoverUploadFile();
      fd.append("coverImage", preparedCoverImage || coverImage);

      const res = await fetch(`${API}/newsletters`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken()}` },
        body: fd,
      });
      if (!res.ok) {
        throw new Error(await parseApiError(res, "Upload failed"));
      }

      const created = await res.json();
      const delivery = created?.emailDelivery || null;
      if (delivery?.requested) {
        timeoutMs = 6000;
        if (delivery.status === "sent") {
          setMsg(`Uploaded and emailed to ${Number(delivery?.sent || 0)} members.`);
        } else if (delivery.status === "partial_failure") {
          setMsg(
            `Uploaded. Email sent to ${Number(delivery?.sent || 0)} members with ${Number(delivery?.failed || 0)} failures.`
          );
        } else if (delivery.status === "skipped_no_recipients") {
          setMsg("Uploaded. No member emails were found, so no broadcast was sent.");
        } else if (delivery.status === "failed") {
          setMsg(`Uploaded. Email delivery failed: ${delivery.message || "Unknown error."}`);
        } else {
          setMsg("Uploaded.");
        }
      } else {
        setMsg("Uploaded!");
      }

      setTitle("");
      setSeason("");
      setYear(String(new Date().getFullYear()));
      setPdf(null);
      setCoverImage(null);
      if (fileRef.current) fileRef.current.value = "";
      if (coverRef.current) coverRef.current.value = "";
      setEmailToNetwork(false);
      onUploaded?.(created);
    } catch (error) {
      setMsg(String(error?.message || "Upload failed"));
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(""), timeoutMs);
    }
  }

  return (
    <form className="cc-admin-form" onSubmit={handleSubmit}>
      <div className="cc-row">
        <label>Title (optional)</label>
        <input
          type="text"
          placeholder={`Fall ${new Date().getFullYear()} ${newsletterLabel}`}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>

      <div className="cc-row cc-row-2">
        <div>
          <label>Season</label>
          <select value={season} onChange={(event) => setSeason(event.target.value)}>
            <option value="">Select...</option>
            {DEFAULT_SEASONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label>Year</label>
          <input
            type="number"
            min="1900"
            max="2100"
            value={year}
            onChange={(event) => setYear(event.target.value)}
          />
        </div>
      </div>

      <div className="cc-form-divider" />

      <div className="cc-row">
        <label>PDF File</label>
        <div className="cc-file-upload">
          <button type="button" className="cc-file-btn" onClick={() => fileRef.current?.click()}>
            Choose PDF
          </button>
          <span className="cc-file-name">{pdf ? pdf.name : "No file selected"}</span>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf"
            hidden
            onChange={(event) => setPdf(event.target.files?.[0] || null)}
          />
        </div>
      </div>

      <div className="cc-row">
        <label>Cover Image (required)</label>
        <div className="cc-file-upload">
          <button type="button" className="cc-file-btn" onClick={() => coverRef.current?.click()}>
            Choose Cover
          </button>
          <span className="cc-file-name">{coverImage ? coverImage.name : "JPG, PNG, or WEBP"}</span>
          <input
            ref={coverRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            onChange={(event) => setCoverImage(event.target.files?.[0] || null)}
          />
        </div>

        {coverPreviewUrl ? (
          <div className="cc-cover-preview-wrap">
            <div className="cc-cover-preview-stage">
              <img
                src={coverPreviewUrl}
                alt="Selected cover preview"
                className="cc-cover-preview-image"
                style={
                  coverPreviewLayout
                    ? {
                        width: `${coverPreviewLayout.width}px`,
                        height: `${coverPreviewLayout.height}px`,
                        left: `${coverPreviewLayout.left}px`,
                        top: `${coverPreviewLayout.top}px`,
                      }
                    : undefined
                }
              />
            </div>
            <div className="cc-cover-controls" aria-label="Cover image controls">
              <label className="cc-cover-control">
                <span>Zoom</span>
                <input
                  type="range"
                  min="100"
                  max="300"
                  step="1"
                  value={Math.round(coverZoom * 100)}
                  onChange={(event) => setCoverZoom(Number(event.target.value) / 100)}
                />
              </label>
              <label className="cc-cover-control">
                <span>Shift Left/Right</span>
                <input
                  type="range"
                  min="-100"
                  max="100"
                  step="1"
                  value={coverOffsetX}
                  onChange={(event) => setCoverOffsetX(Number(event.target.value))}
                />
              </label>
              <label className="cc-cover-control">
                <span>Shift Up/Down</span>
                <input
                  type="range"
                  min="-100"
                  max="100"
                  step="1"
                  value={coverOffsetY}
                  onChange={(event) => setCoverOffsetY(Number(event.target.value))}
                />
              </label>
              <button
                type="button"
                className="cc-file-btn"
                onClick={() => {
                  setCoverZoom(1);
                  setCoverOffsetX(0);
                  setCoverOffsetY(0);
                }}
              >
                Reset Cover Framing
              </button>
            </div>
          </div>
        ) : (
          <div className="cc-cover-preview-empty">Cover preview appears here</div>
        )}
      </div>

      <div className="cc-row">
        <label className="cc-inline-check">
          <input
            type="checkbox"
            checked={emailToNetwork}
            onChange={(event) => setEmailToNetwork(event.target.checked)}
          />
          <span>Email to all members</span>
        </label>
        <p className="cc-check-help">PDF will be attached to the email.</p>
      </div>

      <div className="cc-actions">
        <button type="button" className="cc-btn cc-btn-ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>

        <button type="submit" className="cc-submit-btn" disabled={busy}>
          {busy ? (
            <>
              <span className="cc-spinner" aria-hidden="true" />
              Uploading...
            </>
          ) : (
            "Upload Issue"
          )}
        </button>
      </div>

      {msg && <span className="cc-msg">{msg}</span>}
    </form>
  );
}
