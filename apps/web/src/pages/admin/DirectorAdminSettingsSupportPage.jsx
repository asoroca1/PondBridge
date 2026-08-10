import { useEffect, useState } from "react";
import { Button, Card, Input, Select, Textarea } from "@pondbridge/ui";
import { useAuth } from "../../context/AuthContext.jsx";
import { useTenant } from "../../context/TenantContext.jsx";
import useAdminApi from "./useAdminApi.js";

const SUPPORT_EMAIL = "support@pondbridgealumni.com";
const INITIAL_FORM = {
  topic: "general",
  priority: "normal",
  replyEmail: "",
  subject: "",
  message: ""
};

export default function DirectorAdminSettingsSupportPage() {
  const { request } = useAdminApi();
  const { user } = useAuth();
  const { tenant, slug } = useTenant();
  const [form, setForm] = useState(INITIAL_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    const email = String(user?.email || "").trim();
    if (!email) return;
    setForm((prev) => (prev.replyEmail ? prev : { ...prev, replyEmail: email }));
  }, [user?.email]);

  async function submitSupportRequest(event) {
    event.preventDefault();
    const subject = String(form.subject || "").trim();
    const message = String(form.message || "").trim();
    if (!subject) {
      setError("Please add a subject.");
      setStatus("");
      return;
    }
    if (message.length < 10) {
      setError("Please provide a little more detail so support can help.");
      setStatus("");
      return;
    }

    setSaving(true);
    setError("");
    setStatus("");
    try {
      const response = await request("/settings/support-request", {
        method: "POST",
        body: {
          topic: form.topic,
          priority: form.priority,
          replyEmail: form.replyEmail,
          subject,
          message
        }
      });
      const requestId = String(response?.requestId || "").trim();
      const sentTo = String(response?.sentTo || SUPPORT_EMAIL).trim().toLowerCase();
      setStatus(
        requestId
          ? `Support request sent to ${sentTo}. Reference: ${requestId}`
          : `Support request sent to ${sentTo}.`
      );
      setForm((prev) => ({
        ...prev,
        subject: "",
        message: ""
      }));
    } catch (requestError) {
      setError(requestError.message || "Unable to send support request.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="director-admin-support-card">
      <div className="director-admin-info-banner">
        <p>
          Messages are sent to <strong>{SUPPORT_EMAIL}</strong> with your tenant context so our team can help faster.
        </p>
      </div>
      {error ? <p className="error-text">{error}</p> : null}
      {status ? <p className="success-text">{status}</p> : null}
      <form className="director-admin-form-grid director-admin-support-form" onSubmit={submitSupportRequest}>
        <label>
          Topic
          <Select
            value={form.topic}
            onChange={(event) => setForm((prev) => ({ ...prev, topic: event.target.value }))}
          >
            <option value="general">General</option>
            <option value="billing">Billing</option>
            <option value="branding">Branding</option>
            <option value="members">Members</option>
            <option value="email">Email</option>
            <option value="integrations">Integrations</option>
            <option value="bug">Bug Report</option>
          </Select>
        </label>
        <label>
          Priority
          <Select
            value={form.priority}
            onChange={(event) => setForm((prev) => ({ ...prev, priority: event.target.value }))}
          >
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </Select>
        </label>
        <label className="full-width">
          Reply Email
          <Input
            type="email"
            value={form.replyEmail}
            placeholder={String(user?.email || tenant?.content?.contactEmail || "")}
            onChange={(event) => setForm((prev) => ({ ...prev, replyEmail: event.target.value }))}
          />
        </label>
        <label className="full-width">
          Subject
          <Input
            value={form.subject}
            maxLength={160}
            placeholder={`Help with ${slug || "my network"}...`}
            onChange={(event) => setForm((prev) => ({ ...prev, subject: event.target.value }))}
          />
        </label>
        <label className="full-width">
          Message
          <Textarea
            value={form.message}
            rows={6}
            maxLength={6000}
            placeholder="Describe what happened, where you saw it, and what you expected."
            onChange={(event) => setForm((prev) => ({ ...prev, message: event.target.value }))}
          />
        </label>
        <div className="director-admin-form-actions full-width">
          <Button type="submit" disabled={saving}>
            {saving ? "Sending..." : "Send to Support"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
