// src/pages/ResetPassword.jsx
import React, { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
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

export default function ResetPassword() {
  const navigate = useNavigate();
  const { token } = useParams();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const validate = () => {
    if (!token) return "Reset token is missing.";
    if (password.length < 8) return "Password must be at least 8 characters.";
    if (password !== confirm) return "Passwords do not match.";
    return "";
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    const v = validate();
    if (v) return setError(v);

    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });

      const text = await res.text();

      if (!res.ok) {
        let msg = `Reset failed (${res.status}).`;
        try {
          const j = JSON.parse(text);
          msg = normalizeErrorMessage(j, msg);
        } catch {}
        setError(msg);
        setSubmitting(false);
        return;
      }

      setDone(true);
    } catch (err) {
      console.error(err);
      setError("Unable to reset password right now. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login1">
      <Navbar1 />
      <section className="login1-main">
        <div className="login1-card">
          <h1 className="login1-title">Choose a new password</h1>

          {!done ? (
            <form className="login1-form" onSubmit={handleSubmit}>
              <input
                className="login1-input"
                type="password"
                placeholder="New password (8+ characters)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <input
                className="login1-input"
                type="password"
                placeholder="Confirm new password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />

              {error && <p className="login1-error">{error}</p>}

              <button className="login1-btn" type="submit" disabled={submitting}>
                {submitting ? "Updating..." : "Update password"}
              </button>

              <button
                type="button"
                className="login1-forgot"
                onClick={() => navigate("/login")}
              >
                Back to Login
              </button>
            </form>
          ) : (
            <>
              <p style={{ marginTop: 0 }}>Your password has been updated.</p>
              <button className="login1-btn" onClick={() => navigate("/login")}>
                Login
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
