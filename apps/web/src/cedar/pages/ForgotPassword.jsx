import React, { useState } from "react";
import { Link, useParams } from "react-router-dom";
import Navbar1 from "../components/Navbar1";
import { requestJson } from "../../lib/http.js";
import { useTenant } from "../../context/TenantContext.jsx";

export default function ForgotPassword() {
  const { slug: paramSlug = "" } = useParams();
  const { slug: contextSlug = "" } = useTenant();
  const slug = String(paramSlug || contextSlug || "").trim().toLowerCase();

  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const loginPath = slug ? `/t/${slug}/login` : "/login";

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");

    const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!emailValid) {
      setError("Please enter a valid email address.");
      return;
    }

    setSubmitting(true);
    try {
      await requestJson(`/api/t/${slug}/auth/magic-link/request`, {
        method: "POST",
        body: { email: email.trim().toLowerCase() }
      });
      setSent(true);
    } catch (err) {
      const status = err?.status;
      if (status === 429) {
        setError("Too many requests. Please wait a few minutes and try again.");
      } else {
        setError(err?.message || "Something went wrong. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login1">
      <Navbar1 />
      <section className="login1-main">
        <div className="login1-card">
          <h1 className="login1-title">Forgot Password</h1>

          {sent ? (
            <>
              <p className="success-text" style={{ textAlign: "center", marginBottom: "1rem" }}>
                Check your email for a sign-in link
              </p>
              <p style={{ textAlign: "center", color: "#4e6683", fontSize: "0.92rem", marginBottom: "1rem" }}>
                If an account exists for <strong>{email}</strong>, we sent a magic link you can use to sign in.
              </p>
              <div style={{ textAlign: "center" }}>
                <Link to={loginPath} className="login1-forgot">
                  Back to login
                </Link>
              </div>
            </>
          ) : (
            <form className="login1-form" onSubmit={handleSubmit}>
              <p style={{ color: "#4e6683", fontSize: "0.92rem", margin: "0 0 0.25rem" }}>
                Enter your email and we'll send you a magic link to sign in.
              </p>

              <input
                className="login1-input"
                type="email"
                placeholder="Email Address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />

              {error ? <p className="login1-error">{error}</p> : null}

              <button className="login1-btn" type="submit" disabled={submitting}>
                {submitting ? "Sending..." : "Send Reset Link"}
              </button>

              <Link to={loginPath} className="login1-forgot">
                Back to login
              </Link>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}
