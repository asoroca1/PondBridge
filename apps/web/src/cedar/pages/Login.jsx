import React, { useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { SignIn } from "@clerk/clerk-react";
import Navbar1 from "../components/Navbar1";
import { API_BASE } from "../lib/api";
import { requestJson } from "../../lib/http.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { useTenant } from "../../context/TenantContext.jsx";
import { clerkConfigError, clerkModeRequested, clerkUiEnabled } from "../../lib/authMode.js";
import { resolveNetworkDisplayName } from "../../lib/campLabels.js";

function normalizeErrorMessage(payload, fallback) {
  if (!payload) return fallback;
  if (typeof payload === "string") return payload;
  if (typeof payload?.error === "string") return payload.error;
  if (typeof payload?.error?.message === "string") return payload.error.message;
  if (typeof payload?.message === "string") return payload.message;
  if (typeof payload?.errors?.[0]?.msg === "string") return payload.errors[0].msg;
  return fallback;
}

function LoginScaffold({
  email,
  setEmail,
  password,
  setPassword,
  submitting,
  error,
  status,
  onSubmit,
  onMagicLink,
  sendingMagicLink,
  showLegacyActions
}) {
  return (
    <div className="login1">
      <Navbar1 />
      <section className="login1-main">
        <div className="login1-card">
          <h1 className="login1-title">Login</h1>

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
              </>
            ) : (
              <p className="login1-forgot">Password reset and verification are managed by Clerk.</p>
            )}
          </form>
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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [sendingMagicLink, setSendingMagicLink] = useState(false);

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
      navigate(slug ? `/t/${slug}/home` : "/home", { replace: true });
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
  const path = slug ? `/t/${slug}/login` : "/login";
  const callbackPath = slug
    ? `/t/${slug}/auth/callback${inviteToken ? `?inviteToken=${encodeURIComponent(inviteToken)}` : ""}`
    : `/auth/callback${inviteToken ? `?inviteToken=${encodeURIComponent(inviteToken)}` : ""}`;
  const signUpUrl = slug
    ? `/t/${slug}/create-account${inviteToken ? `?inviteToken=${encodeURIComponent(inviteToken)}` : ""}`
    : `/create-account${inviteToken ? `?inviteToken=${encodeURIComponent(inviteToken)}` : ""}`;

  return (
    <div className="login1">
      <Navbar1 />
      <section className="login1-main">
        <div className="login1-card">
          <h1 className="login1-title">Login</h1>
          <h2 className="login1-clerk-panel-title">Sign in to {networkName}</h2>
          <p className="login1-clerk-panel-subtitle">Use email, Google, Apple, and password recovery via Clerk.</p>
          <SignIn
            path={path}
            routing="path"
            signUpUrl={signUpUrl}
            fallbackRedirectUrl={callbackPath}
            forceRedirectUrl={callbackPath}
            appearance={{
              elements: {
                rootBox: {
                  width: "100%"
                },
                card: {
                  boxShadow: "none",
                  border: "none",
                  width: "100%",
                  background: "transparent",
                  padding: "0"
                },
                header: {
                  display: "none"
                },
                headerTitle: {
                  display: "none"
                },
                headerSubtitle: {
                  display: "none"
                }
              }
            }}
          />
        </div>
      </section>
    </div>
  );
}

function ClerkConfigErrorLogin() {
  return (
    <div className="login1">
      <Navbar1 />
      <section className="login1-main">
        <div className="login1-card">
          <h1 className="login1-title">Login</h1>
          <p className="login1-error">{clerkConfigError() || "Clerk auth is not configured correctly."}</p>
          <p className="login1-forgot">
            Set <code>VITE_CLERK_PUBLISHABLE_KEY</code> and restart the web app.
          </p>
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
