import { readTransitionBranding } from "../lib/appTransitionState.js";

export function AppTransitionShell({ compact = false }) {
  const branding = readTransitionBranding();
  const fallbackInitial = String(branding.networkName || "P").trim().charAt(0).toUpperCase() || "P";

  return (
    <section
      className={`app-transition-shell ${compact ? "is-compact" : ""}`.trim()}
      aria-busy="true"
      aria-live="polite"
    >
      {!compact ? (
        <header className="app-transition-brand">
          {branding.logoUrl ? (
            <img src={branding.logoUrl} alt="" decoding="async" />
          ) : (
            <span className="app-transition-brand-mark" aria-hidden="true">
              {fallbackInitial}
            </span>
          )}
          <strong>{branding.networkName}</strong>
        </header>
      ) : null}

      <div className="app-transition-content" aria-hidden="true">
        <div className="app-transition-line is-kicker" />
        <div className="app-transition-line is-title" />
        <div className="app-transition-line is-copy" />
        <div className="app-transition-grid">
          <div className="app-transition-panel" />
          <div className="app-transition-panel" />
          <div className="app-transition-panel" />
        </div>
      </div>
      <span className="sr-only" role="status">Getting this page ready.</span>
    </section>
  );
}
