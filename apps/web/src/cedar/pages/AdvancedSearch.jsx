// src/pages/AdvancedSearch.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import { useTenant } from "../../context/TenantContext.jsx";
import { resolveStaffRoleOptions } from "../../lib/campLabels.js";
import { API_BASE } from "../lib/api";
import CedarBackground from "../components/CedarBackground";
import defaultProfile from "../assets/default-profile.png";
import "./advanced-search.css";

/* ---------- helpers ---------- */
function pickCurrentJob(p = {}) {
  if (p.currentJob) {
    if (typeof p.currentJob === "string") {
      const [rawRole, rawCompany] = p.currentJob.split("@").map((s) => s?.trim());
      return { role: rawRole || "", company: rawCompany || "" };
    }
    if (typeof p.currentJob === "object" && p.currentJob !== null) {
      const role = p.currentJob.role || p.currentJob.title || p.currentJob.jobTitle || "";
      const company = p.currentJob.company || p.currentJob.organization || p.currentJob.org || "";
      if (role || company) return { role, company };
    }
  }
  const singleRole = p.currentJobTitle || p.jobTitle || p.title || p.currentRole || "";
  const singleCompany = p.currentCompany || p.company || "";
  const arr =
    (Array.isArray(p.currentJobs) && p.currentJobs) ||
    (Array.isArray(p.jobs) && p.jobs) ||
    (Array.isArray(p.employment) && p.employment) ||
    [];
  const j = arr.find((j) => j?.isCurrent || j?.current) ?? arr[0] ?? null;
  const arrayRole = j?.role || j?.title || "";
  const arrayCompany = j?.company || j?.organization || j?.org || "";
  return { role: singleRole || arrayRole || "", company: singleCompany || arrayCompany || "" };
}

const DEBOUNCE = 400;
function useDebounced(value, delay = DEBOUNCE) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

const parseList = (s) =>
  String(s || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

function RolesMultiSelect({ options, value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const selected = String(value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  useEffect(() => {
    const onDocClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const toggle = (opt) => {
    const has = selected.includes(opt);
    const next = has ? selected.filter((v) => v !== opt) : [...selected, opt];
    onChange(next.join(", "));
  };

  return (
    <div className="as2-mwrap" ref={ref}>
      {/* looks/spacing like .as2-input */}
      <div
        className={`as2-mselect ${open ? "is-open" : ""}`}
        role="button"
        tabIndex={0}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {selected.length ? (
          <div className="as2-tags">
            {selected.map((tag) => (
              <span
                key={tag}
                className="as2-tag"
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(tag);
                }}
              >
                {tag} <span className="x">×</span>
              </span>
            ))}
          </div>
        ) : (
          <span className="as2-placeholder">Select roles…</span>
        )}
        <span className="as2-caret">▾</span>
      </div>

      {open && (
        <div className="as2-menu" role="listbox">
          {options.map((opt) => (
            <label key={opt} className="as2-option">
              <input type="checkbox" checked={selected.includes(opt)} onChange={() => toggle(opt)} />
              <span>{opt}</span>
            </label>
          ))}
          {selected.length > 0 && (
            <button
              type="button"
              className="as2-btn as2-btn-ghost as2-menu-clear"
              onClick={() => onChange("")}
            >
              Clear roles
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function initials(first = "", last = "") {
  const f = first?.trim()[0] || "";
  const l = last?.trim()[0] || "";
  return (f + l).toUpperCase();
}

function getToken() {
  // prefer cedarToken, fall back to token
  return localStorage.getItem("cedarToken") || localStorage.getItem("token") || "";
}

/* =================== PAGE =================== */
export default function AdvancedSearch() {
  const { tenant } = useTenant();
  const staffRoleOptions = useMemo(() => resolveStaffRoleOptions(tenant), [tenant]);
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();

  const [form, setForm] = useState(() => ({
    q: params.get("q") || "",
    cedarRoles: params.get("cedarRoles") || "",
    industries: params.get("industries") || "",
    city: params.get("city") || "",
    state: params.get("state") || "",
    college: params.get("college") || "",
    gradMin: params.get("gradMin") || "",
    gradMax: params.get("gradMax") || "",

    // ✅ NEW: Camper year range
    camperMin: params.get("camperMin") || "",
    camperMax: params.get("camperMax") || "",

    role: params.get("role") || "",
    company: params.get("company") || "",
    sort: params.get("sort") || "name",
    offset: parseInt(params.get("offset") || "0", 10),
    limit: parseInt(params.get("limit") || "24", 10),
  }));
  const debounced = useDebounced(form);

  /* ---- FILTER GUARD ---- */
  const hasActiveFilters = useMemo(() => {
    const {
      q,
      cedarRoles,
      industries,
      city,
      state,
      college,
      gradMin,
      gradMax,
      camperMin,
      camperMax,
      role,
      company,
    } = debounced;

    return [q, cedarRoles, industries, city, state, college, gradMin, gradMax, camperMin, camperMax, role, company].some(
      (v) => String(v || "").trim() !== ""
    );
  }, [debounced]);

  const [ui, setUi] = useState({
    sections: {
      name: false,
      cedarRoles: false,
      industry: false,
      role: false,
      college: false,
      camperYears: false, // ✅ NEW
      location: false,
      company: false,
    },
  });

  const [state, setState] = useState({ loading: false, items: [], total: 0, error: null });

  // sync -> URL
  useEffect(() => {
    const p = new URLSearchParams();
    Object.entries(debounced).forEach(([k, v]) => {
      if (v !== "" && v !== null && v !== undefined) p.set(k, String(v));
    });
    setParams(p, { replace: true });
  }, [debounced, setParams]);

  // fetch (skips when no filters)
  useEffect(() => {
    let alive = true;

    if (!hasActiveFilters) {
      setState({ loading: false, items: [], total: 0, error: null });
      return () => {
        alive = false;
      };
    }

    (async () => {
      setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const qs = new URLSearchParams();
        Object.entries(debounced).forEach(([k, v]) => {
          if (v !== "" && v !== null && v !== undefined) qs.set(k, String(v));
        });

        const res = await fetch(`${API_BASE}/search/users?${qs.toString()}`, {
          headers: { Authorization: `Bearer ${getToken()}` },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!alive) return;
        setState({
          loading: false,
          items: Array.isArray(data.items) ? data.items : [],
          total: Number.isFinite(data.total) ? data.total : data.items?.length || 0,
          error: null,
        });
      } catch (err) {
        if (!alive) return;
        setState({ loading: false, items: [], total: 0, error: "Failed to load results." });
      }
    })();

    return () => {
      alive = false;
    };
  }, [debounced, hasActiveFilters]);

  // handlers
  const onField =
    (k) =>
    (e) => {
      const v = e?.target?.value ?? e;
      setForm((f) => ({ ...f, [k]: v, offset: 0 }));
    };

  const clearAll = () => {
    setForm({
      q: "",
      cedarRoles: "",
      industries: "",
      city: "",
      state: "",
      college: "",
      gradMin: "",
      gradMax: "",
      camperMin: "", // ✅ NEW
      camperMax: "", // ✅ NEW
      role: "",
      company: "",
      sort: "name",
      offset: 0,
      limit: 24,
    });
    setState({ loading: false, items: [], total: 0, error: null });
  };

  const toggle = (key) => setUi((s) => ({ ...s, sections: { ...s.sections, [key]: !s.sections[key] } }));

  // industries chip remove
  const industriesList = useMemo(() => parseList(form.industries), [form.industries]);
  const removeIndustry = (val) => {
    const next = industriesList.filter((x) => x.toLowerCase() !== String(val).toLowerCase());
    setForm((f) => ({ ...f, industries: next.join(", "), offset: 0 }));
  };

  // paging
  const page = Math.floor((form.offset || 0) / (form.limit || 24)) + 1;
  const pages = Math.max(1, Math.ceil((state.total || 0) / (form.limit || 24)));
  const nextPage = () => page < pages && setForm((f) => ({ ...f, offset: f.offset + f.limit }));
  const prevPage = () => page > 1 && setForm((f) => ({ ...f, offset: Math.max(0, f.offset - f.limit) }));
  const fromN = state.total ? form.offset + 1 : 0;
  const toN = state.total ? Math.min(form.offset + form.limit, state.total) : 0;

  const header = useMemo(() => (!form.q ? "Advanced Search" : `Results for “${form.q}”`), [form.q]);

  return (
    <div style={{ position: "relative", minHeight: "100vh" }}>
      {/* BACKGROUND */}
      <CedarBackground behavior="scroll" opacity={0.9} fixed zIndex={0} />

      {/* PAGE CONTENT */}
      <main className="as2 nav2-page-shell" style={{ position: "relative", zIndex: 1, background: "transparent" }}>
        <div className="as2-wrap">
          {/* LEFT RAIL */}
          <aside className="as2-rail">
            <div className="as2-rail-head">
              <h2>Advanced Search</h2>
              <button className="as2-btn as2-btn-ghost" onClick={clearAll}>
                Reset
              </button>
            </div>

            {/* Name */}
            <section className={`as2-sec ${ui.sections.name ? "open" : ""}`}>
              <button className="as2-sec-head" onClick={() => toggle("name")}>
                <span>Name</span>
                <i className="chev" />
              </button>
              <div className="as2-sec-body">
                <input className="as2-input" value={form.q} onChange={onField("q")} placeholder="e.g., Henry" />
              </div>
            </section>

            {/* Camp Roles */}
            <section className={`as2-sec ${ui.sections.cedarRoles ? "open" : ""}`}>
              <button className="as2-sec-head" onClick={() => toggle("cedarRoles")}>
                <span>Former/Current Role at Camp</span>
                <i className="chev" />
              </button>
              <div className="as2-sec-body">
                <RolesMultiSelect
                  options={staffRoleOptions}
                  value={form.cedarRoles}
                  onChange={(v) => setForm((f) => ({ ...f, cedarRoles: v, offset: 0 }))}
                />
              </div>
            </section>

                        {/* ✅ NEW: Camper Years */}
                        <section className={`as2-sec ${ui.sections.camperYears ? "open" : ""}`}>
              <button className="as2-sec-head" onClick={() => toggle("camperYears")}>
                <span>Camper Years</span>
                <i className="chev" />
              </button>
              <div className="as2-sec-body">
                <div className="as2-row">
                  <div className="as2-col">
                    <label className="as2-label">Min</label>
                    <input
                      className="as2-input"
                      type="number"
                      inputMode="numeric"
                      value={form.camperMin}
                      onChange={onField("camperMin")}
                      placeholder="year"
                    />
                  </div>
                  <div className="as2-col">
                    <label className="as2-label">Max</label>
                    <input
                      className="as2-input"
                      type="number"
                      inputMode="numeric"
                      value={form.camperMax}
                      onChange={onField("camperMax")}
                      placeholder="year"
                    />
                  </div>
                </div>
                <div className="as2-help muted" style={{ marginTop: 8 }}>
                </div>
              </div>
            </section>

            {/* Industry */}
            <section className={`as2-sec ${ui.sections.industry ? "open" : ""}`}>
              <button className="as2-sec-head" onClick={() => toggle("industry")}>
                <span>Industry</span>
                <i className="chev" />
              </button>
              <div className="as2-sec-body">
                <input
                  className="as2-input"
                  value={form.industries}
                  onChange={onField("industries")}
                  placeholder="(e.g., Finance, Law)"
                />
                {!!industriesList.length && (
                  <div className="as2-chips">
                    {industriesList.map((tag) => (
                      <span key={tag} className="as2-chip">
                        {tag}
                        <button className="x" onClick={() => removeIndustry(tag)} aria-label={`Remove ${tag}`}>
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </section>

            {/* Role / Title */}
            <section className={`as2-sec ${ui.sections.role ? "open" : ""}`}>
              <button className="as2-sec-head" onClick={() => toggle("role")}>
                <span>Role / Title</span>
                <i className="chev" />
              </button>
              <div className="as2-sec-body">
                <input className="as2-input" value={form.role} onChange={onField("role")} placeholder="e.g., Software Engineer" />
              </div>
            </section>

            {/* Company */}
            <section className={`as2-sec ${ui.sections.company ? "open" : ""}`}>
              <button className="as2-sec-head" onClick={() => toggle("company")}>
                <span>Company</span>
                <i className="chev" />
              </button>
              <div className="as2-sec-body">
                <input className="as2-input" value={form.company} onChange={onField("company")} placeholder="e.g., KX Bank" />
              </div>
            </section>

            {/* College + Grad Year */}
            <section className={`as2-sec ${ui.sections.college ? "open" : ""}`}>
              <button className="as2-sec-head" onClick={() => toggle("college")}>
                <span>College & Grad Year</span>
                <i className="chev" />
              </button>
              <div className="as2-sec-body">
                <input className="as2-input" value={form.college} onChange={onField("college")} placeholder="e.g., UCLA" />
                <div className="as2-row">
                  <div className="as2-col">
                    <label className="as2-label">Min</label>
                    <input
                      className="as2-input"
                      type="number"
                      inputMode="numeric"
                      value={form.gradMin}
                      onChange={onField("gradMin")}
                      placeholder="year"
                    />
                  </div>
                  <div className="as2-col">
                    <label className="as2-label">Max</label>
                    <input
                      className="as2-input"
                      type="number"
                      inputMode="numeric"
                      value={form.gradMax}
                      onChange={onField("gradMax")}
                      placeholder="year"
                    />
                  </div>
                </div>
              </div>
            </section>


            {/* Location */}
            <section className={`as2-sec ${ui.sections.location ? "open" : ""}`}>
              <button className="as2-sec-head" onClick={() => toggle("location")}>
                <span>Location</span>
                <i className="chev" />
              </button>
              <div className="as2-sec-body">
                <div className="as2-row">
                  <input className="as2-input" value={form.city} onChange={onField("city")} placeholder="City" />
                  <input
                    className="as2-input"
                    value={form.state}
                    onChange={onField("state")}
                    placeholder="State / Country"
                    aria-label="State or Country"
                  />
                </div>
              </div>
            </section>

            {/* Sort & per-page */}
            <section className="as2-sec open">
              <div className="as2-sec-body">
                <div className="as2-row">
                  <div className="as2-col">
                    <label className="as2-label">Sort</label>
                    <select className="as2-input" value={form.sort} onChange={onField("sort")}>
                      <option value="name">Name (A–Z)</option>
                      <option value="recent">Recently Added</option>
                    </select>
                  </div>
                  <div className="as2-col">
                    <label className="as2-label">Per Page</label>
                    <select
                      className="as2-input"
                      value={form.limit}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          limit: parseInt(e.target.value, 10),
                          offset: 0,
                        }))
                      }
                    >
                      <option value={12}>12</option>
                      <option value={24}>24</option>
                      <option value={48}>48</option>
                    </select>
                  </div>
                </div>
              </div>
            </section>
          </aside>

          {/* RESULTS */}
          <section className="as2-results">
            <div className="as2-results-head">
              <div className="lhs">
                <h1 className="as2-title">{header}</h1>
                {hasActiveFilters && !state.loading && (
                  <div className="as2-sub">
                    Showing {fromN}–{toN} of {state.total}
                  </div>
                )}
              </div>
              <div className="rhs">
                <button className="as2-btn as2-btn-ghost" onClick={clearAll}>
                  Reset
                </button>
              </div>
            </div>

            {/* Welcome state (no filters yet) */}
            {!hasActiveFilters ? (
              <div className="as2-emptywrap">
                <div className="as2-emptycard">
                  <h3>Start an advanced search</h3>
                  <p className="muted">
                    Use the filters on the left to find alumni by name, role at camp, industry, college, grad year, camper years, or location.
                  </p>
                  <ul className="as2-emptylist">
                    <li>
                      Try a name, like <span className="kbd">"Jay"</span>
                    </li>
                    <li>
                      Add a college (e.g., <span className="kbd">“Michigan”</span>)
                    </li>
                    <li>{`Filter by role at camp (${staffRoleOptions.join(", ")})`}</li>
                    <li>Use camper years to find people from a specific era</li>
                  </ul>
                </div>
              </div>
            ) : (
              <>
                {state.loading && (
                  <div className="as2-grid">
                    {Array.from({ length: 8 }).map((_, i) => (
                      <div className="as2-card as2-skel" key={i}>
                        <div className="ph avatar" />
                        <div className="ph line w120" />
                        <div className="ph line w160" />
                        <div className="ph line w140" />
                        <div className="as2-cta">
                          <div className="ph btn" />
                          <div className="ph btn" />
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {!state.loading && state.error && (
                  <div className="as2-emptywrap">
                    <div className="as2-emptycard">
                      <h3>We couldn’t load results</h3>
                      <p className="muted">{state.error}</p>
                      <button className="as2-btn as2-btn-outline" onClick={clearAll}>
                        Reset filters
                      </button>
                    </div>
                  </div>
                )}

                {!state.loading && !state.error && (
                  <>
                    {state.items.length === 0 ? (
                      <div className="as2-emptywrap">
                        <div className="as2-emptycard">
                          <h3>No matches</h3>
                          <p className="muted">Try widening or clearing your filters.</p>
                          <div className="as2-empty-actions">
                            <button className="as2-btn as2-btn-outline" onClick={clearAll}>
                              Clear all filters
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="as2-grid">
                          {state.items.map((p) => {
                            const id = p.id || p._id;
                            const photo = p.photoUrl || p?.uploads?.photoUrl || null;
                            const industry =
                              p.industry ||
                              p.primaryIndustry ||
                              (Array.isArray(p.industries) && p.industries[0]) ||
                              p.sector ||
                              "";
                            const { role, company } = pickCurrentJob(p);
                            const jobLine = [role, company && `@ ${company}`].filter(Boolean).join(" ");
                            const loc = p.location || [p.city, p.state || p.region, p.country].filter(Boolean).join(", ");
                            const first = p.firstName || p.first || "";
                            const last = p.lastName || p.last || "";

                            return (
                              <div className="as2-card" key={id}>
                                <Link
                                  to={`/profile/${id}?name=${encodeURIComponent(`${first} ${last}`)}`}
                                  state={{ preload: p }}
                                  className="as2-card-link"
                                  aria-label={`${first} ${last} profile`}
                                >
                                  {photo ? (
                                    <img className="as2-avatar" src={photo} alt={`${first} ${last}`} />
                                  ) : (
                                    <div className="as2-avatar-fallback">{initials(first, last)}</div>
                                  )}
                                </Link>

                                <Link
                                  to={`/profile/${id}?name=${encodeURIComponent(`${first} ${last}`)}`}
                                  state={{ preload: p }}
                                  className="as2-name"
                                >
                                  {first} {last}
                                </Link>

                                {industry && <div className="as2-industry">{industry}</div>}
                                {loc && <div className="as2-loc">{loc}</div>}
                                {(role || company) && <div className="as2-job">{jobLine || role || company}</div>}

                                <div className="as2-cta">
                                  <Link to={`/profile/${id}`} className="as2-btn as2-btn-primary">
                                    View Profile
                                  </Link>
                                  <button
                                    className="as2-btn as2-btn-outline"
                                    onClick={() => navigate(`/chat-rooms?to=${encodeURIComponent(id)}`)}
                                  >
                                    Message
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {state.total > form.limit && (
                          <div className="as2-pager">
                            <button className="as2-btn as2-btn-outline" disabled={page <= 1} onClick={prevPage}>
                              Prev
                            </button>
                            <div className="as2-pagecount">
                              Page {page} / {pages}
                            </div>
                            <button className="as2-btn as2-btn-outline" disabled={page >= pages} onClick={nextPage}>
                              Next
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </>
                )}
              </>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
