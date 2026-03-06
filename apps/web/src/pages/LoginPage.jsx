import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Button, Card, Input, PageShell } from "@pondbridge/ui";
import { requestJson } from "../lib/http.js";
import { useAuth } from "../context/AuthContext.jsx";

export default function LoginPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { login } = useAuth();
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const magicToken = String(searchParams.get("magicToken") || "").trim();
    if (!magicToken) return;

    setSaving(true);
    setError("");
    requestJson(`/api/t/${slug}/auth/magic-link/consume`, {
      method: "POST",
      body: { token: magicToken }
    })
      .then((payload) => {
        login(payload.token, payload.user);
        navigate(`/t/${slug}/my-profile`);
      })
      .catch((consumeError) => {
        setError(consumeError.message);
      })
      .finally(() => {
        setSaving(false);
      });
  }, [searchParams, slug, navigate, login]);

  async function onSubmit(event) {
    event.preventDefault();
    setError("");
    setSaving(true);

    try {
      const payload = await requestJson(`/api/t/${slug}/auth/login`, {
        method: "POST",
        body: form
      });

      login(payload.token, payload.user);
      navigate(`/t/${slug}/my-profile`);
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageShell className="auth-shell">
      <Card className="form-card auth-card">
        <h1>Sign in</h1>
        <form onSubmit={onSubmit} className="form-grid">
          <label>
            Email
            <Input
              type="email"
              value={form.email}
              onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
            />
          </label>
          <label>
            Password
            <Input
              type="password"
              value={form.password}
              onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
            />
          </label>
          {error ? <p className="error-text">{error}</p> : null}
          <div className="inline-actions">
            <Button disabled={saving}>{saving ? "Signing in..." : "Sign in"}</Button>
          </div>
        </form>
      </Card>
    </PageShell>
  );
}
