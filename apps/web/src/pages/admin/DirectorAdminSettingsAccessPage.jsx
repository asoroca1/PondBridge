import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button, Card, Input, Textarea } from "@pondbridge/ui";
import { ClipboardCheck, DoorOpen, KeyRound, MailCheck } from "lucide-react";
import { SettingStatus } from "../../components/admin/SettingControls.jsx";
import useAdminApi from "./useAdminApi.js";
import "./director-admin-access.css";

// Each mode is a different experience for the person trying to join, so they
// are shown as choices with consequences rather than dropdown labels.
const MODES = [
  {
    value: "open",
    icon: DoorOpen,
    label: "Anyone can join",
    blurb: "Someone finds your network, signs up, and is in immediately.",
    caution: "Best when your network is not sensitive, or you restrict by email domain below."
  },
  {
    value: "code",
    icon: KeyRound,
    label: "With a join code",
    blurb: "Only people who know the code can sign up. Share it in a newsletter or at reunion.",
    caution: "Anyone the code is forwarded to can also join."
  },
  {
    value: "approval_queue",
    icon: ClipboardCheck,
    label: "You approve each person",
    blurb: "Anyone can request access; nobody gets in until you say yes.",
    caution: "Requests land in People → Requests. Someone needs to check it."
  },
  {
    value: "invite_only",
    icon: MailCheck,
    label: "Invitation only",
    blurb: "The only way in is an invitation you send.",
    caution: "Nobody can request access on their own."
  }
];

export default function DirectorAdminSettingsAccessPage() {
  const { slug, request } = useAdminApi();
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [form, setForm] = useState({
    signupMode: "open",
    accessCode: "",
    allowedEmailDomains: "",
    requireProfileCompletion: false
  });

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await request("/settings");
      setPayload(response);
      setForm({
        signupMode: response?.access?.signupMode || "open",
        accessCode: "",
        allowedEmailDomains: (response?.access?.allowedEmailDomains || []).join("\n"),
        requireProfileCompletion: Boolean(response?.access?.requireProfileCompletion)
      });
    } catch (requestError) {
      setError(requestError.message || "Could not load access settings.");
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => { load(); }, [load]);

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setStatus("");
    try {
      // An empty code would fail the server's minimum-length rule, so only
      // send it when the director actually typed one.
      const body = { ...form };
      if (!body.accessCode.trim()) delete body.accessCode;
      await request("/settings/access", { method: "PATCH", body });
      setStatus("Access settings saved.");
      await load();
    } catch (requestError) {
      setError(requestError.message || "Could not save access settings.");
    } finally {
      setSaving(false);
    }
  }

  if (loading && !payload) return <Card><p className="muted">Loading access settings…</p></Card>;

  const active = MODES.find((mode) => mode.value === form.signupMode) || MODES[0];
  const hasCode = Boolean(payload?.access?.hasAccessCode);

  const savedMode = MODES.find((mode) => mode.value === (payload?.access?.signupMode || "open")) || MODES[0];
  const domains = payload?.access?.allowedEmailDomains || [];

  return (
    <form onSubmit={save} className="pb-access">
      <SettingStatus
        icon={savedMode.icon}
        tone="on"
        title={savedMode.label}
        detail={
          domains.length
            ? `${savedMode.blurb} Only ${domains.join(", ")} addresses are allowed.`
            : savedMode.blurb
        }
      />

      <Card>
        <h2 className="pb-section-title">How people join</h2>
        <div className="pb-access-modes" role="radiogroup" aria-label="Signup mode">
          {MODES.map((mode) => {
            const Icon = mode.icon;
            const selected = form.signupMode === mode.value;
            return (
              <button
                key={mode.value}
                type="button"
                role="radio"
                aria-checked={selected}
                className={selected ? "is-selected" : ""}
                onClick={() => setForm((prev) => ({ ...prev, signupMode: mode.value }))}
              >
                <Icon aria-hidden="true" />
                <strong>{mode.label}</strong>
                <small>{mode.blurb}</small>
              </button>
            );
          })}
        </div>

        <p className="pb-access-caution">{active.caution}</p>

        {form.signupMode === "code" ? (
          <label className="pb-access-field">
            <span>Join code</span>
            <Input
              value={form.accessCode}
              onChange={(event) => setForm((prev) => ({ ...prev, accessCode: event.target.value }))}
              placeholder={hasCode ? "Enter a new code to replace the current one" : "Choose a code, at least 6 characters"}
              spellCheck={false}
            />
            <small>
              {hasCode
                ? "A code is set. Leave this blank to keep it, or type a new one to rotate it."
                : "No code is set yet — people cannot join until you set one."}
            </small>
          </label>
        ) : null}

        {form.signupMode === "approval_queue" ? (
          <p className="pb-access-hint">
            Pending requests appear in{" "}
            <Link to={`/t/${slug}/admin/people/request`}>People → Requests</Link>.
          </p>
        ) : null}

        {form.signupMode === "invite_only" ? (
          <p className="pb-access-hint">
            Send invitations from <Link to={`/t/${slug}/admin/people/add`}>People → Add people</Link>.
          </p>
        ) : null}
      </Card>

      <Card>
        <h2 className="pb-section-title">Extra restrictions</h2>
        <label className="pb-access-field">
          <span>Allowed email domains <small>optional</small></span>
          <Textarea
            value={form.allowedEmailDomains}
            rows={3}
            onChange={(event) => setForm((prev) => ({ ...prev, allowedEmailDomains: event.target.value }))}
            placeholder={"example.org\nalumni.example.edu"}
            spellCheck={false}
          />
          <small>
            One per line. When set, only these email domains can sign up — this applies on top of the mode above.
            Leave empty to allow any address.
          </small>
        </label>

        <label className="pb-access-check">
          <input
            type="checkbox"
            checked={form.requireProfileCompletion}
            onChange={(event) => setForm((prev) => ({ ...prev, requireProfileCompletion: event.target.checked }))}
          />
          <span>
            <strong>Require a complete profile</strong>
            <small>Members must finish their profile before they can use the directory, search, and other modules.</small>
          </span>
        </label>
      </Card>

      <Card>
        <h2 className="pb-section-title">Mobile app code</h2>
        <p className="muted pb-access-mobile">
          {payload?.access?.hasMobileAppCode
            ? "Members type this code in the iPhone app to reach your camp's login."
            : "Generated automatically for the iPhone app; it appears here once ready."}
        </p>
        <Input value={payload?.access?.mobileAppCode || ""} readOnly spellCheck={false} placeholder="Generating…" />
        {payload?.access?.mobileAppCodeHint ? (
          <small className="muted">Last updated: {payload.access.mobileAppCodeHint}</small>
        ) : null}
      </Card>

      {error ? <p className="error-text" role="alert">{error}</p> : null}
      {status ? <p className="success-text" role="status">{status}</p> : null}

      <div className="pb-access-actions">
        <Button type="submit" loading={saving}>Save access settings</Button>
      </div>
    </form>
  );
}
