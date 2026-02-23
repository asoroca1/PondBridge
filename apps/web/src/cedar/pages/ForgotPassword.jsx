// src/pages/ForgotPassword.jsx
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import Navbar1 from "../components/Navbar1";
import { API_BASE } from "../lib/api";

function normalizeErrorMessage(payload, fallback) {
  if (!payload) return fallback;
  if (typeof payload === "string") return payload;
  if (typeof payload?.error === "string") return payload.error;
  if (typeof payload?.error?.message === "string") return payload.error.message;
  if (typeof payload?.message === "string") return payload.message;
  if (typeof payload?.errors?.[0]?.msg === "string") return payload.errors[0].msg;
  return fallback;
}

export default function ForgotPassword() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const validate = () => {
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!emailOk) return "Please enter a valid email address.";
    return "";
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSent(false);

    const v = validate();
    if (v) return setError(v);

    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const text = await res.text();

      if (!res.ok) {
        let msg = `Request failed (${res.status}).`;
        try {
          const j = JSON.parse(text);
          msg = normalizeErrorMessage(j, msg);
        } catch {}
        setError(msg);
        setSubmitting(false);
        return;
      }

      // Backend returns OK even if user doesn't exist
      setSent(true);
    } catch (err) {
      console.error(err);
      setError("Unable to request a reset right now. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login1">
      <Navbar1 />
      <section className="login1-main">
        <div className="login1-card">
          <h1 className="login1-title">Reset your password</h1>

          {!sent ? (
            <>
              <p style={{ marginTop: 0, opacity: 0.85 }}>
                Enter your email and we’ll send you a reset link.
              </p>

              <form className="login1-form" onSubmit={handleSubmit}>
                <input
                  className="login1-input"
                  type="email"
                  placeholder="Email Address"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />

                {error && <p className="login1-error">{error}</p>}

                <button className="login1-btn" type="submit" disabled={submitting}>
                  {submitting ? "Sending..." : "Send reset link"}
                </button>

                <button
                  type="button"
                  className="login1-forgot"
                  onClick={() => navigate("/login")}
                >
                  Back to Login
                </button>
              </form>
            </>
          ) : (
            <>
              <p style={{ marginTop: 0 }}>
                If an account exists for <b>{email}</b>, you’ll receive a reset link shortly.
              </p>
              <button className="login1-btn" onClick={() => navigate("/login")}>
                Return to Login
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
