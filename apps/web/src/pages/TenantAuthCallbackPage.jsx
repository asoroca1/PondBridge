import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useAuth as useClerkAuth } from "@clerk/clerk-react";
import { requestJson } from "../lib/http.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useTenant } from "../context/TenantContext.jsx";
import { clerkConfigError, clerkModeRequested, clerkUiEnabled } from "../lib/authMode.js";
import { normalizeTenantRouteForHost, tenantRoute } from "../lib/tenantRouting.js";

function truthy(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
}

function directorBootstrapIntentKey(slug = "") {
  return `pondbridgeDirectorBootstrapIntent:${String(slug || "").trim().toLowerCase() || "default"}`;
}

function readDirectorBootstrapIntent(slug = "") {
  if (typeof window === "undefined") return false;
  return window.sessionStorage.getItem(directorBootstrapIntentKey(slug)) === "1";
}

function clearDirectorBootstrapIntent(slug = "") {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(directorBootstrapIntentKey(slug));
}

function routeWithSlug(slug, path) {
  return tenantRoute(slug, path);
}

function LegacyAuthCallbackPage() {
  const { slug: paramSlug = "" } = useParams();
  const { slug: contextSlug = "" } = useTenant();
  const slug = String(paramSlug || contextSlug || "").trim().toLowerCase();

  return (
    <section className="app-status-shell">
      <div className="app-status-card">
        <h1>Auth callback unavailable</h1>
        <p>This route is only used when Clerk auth is enabled.</p>
        <p>
          <Link to={routeWithSlug(slug, "/login")}>Back to login</Link>
        </p>
      </div>
    </section>
  );
}

function ClerkAuthCallbackPage() {
  const navigate = useNavigate();
  const params = useParams();
  const { slug: contextSlug } = useTenant();
  const slug = String(params.slug || contextSlug || "").trim().toLowerCase();
  const [searchParams] = useSearchParams();
  const inviteToken = String(searchParams.get("inviteToken") || searchParams.get("token") || "").trim();
  const directorBootstrap = truthy(searchParams.get("directorBootstrap"));
  const completeJoin = truthy(searchParams.get("completeJoin"));
  const { refreshSession } = useAuth();
  const { isLoaded, isSignedIn, getToken } = useClerkAuth();
  const [error, setError] = useState("");
  const [working, setWorking] = useState(true);

  useEffect(() => {
    if (!isLoaded || !slug) return;
    let cancelled = false;
    let redirected = false;

    async function run() {
      try {
        if (!isSignedIn) {
          redirected = true;
          navigate(routeWithSlug(slug, `/login${inviteToken ? `?inviteToken=${encodeURIComponent(inviteToken)}` : ""}`), {
            replace: true
          });
          return;
        }

        const token = await getToken();
        if (!token) throw new Error("No authenticated session token from Clerk.");

        let payload = await requestJson(
          `/api/t/${slug}/access/decision${inviteToken ? `?inviteToken=${encodeURIComponent(inviteToken)}` : ""}`,
          { token }
        );
        let decision = payload?.decision || {};
        const hasDirectorBootstrapIntent = directorBootstrap || readDirectorBootstrapIntent(slug);
        const tenantOnboardingStatus = String(payload?.tenant?.onboardingStatus || "").trim().toLowerCase();
        const shouldBootstrapFromPrelaunchFallback =
          !inviteToken &&
          tenantOnboardingStatus &&
          tenantOnboardingStatus !== "live" &&
          decision.state === "not_member";

        if (hasDirectorBootstrapIntent || shouldBootstrapFromPrelaunchFallback) {
          await requestJson(`/api/t/${slug}/access/director-bootstrap`, {
            method: "POST",
            token,
            body: {}
          });
          clearDirectorBootstrapIntent(slug);
        } else if (decision.action === "accept_invite" && inviteToken) {
          clearDirectorBootstrapIntent(slug);
          await requestJson(`/api/t/${slug}/access/invite/accept`, {
            method: "POST",
            token,
            body: { inviteToken }
          });
        } else if (decision.action === "join_network") {
          clearDirectorBootstrapIntent(slug);
          if (String(decision.signupMode || "").toLowerCase() === "code" && !completeJoin) {
            redirected = true;
            navigate(
              routeWithSlug(
                slug,
                `/create-account?completeJoin=1${inviteToken ? `&inviteToken=${encodeURIComponent(inviteToken)}` : ""}`
              ),
              { replace: true }
            );
            return;
          }

          await requestJson(`/api/t/${slug}/access/join`, {
            method: "POST",
            token,
            body: {}
          });
        } else if (decision.action === "request_access") {
          clearDirectorBootstrapIntent(slug);
          await requestJson(`/api/t/${slug}/access/request-access`, {
            method: "POST",
            token,
            body: {}
          });
        }

        payload = await requestJson(`/api/t/${slug}/access/decision`, { token });
        decision = payload?.decision || {};
        await refreshSession({ tenantSlug: slug });

        const next = normalizeTenantRouteForHost(
          slug,
          String(decision.nextRoute || "").trim() || routeWithSlug(slug, "/home")
        );
        redirected = true;
        navigate(next, { replace: true });
      } catch (err) {
        if (cancelled) return;
        setError(String(err?.message || "Unable to finish authentication."));
      } finally {
        if (!cancelled && !redirected) setWorking(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [completeJoin, directorBootstrap, getToken, inviteToken, isLoaded, isSignedIn, navigate, refreshSession, slug]);

  return (
    <section className="app-status-shell">
      <div className="app-status-card">
        <h1>{working ? "Finishing sign in..." : "Sign in issue"}</h1>
        <p>
          {working
            ? "We are syncing your account and loading your network access."
            : error || "Could not complete authentication."}
        </p>
        {!working ? (
          <p>
            <Link to={routeWithSlug(slug, "/login")}>Back to login</Link>
          </p>
        ) : null}
      </div>
    </section>
  );
}

export default function TenantAuthCallbackPage() {
  if (clerkUiEnabled()) return <ClerkAuthCallbackPage />;
  if (clerkModeRequested()) {
    return (
      <section className="app-status-shell is-error">
        <div className="app-status-card">
          <h1>Auth callback unavailable</h1>
          <p>{clerkConfigError() || "Clerk auth is enabled but web auth configuration is incomplete."}</p>
        </div>
      </section>
    );
  }
  return <LegacyAuthCallbackPage />;
}
