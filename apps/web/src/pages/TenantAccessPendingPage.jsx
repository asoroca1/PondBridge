import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth as useClerkAuth } from "@clerk/clerk-react";
import { requestJson } from "../lib/http.js";
import { useTenant } from "../context/TenantContext.jsx";
import { clerkConfigError, clerkModeRequested, clerkUiEnabled } from "../lib/authMode.js";
import { normalizeTenantRouteForHost, tenantRoute } from "../lib/tenantRouting.js";

function routeWithSlug(slug, path) {
  return tenantRoute(slug, path);
}

function LegacyPendingPage() {
  const { slug: paramSlug = "" } = useParams();
  const { slug: contextSlug = "" } = useTenant();
  const slug = String(paramSlug || contextSlug || "").trim().toLowerCase();
  return (
    <section className="app-status-shell">
      <div className="app-status-card">
        <h1>Access request pending</h1>
        <p>A director still needs to approve your account.</p>
        <p>
          <Link to={routeWithSlug(slug, "/login")}>Back to login</Link>
        </p>
      </div>
    </section>
  );
}

function ClerkPendingPage() {
  const navigate = useNavigate();
  const params = useParams();
  const { slug: contextSlug } = useTenant();
  const slug = String(params.slug || contextSlug || "").trim().toLowerCase();
  const { isLoaded, isSignedIn, getToken } = useClerkAuth();
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !slug) return;
    let active = true;

    async function checkStatus() {
      setChecking(true);
      setError("");
      try {
        const token = await getToken();
        if (!token) return;
        const payload = await requestJson(`/api/t/${slug}/access/decision`, { token });
        const decision = payload?.decision || {};
        if (decision.state === "active_member") {
          navigate(
            normalizeTenantRouteForHost(slug, String(decision.nextRoute || routeWithSlug(slug, "/home"))),
            { replace: true }
          );
        }
      } catch (err) {
        if (!active) return;
        setError(String(err?.message || "Could not refresh your access status."));
      } finally {
        if (active) setChecking(false);
      }
    }

    checkStatus();
    const id = window.setInterval(checkStatus, 15000);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, [getToken, isLoaded, isSignedIn, navigate, slug]);

  return (
    <section className="app-status-shell">
      <div className="app-status-card">
        <h1>Access request pending</h1>
        <p>A camp director needs to approve your account before you can enter this network.</p>
        {checking ? <p className="muted">Checking status...</p> : null}
        {error ? <p className="error-text">{error}</p> : null}
        <p>
          <Link to={routeWithSlug(slug, "/login")}>Back to login</Link>
        </p>
      </div>
    </section>
  );
}

export default function TenantAccessPendingPage() {
  if (clerkUiEnabled()) return <ClerkPendingPage />;
  if (clerkModeRequested()) {
    return (
      <section className="app-status-shell is-error">
        <div className="app-status-card">
          <h1>Access request pending</h1>
          <p>{clerkConfigError() || "Clerk auth is enabled but web auth configuration is incomplete."}</p>
        </div>
      </section>
    );
  }
  return <LegacyPendingPage />;
}
