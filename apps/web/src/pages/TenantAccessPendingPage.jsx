import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth as useClerkAuth } from "@clerk/clerk-react";
import { Hourglass, Mail } from "lucide-react";
import { requestJson } from "../lib/http.js";
import { useTenant } from "../context/TenantContext.jsx";
import { clerkConfigError, clerkModeRequested, clerkUiEnabled } from "../lib/authMode.js";
import { normalizeTenantRouteForHost, tenantRoute } from "../lib/tenantRouting.js";

function routeWithSlug(slug, path) {
  return tenantRoute(slug, path);
}

/**
 * What someone sees for however long a director takes to decide.
 *
 * The only questions they have are whether their signup worked and whether
 * they need to keep checking, so the page answers both and offers nothing else
 * to poke at. Both auth modes render this, so the two cannot drift apart.
 */
function PendingCard({ campName = "", slug = "", error = "" }) {
  const approver = campName ? `A director at ${campName}` : "A camp director";

  return (
    <section className="app-status-shell">
      <div className="app-status-card pb-pending">
        <span className="pb-pending-mark" aria-hidden="true">
          <Hourglass />
        </span>

        <h1>Waiting for director approval</h1>
        <p className="pb-pending-lede">
          Your account is set up. {approver} needs to approve it before you can sign in.
        </p>

        <p className="pb-pending-note">
          <Mail aria-hidden="true" />
          <span>We will email you as soon as they do. Nothing else to do on your end.</span>
        </p>

        {error ? <p className="error-text" role="alert">{error}</p> : null}

        <Link className="pb-pending-back" to={routeWithSlug(slug, "/login")}>
          Back to login
        </Link>
      </div>
    </section>
  );
}

function LegacyPendingPage() {
  const { slug: paramSlug = "" } = useParams();
  const { slug: contextSlug = "", tenant } = useTenant();
  const slug = String(paramSlug || contextSlug || "").trim().toLowerCase();
  return <PendingCard campName={String(tenant?.name || "")} slug={slug} />;
}

function ClerkPendingPage() {
  const navigate = useNavigate();
  const params = useParams();
  const { slug: contextSlug, tenant } = useTenant();
  const slug = String(params.slug || contextSlug || "").trim().toLowerCase();
  const { isLoaded, isSignedIn, getToken } = useClerkAuth();
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !slug) return;
    let active = true;

    async function checkStatus() {
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
      }
    }

    // Approval usually lands while the tab is still open, so the poll saves
    // people a manual refresh. It stays silent; the page already told them to
    // wait for the email instead of watching this.
    checkStatus();
    const id = window.setInterval(checkStatus, 15000);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, [getToken, isLoaded, isSignedIn, navigate, slug]);

  return <PendingCard campName={String(tenant?.name || "")} slug={slug} error={error} />;
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
