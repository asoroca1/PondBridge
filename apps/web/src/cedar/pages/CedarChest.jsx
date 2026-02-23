import React, { useEffect, useMemo, useState } from "react";
import { useTenant } from "../../context/TenantContext.jsx";
import {
  resolveNetworkDisplayName,
  resolveNewsletterLabel
} from "../../lib/campLabels.js";
import CedarBackground from "../components/CedarBackground";
import { API_BASE } from "../lib/api";
import { getToken, authHeaders, fmtDate } from "../lib/helpers.js";
import "./cedar-chest.css";
import { Newspaper } from "lucide-react";


const API = API_BASE;

// ===== config =====
// Temporary: single-account admin allow-list
const ADMIN_EMAILS = [
  "aden@sorocafamily.com", // change/remove as needed
];

// ===== main page =====
export default function CedarChest() {
  const { tenant } = useTenant();
  const [newsletters, setNewsletters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [season, setSeason] = useState("");
  const [year, setYear] = useState("");
  const [me, setMe] = useState(null);
  const [subEmail, setSubEmail] = useState("");
  const [subMsg, setSubMsg] = useState("");
  const networkDisplayName = resolveNetworkDisplayName(tenant);
  const newsletterLabel = resolveNewsletterLabel(tenant);

  // Fetch current user (for admin check)
  useEffect(() => {
    let ignore = false;
    async function run() {
      try {
        const res = await fetch(`${API}/me`, { headers: authHeaders() });
        if (!res.ok) throw new Error("Failed to load user");
        const j = await res.json();
        if (!ignore) setMe(j);
      } catch {
        if (!ignore) setMe(null); // not signed in is fine
      }
    }
    run();
    return () => {
      ignore = true;
    };
  }, []);

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
          setNewsletters(Array.isArray(j) ? j : j?.items ?? []);
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

  // Admin check
  const isAdmin = useMemo(() => {
    const email = me?.email || me?.user?.email || me?.profile?.email;
    return email ? ADMIN_EMAILS.includes(email.toLowerCase()) : false;
  }, [me]);

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
      .filter((n) =>
        season ? String(n?.season).toLowerCase() === season.toLowerCase() : true
      )
      .filter((n) => (year ? String(n?.year) === String(year) : true))
      .sort((a, b) => {
        // newest (by year desc, then typical season order) first:
        const y = Number(b.year) - Number(a.year);
        if (y !== 0) return y;
        const order = ["Winter", "Spring", "Summer", "Fall"];
        return order.indexOf(b.season) - order.indexOf(a.season);
      });
  }, [newsletters, season, year]);

  // Subscribe UI (front-end only for now)
  function handleSubscribe(e) {
    e.preventDefault();
    if (!subEmail || !/\S+@\S+\.\S+/.test(subEmail)) {
      setSubMsg("Please enter a valid email.");
      return;
    }
    // UI only; later: POST to /api/subscribe
    setSubMsg(`Thanks! You’ll get the next ${newsletterLabel} in your inbox.`);
    setTimeout(() => setSubMsg(""), 3000);
    setSubEmail("");
  }

  // remove from state when deleted
  function handleDeleted(id) {
    setNewsletters((prev) => prev.filter((x) => (x._id || x.id) !== id));
  }

  return (
    <>
      {/* background visible; keep as you last set it */}
      <CedarBackground behavior="fixed" opacity={0.9} zIndex={0} />
      <main className="cc-wrap nav2-page-shell">
      <header className="cc-header">
        <div className="cc-head-left">
            <div className="cc-title-row">
            <span className="cc-title-icon"><Newspaper size={18} /></span>
            <h1 className="cc-title">{`The ${newsletterLabel}`}</h1>
            </div>
            <p className="cc-subtitle">{`Seasonal PDF newsletter for the ${networkDisplayName} community.`}</p>
        </div>

        <div className="cc-filters" role="group" aria-label="Filter newsletters">
            <label className="cc-filter">
            <div className="cc-filter-label">Season</div>
            <select value={season} onChange={(e)=>setSeason(e.target.value)}>
                <option value="">All</option>
                {["Winter","Spring","Summer","Fall"].map(s => (
                <option key={s} value={s}>{s}</option>
                ))}
                {seasonsInData
                .filter(s => !["Winter","Spring","Summer","Fall"].includes(s))
                .map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            </label>
            <label className="cc-filter">
            <div className="cc-filter-label">Year</div>
            <select value={year} onChange={(e)=>setYear(e.target.value)}>
                <option value="">All</option>
                {yearsInData.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            </label>
        </div>
        </header>


        {/* TWO-COLUMN GRID */}
        <section className="cc-layout">
          {/* LEFT: newsletter stream OR status — this column is the anchor for alignment */}
          <div className="cc-left">
            {loading && <div className="cc-status">Loading newsletters…</div>}
            {err && !loading && (
              <div className="cc-error">Couldn’t load newsletters: {err}</div>
            )}

            {!loading && !err && (
              <section className="cc-list">
                {filtered.length === 0 ? (
                  <div className="cc-empty">No newsletters match your filters.</div>
                ) : (
                  filtered.map((n) => (
                    <NewsletterCard
                      key={n._id || n.id}
                      item={n}
                      newsletterLabel={newsletterLabel}
                      isAdmin={isAdmin}
                      onDeleted={handleDeleted}
                    />
                  ))
                )}
              </section>
            )}
          </div>

          {/* RIGHT: subscribe (top) + admin (below) */}
          <aside className="cc-right">
            <div className="cc-rail">
              {/*<section className="cc-subscribe">
                <h2>{`Get the ${newsletterLabel} by Email`}</h2>
                <form onSubmit={handleSubscribe} className="cc-sub-form">
                  <input
                    type="email"
                    placeholder="your@email.com"
                    value={subEmail}
                    onChange={(e) => setSubEmail(e.target.value)}
                    aria-label="Email address"
                  />
                  <button type="submit">Subscribe</button>
                  </form>
                {!!subMsg && <div className="cc-sub-msg">{subMsg}</div>}
              </section>*/}
              {isAdmin && (
                <section className="cc-admin">
                  <h2>{`Upload New ${newsletterLabel} (Admin)`}</h2>
                  <AdminUpload
                    compact
                    newsletterLabel={newsletterLabel}
                    onUploaded={(created) => {
                      setNewsletters((prev) => [created, ...prev]);
                    }}
                  />
                </section>
              )}
            </div>
          </aside>
        </section>
      </main>
    </>
  );
}

// ===== card =====
function NewsletterCard({ item, newsletterLabel, isAdmin, onDeleted }) {
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
    <article className="cc-card">
      <div className="cc-card-meta">
        <div className="cc-chip">{item?.season}</div>
        <div className="cc-year">{item?.year}</div>
      </div>

      <h3 className="cc-card-title">{title}</h3>
      {created && <div className="cc-card-date">Published {fmtDate(created)}</div>}

      <div className="cc-card-actions">
        {pdfUrl ? (
          <a className="cc-btn" href={pdfUrl} target="_blank" rel="noreferrer">
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
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

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
    try {
      const fd = new FormData();
      if (title) fd.append("title", title);
      fd.append("season", season);
      fd.append("year", String(year));
      fd.append("file", pdf);

      const res = await fetch(`${API}/newsletters`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken()}` },
        body: fd,
      });
      if (!res.ok) throw new Error((await res.text()) || "Upload failed");
      const created = await res.json();
      setMsg("Uploaded!");
      setTitle("");
      setSeason("");
      setYear(new Date().getFullYear());
      setPdf(null);
      onUploaded?.(created);
    } catch (e) {
      setMsg(e.message || "Upload failed");
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(""), 3000);
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

      <div className="cc-row">
        <label>PDF File</label>
        <input
          type="file"
          accept="application/pdf"
          onChange={(e) => setPdf(e.target.files?.[0] || null)}
        />
      </div>

      <div className="cc-actions">
        <button type="submit" disabled={busy}>
          {busy ? "Uploading…" : "Upload Newsletter"}
        </button>
        {msg && <span className="cc-msg">{msg}</span>}
      </div>

      {!compact && (
        <p className="cc-note">
          This panel is visible only to the admin email(s). Regular users won’t see it.
        </p>
      )}
    </form>
  );

  if (compact) return Form;

  // non-compact legacy rendering (kept for reuse elsewhere if needed)
  return (
    <section className="cc-admin">
      <h2>{`Upload New ${newsletterLabel} (Admin)`}</h2>
      {Form}
    </section>
  );
}
