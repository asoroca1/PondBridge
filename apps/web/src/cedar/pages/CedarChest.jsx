import { useEffect, useMemo, useRef, useState } from "react";
import { useTenant } from "../../context/TenantContext.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { resolveNetworkDisplayName, resolveNewsletterLabel } from "../../lib/campLabels.js";
import CedarBackground from "../components/CedarBackground";
import CedarPageHeader from "../components/CedarPageHeader.jsx";
import { API_BASE } from "../lib/api";
import { getToken, authHeaders, fmtDate } from "../lib/helpers.js";
import "./cedar-chest.css";
import { FileText, Newspaper } from "lucide-react";

const API = API_BASE;

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
  const networkDisplayName = resolveNetworkDisplayName(tenant);
  const newsletterLabel = resolveNewsletterLabel(tenant);

  // Fetch newsletters
  useEffect(() => {
    let ignore = false;
    async function run() {
      setLoading(true);
      setErr("");
      try {
        const res = await fetch(`${API}/newsletters`, {
          headers: authHeaders(),
        });
        if (!res.ok) throw new Error("Failed to load newsletters");
        const j = await res.json();
        if (!ignore) {
          setNewsletters(Array.isArray(j) ? j : (j?.items ?? []));
        }
      } catch (e) {
        if (!ignore) setErr(e.message || "Error");
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

  // Fallback permission probe keeps admin UI available even if local role payload is stale.
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

  // Distinct season/year options from data
  const seasonsInData = useMemo(() => {
    const s = new Set();
    newsletters.forEach((n) => n?.season && s.add(n.season));
    return Array.from(s).sort();
  }, [newsletters]);

  const yearsInData = useMemo(() => {
    const s = new Set();
    newsletters.forEach((n) => n?.year && s.add(String(n.year)));
    return Array.from(s).sort((a, b) => Number(b) - Number(a)); // newest first
  }, [newsletters]);

  // Client-side filtering
  const filtered = useMemo(() => {
    return newsletters
      .filter((n) => (season ? String(n?.season).toLowerCase() === season.toLowerCase() : true))
      .filter((n) => (year ? String(n?.year) === String(year) : true))
      .sort((a, b) => {
        // newest (by year desc, then typical season order) first:
        const y = Number(b.year) - Number(a.year);
        if (y !== 0) return y;
        const order = ["Winter", "Spring", "Summer", "Fall"];
        return order.indexOf(b.season) - order.indexOf(a.season);
      });
  }, [newsletters, season, year]);

  // remove from state when deleted
  function handleDeleted(id) {
    setNewsletters((prev) => prev.filter((x) => (x._id || x.id) !== id));
  }

  const subtitleText = newsletters.length
    ? `${filtered.length} of ${newsletters.length} issues in the archive`
    : `Seasonal PDF newsletter for the ${networkDisplayName} community.`;

  return (
    <>
      {/* background visible; keep as you last set it */}
      <CedarBackground behavior="fixed" opacity={0.9} zIndex={0} />
      <main className="cc-wrap nav2-page-shell">
        <CedarPageHeader
          icon={<Newspaper size={18} />}
          title={`The ${newsletterLabel}`}
          subtitle={subtitleText}
        >
          <div className="cc-filters" role="group" aria-label="Filter newsletters">
            <label className="cc-filter">
              <div className="cc-filter-label">Season</div>
              <select
                className={season ? "active" : ""}
                value={season}
                onChange={(e) => setSeason(e.target.value)}
              >
                <option value="">All</option>
                {["Winter", "Spring", "Summer", "Fall"].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
                {seasonsInData
                  .filter((s) => !["Winter", "Spring", "Summer", "Fall"].includes(s))
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
                onChange={(e) => setYear(e.target.value)}
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
        </CedarPageHeader>

        {/* TWO-COLUMN GRID */}
        <section className={`cc-layout${isAdmin ? "" : " cc-layout-single"}`}>
          {/* LEFT: newsletter stream OR status — this column is the anchor for alignment */}
          <div className="cc-left">
            {loading && (
              <section className="cc-list">
                {[0, 1, 2].map((idx) => (
                  <article key={idx} className="cc-card cc-skel">
                    <div className="cc-skel-chip" />
                    <div className="cc-skel-title" />
                    <div className="cc-skel-date" />
                    <div className="cc-skel-btn" />
                  </article>
                ))}
              </section>
            )}
            {err && !loading && <div className="cc-error">Couldn’t load newsletters: {err}</div>}

            {!loading && !err && (
              <section className="cc-list">
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
          </div>

          {/* RIGHT: subscribe (top) + admin (below) */}
          {isAdmin && (
            <aside className="cc-right">
              <div className="cc-rail">
                <section className="cc-admin">
                  <h2>Publish New Issue</h2>
                  <AdminUpload
                    compact
                    newsletterLabel={newsletterLabel}
                    onUploaded={(created) => {
                      setNewsletters((prev) => [created, ...prev]);
                    }}
                  />
                </section>
              </div>
            </aside>
          )}
        </section>
      </main>
    </>
  );
}

// ===== card =====
function NewsletterCard({ item, newsletterLabel, isAdmin, onDeleted, index = 0 }) {
  const id = item?._id || item?.id;
  const title =
    item?.title || `${item?.season || ""} ${item?.year || ""} ${newsletterLabel}`.trim();
  const pdfUrl = item?.pdfUrl || item?.url || item?.fileUrl;
  const created = item?.createdAt || item?.created_at;

  const [deleting, setDeleting] = useState(false);
  const [delErr, setDelErr] = useState("");

  async function handleDelete() {
    if (!isAdmin || !id) return;
    if (!window.confirm("Delete this newsletter? This cannot be undone.")) return;
    setDeleting(true);
    setDelErr("");
    try {
      const res = await fetch(`${API}/newsletters/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || "Delete failed");
      }
      onDeleted?.(id);
    } catch (e) {
      setDelErr(e.message || "Delete failed");
      setTimeout(() => setDelErr(""), 4000);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <article className="cc-card" style={{ animationDelay: `${index * 0.04}s` }}>
      <div className="cc-card-meta">
        <div className="cc-chip" data-season={item?.season}>
          {item?.season}
        </div>
        <div className="cc-year">{item?.year}</div>
      </div>

      <h3 className="cc-card-title">{title}</h3>
      {created && <div className="cc-card-date">Published {fmtDate(created)}</div>}

      <div className="cc-card-actions">
        {pdfUrl ? (
          <a className="cc-btn cc-btn-primary" href={pdfUrl} target="_blank" rel="noreferrer">
            <FileText size={14} />
            View PDF
          </a>
        ) : (
          <span className="cc-miss">PDF missing</span>
        )}

        {isAdmin && (
          <button
            className={`cc-btn danger${deleting ? " busy" : ""}`}
            onClick={handleDelete}
            disabled={deleting}
            aria-disabled={deleting}
            title="Delete newsletter"
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        )}
      </div>

      {!!delErr && <div className="cc-error small">{delErr}</div>}
    </article>
  );
}

// ===== admin upload panel =====
function AdminUpload({ onUploaded, newsletterLabel = "Newsletter", compact = false }) {
  const [title, setTitle] = useState("");
  const [season, setSeason] = useState("");
  const [year, setYear] = useState(new Date().getFullYear());
  const [pdf, setPdf] = useState(null);
  const [emailToNetwork, setEmailToNetwork] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const fileRef = useRef(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!pdf) {
      setMsg("Please choose a PDF.");
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

      const res = await fetch(`${API}/newsletters`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken()}` },
        body: fd,
      });
      if (!res.ok) throw new Error((await res.text()) || "Upload failed");
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
      setYear(new Date().getFullYear());
      setPdf(null);
      if (fileRef.current) fileRef.current.value = "";
      setEmailToNetwork(false);
      onUploaded?.(created);
    } catch (e) {
      setMsg(e.message || "Upload failed");
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(""), timeoutMs);
    }
  }

  const Form = (
    <form className="cc-admin-form" onSubmit={handleSubmit}>
      <div className="cc-row">
        <label>Title (optional)</label>
        <input
          type="text"
          placeholder={`Fall ${new Date().getFullYear()} ${newsletterLabel}`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      <div className="cc-row cc-row-2">
        <div>
          <label>Season</label>
          <select value={season} onChange={(e) => setSeason(e.target.value)}>
            <option value="">Select…</option>
            {["Winter", "Spring", "Summer", "Fall"].map((s) => (
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
            value={year}
            onChange={(e) => setYear(e.target.value)}
            min="1900"
            max="2100"
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
            onChange={(e) => setPdf(e.target.files?.[0] || null)}
          />
        </div>
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
        <button type="submit" disabled={busy}>
          {busy ? (
            <>
              <span className="cc-spinner" aria-hidden="true" />
              Uploading...
            </>
          ) : (
            "Upload Issue"
          )}
        </button>
        {msg && <span className="cc-msg">{msg}</span>}
      </div>

      {!compact && (
        <p className="cc-note">
          This panel is visible only to directors/admins. Regular users won’t see it.
        </p>
      )}
    </form>
  );

  if (compact) return Form;

  // non-compact legacy rendering (kept for reuse elsewhere if needed)
  return (
    <section className="cc-admin">
      <h2>Publish New Issue</h2>
      {Form}
    </section>
  );
}
