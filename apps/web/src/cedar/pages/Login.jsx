import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { SignIn } from "@clerk/clerk-react";
import Navbar1 from "../components/Navbar1";
import { API_BASE } from "../lib/api";
import { requestJson } from "../../lib/http.js";
import { noteTabLoginIntent, useAuth } from "../../context/AuthContext.jsx";
import { useTenant } from "../../context/TenantContext.jsx";
import { clerkConfigError, clerkModeRequested, clerkUiEnabled } from "../../lib/authMode.js";
import { resolveCampName, resolveNetworkDisplayName } from "../../lib/campLabels.js";
import { isNativeApp } from "../../lib/nativeApp.js";
import { tenantRoute } from "../../lib/tenantRouting.js";

function normalizeErrorMessage(payload, fallback) {
  if (!payload) return fallback;
  if (typeof payload === "string") return payload;
  if (typeof payload?.error === "string") return payload.error;
  if (typeof payload?.error?.message === "string") return payload.error.message;
  if (typeof payload?.message === "string") return payload.message;
  if (typeof payload?.errors?.[0]?.msg === "string") return payload.errors[0].msg;
  return fallback;
}

function resolveAuthIssueMessage(searchParams) {
  const authIssue = String(searchParams.get("authIssue") || "")
    .trim()
    .toLowerCase();

  if (authIssue === "wrong_network") {
    return "This account cannot access this network. Sign in with an account that belongs to this camp.";
  }
  if (authIssue === "session_reset") {
    return "Your previous sign-in session was reset. Please sign in again.";
  }

  return "";
}

function normalizeReturnTo(value = "") {
  const raw = String(value || "").trim();
  if (!raw.startsWith("/") || raw.startsWith("//")) return "";
  return raw;
}

function authPageClassName({ nativeApp = false, clerk = false } = {}) {
  return [
    "login1",
    "login1-modern",
    nativeApp ? "login1-native-auth" : "",
    clerk ? "login1-clerk-page" : ""
  ]
    .filter(Boolean)
    .join(" ");
}

function AuthBrandHeader({ tenant = null }) {
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

function LoginScaffold({
  tenant,
  signUpPath,
  email,
  setEmail,
  password,
  setPassword,
  submitting,
  error,
  notice,
  onSubmit,
  showLegacyActions,
  onRequestMagicLink = null,
  requestingMagicLink = false,
  magicLinkStatus = ""
}) {
  const nativeApp = isNativeApp();
  return (
    <div className={authPageClassName({ nativeApp })}>
      <Navbar1 />
      <section className="login1-main login1-main-modern login1-main-create-bg">
        <div className="login1-wrap">
          <article className="login1-card login1-card-modern">
            <AuthBrandHeader tenant={tenant} />
            <div className="login1-intro">
              <p className="login1-kicker">Camp Access</p>
              <h1 className="login1-title auth-entry-title">Login</h1>
              <p className="login1-clerk-panel-subtitle">
                Welcome back. Sign in with your camp account to continue.
              </p>
            </div>

            <form className="login1-form" onSubmit={onSubmit}>
              <input
                className="login1-input"
                type="email"
                placeholder="Email Address"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
              <input
                className="login1-input"
                type="password"
                placeholder="Password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />

              {notice ? <p className="login1-error">{notice}</p> : null}
              {error ? <p className="login1-error">{error}</p> : null}
              {magicLinkStatus ? <p className="success-text auth-inline-status">{magicLinkStatus}</p> : null}

              <button className="login1-btn" type="submit" disabled={submitting}>
                {submitting ? "Logging in..." : "Login"}
              </button>

              {showLegacyActions && typeof onRequestMagicLink === "function" ? (
                <button
                  className="login1-btn login1-btn-secondary"
                  type="button"
                  onClick={onRequestMagicLink}
                  disabled={submitting || requestingMagicLink}
                >
                  {requestingMagicLink ? "Sending link..." : "Email Me a Sign-In Link"}
                </button>
              ) : null}

              {showLegacyActions ? (
                <>
                  <Link to="../forgot-password" className="login1-forgot" style={{ fontSize: "0.88rem" }}>
                    Forgot password?
                  </Link>
                  <div className="auth-create-account-row">
                    <span>Need an account?</span>
                    <Link to={signUpPath} className="auth-create-account-link">
                      Create account
                    </Link>
                  </div>
                </>
              ) : (
                <div className="auth-create-account-row">
                  <span>Password reset and verification are managed by Clerk.</span>
                  <Link to={signUpPath} className="auth-create-account-link">
                    Create account
                  </Link>
                </div>
              )}
            </form>
          </article>
        </div>
      </section>
    </div>
  );
}

function LegacyLogin() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const { slug: paramSlug = "" } = useParams();
  const { slug: contextSlug = "", tenant } = useTenant();
  const slug = String(paramSlug || contextSlug || "").trim().toLowerCase();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [requestingMagicLink, setRequestingMagicLink] = useState(false);
  const [magicLinkStatus, setMagicLinkStatus] = useState("");
  const [error, setError] = useState("");
  const notice = resolveAuthIssueMessage(searchParams);
  const returnTo = normalizeReturnTo(searchParams.get("returnTo"));
  const signUpPath = tenantRoute(
    slug,
    `/create-account${searchParams.toString() ? `?${searchParams.toString()}` : ""}`
  );

  const validate = () => {
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    const passOk = password.length >= 8;
    if (!emailOk) return "Please enter a valid email address.";
    if (!passOk) return "Password must be at least 8 characters.";
    return "";
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setMagicLinkStatus("");

    const v = validate();
    if (v) return setError(v);

    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      const text = await res.text();

      if (!res.ok) {
        let msg = `Login failed (${res.status}).`;
        try {
          msg = normalizeErrorMessage(JSON.parse(text), msg);
        } catch {
          // keep default
        }
        throw new Error(msg);
      }

      const payload = JSON.parse(text || "{}");
      if (!payload?.token || !payload?.user) {
        throw new Error("Invalid login response from server.");
      }

      login(payload.token, payload.user);
      navigate(returnTo || tenantRoute(slug, "/home"), { replace: true });
    } catch (err) {
      setError(String(err?.message || "Unable to login right now. Please try again."));
    } finally {
      setSubmitting(false);
    }
  };

  const handleRequestMagicLink = async () => {
    setError("");
    setMagicLinkStatus("");
    const normalizedEmail = String(email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError("Enter your email address first so we can send a sign-in link.");
      return;
    }

    setRequestingMagicLink(true);
    try {
      await requestJson(`/api/t/${slug}/auth/magic-link/request`, {
        method: "POST",
        body: { email: normalizedEmail }
      });
      setMagicLinkStatus(`If an account exists for ${normalizedEmail}, we sent a sign-in link.`);
    } catch (requestError) {
      setError(String(requestError?.message || "Unable to send a sign-in link right now."));
    } finally {
      setRequestingMagicLink(false);
    }
  };

  return (
    <LoginScaffold
      tenant={tenant}
      signUpPath={signUpPath}
      email={email}
      setEmail={setEmail}
      password={password}
      setPassword={setPassword}
      submitting={submitting}
      error={error}
      notice={notice}
      onSubmit={handleSubmit}
      showLegacyActions
      onRequestMagicLink={handleRequestMagicLink}
      requestingMagicLink={requestingMagicLink}
      magicLinkStatus={magicLinkStatus}
    />
  );
}

function ClerkLogin() {
  const { slug: paramSlug = "" } = useParams();
  const { slug: contextSlug = "", tenant } = useTenant();
  const slug = String(paramSlug || contextSlug || "").trim().toLowerCase();
  const networkName = resolveNetworkDisplayName(tenant);
  const [searchParams] = useSearchParams();
  const inviteToken = String(searchParams.get("inviteToken") || searchParams.get("token") || "").trim();
  const returnTo = normalizeReturnTo(searchParams.get("returnTo"));
  const notice = resolveAuthIssueMessage(searchParams);
  const { user, isAuthenticated, logout } = useAuth();
  const isSuperAdmin = isAuthenticated && user?.roles?.includes("super_admin");
  const nativeApp = isNativeApp();
  const path = tenantRoute(slug, "/login");
  const callbackParams = new URLSearchParams();
  if (inviteToken) callbackParams.set("inviteToken", inviteToken);
  if (returnTo) callbackParams.set("returnTo", returnTo);
  const callbackPath = tenantRoute(
    slug,
    `/auth/callback${callbackParams.toString() ? `?${callbackParams.toString()}` : ""}`
  );
  const signUpParams = new URLSearchParams();
  if (inviteToken) signUpParams.set("inviteToken", inviteToken);
  if (returnTo) signUpParams.set("returnTo", returnTo);
  const signUpUrl = tenantRoute(
    slug,
    `/create-account${signUpParams.toString() ? `?${signUpParams.toString()}` : ""}`
  );

  useEffect(() => {
    noteTabLoginIntent();
  }, []);

  // If the current user is a super admin, block them from proceeding into
  // the camp login flow. This prevents creating unwanted user/profile records.
  if (isSuperAdmin) {
    return (
      <div className={authPageClassName({ nativeApp, clerk: true })}>
        <Navbar1 />
        <section className="login1-main login1-main-modern login1-main-create-bg">
          <div className="login1-wrap">
            <article className="login1-card login1-card-modern">
              <div className="login1-intro">
                <p className="login1-kicker">Camp Access</p>
                <h1 className="login1-title auth-entry-title">Super Admin Detected</h1>
              </div>
              <p className="login1-error">
                You are signed in as a Super Admin. Super admin accounts cannot join camp networks
                because it creates member records that affect camp data.
              </p>
              <p style={{ fontSize: "0.92rem", color: "var(--text-muted)", lineHeight: 1.5, marginTop: 8 }}>
                To access a camp as a member, sign out first and use a separate account.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 16 }}>
                <Link
                  to={nativeApp ? "/" : "/super/tenants"}
                  className="login1-btn"
                  style={{ textAlign: "center", textDecoration: "none" }}
                >
                  {nativeApp ? "Back to camp code" : "Back to Super Console"}
                </Link>
                <button
                  type="button"
                  className="login1-forgot"
                  onClick={() => logout()}
                >
                  Sign out and use a different account
                </button>
              </div>
            </article>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className={authPageClassName({ nativeApp, clerk: true })}>
      <Navbar1 />
      <section className="login1-main login1-main-modern login1-main-create-bg">
        <div className="login1-wrap">
          <article className="login1-card login1-card-modern">
            <AuthBrandHeader tenant={tenant} />
            <div className="login1-intro">
              <p className="login1-kicker">Camp Access</p>
              <h1 className="login1-title auth-entry-title">Login</h1>
              <p className="login1-clerk-panel-subtitle">
                Welcome back. Sign in to continue to {networkName}.
              </p>
            </div>
            {notice ? <p className="login1-error">{notice}</p> : null}
            <div className="login1-clerk-host">
              <SignIn
                path={path}
                routing="path"
                signUpUrl={signUpUrl}
                fallbackRedirectUrl={callbackPath}
                forceRedirectUrl={callbackPath}
                localization={{
                  signIn: {
                    start: {
                      title: "",
                      subtitle: ""
                    },
                    password: {
                      title: "Enter your password",
                      subtitle: `Continue to ${networkName}.`
                    },
                    emailCode: {
                      title: "Check your email",
                      subtitle: `Enter the verification code to continue to ${networkName}.`
                    },
                    emailLink: {
                      title: "Check your email",
                      subtitle: `Open the secure sign-in link to continue to ${networkName}.`,
                      formSubtitle: `Use the secure link in your inbox to continue to ${networkName}.`
                    },
                    emailCodeMfa: {
                      title: "Verify your login",
                      subtitle: `Enter the verification code to continue to ${networkName}.`
                    },
                    emailLinkMfa: {
                      title: "Verify your login",
                      subtitle: `Open the secure verification link to continue to ${networkName}.`,
                      formSubtitle: `Use the secure link in your inbox to continue to ${networkName}.`
                    },
                    newDeviceVerificationNotice: `For security, verify this device before continuing to ${networkName}.`
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
                    fontFamily: "Inter, Avenir Next, Segoe UI, sans-serif"
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
                      fontSize: "1rem",
                      fontWeight: "700",
                      background: "var(--brand-primary)",
                      boxShadow: "none"
                    }
                  }
                }}
              />
            </div>
            <div className="auth-create-account-row auth-create-account-row-clerk">
              <span>Need an account?</span>
              <Link to={signUpUrl} className="auth-create-account-link">
                Create account
              </Link>
            </div>
          </article>
        </div>
      </section>
    </div>
  );
}

function ClerkConfigErrorLogin() {
  const nativeApp = isNativeApp();
  const { tenant, slug: contextSlug = "" } = useTenant();
  const { slug: paramSlug = "" } = useParams();
  const slug = String(paramSlug || contextSlug || "").trim().toLowerCase();
  return (
    <div className={authPageClassName({ nativeApp })}>
      <Navbar1 />
      <section className="login1-main login1-main-modern login1-main-create-bg">
        <div className="login1-wrap">
          <article className="login1-card login1-card-modern">
            <AuthBrandHeader tenant={tenant} />
            <div className="login1-intro">
              <p className="login1-kicker">Camp Access</p>
              <h1 className="login1-title auth-entry-title">Login</h1>
            </div>
            <p className="login1-error">{clerkConfigError() || "Clerk auth is not configured correctly."}</p>
            <p className="login1-forgot">
              Set <code>VITE_CLERK_PUBLISHABLE_KEY</code> and restart the web app.
            </p>
            <div className="auth-create-account-row auth-create-account-row-clerk">
              <span>Need an account?</span>
              <Link to={tenantRoute(slug, "/create-account")} className="auth-create-account-link">
                Create account
              </Link>
            </div>
          </article>
        </div>
      </section>
    </div>
  );
}

function DemoCodeLogin() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const { slug: paramSlug = "" } = useParams();
  const { slug: contextSlug = "", tenant } = useTenant();
  const slug = String(paramSlug || contextSlug || "").trim().toLowerCase();
  const networkName = resolveNetworkDisplayName(tenant);
  const [searchParams] = useSearchParams();
  const returnTo = normalizeReturnTo(searchParams.get("returnTo"));
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const notice = resolveAuthIssueMessage(searchParams);
  const nativeApp = isNativeApp();

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    const normalizedCode = String(code || "").trim();
    if (!normalizedCode) {
      setError("Please enter your demo access code.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/auth/demo-access`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: normalizedCode })
      });
      const text = await res.text();
      if (!res.ok) {
        let msg = `Demo access failed (${res.status}).`;
        try {
          msg = normalizeErrorMessage(JSON.parse(text), msg);
        } catch {
          // keep default
        }
        throw new Error(msg);
      }
      const payload = JSON.parse(text || "{}");
      if (!payload?.token || !payload?.user) {
        throw new Error("Invalid demo access response from server.");
      }

      login(payload.token, payload.user);
      navigate(returnTo || tenantRoute(slug, "/home"), { replace: true });
    } catch (submitError) {
      setError(String(submitError?.message || "Unable to verify access code right now."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={authPageClassName({ nativeApp })}>
      <Navbar1 />
      <section className="login1-main login1-main-modern login1-main-create-bg">
        <div className="login1-wrap">
          <article className="login1-card login1-card-modern">
            <AuthBrandHeader tenant={tenant} />
            <div className="login1-intro">
              <p className="login1-kicker">Camp Access</p>
              <h1 className="login1-title auth-entry-title">Login</h1>
              <p className="login1-clerk-panel-subtitle">
                Enter your demo code to continue to {networkName}.
              </p>
            </div>

            <form className="login1-form" onSubmit={handleSubmit}>
              <input
                className="login1-input"
                type="text"
                placeholder="Demo Access Code"
                value={code}
                onChange={(event) => setCode(String(event.target.value || "").toUpperCase())}
                autoComplete="one-time-code"
                required
              />
              {notice ? <p className="login1-error">{notice}</p> : null}
              {error ? <p className="login1-error">{error}</p> : null}
              <button className="login1-btn" type="submit" disabled={submitting}>
                {submitting ? "Logging in..." : "Login"}
              </button>
              <div className="auth-create-account-row">
                <span>Need an account?</span>
                <Link to={tenantRoute(slug, "/create-account")} className="auth-create-account-link">
                  Create account
                </Link>
              </div>
            </form>
          </article>
        </div>
      </section>
    </div>
  );
}

export default function Login() {
  const { tenant } = useTenant();
  const demoAccessEnabled = Boolean(tenant?.accessSettings?.demoAccessEnabled);

  if (demoAccessEnabled) return <DemoCodeLogin />;
  if (clerkUiEnabled()) return <ClerkLogin />;
  if (clerkModeRequested()) return <ClerkConfigErrorLogin />;
  return <LegacyLogin />;
}
