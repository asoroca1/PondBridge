import { useEffect, useState } from "react";
import { getAppBaseDomain } from "../lib/domain.js";
import { requestJson } from "../lib/http.js";

const RECENT_CAMP_KEY = "pondbridgeRecentCamp";

function readRecentCamp() {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RECENT_CAMP_KEY) || "null");
    const slug = String(parsed?.slug || "").trim().toLowerCase();
    const name = String(parsed?.name || "").trim();
    return slug && name ? { slug, name } : null;
  } catch {
    return null;
  }
}

function rememberVerifiedCamp(camp = null) {
  if (typeof window === "undefined") return;
  const slug = String(camp?.slug || "").trim().toLowerCase();
  const name = String(camp?.networkDisplayName || camp?.name || "").trim();
  if (!slug || !name) return;
  try {
    window.localStorage.setItem(RECENT_CAMP_KEY, JSON.stringify({ slug, name }));
    window.localStorage.setItem("pondbridgeTenantSlug", slug);
  } catch {
    // Storage is an optional convenience; lookup still works without it.
  }
}

function safeDestination(value = "") {
  try {
    const url = new URL(String(value || ""));
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

export default function PlatformLandingPage() {
  const [campSlug, setCampSlug] = useState("");
  const [recentCamp, setRecentCamp] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const baseDomain = getAppBaseDomain();
  const protocol = typeof window !== "undefined" && window.location.protocol === "http:" ? "http" : "https";
  const adminUrl = `${protocol}://super.${baseDomain}/super/login`;

  useEffect(() => {
    setRecentCamp(readRecentCamp());
  }, []);

  async function findAndOpenCamp(value) {
    const query = String(value || "").trim();
    if (query.length < 2) {
      setError("Enter a camp name or code.");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const payload = await requestJson(`/api/public/tenant-lookup?query=${encodeURIComponent(query)}`);
      const destination = safeDestination(payload?.network?.loginUrl || payload?.network?.appUrl);
      if (!destination) throw new Error("That camp does not have a valid network address yet.");
      rememberVerifiedCamp(payload);
      window.location.assign(destination);
    } catch (lookupError) {
      setError(String(lookupError?.message || "We could not look up that camp right now."));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGoToCamp(e) {
    e.preventDefault();
    await findAndOpenCamp(campSlug);
  }

  return (
    <section className="platform-landing-shell">
      <div className="platform-landing-backdrop" />
      <div className="platform-landing-content">
        <div className="platform-landing-panel">
          <div className="platform-landing-header">
            <p className="platform-landing-kicker">PondBridge</p>
            <h1>Your Camp Alumni Network</h1>
            <p className="platform-landing-subtitle">
              PondBridge connects summer camp alumni. Enter your camp&rsquo;s name or code below to sign in or create an account.
            </p>
          </div>
          <form className="platform-landing-form" onSubmit={handleGoToCamp}>
            <label className="platform-landing-field">
              <span className="platform-landing-field-label">Camp name or code</span>
              <input
                className="pb-input"
                type="text"
                placeholder="e.g. Camp Cedar or CEDAR24"
                value={campSlug}
                onChange={(e) => {
                  setCampSlug(e.target.value);
                  setError("");
                }}
                autoComplete="off"
                autoFocus
                aria-describedby={error ? "camp-lookup-error" : undefined}
                aria-invalid={Boolean(error)}
              />
            </label>
            {error ? (
              <p id="camp-lookup-error" className="platform-landing-error" role="alert">
                {error}
              </p>
            ) : null}
            <button
              className="pb-btn pb-btn--primary platform-landing-submit"
              type="submit"
              disabled={!campSlug.trim() || submitting}
            >
              {submitting ? "Finding your camp..." : "Go to my camp"}
            </button>
          </form>
          {recentCamp ? (
            <div className="platform-landing-recent" aria-label="Recent camp">
              <span>Recently visited</span>
              <button type="button" onClick={() => findAndOpenCamp(recentCamp.slug)} disabled={submitting}>
                Continue to {recentCamp.name}
              </button>
            </div>
          ) : null}
          <div className="platform-landing-footer">
            <a href={adminUrl} className="platform-landing-admin-link">
              Platform admin sign-in
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
