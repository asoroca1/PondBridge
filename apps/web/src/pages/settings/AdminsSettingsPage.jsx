import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button, Card, Input, PageShell, SectionTitle } from "@pondbridge/ui";
import { requestJson } from "../../lib/http.js";
import { useAuth } from "../../context/AuthContext.jsx";

export default function AdminsSettingsPage() {
  const { slug } = useParams();
  const { token } = useAuth();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);

  async function addAdmin(event) {
    event.preventDefault();
    setError("");
    setStatus("");
    setSaving(true);
    try {
      const payload = await requestJson("/api/tenants/me/admins", {
        method: "POST",
        token,
        body: { email }
      });
      setStatus(`Added ${payload.admin.email} as an admin.`);
      setEmail("");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageShell className="pb-cedar-page">
      <Card>
        <SectionTitle>Admin Access</SectionTitle>
        <p className="muted">
          Add additional camp directors. They must have an existing account first.
        </p>
        <form className="form-grid" onSubmit={addAdmin}>
          <label>
            Existing member email
            <Input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="director2@yourcamp.org"
            />
          </label>
          {error ? <p className="error-text">{error}</p> : null}
          {status ? <p className="success-text">{status}</p> : null}
          <div className="inline-actions">
            <Button disabled={saving}>{saving ? "Adding..." : "Add Admin"}</Button>
            <Link className="link-button secondary" to={`/t/${slug}/admin/people/add`}>
              Manage Invites
            </Link>
            <Link className="link-button secondary" to={`/t/${slug}/onboarding`}>
              Back to Onboarding
            </Link>
          </div>
        </form>
      </Card>
    </PageShell>
  );
}
