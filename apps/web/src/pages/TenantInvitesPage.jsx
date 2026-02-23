import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button, Card, Input, PageShell, SectionTitle, Select, Textarea } from "@pondbridge/ui";
import { requestJson } from "../lib/http.js";
import { useAuth } from "../context/AuthContext.jsx";

export default function TenantInvitesPage() {
  const { slug } = useParams();
  const { token } = useAuth();

  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [invites, setInvites] = useState([]);
  const [inviteFile, setInviteFile] = useState(null);
  const [form, setForm] = useState({
    emails: "",
    roleToAssign: "user",
    expiresInDays: 7
  });

  async function loadInvites() {
    setLoading(true);
    setError("");

    try {
      const payload = await requestJson(`/api/t/${slug}/admin/invites`, { token });
      setInvites(payload.items || []);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadInvites();
  }, [slug, token]);

  async function sendInvites(event) {
    event.preventDefault();
    setSending(true);
    setError("");
    setStatus("");

    try {
      const data = new FormData();
      data.append("emails", form.emails);
      data.append("roleToAssign", form.roleToAssign);
      data.append("expiresInDays", String(form.expiresInDays));
      if (inviteFile) data.append("file", inviteFile);

      const payload = await requestJson(`/api/t/${slug}/admin/invites/send`, {
        method: "POST",
        token,
        body: data
      });

      setStatus(
        `Invites processed. Created ${payload.createdCount}, sent ${payload.sentCount}, skipped ${payload.skipped.length}.`
      );
      setForm((prev) => ({ ...prev, emails: "" }));
      setInviteFile(null);
      await loadInvites();
    } catch (sendError) {
      setError(sendError.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <PageShell className="pb-cedar-page">
      <Card>
        <h1>Invite Members</h1>
        <p className="muted">
          Send invite-only signup links by pasting emails, uploading CSV, or both.
        </p>

        <form className="form-grid" onSubmit={sendInvites}>
          <label>
            Emails (comma/newline separated)
            <Textarea
              value={form.emails}
              placeholder="alumni1@example.com, alumni2@example.com"
              onChange={(event) => setForm((prev) => ({ ...prev, emails: event.target.value }))}
            />
          </label>
          <label>
            Optional CSV file
            <Input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => setInviteFile(event.target.files?.[0] || null)}
            />
          </label>
          <div className="inline-actions">
            <label>
              Role to assign
              <Select
                value={form.roleToAssign}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, roleToAssign: event.target.value }))
                }
              >
                <option value="user">User</option>
                <option value="tenant_admin">Tenant Admin</option>
              </Select>
            </label>
            <label>
              Expires in days
              <Input
                type="number"
                min="1"
                max="30"
                value={form.expiresInDays}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, expiresInDays: Number(event.target.value || 7) }))
                }
              />
            </label>
          </div>
          {error ? <p className="error-text">{error}</p> : null}
          {status ? <p className="success-text">{status}</p> : null}
          <div className="inline-actions">
            <Button type="submit" disabled={sending}>
              {sending ? "Sending..." : "Send invites"}
            </Button>
            <Link className="link-button secondary" to={`/t/${slug}/admin`}>
              Back to admin
            </Link>
          </div>
        </form>
      </Card>

      <Card>
        <SectionTitle>Pending Invites</SectionTitle>
        {loading ? (
          <p className="muted">Loading invites...</p>
        ) : invites.length === 0 ? (
          <p className="muted">No pending invites.</p>
        ) : (
          <div className="import-errors-wrap">
            <table className="import-errors-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Expires</th>
                  <th>Used</th>
                </tr>
              </thead>
              <tbody>
                {invites.map((invite) => (
                  <tr key={invite.id}>
                    <td>{invite.email}</td>
                    <td>{invite.roleToAssign}</td>
                    <td>{new Date(invite.expiresAt).toLocaleString()}</td>
                    <td>{invite.usedAt ? new Date(invite.usedAt).toLocaleString() : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </PageShell>
  );
}
