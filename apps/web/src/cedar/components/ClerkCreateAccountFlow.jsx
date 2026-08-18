import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { SignUp, useAuth as useClerkAuth } from "@clerk/clerk-react";
import { requestJson } from "../../lib/http.js";
import { noteTabLoginIntent, useAuth } from "../../context/AuthContext.jsx";
import { useTenant } from "../../context/TenantContext.jsx";
import { tenantRoute } from "../../lib/tenantRouting.js";
import { resolveNetworkDisplayName } from "../../lib/campLabels.js";
import { buildClerkSignupContext } from "../../lib/clerkSignupContext.js";
import { isNativeApp } from "../../lib/nativeApp.js";
import {
  clearPendingLegalAgreement,
  readPendingLegalAgreement,
  setPendingLegalAgreementAccepted
} from "../../lib/legalAgreement.js";
import {
  readPendingAccessGrant,
  storePendingAccessGrant
} from "../../lib/pendingAccessGrant.js";

function routeWithSlug(slug, path) {
  return tenantRoute(slug, path);
}

export default function ClerkCreateAccountFlow() {
  const navigate = useNavigate();
  const params = useParams();
  const { slug: contextSlug, tenant, loading: tenantLoading } = useTenant();
  const slug = String(params.slug || contextSlug || "").trim().toLowerCase();
  const networkName = resolveNetworkDisplayName(tenant);
  const [searchParams] = useSearchParams();
  const inviteToken = String(searchParams.get("inviteToken") || searchParams.get("token") || "").trim();
  const legalRequired = String(searchParams.get("legalRequired") || "").trim() === "1";
  const { isLoaded, isSignedIn } = useClerkAuth();
  const { bootstrapError, clerkLoadTimedOut, retryBootstrap, logout } = useAuth();
  const [inviteMeta, setInviteMeta] = useState(null);
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [legalError, setLegalError] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [accessCodeError, setAccessCodeError] = useState("");
  const [verifyingAccessCode, setVerifyingAccessCode] = useState(false);
  const [accessGrantReady, setAccessGrantReady] = useState(() => Boolean(readPendingAccessGrant(slug)));
  const nativeApp = isNativeApp();
  const signupMode = String(
    tenant?.accessSettings?.signupMode || tenant?.config?.accessRules?.signupMode || "open"
  ).trim().toLowerCase();
  const inviteOnlyWithoutInvite = signupMode === "invite_only" && !inviteToken;
  const accessCodeRequired = signupMode === "code" && !inviteToken;
  // A new object identity on every render churns the Clerk widget's props, so
  // keep the signup context stable for as long as the slug is.
  const signupContext = useMemo(() => buildClerkSignupContext(slug, "member"), [slug]);

  useEffect(() => {
    noteTabLoginIntent();
  }, []);

  useEffect(() => {
    const pending = readPendingLegalAgreement(slug);
    setLegalAccepted(Boolean(pending?.accepted));
  }, [slug]);

  useEffect(() => {
    if (!legalRequired) return;
    setLegalError("Agree to the Terms of Service and Privacy Policy to create your account.");
  }, [legalRequired]);

  useEffect(() => {
    if (legalAccepted) {
      setPendingLegalAgreementAccepted(slug, { ageEligibilityConfirmed: true });
      return;
    }
    clearPendingLegalAgreement(slug);
  }, [legalAccepted, slug]);

  useEffect(() => {
    if (!inviteToken || !slug) return;
    requestJson(`/api/t/${slug}/auth/invite/verify`, {
      method: "POST",
      body: { inviteToken }
    })
      .then((payload) => {
        setInviteMeta(payload?.invite || null);
      })
      .catch(() => {
        setInviteMeta(null);
      });
  }, [inviteToken, slug]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !slug || tenantLoading || !tenant) return;
    if (inviteOnlyWithoutInvite || (accessCodeRequired && !readPendingAccessGrant(slug))) return;
    const callbackPath = routeWithSlug(
      slug,
      `/auth/callback${inviteToken ? `?inviteToken=${encodeURIComponent(inviteToken)}` : ""}`
    );
    navigate(callbackPath, { replace: true });
  }, [accessCodeRequired, accessGrantReady, inviteOnlyWithoutInvite, inviteToken, isLoaded, isSignedIn, navigate, slug, tenant, tenantLoading]);

  const path = routeWithSlug(slug, "/create-account");
  const callbackPath = routeWithSlug(
    slug,
    `/auth/callback${inviteToken ? `?inviteToken=${encodeURIComponent(inviteToken)}` : ""}`
  );
  const signInUrl = routeWithSlug(slug, `/login${inviteToken ? `?inviteToken=${encodeURIComponent(inviteToken)}` : ""}`);
  const legalPath = routeWithSlug(slug, "/legal");
  // Clerk's email.created webhook carries no tenant, so tell the API which camp
  // this address is signing up for before Clerk sends the code. Fire and
  // forget: a failure only costs the camp branding on the email.
  const noteSignupIntent = (form) => {
    if (!slug || !form) return;
    const email = String(
      form.querySelector('input[name="emailAddress"]')?.value ||
      form.querySelector('input[type="email"]')?.value ||
      ""
    ).trim();
    if (!email.includes("@")) return;
    requestJson(`/api/t/${slug}/auth/signup-intent`, {
      method: "POST",
      body: { email, audience: "member" }
    }).catch(() => {});
  };

  const onSignUpSubmitCapture = (event) => {
    if (legalAccepted) {
      setLegalError("");
      setPendingLegalAgreementAccepted(slug, { ageEligibilityConfirmed: true });
      noteSignupIntent(event.target?.closest?.("form") || event.target);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    setLegalError("Agree to the Terms of Service and Privacy Policy to create your account.");
  };

  async function verifyAccessCode(event) {
    event.preventDefault();
    setVerifyingAccessCode(true);
    setAccessCodeError("");
    try {
      const payload = await requestJson(`/api/t/${slug}/auth/access-code/verify`, {
        method: "POST",
        body: { accessCode }
      });
      if (!payload?.accessGrant) throw new Error("The server did not return a join authorization.");
      storePendingAccessGrant(slug, payload.accessGrant);
      setAccessGrantReady(true);
      if (isSignedIn) navigate(callbackPath, { replace: true });
    } catch (error) {
      setAccessCodeError(String(error?.message || "That join code could not be verified."));
    } finally {
      setVerifyingAccessCode(false);
    }
  }

  if (bootstrapError && (clerkLoadTimedOut || (isLoaded && isSignedIn))) {
    return (
      <div className={`login1 login1-modern login1-clerk-page ${nativeApp ? "login1-native-auth" : ""}`.trim()}>
        <section className="login1-main login1-main-modern login1-main-create-bg">
          <div className="login1-wrap">
            <article className="login1-card login1-card-modern">
              <div className="login1-intro">
                <p className="login1-kicker">Camp Access</p>
                <h1 className="login1-title auth-entry-title">We Couldn&apos;t Start Account Creation</h1>
                <p className="login1-clerk-panel-subtitle">
                  {clerkLoadTimedOut
                    ? `The sign-up service did not finish loading for ${networkName}.`
                    : `You are signed in, but we could not finish starting your ${networkName} sign-up session.`}
                </p>
              </div>
              <p className="login1-error">
                {clerkLoadTimedOut
                  ? "Refresh once and try again. If this keeps happening, use a different browser profile so we can rule out a stale Clerk session."
                  : "Retry once. If it keeps happening, sign out and restart the camp account flow."}
              </p>
              <p className="login1-forgot">
                <code>{bootstrapError}</code>
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 16 }}>
                <button
                  type="button"
                  className="login1-btn"
                  onClick={() => {
                    retryBootstrap();
                    if (clerkLoadTimedOut) {
                      window.location.reload();
                    }
                  }}
                >
                  {clerkLoadTimedOut ? "Refresh and Retry" : "Retry"}
                </button>
                <button
                  type="button"
                  className="login1-btn login1-btn-secondary"
                  onClick={() => logout()}
                >
                  Sign out and restart
                </button>
                <Link to={signInUrl} className="auth-create-account-link" style={{ textAlign: "center" }}>
                  Back to login
                </Link>
              </div>
            </article>
          </div>
        </section>
      </div>
    );
  }

  // Clerk starts a fresh sign-up attempt every time <SignUp> mounts, and each
  // attempt sends its own code. Hold it back until the tenant has loaded: the
  // access-mode guards below are not final before then, so an early mount could
  // be torn down and remounted, and the signup context would carry no slug for
  // the email.created webhook to brand against.
  if (tenantLoading || !slug) {
    return (
      <div className={`login1 login1-modern login1-clerk-page ${nativeApp ? "login1-native-auth" : ""}`.trim()}>
        <section className="login1-main login1-main-modern login1-main-create-bg">
          <div className="login1-wrap">
            <article className="login1-card login1-card-modern">
              <div className="login1-intro">
                <p className="login1-kicker">Camp Access</p>
                <h1 className="login1-title auth-entry-title">Loading</h1>
                <p className="login1-clerk-panel-subtitle">Getting {networkName} ready.</p>
              </div>
            </article>
          </div>
        </section>
      </div>
    );
  }

  if (!tenantLoading && inviteOnlyWithoutInvite) {
    return (
      <div className={`login1 login1-modern login1-clerk-page ${nativeApp ? "login1-native-auth" : ""}`.trim()}>
        <section className="login1-main login1-main-modern login1-main-create-bg">
          <div className="login1-wrap">
            <article className="login1-card login1-card-modern">
              <div className="login1-intro">
                <p className="login1-kicker">Camp Access</p>
                <h1 className="login1-title auth-entry-title">Invite required</h1>
                <p className="login1-clerk-panel-subtitle">
                  {networkName} is invite-only. Open the personal invite from your camp director to create an account.
                </p>
              </div>
              <Link to={signInUrl} className="auth-create-account-link" style={{ textAlign: "center" }}>
                Back to login
              </Link>
            </article>
          </div>
        </section>
      </div>
    );
  }

  if (!tenantLoading && accessCodeRequired && !accessGrantReady) {
    return (
      <div className={`login1 login1-modern login1-clerk-page ${nativeApp ? "login1-native-auth" : ""}`.trim()}>
        <section className="login1-main login1-main-modern login1-main-create-bg">
          <div className="login1-wrap">
            <article className="login1-card login1-card-modern">
              <div className="login1-intro">
                <p className="login1-kicker">Camp Access</p>
                <h1 className="login1-title auth-entry-title">Enter your join code</h1>
                <p className="login1-clerk-panel-subtitle">
                  Enter the code provided by {networkName} before creating your account.
                </p>
              </div>
              <form onSubmit={verifyAccessCode}>
                <label className="wizard1-label" htmlFor="member-join-code">Join code</label>
                <input
                  id="member-join-code"
                  className="login1-input"
                  value={accessCode}
                  onChange={(event) => setAccessCode(event.target.value)}
                  autoComplete="one-time-code"
                  autoCapitalize="none"
                  aria-invalid={Boolean(accessCodeError)}
                  aria-describedby={accessCodeError ? "member-join-code-error" : undefined}
                  required
                />
                {accessCodeError ? (
                  <p id="member-join-code-error" className="login1-error">{accessCodeError}</p>
                ) : null}
                <button type="submit" className="login1-btn" disabled={verifyingAccessCode || !accessCode.trim()}>
                  {verifyingAccessCode ? "Checking code..." : "Continue"}
                </button>
              </form>
              <Link to={signInUrl} className="auth-create-account-link" style={{ textAlign: "center" }}>
                Back to login
              </Link>
            </article>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className={`login1 login1-modern login1-clerk-page ${nativeApp ? "login1-native-auth" : ""}`.trim()}>
      <section className="login1-main login1-main-modern login1-main-create-bg">
        <div className="login1-wrap">
          <article className="login1-card login1-card-modern">
            <div className="login1-intro">
              <p className="login1-kicker">Camp Access</p>
              <h1 className="login1-title auth-entry-title">Create Account</h1>
              <p className="login1-clerk-panel-subtitle">
                Set up your camp account to continue to {networkName}.
              </p>
            </div>
            {inviteMeta ? (
              <p className="success-text">
                Invite recognized for <strong>{inviteMeta.email || "this account"}</strong>.
              </p>
            ) : null}
            <div className={`alumni-create-legal-block ${legalError ? "has-error" : ""}`}>
              <label className="alumni-create-legal-check">
                <input
                  type="checkbox"
                  checked={legalAccepted}
                  onChange={(event) => {
                    setLegalAccepted(event.target.checked);
                    setLegalError("");
                  }}
                />
                <span>
                  I agree to the{" "}
                  <a href={`${legalPath}#terms`} target="_blank" rel="noreferrer">
                    Terms of Service
                  </a>{" "}
                  and{" "}
                  <a href={`${legalPath}#privacy`} target="_blank" rel="noreferrer">
                    Privacy Policy
                  </a>
                  .
                </span>
              </label>
              {legalError ? <p className="error-text alumni-create-legal-error">{legalError}</p> : null}
            </div>
            <div className="login1-clerk-host alumni-create-clerk-host" onSubmitCapture={onSignUpSubmitCapture}>
              <SignUp
                path={path}
                routing="path"
                unsafeMetadata={signupContext}
                withSignIn={false}
                signInUrl={signInUrl}
                fallbackRedirectUrl={callbackPath}
                forceRedirectUrl={callbackPath}
                signInFallbackRedirectUrl={callbackPath}
                signInForceRedirectUrl={callbackPath}
                afterSignUpUrl={callbackPath}
                localization={{
                  signUp: {
                    start: {
                      title: "",
                      subtitle: ""
                    },
                    emailLink: {
                      title: "Check your email",
                      subtitle: `Open the secure sign-up link to continue to ${networkName}.`,
                      formSubtitle: `Use the secure link we sent to continue to ${networkName}.`
                    },
                    emailCode: {
                      title: "Check your email",
                      subtitle: `Enter the verification code to continue to ${networkName}.`,
                      formSubtitle: `Enter the code from your email to continue to ${networkName}.`
                    }
                  }
                }}
                appearance={{
                  variables: {
                    colorPrimary: "var(--brand-primary)",
                    colorText: "var(--text)",
                    colorTextSecondary: "var(--text-muted)",
                    colorInputBackground: "#ffffff",
                    colorInputText: "var(--text)",
                    colorNeutral: "var(--card-border)",
                    borderRadius: "12px",
                    fontFamily: "Inter Variable, Inter, Avenir Next, Segoe UI, sans-serif"
                  },
                  elements: {
                    rootBox: {
                      width: "100%"
                    },
                    socialButtons: {
                      display: "none"
                    },
                    socialButtonsBlock: {
                      display: "none"
                    },
                    socialButtonsBlockButton: {
                      display: "none"
                    },
                    socialButtonsIconButton: {
                      display: "none"
                    },
                    dividerRow: {
                      display: "none"
                    },
                    dividerLine: {
                      display: "none"
                    },
                    dividerText: {
                      display: "none"
                    },
                    footerAction: {
                      display: "none"
                    },
                    footerActionText: {
                      display: "none"
                    },
                    footerActionLink: {
                      display: "none"
                    },
                    footer: {
                      display: "none"
                    },
                    header: {
                      display: "none"
                    },
                    headerTitle: {
                      display: "none"
                    },
                    headerSubtitle: {
                      display: "none"
                    },
                    cardBox: {
                      boxShadow: "none",
                      border: "none",
                      width: "100%",
                      maxWidth: "100%",
                      background: "transparent",
                      padding: "0"
                    },
                    card: {
                      boxShadow: "none",
                      border: "none",
                      width: "100%",
                      maxWidth: "100%",
                      borderRadius: "0",
                      background: "transparent",
                      padding: "0"
                    },
                    main: {
                      padding: "0",
                      gap: "12px"
                    },
                    form: {
                      gap: "12px"
                    },
                    formFieldLabel: {
                      color: "var(--brand-primary-strong)",
                      fontWeight: "700"
                    },
                    formFieldInput: {
                      minHeight: "46px",
                      borderRadius: "12px",
                      border: "1px solid var(--card-border)",
                      boxShadow: "none",
                      color: "var(--text)",
                      background: "#ffffff"
                    },
                    formFieldInputShowPasswordButton: {
                      color: "var(--text-muted)"
                    },
                    formButtonPrimary: {
                      minHeight: "48px",
                      borderRadius: "12px",
                      background: "var(--brand-primary)",
                      boxShadow: "none",
                      fontWeight: "700",
                      fontSize: "1rem"
                    }
                  }
                }}
                unsafe_disableDevelopmentModeWarnings
              />
            </div>
            {nativeApp ? (
              <div className="auth-create-account-row auth-create-account-row-clerk">
                <span>Already have an account?</span>
                <Link to={signInUrl} className="auth-create-account-link">
                  Back to login
                </Link>
              </div>
            ) : null}
          </article>
        </div>
      </section>
    </div>
  );
}
