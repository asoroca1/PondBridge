import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Button, Card, Input, Select, Textarea } from "@pondbridge/ui";
import { Trash2 } from "lucide-react";
import AlertSwitch from "./AlertSwitch.jsx";
import {
  AUDIENCE_OPTIONS,
  CATEGORY_OPTIONS,
  DEFAULT_COMPOSE,
  audienceLabel,
  formatDateTime
} from "./alertOptions.js";

const BLOCK_COPY = {
  off: {
    title: "Mobile alerts are turned off",
    body: "Nothing can be sent while the network switch above is off."
  },
  broadcasts: {
    title: "One-off alerts are turned off",
    body: "Automatic alerts still go out. Turn on “Allow one-off alerts” under Automatic alerts to send from here."
  },
  nowhere: {
    title: "Nothing can be delivered",
    body: "Push and the app inbox are both off, so an alert has nowhere to land. Turn one on under Automatic alerts."
  }
};

export default function AlertsSendView({
  request,
  slug,
  settings,
  blockReason,
  templates,
  confirm,
  onFlash,
  onError,
  onSent,
  onTemplatesChanged
}) {
  const [compose, setCompose] = useState(DEFAULT_COMPOSE);
  const [sending, setSending] = useState(false);
  const [preview, setPreview] = useState({ total: 0, loading: true });
  const [memberQuery, setMemberQuery] = useState("");
  const [memberResults, setMemberResults] = useState([]);
  const [memberSearching, setMemberSearching] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);

  const specific = compose.audience === "specific_members";
  const selectedIds = useMemo(() => new Set(compose.userIds || []), [compose.userIds]);

  useEffect(() => {
    if (!specific) return undefined;
    let cancelled = false;
    const handle = window.setTimeout(async () => {
      setMemberSearching(true);
      try {
        const query = memberQuery.trim();
        const search = query ? `?q=${encodeURIComponent(query)}&pageSize=20` : "?pageSize=20";
        const response = await request(`/members${search}`);
        if (!cancelled) setMemberResults((Array.isArray(response?.items) ? response.items : []).slice(0, 30));
      } catch {
        if (!cancelled) setMemberResults([]);
      } finally {
        if (!cancelled) setMemberSearching(false);
      }
    }, 250);
    return () => { cancelled = true; window.clearTimeout(handle); };
  }, [memberQuery, request, specific]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setPreview((current) => ({ ...current, loading: true }));
      request("/notifications/recipients-preview", {
        method: "POST",
        body: { audience: compose.audience, userIds: specific ? compose.userIds : [] }
      })
        .then((payload) => {
          if (!cancelled) setPreview({ total: Number(payload?.totalRecipients || 0), loading: false });
        })
        .catch(() => {
          if (!cancelled) setPreview({ total: 0, loading: false });
        });
    }, 180);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [compose.audience, compose.userIds, request, specific]);

  function patch(changes) {
    setCompose((prev) => ({ ...prev, ...changes }));
  }

  function toggleMember(member) {
    const id = String(member?.id || member?._id || member?.userId || "").trim();
    if (!id) return;
    setCompose((prev) => {
      const next = new Set(prev.userIds || []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...prev, userIds: [...next] };
    });
  }

  function applyTemplate(template) {
    setCompose({
      ...DEFAULT_COMPOSE,
      audience: template.audience || "all_active_members",
      category: template.category || "announcements",
      title: template.title || "",
      body: template.body || "",
      deepLink: template.deepLink || "",
      userIds: Array.isArray(template.userIds) ? template.userIds : []
    });
    onFlash(`Loaded “${template.name || "template"}”.`);
  }

  async function deleteTemplate(template) {
    const id = template.id || template._id;
    if (!id) return;
    const confirmed = await confirm({
      title: `Delete “${template.name || "this template"}”?`,
      description: "Alerts you already sent are not affected.",
      confirmLabel: "Delete template",
      tone: "danger"
    });
    if (!confirmed) return;
    try {
      await request(`/notifications/templates/${id}`, { method: "DELETE" });
      onFlash("Template deleted.");
      onTemplatesChanged();
    } catch (requestError) {
      onError(requestError.message || "Could not delete that template.");
    }
  }

  async function saveAsTemplate() {
    const name = templateName.trim();
    if (!name) {
      onError("Give the template a name first.");
      return;
    }
    if (!compose.title.trim() || !compose.body.trim()) {
      onError("Write the alert before saving it as a template.");
      return;
    }
    setSavingTemplate(true);
    try {
      await request("/notifications/templates", {
        method: "POST",
        body: {
          name,
          title: compose.title,
          body: compose.body,
          category: compose.category,
          deepLink: compose.deepLink,
          audience: compose.audience,
          userIds: specific ? compose.userIds : []
        }
      });
      onFlash(`Saved “${name}”.`);
      setTemplateName("");
      onTemplatesChanged();
    } catch (requestError) {
      onError(requestError.message || "Could not save that template.");
    } finally {
      setSavingTemplate(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (!compose.title.trim() || !compose.body.trim()) {
      onError("An alert needs a title and a message.");
      return;
    }
    if (specific && !compose.userIds.length) {
      onError("Pick at least one person.");
      return;
    }
    if (preview.loading) {
      onError("Still counting recipients — try again in a second.");
      return;
    }
    if (preview.total <= 0) {
      onError("Nobody in this audience can receive an alert right now.");
      return;
    }
    if (compose.scheduleAt) {
      const when = new Date(compose.scheduleAt).getTime();
      if (!when || Number.isNaN(when)) {
        onError("That schedule date is not valid.");
        return;
      }
      if (when < Date.now() + 60 * 1000) {
        onError("Schedule an alert at least a minute out.");
        return;
      }
      if (when > Date.now() + 30 * 24 * 60 * 60 * 1000) {
        onError("Alerts can be scheduled up to 30 days ahead.");
        return;
      }
    }

    const people = `${preview.total} ${preview.total === 1 ? "person" : "people"}`;
    const confirmed = await confirm({
      title: compose.scheduleAt ? `Schedule this for ${people}?` : `Send this to ${people} now?`,
      description: `${audienceLabel(compose.audience)} will get “${compose.title.trim()}” ${
        compose.pushRequested ? "on their lock screen and in the app inbox" : "in the app inbox only"
      }.`,
      confirmLabel: compose.scheduleAt ? "Schedule it" : "Send it",
      tone: compose.scheduleAt ? "default" : "danger"
    });
    if (!confirmed) return;

    setSending(true);
    try {
      const body = {
        audience: compose.audience,
        category: compose.category,
        title: compose.title,
        body: compose.body,
        deepLink: compose.deepLink,
        pushRequested: compose.pushRequested,
        userIds: specific ? compose.userIds : []
      };
      if (compose.scheduleAt) {
        const when = new Date(compose.scheduleAt);
        if (!Number.isNaN(when.getTime())) body.scheduleAt = when.toISOString();
      }
      const response = await request("/notifications/send", { method: "POST", body });
      if (response?.scheduled) {
        onFlash(`Scheduled for ${formatDateTime(response?.schedule?.runAt)}.`);
      } else {
        onFlash(`Sent to ${response?.totalRecipients || 0} ${response?.totalRecipients === 1 ? "person" : "people"}.`);
      }
      setCompose((prev) => ({ ...prev, title: "", body: "", scheduleAt: "" }));
      onSent(Boolean(response?.scheduled));
    } catch (requestError) {
      onError(requestError.message || "Could not send that alert.");
    } finally {
      setSending(false);
    }
  }

  if (blockReason) {
    const copy = BLOCK_COPY[blockReason];
    return (
      <div className="pb-alerts-pane">
        <Card className="pb-alerts-blocked">
          <h2 className="pb-section-title">{copy.title}</h2>
          <p className="muted">{copy.body}</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="pb-alerts-pane">
      {templates.length ? (
        <Card>
          <h2 className="pb-section-title">Reuse something</h2>
          <div className="pb-alerts-templates">
            {templates.map((template) => (
              <div key={template.id || template._id} className="pb-alerts-template">
                <button type="button" onClick={() => applyTemplate(template)}>
                  <strong>{template.name}</strong>
                  <small>{template.title}</small>
                </button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Delete ${template.name}`}
                  onClick={() => deleteTemplate(template)}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <Card>
        <form className="pb-alerts-compose" onSubmit={submit}>
          <div className="pb-alerts-row">
            <label className="pb-alerts-field">
              <span>Who gets it</span>
              <Select
                value={compose.audience}
                onChange={(event) => patch({ audience: event.target.value, userIds: [] })}
              >
                {AUDIENCE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </Select>
            </label>
            <label className="pb-alerts-field">
              <span>Category</span>
              <Select value={compose.category} onChange={(event) => patch({ category: event.target.value })}>
                {CATEGORY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </Select>
            </label>
            <div className="pb-alerts-count" role="status" aria-live="polite">
              <span>Reaches</span>
              <strong>{preview.loading ? "…" : preview.total.toLocaleString()}</strong>
              <small>{preview.loading ? "counting" : preview.total === 1 ? "phone" : "phones"}</small>
            </div>
          </div>

          {specific ? (
            <div className="pb-alerts-picker">
              <Input
                value={memberQuery}
                onChange={(event) => setMemberQuery(event.target.value)}
                placeholder="Search by name or email…"
              />
              <div className="pb-alerts-picker-meta">
                <span>
                  {compose.userIds.length
                    ? `${compose.userIds.length} selected`
                    : "Nobody selected yet"}
                </span>
                {compose.userIds.length ? (
                  <Button type="button" variant="ghost" size="sm" onClick={() => patch({ userIds: [] })}>
                    Clear
                  </Button>
                ) : null}
              </div>
              <div className="pb-alerts-picker-list">
                {memberSearching ? (
                  <p className="muted">Searching…</p>
                ) : !memberResults.length ? (
                  <p className="muted">Nobody matches that.</p>
                ) : (
                  memberResults.map((member) => {
                    const id = String(member.id || member._id || member.userId || "");
                    const name = String(
                      member.displayName
                        || [member.firstName, member.lastName].filter(Boolean).join(" ")
                        || member.email
                        || id
                    );
                    const email = String(member.email || "");
                    return (
                      <label key={id}>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(id)}
                          onChange={() => toggleMember(member)}
                        />
                        <span>
                          <strong>{name}</strong>
                          {email && email !== name ? <small>{email}</small> : null}
                        </span>
                      </label>
                    );
                  })
                )}
              </div>
            </div>
          ) : null}

          <label className="pb-alerts-field">
            <span>Title</span>
            <Input
              value={compose.title}
              maxLength={120}
              placeholder="Orientation moved to 9am"
              onChange={(event) => patch({ title: event.target.value })}
            />
          </label>

          <label className="pb-alerts-field">
            <span>Message</span>
            <Textarea
              value={compose.body}
              rows={3}
              maxLength={500}
              placeholder="Short enough to read on a lock screen."
              onChange={(event) => patch({ body: event.target.value })}
            />
            <small>{compose.body.length}/500</small>
          </label>

          <div className="pb-alerts-row">
            <label className="pb-alerts-field">
              <span>Open to <small>optional</small></span>
              <Input
                value={compose.deepLink}
                placeholder="/events"
                spellCheck={false}
                onChange={(event) => patch({ deepLink: event.target.value })}
              />
              <small>Where tapping the alert lands in the app.</small>
            </label>
            <label className="pb-alerts-field">
              <span>Send at <small>optional</small></span>
              <Input
                type="datetime-local"
                value={compose.scheduleAt}
                onChange={(event) => patch({ scheduleAt: event.target.value })}
              />
              <small>Leave blank to send as soon as you confirm.</small>
            </label>
          </div>

          <AlertSwitch
            checked={compose.pushRequested}
            onChange={(value) => patch({ pushRequested: value })}
            label="Push to lock screens"
            blurb={
              settings.pushEnabled
                ? "Turn off to leave it in the app inbox only."
                : "Push is off for this network, so this stays in the inbox."
            }
            disabled={!settings.pushEnabled}
          />

          <div className="pb-alerts-actions">
            <div className="pb-alerts-save-template">
              <Input
                value={templateName}
                placeholder="Save as…"
                onChange={(event) => setTemplateName(event.target.value)}
              />
              <Button type="button" variant="secondary" loading={savingTemplate} onClick={saveAsTemplate}>
                Save template
              </Button>
            </div>
            <Button type="submit" loading={sending} disabled={preview.loading || preview.total <= 0}>
              {compose.scheduleAt ? "Schedule alert" : "Send now"}
            </Button>
          </div>

          <p className="pb-alerts-footnote">
            This only reaches people with the app installed. To email everyone, use the{" "}
            <Link to={`/t/${slug}/admin/email/compose`}>Email workspace</Link>.
          </p>
        </form>
      </Card>
    </div>
  );
}
