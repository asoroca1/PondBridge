import { useState } from "react";
import { getAppBaseDomain } from "../lib/domain.js";

export default function PlatformLandingPage() {
  const [campSlug, setCampSlug] = useState("");
  const baseDomain = getAppBaseDomain();
  const adminUrl = `https://super.${baseDomain}/super/login`;

  function handleGoToCamp(e) {
    e.preventDefault();
    const slug = campSlug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (!slug) return;
    window.location.href = `https://${slug}.${baseDomain}`;
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
                placeholder="e.g. cedarwoodcamp"
                value={campSlug}
                onChange={(e) => setCampSlug(e.target.value)}
                autoComplete="off"
                autoFocus
              />
            </label>
            <button
              className="pb-btn pb-btn--primary platform-landing-submit"
              type="submit"
              disabled={!campSlug.trim()}
            >
              Go to my camp
            </button>
          </form>
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
