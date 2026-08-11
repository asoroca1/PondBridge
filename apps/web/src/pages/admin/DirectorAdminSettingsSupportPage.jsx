import { useEffect, useState } from "react";
import { Button, Card, Input, Select, Textarea } from "@pondbridge/ui";
import { CheckCircle2, LifeBuoy } from "lucide-react";
import {
  SettingActions,
  SettingField,
  SettingRow,
  SettingStatus
} from "../../components/admin/SettingControls.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { useTenant } from "../../context/TenantContext.jsx";
import useAdminApi from "./useAdminApi.js";

const SUPPORT_EMAIL = "support@pondbridgealumni.com";

const TOPICS = [
  { value: "general", label: "Something else" },
  { value: "bug", label: "Something is broken" },
  { value: "members", label: "Members and access" },
  { value: "email", label: "Email and alerts" },
  { value: "branding", label: "Branding and appearance" },
  { value: "billing", label: "Billing" },
  { value: "integrations", label: "Integrations" }
];

// Named by the wait a director should expect, not by an abstract severity.
const PRIORITIES = [
  { value: "low", label: "Whenever — no rush" },
  { value: "normal", label: "Normal — within a day or two" },
  { value: "high", label: "Soon — it is blocking me" },
  { value: "urgent", label: "Urgent — members are affected" }
];

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
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(null);

  useEffect(() => {
    const email = String(user?.email || "").trim();
    if (!email) return;
    setForm((prev) => (prev.replyEmail ? prev : { ...prev, replyEmail: email }));
  }, [user?.email]);

  function patch(changes) {
    setForm((prev) => ({ ...prev, ...changes }));
  }

  async function submit(event) {
    event.preventDefault();
    const subject = form.subject.trim();
    const message = form.message.trim();
    if (!subject) {
      setError("Add a subject so we know what this is about.");
      return;
    }
    if (message.length < 10) {
      setError("Tell us a little more — what happened, and where.");
      return;
    }

    setSending(true);
    setError("");
    try {
      const response = await request("/settings/support-request", {
        method: "POST",
        body: { topic: form.topic, priority: form.priority, replyEmail: form.replyEmail, subject, message }
      });
      setSent({
        requestId: String(response?.requestId || "").trim(),
        sentTo: String(response?.sentTo || SUPPORT_EMAIL).trim().toLowerCase(),
        replyEmail: form.replyEmail.trim() || String(user?.email || "")
      });
      setForm((prev) => ({ ...prev, subject: "", message: "" }));
    } catch (requestError) {
      setError(requestError.message || "That message could not be sent.");
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <Card className="pb-set-stack">
        <div className="pb-set-note">
          <CheckCircle2 aria-hidden="true" />
          <p>
            <strong>Sent to {sent.sentTo}.</strong> We reply to{" "}
            <strong>{sent.replyEmail || "your account email"}</strong>, usually within one business day.
            {sent.requestId ? <> Quote <strong>{sent.requestId}</strong> if you follow up.</> : null}
          </p>
        </div>
        <SettingActions note="Need to send something else?">
          <Button variant="secondary" onClick={() => setSent(null)}>Write another message</Button>
        </SettingActions>
      </Card>
    );
  }

  return (
    <div className="pb-set-stack">
      <SettingStatus
        icon={LifeBuoy}
        tone="on"
        title="PondBridge support"
        detail={`Messages go to ${SUPPORT_EMAIL} with your network details attached. We usually reply within one business day.`}
      />

      <Card>
      <h2 className="pb-section-title">Message PondBridge</h2>
      <p className="muted">
        Goes to our team along with which network you are on, so nobody has to ask you for it.
      </p>

      {error ? <p className="error-text" role="alert">{error}</p> : null}

      <form className="pb-set-form" onSubmit={submit}>
        <SettingRow>
          <SettingField label="What is this about?">
            <Select value={form.topic} onChange={(event) => patch({ topic: event.target.value })}>
              {TOPICS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </Select>
          </SettingField>
          <SettingField label="How urgent is it?">
            <Select value={form.priority} onChange={(event) => patch({ priority: event.target.value })}>
              {PRIORITIES.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </Select>
          </SettingField>
        </SettingRow>

        <SettingField label="Subject">
          <Input
            value={form.subject}
            maxLength={160}
            placeholder={`Help with ${slug || "my network"}`}
            onChange={(event) => patch({ subject: event.target.value })}
          />
        </SettingField>

        <SettingField
          label="What is happening?"
          hint="What you did, what you expected, and what you saw instead. A page name or a member's email helps a lot."
        >
          <Textarea
            value={form.message}
            rows={6}
            maxLength={6000}
            placeholder="I tried to… and expected… but instead…"
            onChange={(event) => patch({ message: event.target.value })}
          />
        </SettingField>

        <SettingField label="Reply to" hint="Change this if someone else should get the answer.">
          <Input
            type="email"
            value={form.replyEmail}
            placeholder={String(user?.email || tenant?.content?.contactEmail || "")}
            onChange={(event) => patch({ replyEmail: event.target.value })}
          />
        </SettingField>

        <SettingActions note={`Sent to ${SUPPORT_EMAIL}. We usually reply within one business day.`}>
          <Button type="submit" loading={sending}>
            <LifeBuoy aria-hidden="true" />
            Send message
          </Button>
        </SettingActions>
      </form>
      </Card>
    </div>
  );
}
