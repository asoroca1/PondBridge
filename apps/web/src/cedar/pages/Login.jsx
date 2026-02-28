import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { SignIn } from "@clerk/clerk-react";
import Navbar1 from "../components/Navbar1";
import { API_BASE } from "../lib/api";
import { requestJson } from "../../lib/http.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { useTenant } from "../../context/TenantContext.jsx";
import { clerkConfigError, clerkModeRequested, clerkUiEnabled } from "../../lib/authMode.js";
import { resolveNetworkDisplayName } from "../../lib/campLabels.js";
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

  return "";
}

function LoginScaffold({
  email,
  setEmail,
  password,
  setPassword,
  submitting,
  error,
  notice,
  status,
  onSubmit,
  onMagicLink,
  sendingMagicLink,
  showLegacyActions
}) {
  return (
    <div className="login1 login1-modern">
      <Navbar1 />
      <section className="login1-main login1-main-modern login1-main-create-bg">
        <div className="login1-wrap">
          <article className="login1-card login1-card-modern">
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
              {status ? <p className="success-text">{status}</p> : null}

              <button className="login1-btn" type="submit" disabled={submitting}>
                {submitting ? "Logging in..." : "Login"}
              </button>

              {showLegacyActions ? (
                <>
                  <button
                    type="button"
                    className="login1-forgot"
                    onClick={onMagicLink}
                    disabled={sendingMagicLink || !email}
                  >
                    {sendingMagicLink ? "Sending magic link..." : "Email magic link"}
                  </button>
                  <Link to="../forgot-password" className="login1-forgot" style={{ fontSize: "0.88rem" }}>
                    Forgot password?
                  </Link>
                </>
              ) : (
                <p className="login1-forgot">Password reset and verification are managed by Clerk.</p>
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
  const { slug: contextSlug = "" } = useTenant();
  const slug = String(paramSlug || contextSlug || "").trim().toLowerCase();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [sendingMagicLink, setSendingMagicLink] = useState(false);
  const notice = resolveAuthIssueMessage(searchParams);

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
    setStatus("");

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
      navigate(tenantRoute(slug, "/home"), { replace: true });
    } catch (err) {
      setError(String(err?.message || "Unable to login right now. Please try again."));
    } finally {
      setSubmitting(false);
    }
  };

  const sendMagicLink = async () => {
    setError("");
    setStatus("");
    setSendingMagicLink(true);
    try {
      await requestJson(`/api/t/${slug}/auth/magic-link/request`, {
        method: "POST",
        body: { email }
      });
      setStatus("If your account exists, a magic link has been sent.");
    } catch (magicError) {
      setError(magicError.message);
    } finally {
      setSendingMagicLink(false);
    }
  };

  return (
    <LoginScaffold
      email={email}
      setEmail={setEmail}
      password={password}
      setPassword={setPassword}
      submitting={submitting}
      error={error}
      notice={notice}
      status={status}
      onSubmit={handleSubmit}
      onMagicLink={sendMagicLink}
      sendingMagicLink={sendingMagicLink}
      showLegacyActions
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
  const notice = resolveAuthIssueMessage(searchParams);
  const path = tenantRoute(slug, "/login");
  const callbackPath = tenantRoute(
    slug,
    `/auth/callback${inviteToken ? `?inviteToken=${encodeURIComponent(inviteToken)}` : ""}`
  );
  const signUpUrl = tenantRoute(
    slug,
    `/create-account${inviteToken ? `?inviteToken=${encodeURIComponent(inviteToken)}` : ""}`
  );

  return (
    <div className="login1 login1-modern login1-clerk-page">
      <Navbar1 />
      <section className="login1-main login1-main-modern login1-main-create-bg">
        <div className="login1-wrap">
          <article className="login1-card login1-card-modern">
            <div className="login1-intro">
              <p className="login1-kicker">Camp Access</p>
              <h1 className="login1-title auth-entry-title">Login</h1>
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
                      subtitle: `Open the secure sign-in link to continue to ${networkName}.`
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
          </article>
        </div>
      </section>
    </div>
  );
}

function ClerkConfigErrorLogin() {
  return (
    <div className="login1 login1-modern">
      <Navbar1 />
      <section className="login1-main login1-main-modern login1-main-create-bg">
        <div className="login1-wrap">
          <article className="login1-card login1-card-modern">
            <div className="login1-intro">
              <p className="login1-kicker">Camp Access</p>
              <h1 className="login1-title auth-entry-title">Login</h1>
            </div>
            <p className="login1-error">{clerkConfigError() || "Clerk auth is not configured correctly."}</p>
            <p className="login1-forgot">
              Set <code>VITE_CLERK_PUBLISHABLE_KEY</code> and restart the web app.
            </p>
          </article>
        </div>
      </section>
    </div>
  );
}

export default function Login() {
  if (clerkUiEnabled()) return <ClerkLogin />;
  if (clerkModeRequested()) return <ClerkConfigErrorLogin />;
  return <LegacyLogin />;
}
