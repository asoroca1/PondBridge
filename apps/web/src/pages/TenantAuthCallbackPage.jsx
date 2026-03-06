import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useAuth as useClerkAuth } from "@clerk/clerk-react";
import { requestJson } from "../lib/http.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useTenant } from "../context/TenantContext.jsx";
import { clerkConfigError, clerkModeRequested, clerkUiEnabled } from "../lib/authMode.js";
import { normalizeTenantRouteForHost, tenantRoute } from "../lib/tenantRouting.js";
import {
  clearPendingLegalAgreement,
  readPendingLegalAgreement
} from "../lib/legalAgreement.js";

function truthy(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
}

function wait(ms = 0) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
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

function buildLoginPath(slug, { inviteToken = "", authIssue = "" } = {}) {
  const params = new URLSearchParams();
  if (inviteToken) params.set("inviteToken", inviteToken);
  if (authIssue) params.set("authIssue", authIssue);
  const query = params.toString();
  return routeWithSlug(slug, `/login${query ? `?${query}` : ""}`);
}

function isTenantScopeMismatchError(err) {
  const code = String(err?.payload?.error?.code || err?.code || "")
    .trim()
    .toUpperCase();
  const message = String(err?.payload?.error?.message || err?.message || "")
    .trim()
    .toLowerCase();
  return (
    code === "TENANT_SCOPE_DENIED" ||
    code === "TENANT_CLAIM_REQUIRED" ||
    message.includes("tenant scope does not match") ||
    message.includes("does not match this network") ||
    message.includes("tenant-scoped clerk token claim is required")
  );
}

function isSuperAdminDecision(decision) {
  return String(decision?.state || "").toLowerCase() === "super_admin_blocked";
}

function isDirectorBootstrapDisabledError(err) {
  const code = String(err?.payload?.error?.code || err?.code || "")
    .trim()
    .toUpperCase();
  const message = String(err?.payload?.error?.message || err?.message || "")
    .trim()
    .toLowerCase();
  return code === "DIRECTOR_BOOTSTRAP_DISABLED" || message.includes("only available before launch");
}

function isLegalAgreementRequiredError(err) {
  const code = String(err?.payload?.error?.code || err?.code || "")
    .trim()
    .toUpperCase();
  return code === "LEGAL_AGREEMENT_REQUIRED";
}

function isAuthTokenPendingError(err) {
  const code = String(err?.payload?.error?.code || err?.code || "")
    .trim()
    .toUpperCase();
  return code === "AUTH_TOKEN_PENDING";
}

function isAuthMembershipRequiredError(err) {
  const code = String(err?.payload?.error?.code || err?.code || "")
    .trim()
    .toUpperCase();
  return code === "AUTH_MEMBERSHIP_REQUIRED";
}

function shouldForceSessionReset(err) {
  const code = String(err?.payload?.error?.code || err?.code || "")
    .trim()
    .toUpperCase();
  return (
    code === "SESSION_SYNC_FAILED" ||
    code === "AUTH_MEMBERSHIP_REQUIRED" ||
    code === "AUTH_REQUIRED" ||
    code === "AUTH_INVALID"
  );
}

function resolveAuthCallbackError(err, slug, inviteToken = "") {
  const code = String(err?.payload?.error?.code || err?.code || "")
    .trim()
    .toUpperCase();
  const fallbackMessage = String(err?.message || "Could not complete authentication.");
  const loginPath = buildLoginPath(slug, { inviteToken });

  if (code === "SUPER_ADMIN_BLOCKED") {
    return {
      message: "Super admin accounts cannot join camp networks.",
      guidance: "Sign out and use a separate account, or return to the super admin console.",
      retryPath: "/super/tenants"
    };
  }
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
  if (code === "SESSION_SYNC_FAILED") {
    return {
      message: "Sign-in completed, but we could not finalize your network session.",
      guidance: "Retry sign-in once. If this repeats, contact support with this error.",
      retryPath: loginPath
    };
  }
  if (code === "AUTH_MEMBERSHIP_REQUIRED") {
    return {
      message: "Your account was authenticated, but network membership could not be confirmed.",
      guidance: "Retry sign-in once so we can refresh your camp access.",
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
  const { refreshSession, logout } = useAuth();
  const { isLoaded, isSignedIn, getToken } = useClerkAuth();
  const [error, setError] = useState("");
  const [guidance, setGuidance] = useState("");
  const [retryPath, setRetryPath] = useState("");
  const [phaseMessage, setPhaseMessage] = useState(
    "We are syncing your account and loading your network access."
  );
  const [working, setWorking] = useState(true);

  async function recoverMembership({
    tenantSlug = "",
    token = "",
    inviteTokenValue = "",
    legalAgreement = null
  } = {}) {
    const safeSlug = String(tenantSlug || "").trim().toLowerCase();
    if (!safeSlug || !token) return;

    const query = inviteTokenValue ? `?inviteToken=${encodeURIComponent(inviteTokenValue)}` : "";
    const payload = await requestJson(`/api/t/${safeSlug}/access/decision${query}`, { token });
    const decision = payload?.decision || {};

    if (decision.action === "accept_invite" && inviteTokenValue) {
      await requestJson(`/api/t/${safeSlug}/access/invite/accept`, {
        method: "POST",
        token,
        body: {
          inviteToken: inviteTokenValue,
          legalAgreement
        }
      });
      return;
    }

    if (decision.action === "join_network") {
      await requestJson(`/api/t/${safeSlug}/access/join`, {
        method: "POST",
        token,
        body: {
          legalAgreement
        }
      });
    }
  }

  async function ensureTenantSessionSync(
    targetSlug = "",
    { token = "", legalAgreement = null, inviteTokenValue = "" } = {}
  ) {
    const safeSlug = String(targetSlug || "").trim().toLowerCase();
    for (const delayMs of [0, 180, 420, 900, 1500, 2400]) {
      if (delayMs > 0) await wait(delayMs);
      try {
        const payload = await refreshSession({ tenantSlug: safeSlug, strictTenantSync: true });
        const userId = String(payload?.user?.id || payload?.user?._id || "").trim();
        if (userId) return payload;
      } catch (error) {
        if (isAuthTokenPendingError(error)) continue;
        if (isAuthMembershipRequiredError(error)) {
          await recoverMembership({
            tenantSlug: safeSlug,
            token,
            inviteTokenValue,
            legalAgreement
          }).catch(() => {});
          continue;
        }
        throw error;
      }
    }
    const error = new Error("Session sync did not resolve a tenant user.");
    error.code = "SESSION_SYNC_FAILED";
    throw error;
  }

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
        const pendingLegalAgreement = readPendingLegalAgreement(slug);

        setPhaseMessage("Checking your network access...");
        let payload = await requestJson(
          `/api/t/${slug}/access/decision${inviteToken ? `?inviteToken=${encodeURIComponent(inviteToken)}` : ""}`,
          { token }
        );
        let decision = payload?.decision || {};

        // Block super admin accounts from joining camp networks. The backend
        // returns a special decision state; redirect to the super console.
        if (isSuperAdminDecision(decision)) {
          redirected = true;
          navigate("/super/tenants", { replace: true });
          return;
        }

        const hasDirectorBootstrapIntent = directorBootstrap || readDirectorBootstrapIntent(slug);
        const tenantOnboardingStatus = String(payload?.tenant?.onboardingStatus || "").trim().toLowerCase();
        const bootstrapAvailable = tenantOnboardingStatus && tenantOnboardingStatus !== "live";
        if (hasDirectorBootstrapIntent && !bootstrapAvailable) {
          clearDirectorBootstrapIntent(slug);
        }
        const shouldBootstrapFromPrelaunchFallback =
          !inviteToken &&
          tenantOnboardingStatus &&
          tenantOnboardingStatus !== "live" &&
          decision.state === "not_member";
        const shouldAttemptDirectorBootstrap =
          (hasDirectorBootstrapIntent && bootstrapAvailable) || shouldBootstrapFromPrelaunchFallback;

        if (shouldAttemptDirectorBootstrap) {
          setPhaseMessage("Claiming director setup access...");
          try {
            await requestJson(`/api/t/${slug}/access/director-bootstrap`, {
              method: "POST",
              token,
              body: {}
            });
          } catch (bootstrapErr) {
            if (!isDirectorBootstrapDisabledError(bootstrapErr)) throw bootstrapErr;
          }
          clearDirectorBootstrapIntent(slug);
        } else if (decision.action === "accept_invite" && inviteToken) {
          clearDirectorBootstrapIntent(slug);
          setPhaseMessage("Accepting your invite...");
          await requestJson(`/api/t/${slug}/access/invite/accept`, {
            method: "POST",
            token,
            body: {
              inviteToken,
              legalAgreement: pendingLegalAgreement
            }
          });
        } else if (decision.action === "join_network") {
          clearDirectorBootstrapIntent(slug);
          setPhaseMessage("Creating your network membership...");
          await requestJson(`/api/t/${slug}/access/join`, {
            method: "POST",
            token,
            body: {
              legalAgreement: pendingLegalAgreement
            }
          });
        }

        setPhaseMessage("Finalizing sign-in...");
        payload = await requestJson(`/api/t/${slug}/access/decision`, { token });
        decision = payload?.decision || {};
        await ensureTenantSessionSync(slug, {
          token,
          legalAgreement: pendingLegalAgreement,
          inviteTokenValue: inviteToken
        });

        const next = normalizeTenantRouteForHost(
          slug,
          String(decision.nextRoute || "").trim() || routeWithSlug(slug, "/home")
        );
        clearPendingLegalAgreement(slug);
        redirected = true;
        navigate(next, { replace: true });
      } catch (err) {
        if (cancelled) return;
        if (isLegalAgreementRequiredError(err)) {
          const params = new URLSearchParams();
          if (inviteToken) params.set("inviteToken", inviteToken);
          params.set("legalRequired", "1");
          redirected = true;
          navigate(routeWithSlug(slug, `/create-account?${params.toString()}`), {
            replace: true
          });
          return;
        }
        if (isTenantScopeMismatchError(err)) {
          clearDirectorBootstrapIntent(slug);
          setPhaseMessage("Resetting sign-in so you can use the correct network account...");
          try {
            await Promise.resolve(logout?.());
          } finally {
            if (cancelled) return;
            redirected = true;
            navigate(buildLoginPath(slug, { inviteToken, authIssue: "wrong_network" }), {
              replace: true
            });
          }
          return;
        }
        if (shouldForceSessionReset(err)) {
          clearDirectorBootstrapIntent(slug);
          setPhaseMessage("Resetting sign-in...");
          try {
            await Promise.resolve(logout?.());
          } finally {
            if (cancelled) return;
            redirected = true;
            navigate(buildLoginPath(slug, { inviteToken, authIssue: "session_reset" }), {
              replace: true
            });
          }
          return;
        }
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
  }, [directorBootstrap, getToken, inviteToken, isLoaded, isSignedIn, logout, navigate, refreshSession, slug]);

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
