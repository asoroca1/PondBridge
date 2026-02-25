// pages/SearchResults.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams, Link, useNavigate } from "react-router-dom";
import { API_BASE } from "../lib/api";
import { getToken } from "../lib/helpers.js";
import defaultProfile from "../assets/default-profile.png";

/* ------------ helpers (keep OUTSIDE the component) ------------ */
function pickCurrentJob(p = {}) {
  // 1) If backend precomputes currentJob like the Navbar uses
  if (p.currentJob) {
    if (typeof p.currentJob === "string") {
      // Expect formats like "Analyst @ Blackstone" or just "Analyst"
      const [rawRole, rawCompany] = p.currentJob.split("@").map(s => s?.trim());
      return { role: rawRole || "", company: rawCompany || "" };
    }
    if (typeof p.currentJob === "object" && p.currentJob !== null) {
      const role =
        p.currentJob.role ||
        p.currentJob.title ||
        p.currentJob.jobTitle ||
        "";
      const company =
        p.currentJob.company ||
        p.currentJob.organization ||
        p.currentJob.org ||
        "";
      if (role || company) return { role, company };
    }
  }

  // 2) Fallbacks from single fields on the user
  const singleRole =
    p.currentJobTitle || p.jobTitle || p.title || p.currentRole || "";
  const singleCompany = p.currentCompany || p.company || "";

  // 3) Array shapes
  const arr =
    (Array.isArray(p.currentJobs) && p.currentJobs) ||
    (Array.isArray(p.jobs) && p.jobs) ||
    (Array.isArray(p.employment) && p.employment) ||
    [];

  const j = arr.find(j => j?.isCurrent || j?.current) ?? arr[0] ?? null;

  const arrayRole = j?.role || j?.title || "";
  const arrayCompany = j?.company || j?.organization || j?.org || "";

  // Prefer explicit single fields, then array fields
  const role = singleRole || arrayRole || "";
  const company = singleCompany || arrayCompany || "";

  return { role, company };
}

export default function SearchResults() {
  const [params] = useSearchParams();
  const q = (params.get("q") || "").trim();
  const navigate = useNavigate();

  const [state, setState] = useState({
    loading: true,
    items: [],
    total: 0,
    error: null,
  });

  useEffect(() => {
    let alive = true;
    if (!q) {
      setState({ loading: false, items: [], total: 0, error: null });
      return;
    }
    (async () => {
      try {
        setState((s) => ({ ...s, loading: true, error: null }));
        const res = await fetch(
          `${API_BASE}/search/users?q=${encodeURIComponent(q)}&limit=48`,
          { headers: { Authorization: `Bearer ${getToken()}` } }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!alive) return;

        const items = Array.isArray(data.items)
          ? data.items
          : Array.isArray(data.results)
          ? data.results
          : [];

        setState({
          loading: false,
          items,
          total: data.total ?? items.length,
          error: null,
        });
      } catch {
        if (!alive) return;
        setState({
          loading: false,
          items: [],
          total: 0,
          error: "Failed to load results.",
        });
      }
    })();
    return () => { alive = false; };
  }, [q]);

  const header = useMemo(() => (!q ? "Search" : `Results for “${q}”`), [q]);
  const goMessage = (id) => navigate(`/chat/${id}`);

  return (
    <>

      <div className="page-container sr-container nav2-page-shell">
        <div className="sr-header">
          <h1 className="sr-title">{header}</h1>
          {!state.loading && (
            <div className="sr-sub">
              {state.total} match{state.total === 1 ? "" : "es"}
            </div>
          )}
        </div>

        {state.loading && (
          <div className="sr-grid">
            {Array.from({ length: 8 }).map((_, i) => (
              <div className="sr-card sr-skel" key={i}>
                <div className="sr-avatar skel" />
                <div className="sr-name skel" />
                <div className="sr-industry skel" />
                <div className="sr-loc skel" />
                <div className="sr-job skel" />
                <div className="sr-cta-row">
                  <div className="btn btn-primary skel" />
                  <div className="btn btn-ghost skel" />
                </div>
              </div>
            ))}
          </div>
        )}

        {!state.loading && state.error && (
          <div className="sr-error">{state.error}</div>
        )}

        {!state.loading && !state.error && (
          <>
            {state.items.length === 0 ? (
              <div className="sr-empty">No matches for “{q}”.</div>
            ) : (
              <div className="sr-grid">
                {state.items.map((p) => {
                  const id = p.id || p._id;

                  // Photo
                  const photo =
                    p.photoUrl || p?.uploads?.photoUrl || defaultProfile;

                  // Industry chip (several fallbacks)
                  const industry =
                    p.industry ||
                    p.primaryIndustry ||
                    (Array.isArray(p.industries) && p.industries[0]) ||
                    p.sector ||
                    "";

                  // Current job (now reads p.currentJob too)
                  const { role, company } = pickCurrentJob(p);
                  const jobLine = [role, company && `@ ${company}`]
                    .filter(Boolean)
                    .join(" ");

                  // Location
                  const loc =
                    p.location ||
                    [p.city, p.state || p.region, p.country]
                      .filter(Boolean)
                      .join(", ");

                  const first = p.firstName || "";
                  const last = p.lastName || "";

                  return (
                    <div className="sr-card" key={id}>
                      <Link
                        to={`/profile/${id}`}
                        className="sr-card-link"
                        aria-label={`${first} ${last} profile`}
                      >
                        <img className="sr-avatar" src={photo} alt="" />
                      </Link>

                      <Link to={`/profile/${id}`} className="sr-name">
                        {first} {last}
                      </Link>

                      {industry && <div className="sr-industry">{industry}</div>}

                      {loc && <div className="sr-loc">{loc}</div>}

                      {(role || company) && (
                        <div className="sr-job">{jobLine || role || company}</div>
                      )}

                      <div className="sr-cta-row">
                        <Link to={`/profile/${id}`} className="btn btn-primary">
                          View Profile
                        </Link>
                        <button
                          className="btn btn-ghost"
                          onClick={() => goMessage(id)}
                        >
                          Message
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
