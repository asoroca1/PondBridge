import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useAuth as useClerkAuth } from "@clerk/clerk-react";
import { requestJson } from "../lib/http.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useTenant } from "../context/TenantContext.jsx";
import { clerkUiEnabled } from "../lib/authMode.js";
import {
  normalizeAccountConfirmationReturnTo
} from "../lib/accountConfirmation.js";
import { buildAcceptedLegalAgreementPayload } from "../lib/legalAgreement.js";
import { normalizeTenantRouteForHost, tenantRoute } from "../lib/tenantRouting.js";

function errorCode(error) {
  return String(error?.payload?.error?.code || error?.code || "").trim().toUpperCase();
}

function shouldRefreshConfirmationDecision(code = "") {
  return [
    "ACCOUNT_CONFIRMATION_CHANGED",
    "ACCOUNT_CONFIRMATION_REVOKED",
    "ACCOUNT_CONFIRMATION_FORBIDDEN"
  ].includes(String(code || "").trim().toUpperCase());
}

function AccountConfirmationFlow({ identityLoaded, signedIn, getIdentityToken, logout, refreshSession }) {
  const navigate = useNavigate();
  const params = useParams();
  const [searchParams] = useSearchParams();
  const { slug: contextSlug = "", tenant } = useTenant();
  const slug = String(params.slug || contextSlug || "").trim().toLowerCase();
  const returnTo = normalizeAccountConfirmationReturnTo(searchParams.get("returnTo"), slug);
  const [loading, setLoading] = useState(true);
  const [required, setRequired] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [retryNonce, setRetryNonce] = useState(0);
  const campName = String(tenant?.name || "").trim() || "your camp network";
  const homePath = tenantRoute(slug, "/home");

  useEffect(() => {
    if (!identityLoaded || !slug) return undefined;
    let active = true;

    async function check() {
      if (!signedIn) {
        const loginParams = new URLSearchParams();
        if (returnTo) loginParams.set("returnTo", returnTo);
        navigate(tenantRoute(slug, `/login${loginParams.toString() ? `?${loginParams.toString()}` : ""}`), {
          replace: true
        });
        return;
      }

      setLoading(true);
      setError("");
      try {
        const token = await getIdentityToken();
        if (!token) throw new Error("Your sign-in session is still loading. Try again.");
        const payload = await requestJson(`/api/t/${slug}/access/decision`, {
          token,
          cache: "no-store"
        });
        if (!active) return;
        const decision = payload?.decision || {};
        if (decision.action === "confirm_account" && decision.confirmation?.required === true) {
          setRequired(true);
          return;
        }

        if (decision.state === "active_member") {
          await refreshSession?.({ tenantSlug: slug, strictTenantSync: true }).catch(() => {});
          const next = normalizeTenantRouteForHost(
            slug,
            returnTo || String(decision.nextRoute || homePath)
          );
          navigate(next, { replace: true });
          return;
        }
        if (decision.action === "contact_director" || decision.state === "revoked") {
          navigate(normalizeTenantRouteForHost(
            slug,
            String(decision.nextRoute || tenantRoute(slug, "/login"))
          ), { replace: true });
          return;
        }
        const callbackParams = new URLSearchParams();
        if (returnTo) callbackParams.set("returnTo", returnTo);
        navigate(tenantRoute(slug, `/auth/callback${callbackParams.toString() ? `?${callbackParams.toString()}` : ""}`), {
          replace: true
        });
      } catch (caught) {
        if (!active) return;
        const code = errorCode(caught);
        if (["TENANT_SCOPE_DENIED", "TENANT_CLAIM_REQUIRED", "ACCOUNT_CONFIRMATION_IDENTITY_MISMATCH"].includes(code)) {
          setError("This sign-in does not match the account waiting in this camp network. Sign out and use the verified account that received approval.");
        } else {
          setError(String(caught?.message || "Could not check your account confirmation."));
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    check();
    return () => {
      active = false;
    };
  }, [getIdentityToken, homePath, identityLoaded, navigate, refreshSession, retryNonce, returnTo, signedIn, slug]);

  async function confirmAndEnter() {
    if (saving || !required) return;
    setSaving(true);
    setError("");
    try {
      const token = await getIdentityToken();
      if (!token) throw new Error("Your sign-in session is still loading. Try again.");
      const payload = await requestJson(`/api/t/${slug}/access/confirm-account`, {
        method: "POST",
        token,
        body: {
          legalAgreement: buildAcceptedLegalAgreementPayload({ ageEligibilityConfirmed: true })
        }
      });
      if (payload?.confirmed !== true) throw new Error("The server did not confirm your account. Try again.");
      await refreshSession?.({ tenantSlug: slug, strictTenantSync: true });
      const next = normalizeTenantRouteForHost(
        slug,
        returnTo || String(payload?.decision?.nextRoute || payload?.nextRoute || homePath)
      );
      navigate(next, { replace: true });
    } catch (caught) {
      const code = errorCode(caught);
      if (shouldRefreshConfirmationDecision(code)) {
        setRequired(false);
        setSaving(false);
        setLoading(true);
        setRetryNonce((value) => value + 1);
        return;
      }
      setError(String(caught?.message || "Could not save your confirmation. Try again."));
      setSaving(false);
    }
  }

  async function signOut() {
    await Promise.resolve(logout?.()).catch(() => {});
    navigate(tenantRoute(slug, "/login"), { replace: true });
  }

  if (loading || !identityLoaded) {
    return (
      <section className="app-status-shell">
        <div className="app-status-card"><p>Checking your account...</p></div>
      </section>
    );
  }

  return (
    <section className="app-status-shell">
      <div className="app-status-card pb-account-confirmation">
        <h1>{required ? "One confirmation before you enter" : "Account confirmation"}</h1>
        {required ? (
          <>
            <p>Your director has approved your account for {campName}.</p>
            <p>
              By selecting <strong>Confirm and enter</strong>, I confirm that I am at least 14 and agree to the{" "}
              <Link to={tenantRoute(slug, "/legal#terms")} target="_blank" rel="noreferrer">Terms of Service</Link>
              {" "}and{" "}
              <Link to={tenantRoute(slug, "/legal#privacy")} target="_blank" rel="noreferrer">Privacy Policy</Link>.
            </p>
            <button type="button" className="login1-btn" onClick={confirmAndEnter} disabled={saving}>
              {saving ? "Saving confirmation..." : "Confirm and enter"}
            </button>
          </>
        ) : null}
        {error ? <p className="error-text" role="alert">{error}</p> : null}
        <button type="button" className="pb-pending-back" onClick={signOut}>Sign out</button>
        {!required && error ? (
          <button type="button" className="pb-pending-back" onClick={() => setRetryNonce((value) => value + 1)}>
            Try again
          </button>
        ) : null}
      </div>
    </section>
  );
}

function ClerkAccountConfirmationPage() {
  const { isLoaded, isSignedIn, getToken } = useClerkAuth();
  const auth = useAuth();
  const getIdentityToken = useCallback(async () => {
    const appToken = await Promise.resolve(auth.getAuthToken?.()).catch(() => "");
    if (appToken) return appToken;
    if (isLoaded && isSignedIn) return (await getToken()) || "";
    return String(auth.token || "");
  }, [auth.getAuthToken, auth.token, getToken, isLoaded, isSignedIn]);
  const hasLegacySession = Boolean(auth.isAuthenticated && auth.token);
  return (
    <AccountConfirmationFlow
      identityLoaded={Boolean(auth.isReady && (isLoaded || hasLegacySession))}
      signedIn={Boolean(hasLegacySession || (isLoaded && isSignedIn))}
      getIdentityToken={getIdentityToken}
      logout={auth.logout}
      refreshSession={auth.refreshSession}
    />
  );
}

function LegacyAccountConfirmationPage() {
  const auth = useAuth();
  const getIdentityToken = useCallback(
    async () => (await Promise.resolve(auth.getAuthToken?.()).catch(() => "")) || String(auth.token || ""),
    [auth.getAuthToken, auth.token]
  );
  return (
    <AccountConfirmationFlow
      identityLoaded={Boolean(auth.isReady)}
      signedIn={Boolean(auth.isAuthenticated && auth.token)}
      getIdentityToken={getIdentityToken}
      logout={auth.logout}
      refreshSession={auth.refreshSession}
    />
  );
}

export default function TenantAccountConfirmationPage() {
  return clerkUiEnabled() ? <ClerkAccountConfirmationPage /> : <LegacyAccountConfirmationPage />;
}
