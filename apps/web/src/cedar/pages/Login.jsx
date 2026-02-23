// src/pages/Login.jsx
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

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const validate = () => {
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    const passOk = password.length >= 8;
    if (!emailOk) return "Please enter a valid email address.";
    if (!passOk) return "Password must be at least 8 characters.";
    return "";
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    const v = validate();
    if (v) return setError(v);

    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      // Read body as text first so we can surface non-JSON errors
      const text = await res.text();

      if (!res.ok) {
        let msg = `Login failed (${res.status}).`;
        try {
          const j = JSON.parse(text);
          msg = normalizeErrorMessage(j, msg);
        } catch {
          /* not JSON; keep default msg */
        }
        setError(msg);
        setSubmitting(false);
        return;
      }

      // Expecting: { token, user }
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        setError("Unexpected server response.");
        setSubmitting(false);
        return;
      }

      if (!data?.token || !data?.user) {
        setError("Invalid login response from server.");
        setSubmitting(false);
        return;
      }

      // Persist auth like Create Profile does
      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));
      localStorage.setItem("pondbridgeToken", data.token);
      localStorage.setItem("pondbridgeUser", JSON.stringify(data.user));
      window.dispatchEvent(new CustomEvent("pondbridge-auth-updated"));

      navigate("/home");
    } catch (err) {
      console.error(err);
      setError("Unable to login right now. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login1">
      <Navbar1 />
      <section className="login1-main">
        <div className="login1-card">
          <h1 className="login1-title">Login</h1>

          <form className="login1-form" onSubmit={handleSubmit}>
            <input
              className="login1-input"
              type="email"
              placeholder="Email Address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <input
              className="login1-input"
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />

            {error && <p className="login1-error">{error}</p>}

            <button className="login1-btn" type="submit" disabled={submitting}>
              {submitting ? "Logging in..." : "Login"}
            </button>

            <button
              type="button"
              className="login1-forgot"
              onClick={() => navigate("/forgot-password")}
            >
              Forgot Password?
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
