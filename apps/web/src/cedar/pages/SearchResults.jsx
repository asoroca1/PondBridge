// pages/SearchResults.jsx
import { useEffect, useMemo, useState } from "react";
import { useSearchParams, Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext.jsx";
import { useTenant } from "../../context/TenantContext.jsx";
import { requestJson } from "../../lib/http.js";
import { tenantRoute } from "../../lib/tenantRouting.js";
import { avatarUrl } from "../lib/helpers.js";

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

function initials(first = "", last = "") {
  return `${String(first || "").trim()[0] || ""}${String(last || "").trim()[0] || ""}`.toUpperCase() || "?";
}

function ResultAvatar({ photo = "", first = "", last = "", name = "" }) {
  const [errored, setErrored] = useState(false);
  const src = String(photo || "").trim();

  useEffect(() => {
    setErrored(false);
  }, [src]);

  if (src && !errored) {
    return (
      <img
        className="sr-avatar"
        src={src}
        alt={name}
        loading="lazy"
        decoding="async"
        onError={() => setErrored(true)}
      />
    );
  }

  return (
    <div className="sr-avatar sr-avatar-fallback" aria-hidden="true">
      {initials(first, last)}
    </div>
  );
}

export default function SearchResults() {
  const { token, getAuthToken, isReady: authReady } = useAuth();
  const { slug } = useTenant();
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
    const controller = new AbortController();
    if (!authReady || !slug || !q) {
      setState({ loading: false, items: [], total: 0, error: null });
      return () => {
        alive = false;
        controller.abort();
      };
    }
    (async () => {
      try {
        setState((s) => ({ ...s, loading: true, error: null }));
        const data = await requestJson(`/api/t/${slug}/search/users?q=${encodeURIComponent(q)}&limit=48`, {
          token: token || "",
          getToken: async ({ forceRefresh = false } = {}) => {
            if (typeof getAuthToken === "function") {
              const next = await getAuthToken({ forceRefresh });
              if (next) return next;
            }
            return token || "";
          },
          signal: controller.signal
        });
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
      } catch (error) {
        if (error?.name === "AbortError") return;
        if (!alive) return;
        setState({
          loading: false,
          items: [],
          total: 0,
          error: "Failed to load results.",
        });
      }
    })();
    return () => {
      alive = false;
      controller.abort();
    };
  }, [authReady, getAuthToken, q, slug, token]);

  const header = useMemo(() => (!q ? "Search" : `Results for “${q}”`), [q]);
  const goMessage = (id) => navigate(tenantRoute(slug, `/chat/${id}`));

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
                  const id = String(p.id || p._id || p.profileId || p.userId || "").trim();
                  if (!id || id === "undefined" || id === "null") return null;

                  // Photo
                  const photo = avatarUrl(p);

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
                        to={tenantRoute(slug, `/profile/${id}`)}
                        className="sr-card-link"
                        aria-label={`${first} ${last} profile`}
                      >
                        <ResultAvatar photo={photo} first={first} last={last} name={`${first} ${last}`.trim()} />
                      </Link>

                      <Link to={tenantRoute(slug, `/profile/${id}`)} className="sr-name">
                        {first} {last}
                      </Link>

                      {industry && <div className="sr-industry">{industry}</div>}

                      {loc && <div className="sr-loc">{loc}</div>}

                      {(role || company) && (
                        <div className="sr-job">{jobLine || role || company}</div>
                      )}

                      <div className="sr-cta-row">
                        <Link to={tenantRoute(slug, `/profile/${id}`)} className="btn btn-primary">
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
