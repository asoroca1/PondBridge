import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import Navbar1 from "../components/Navbar1";
import ClerkCreateAccountFlow from "../components/ClerkCreateAccountFlow";
import { noteTabLoginIntent, useAuth } from "../../context/AuthContext.jsx";
import { useTenant } from "../../context/TenantContext.jsx";
import { resolveCampName, resolveNetworkDisplayName } from "../../lib/campLabels.js";
import { clerkConfigError, clerkModeRequested, clerkUiEnabled } from "../../lib/authMode.js";
import { requestJson } from "../../lib/http.js";
import { isNativeApp } from "../../lib/nativeApp.js";
import {
  buildAcceptedLegalAgreementPayload,
  LEGAL_PRIVACY_VERSION,
  LEGAL_TERMS_VERSION
} from "../../lib/legalAgreement.js";
import {
  clearPendingAccessGrant,
  readPendingAccessGrant,
  storePendingAccessGrant
} from "../../lib/pendingAccessGrant.js";
import { tenantRoute } from "../../lib/tenantRouting.js";

function BrandHeader({ tenant }) {
  const campName = resolveCampName(tenant);
  const networkName = resolveNetworkDisplayName(tenant);
  const branding = tenant?.config?.branding || tenant?.theme || {};
  const logoUrl = String(branding.logoUrl || "").trim();
  const fallbackInitials = campName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => (part[0] || "").toUpperCase())
    .join("") || "PB";

  return (
    <div className="auth-brand-header">
      <div className="auth-brand-mark" aria-hidden="true">
        {logoUrl ? <img src={logoUrl} alt="" /> : <span>{fallbackInitials}</span>}
      </div>
      <div className="auth-brand-copy">
        <p className="auth-brand-camp">{campName}</p>
        <p className="auth-brand-network">{networkName}</p>
      </div>
    </div>
  );
}

function LegacyCreateAccountFlow() {
  const navigate = useNavigate();
  const params = useParams();
  const [searchParams] = useSearchParams();
  const { login } = useAuth();
  const { slug: contextSlug = "", tenant, loading: tenantLoading } = useTenant();
  const slug = String(params.slug || contextSlug || "").trim().toLowerCase();
  const inviteToken = String(searchParams.get("inviteToken") || searchParams.get("token") || "").trim();
  const networkName = resolveNetworkDisplayName(tenant);
  const nativeApp = isNativeApp();
  const signupMode = String(
    tenant?.accessSettings?.signupMode || tenant?.config?.accessRules?.signupMode || "open"
  ).trim().toLowerCase();
  const signupEnabled = tenant?.accessSettings?.signupEnabled !== false;
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", password: "" });
  const [inviteMeta, setInviteMeta] = useState(null);
  const [inviteState, setInviteState] = useState(inviteToken ? "checking" : "idle");
  const [accessGrant, setAccessGrant] = useState(() => readPendingAccessGrant(slug));
  const [accessCode, setAccessCode] = useState("");
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [error, setError] = useState("");
  const [invalidField, setInvalidField] = useState("");
  const loginPath = tenantRoute(slug, `/login${inviteToken ? `?inviteToken=${encodeURIComponent(inviteToken)}` : ""}`);
  const legalPath = tenantRoute(slug, "/legal");
  const accessCodeRequired = signupMode === "code" && !inviteToken && !accessGrant;
  const inviteOnlyWithoutInvite = signupMode === "invite_only" && !inviteToken;

  useEffect(() => {
    noteTabLoginIntent();
  }, []);

  useEffect(() => {
    setAccessGrant(readPendingAccessGrant(slug));
  }, [slug]);

  useEffect(() => {
    if (!inviteToken || !slug) {
      setInviteMeta(null);
      setInviteState("idle");
      return;
    }

    let active = true;
    setInviteState("checking");
    requestJson(`/api/t/${slug}/auth/invite/verify`, {
      method: "POST",
      body: { inviteToken }
    })
      .then((payload) => {
        if (!active) return;
        const invite = payload?.invite || null;
        setInviteMeta(invite);
        setInviteState("valid");
        if (invite?.email) {
          setForm((current) => ({ ...current, email: invite.email }));
        }
      })
      .catch(() => {
        if (!active) return;
        setInviteMeta(null);
        setInviteState("invalid");
      });
    return () => {
      active = false;
    };
  }, [inviteToken, slug]);

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
    if (invalidField === field) setInvalidField("");
    setError("");
  }

  function showValidationError(field, message) {
    const fieldIds = {
      firstName: "member-first-name",
      lastName: "member-last-name",
      email: "member-create-email",
      password: "member-create-password",
      legal: "member-legal-agreement"
    };
    setInvalidField(field);
    setError(message);
    window.requestAnimationFrame(() => document.getElementById(fieldIds[field])?.focus());
  }

  async function verifyAccessCode(event) {
    event.preventDefault();
    setError("");
    setVerifyingCode(true);
    try {
      const payload = await requestJson(`/api/t/${slug}/auth/access-code/verify`, {
        method: "POST",
        body: { accessCode }
      });
      if (!payload?.accessGrant) throw new Error("The server did not return a join authorization.");
      storePendingAccessGrant(slug, payload.accessGrant);
      setAccessGrant(payload.accessGrant);
    } catch (requestError) {
      setError(String(requestError?.message || "That join code could not be verified."));
    } finally {
      setVerifyingCode(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setInvalidField("");

    if (!form.firstName.trim()) {
      showValidationError("firstName", "Enter your first name.");
      return;
    }
    if (!form.lastName.trim()) {
      showValidationError("lastName", "Enter your last name.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      showValidationError("email", "Enter a valid email address.");
      return;
    }
    if (form.password.length < 8) {
      showValidationError("password", "Password must be at least 8 characters.");
      return;
    }
    if (!legalAccepted) {
      showValidationError("legal", "Agree to the Terms of Service and Privacy Policy.");
      return;
    }
    if (inviteToken && inviteState !== "valid") {
      setError("This invitation is invalid or expired. Ask your camp director for a new invite.");
      return;
    }

    setSubmitting(true);
    try {
      const legalAgreement = buildAcceptedLegalAgreementPayload({ ageEligibilityConfirmed: true });
      const payload = await requestJson(`/api/t/${slug}/auth/register`, {
        method: "POST",
        body: {
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          email: form.email.trim().toLowerCase(),
          password: form.password,
          inviteToken,
          accessGrant,
          legalAgreementAccepted: true,
          ageEligibilityConfirmed: true,
          termsVersion: LEGAL_TERMS_VERSION,
          privacyVersion: LEGAL_PRIVACY_VERSION,
          legalAgreement
        }
      });
      clearPendingAccessGrant(slug);
      login(payload.token, payload.user);
      navigate(tenantRoute(slug, "/my-profile"), { replace: true });
    } catch (requestError) {
      if (requestError?.payload?.error?.code === "APPROVAL_REQUIRED") {
        navigate(tenantRoute(slug, "/request-access"), { replace: true });
        return;
      }
      setError(String(requestError?.message || "Could not create your account."));
    } finally {
      setSubmitting(false);
    }
  }

  const shell = (content) => (
    <div className={`login1 login1-modern ${nativeApp ? "login1-native-auth" : ""}`.trim()}>
      <Navbar1 />
      <section className="login1-main login1-main-modern login1-main-create-bg">
        <div className="login1-wrap">
          <article className="login1-card login1-card-modern">
            <BrandHeader tenant={tenant} />
            {content}
          </article>
        </div>
      </section>
    </div>
  );

  if (tenantLoading) {
    return shell(<p role="status">Preparing account creation…</p>);
  }

  if (inviteOnlyWithoutInvite) {
    return shell(
      <>
        <div className="login1-intro">
          <p className="login1-kicker">Camp Access</p>
          <h1 className="login1-title auth-entry-title">Invite required</h1>
          <p className="login1-clerk-panel-subtitle">
            {networkName} is invite-only. Open your personal invitation from a camp director to create an account.
          </p>
        </div>
        <Link to={loginPath} className="auth-create-account-link auth-create-account-back">Back to login</Link>
      </>
    );
  }

  if (accessCodeRequired) {
    return shell(
      <>
        <div className="login1-intro">
          <p className="login1-kicker">Camp Access</p>
          <h1 className="login1-title auth-entry-title">Enter your join code</h1>
          <p className="login1-clerk-panel-subtitle">Use the code provided by {networkName} before creating an account.</p>
        </div>
        <form className="login1-form" onSubmit={verifyAccessCode}>
          <label className="legacy-create-label" htmlFor="member-join-code">Join code</label>
          <input
            id="member-join-code"
            className="login1-input"
            value={accessCode}
            onChange={(event) => {
              setAccessCode(event.target.value);
              setError("");
            }}
            autoComplete="one-time-code"
            autoCapitalize="none"
            required
            aria-invalid={Boolean(error) || undefined}
            aria-describedby={error ? "legacy-create-error" : undefined}
          />
          {error ? <p id="legacy-create-error" className="login1-error" role="alert">{error}</p> : null}
          <button className="login1-btn" type="submit" disabled={verifyingCode || !accessCode.trim()}>
            {verifyingCode ? "Checking code…" : "Continue"}
          </button>
          <Link to={loginPath} className="auth-create-account-link auth-create-account-back">Back to login</Link>
        </form>
      </>
    );
  }

  return shell(
    <>
      <div className="login1-intro">
        <p className="login1-kicker">Camp Access</p>
        <h1 className="login1-title auth-entry-title">Create Account</h1>
        <p className="login1-clerk-panel-subtitle">
          Create your login now. You can finish your camp profile after you enter {networkName}.
        </p>
      </div>
      {inviteState === "checking" ? <p className="muted auth-inline-status" role="status">Checking your invitation…</p> : null}
      {inviteMeta ? (
        <p className="success-text auth-inline-status">Invite recognized for <strong>{inviteMeta.email || "this account"}</strong>.</p>
      ) : null}
      {inviteState === "invalid" ? (
        <p className="login1-error" role="alert">This invitation is invalid or expired. Ask your camp director for a new invite.</p>
      ) : null}
      {!signupEnabled ? (
        <p className="login1-error" role="alert">Account creation is not open yet. Contact your camp director.</p>
      ) : null}
      <form className="login1-form legacy-create-form" onSubmit={handleSubmit} noValidate>
        <div className="legacy-create-name-grid">
          <label className="legacy-create-label" htmlFor="member-first-name">
            First name
            <input
              id="member-first-name"
              className="login1-input"
              value={form.firstName}
              onChange={(event) => updateField("firstName", event.target.value)}
              autoComplete="given-name"
              disabled={submitting || !signupEnabled}
              aria-invalid={invalidField === "firstName" || undefined}
              aria-describedby={invalidField === "firstName" ? "legacy-create-error" : undefined}
            />
          </label>
          <label className="legacy-create-label" htmlFor="member-last-name">
            Last name
            <input
              id="member-last-name"
              className="login1-input"
              value={form.lastName}
              onChange={(event) => updateField("lastName", event.target.value)}
              autoComplete="family-name"
              disabled={submitting || !signupEnabled}
              aria-invalid={invalidField === "lastName" || undefined}
              aria-describedby={invalidField === "lastName" ? "legacy-create-error" : undefined}
            />
          </label>
        </div>
        <label className="legacy-create-label" htmlFor="member-create-email">
          Email address
          <input
            id="member-create-email"
            className="login1-input"
            type="email"
            value={form.email}
            onChange={(event) => updateField("email", event.target.value)}
            autoComplete="email"
            inputMode="email"
            disabled={submitting || !signupEnabled || Boolean(inviteMeta?.email)}
            aria-invalid={invalidField === "email" || undefined}
            aria-describedby={invalidField === "email" ? "legacy-create-error" : undefined}
          />
        </label>
        <label className="legacy-create-label" htmlFor="member-create-password">
          Password
          <input
            id="member-create-password"
            className="login1-input"
            type="password"
            value={form.password}
            onChange={(event) => updateField("password", event.target.value)}
            autoComplete="new-password"
            disabled={submitting || !signupEnabled}
            aria-invalid={invalidField === "password" || undefined}
            aria-describedby={invalidField === "password" ? "legacy-create-error member-password-help" : "member-password-help"}
          />
          <small id="member-password-help" className="legacy-create-help">Use at least 8 characters.</small>
        </label>
        <div className={`alumni-create-legal-block ${invalidField === "legal" ? "has-error" : ""}`}>
          <label className="alumni-create-legal-check">
            <input
              id="member-legal-agreement"
              type="checkbox"
              checked={legalAccepted}
              onChange={(event) => {
                setLegalAccepted(event.target.checked);
                setInvalidField("");
                setError("");
              }}
              disabled={submitting || !signupEnabled}
              aria-invalid={invalidField === "legal" || undefined}
              aria-describedby={invalidField === "legal" ? "legacy-create-error" : undefined}
            />
            <span>
              I agree to the <a href={`${legalPath}#terms`} target="_blank" rel="noreferrer">Terms of Service</a> and{" "}
              <a href={`${legalPath}#privacy`} target="_blank" rel="noreferrer">Privacy Policy</a>.
            </span>
          </label>
        </div>
        {error ? <p id="legacy-create-error" className="login1-error" role="alert">{error}</p> : null}
        <button
          className="login1-btn"
          type="submit"
          disabled={submitting || !signupEnabled || inviteState === "checking" || inviteState === "invalid"}
        >
          {submitting ? "Creating account…" : signupMode === "approval_queue" ? "Request access" : "Create account"}
        </button>
        <div className="auth-create-account-row">
          <span>Already have an account?</span>
          <Link to={loginPath} className="auth-create-account-link">Back to login</Link>
        </div>
      </form>
    </>
  );
}

function ClerkConfigErrorPage() {
  return (
    <div className="wizard1 wizard1--create">
      <Navbar1 />
      <section className="wizard1-main">
        <div className="wizard1-card">
          <h1 className="wizard1-h1">Create Account</h1>
          <p className="login1-error">
            {clerkConfigError() || "Clerk auth is enabled but web auth configuration is incomplete."}
          </p>
          <p className="wizard1-sub">
            Set <code>VITE_CLERK_PUBLISHABLE_KEY</code> and restart the web app.
          </p>
        </div>
      </section>
    </div>
  );
}

export default function CreateProfileWizard() {
  if (clerkUiEnabled()) return <ClerkCreateAccountFlow />;
  if (clerkModeRequested()) return <ClerkConfigErrorPage />;
  return <LegacyCreateAccountFlow />;
}
