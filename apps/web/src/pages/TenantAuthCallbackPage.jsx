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

function resolveAuthCallbackError(err, slug, inviteToken = "") {
  const code = String(err?.payload?.error?.code || err?.code || "")
    .trim()
    .toUpperCase();
  const fallbackMessage = String(err?.message || "Could not complete authentication.");
  const loginPath = routeWithSlug(
    slug,
    `/login${inviteToken ? `?inviteToken=${encodeURIComponent(inviteToken)}` : ""}`
  );

  if (code === "RATE_LIMITED") {
    return {
      message: "Too many access attempts were made. Wait a minute, then try again.",
      guidance: "If this keeps happening, open a private window and try once.",
      retryPath: loginPath
    };
  }
  if (code === "TENANT_INACTIVE") {
    return {
      message: "This camp network is currently inactive.",
      guidance: "Contact support or your camp director to reactivate access.",
      retryPath: loginPath
    };
  }
  if (code === "DIRECTOR_ALREADY_CLAIMED") {
    return {
      message: "This director account is already claimed.",
      guidance: "Sign in with the claimed director account or ask support to transfer ownership.",
      retryPath: loginPath
    };
  }
  if (code === "BILLING_RESTRICTED" || code === "BILLING_TENANT_NOT_FOUND") {
    return {
      message: "Billing access is still syncing for this network.",
      guidance: "Wait a few seconds, then retry sign-in.",
      retryPath: loginPath
    };
  }
  if (code === "API_UNREACHABLE") {
    return {
      message: "Could not reach the API while finishing sign-in.",
      guidance: "Verify the backend is running, then retry.",
      retryPath: loginPath
    };
  }

  return {
    message: fallbackMessage,
    guidance: "Retry sign-in. If the issue repeats, contact support with the exact error message.",
    retryPath: loginPath
  };
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
  const [guidance, setGuidance] = useState("");
  const [retryPath, setRetryPath] = useState("");
  const [phaseMessage, setPhaseMessage] = useState(
    "We are syncing your account and loading your network access."
  );
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

        setPhaseMessage("Checking your network access...");
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
          setPhaseMessage("Claiming director setup access...");
          await requestJson(`/api/t/${slug}/access/director-bootstrap`, {
            method: "POST",
            token,
            body: {}
          });
          clearDirectorBootstrapIntent(slug);
        } else if (decision.action === "accept_invite" && inviteToken) {
          clearDirectorBootstrapIntent(slug);
          setPhaseMessage("Accepting your invite...");
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

          setPhaseMessage("Creating your network membership...");
          await requestJson(`/api/t/${slug}/access/join`, {
            method: "POST",
            token,
            body: {}
          });
        } else if (decision.action === "request_access") {
          clearDirectorBootstrapIntent(slug);
          setPhaseMessage("Submitting your access request...");
          await requestJson(`/api/t/${slug}/access/request-access`, {
            method: "POST",
            token,
            body: {}
          });
        }

        setPhaseMessage("Finalizing sign-in...");
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
        const resolved = resolveAuthCallbackError(err, slug, inviteToken);
        setError(resolved.message);
        setGuidance(resolved.guidance);
        setRetryPath(resolved.retryPath);
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
            ? phaseMessage
            : error || "Could not complete authentication."}
        </p>
        {!working && guidance ? <p>{guidance}</p> : null}
        {!working ? (
          <p>
            <Link to={retryPath || routeWithSlug(slug, "/login")}>Retry sign-in</Link>
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
