import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Button, Card, Input } from "@pondbridge/ui";
import { requestJson } from "../lib/http.js";
import { useAuth } from "../context/AuthContext.jsx";

export default function SuperLoginPage() {
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { token, user, login } = useAuth();
  const navigate = useNavigate();
  const roleSet = new Set(user?.roles || []);
  const hasSuperConsoleRole = roleSet.has("super_admin") || roleSet.has("support_admin") || roleSet.has("finance_admin");

  if (token && hasSuperConsoleRole) {
    const destination = roleSet.has("finance_admin") && !roleSet.has("super_admin") ? "/super/billing" : "/super/dashboard";
    return <Navigate to={destination} replace />;
  }

  async function onSubmit(event) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const payload = await requestJson("/api/auth/super/login", {
        method: "POST",
        body: form
      });

      login(payload.token, payload.user);
      const nextRoles = new Set(payload.user?.roles || []);
      if (nextRoles.has("finance_admin") && !nextRoles.has("super_admin")) {
        navigate("/super/billing");
      } else {
        navigate("/super/dashboard");
      }
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="super-login-shell">
      <div className="super-login-backdrop" />
      <div className="super-login-content">
        <p className="super-login-kicker">PondBridge</p>
        <h1>Super Admin Console</h1>
        <p className="super-login-subtitle">
          Manage tenants, billing, and transactional email performance.
        </p>
        <Card className="super-login-card">
          <form onSubmit={onSubmit} className="super-login-form">
            <label>
              Email
              <Input
                type="email"
                value={form.email}
                onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
                placeholder="you@pondbridge.com"
              />
            </label>
            <label>
              Password
              <Input
                type="password"
                value={form.password}
                onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
                placeholder="Enter your password"
              />
            </label>
            {error ? <p className="error-text">{error}</p> : null}
            <Button disabled={loading}>{loading ? "Signing in..." : "Sign in"}</Button>
          </form>
        </Card>
      </div>
    </section>
  );
}
