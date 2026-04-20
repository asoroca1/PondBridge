import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, Input, Select, Textarea } from "@pondbridge/ui";
import useAdminApi from "./useAdminApi.js";

const CATEGORY_OPTIONS = [
  { value: "announcements", label: "Announcements" },
  { value: "events", label: "Events" },
  { value: "community", label: "Community" },
  { value: "account", label: "Account" },
  { value: "admin", label: "Admin" }
];

const AUDIENCE_OPTIONS = [
  { value: "all_active_members", label: "All Active Members" },
  { value: "admins", label: "Admins Only" },
  { value: "all_users", label: "Everyone" },
  { value: "flagged_members", label: "Flagged Members" },
  { value: "pending_members", label: "Pending Members" },
  { value: "specific_members", label: "Specific Members" }
];

const PREFERENCE_TOGGLES = [
  ["mobileEnabled", "Enable mobile notifications"],
  ["pushEnabled", "Allow push delivery"],
  ["inboxEnabled", "Keep a mobile inbox"],
  ["soundEnabled", "Play push sound"],
  ["customBroadcasts", "Allow directors to send custom mobile notifications"]
];

const AUTOMATIC_TOGGLES = [
  ["newMemberJoined", "New member joined — notify admins"],
  ["approvalRequests", "Approval requests — notify admins"],
  ["memberFlagged", "Member flagged — notify admins"],
  ["eventPublished", "Event published — notify members"],
  ["eventCanceled", "Event canceled — notify members"],
  ["newsletterPublished", "Newsletter published — notify members"],
  ["weeklySummary", "Reserve weekly summary slot"]
];

const DEFAULT_PREFS = {
  mobileEnabled: true,
  pushEnabled: true,
  inboxEnabled: true,
  soundEnabled: true,
  newMemberJoined: true,
  approvalRequests: true,
  memberFlagged: true,
  weeklySummary: false,
  eventPublished: true,
  eventCanceled: true,
  newsletterPublished: true,
  customBroadcasts: true
};

const DEFAULT_COMPOSE = {
  audience: "all_active_members",
  category: "announcements",
  title: "",
  body: "",
  deepLink: "",
  pushRequested: true,
  scheduleAt: "",
  userIds: []
};

function formatDateTime(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString();
}

function formatScheduleStatus(status) {
  const key = String(status || "").trim().toLowerCase();
  if (key === "pending") return "Scheduled";
  if (key === "sent") return "Sent";
  if (key === "failed") return "Failed";
  if (key === "canceled") return "Canceled";
  if (key === "sending") return "Sending…";
  return status || "—";
}

export default function DirectorAdminNotificationsPage() {
  const { request } = useAdminApi();
  const [settings, setSettings] = useState(DEFAULT_PREFS);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const [compose, setCompose] = useState(DEFAULT_COMPOSE);
  const [sending, setSending] = useState(false);

  const [history, setHistory] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [schedules, setSchedules] = useState([]);

  const [memberQuery, setMemberQuery] = useState("");
  const [memberResults, setMemberResults] = useState([]);
  const [memberSearching, setMemberSearching] = useState(false);

  const [templateName, setTemplateName] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);

  const loadSettings = useCallback(async () => {
    setSettingsLoading(true);
    try {
      const response = await request("/settings");
      const prefs = response?.notifications || {};
      setSettings({ ...DEFAULT_PREFS, ...prefs });
    } catch (requestError) {
      setError(requestError.message || "Unable to load notification settings.");
    } finally {
      setSettingsLoading(false);
    }
  }, [request]);

  const loadHistory = useCallback(async () => {
    try {
      const response = await request("/notifications/history");
      setHistory(Array.isArray(response?.items) ? response.items : []);
    } catch {
      setHistory([]);
    }
  }, [request]);

  const loadTemplates = useCallback(async () => {
    try {
      const response = await request("/notifications/templates");
      setTemplates(Array.isArray(response?.items) ? response.items : []);
    } catch {
      setTemplates([]);
    }
  }, [request]);

  const loadSchedules = useCallback(async () => {
    try {
      const response = await request("/notifications/schedules");
      setSchedules(Array.isArray(response?.items) ? response.items : []);
    } catch {
      setSchedules([]);
    }
  }, [request]);

  useEffect(() => {
    loadSettings();
    loadHistory();
    loadTemplates();
    loadSchedules();
  }, [loadSettings, loadHistory, loadTemplates, loadSchedules]);

  useEffect(() => {
    if (compose.audience !== "specific_members") return undefined;
    const query = memberQuery.trim();
    let cancelled = false;
    const handle = setTimeout(async () => {
      setMemberSearching(true);
      try {
        const search = query ? `?q=${encodeURIComponent(query)}&pageSize=20` : "?pageSize=20";
        const response = await request(`/members${search}`);
        if (cancelled) return;
        const items = Array.isArray(response?.items)
          ? response.items
          : Array.isArray(response?.members)
          ? response.members
          : Array.isArray(response)
          ? response
          : [];
        setMemberResults(items.slice(0, 30));
      } catch {
        if (!cancelled) setMemberResults([]);
      } finally {
        if (!cancelled) setMemberSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [compose.audience, memberQuery, request]);

  const selectedMemberIds = useMemo(() => new Set(compose.userIds || []), [compose.userIds]);

  function flashStatus(message) {
    setStatus(message);
    setError("");
    if (message) {
      setTimeout(() => setStatus(""), 4000);
    }
  }

  function flashError(message) {
    setError(message);
    setStatus("");
  }

  async function saveSettings(event) {
    event.preventDefault();
    setSettingsSaving(true);
    setError("");
    try {
      await request("/settings/notifications", { method: "PATCH", body: settings });
      flashStatus("Notification preferences saved.");
      await loadSettings();
    } catch (requestError) {
      flashError(requestError.message || "Unable to save preferences.");
    } finally {
      setSettingsSaving(false);
    }
  }

  function toggleMember(user) {
    const id = String(user?.id || user?._id || user?.userId || "").trim();
    if (!id) return;
    setCompose((prev) => {
      const next = new Set(prev.userIds || []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...prev, userIds: [...next] };
    });
  }

  function clearSelectedMembers() {
    setCompose((prev) => ({ ...prev, userIds: [] }));
  }

  async function submitCompose(event) {
    event.preventDefault();
    if (!compose.title.trim() || !compose.body.trim()) {
      flashError("Title and body are required.");
      return;
    }
    if (compose.audience === "specific_members" && !compose.userIds.length) {
      flashError("Pick at least one member to send to.");
      return;
    }
    setSending(true);
    setError("");
    try {
      const payload = {
        audience: compose.audience,
        category: compose.category,
        title: compose.title,
        body: compose.body,
        deepLink: compose.deepLink,
        pushRequested: compose.pushRequested,
        userIds: compose.audience === "specific_members" ? compose.userIds : []
      };
      if (compose.scheduleAt) {
        const when = new Date(compose.scheduleAt);
        if (!Number.isNaN(when.getTime())) payload.scheduleAt = when.toISOString();
      }
      const response = await request("/notifications/send", { method: "POST", body: payload });
      if (response?.scheduled) {
        flashStatus(`Scheduled for ${formatDateTime(response?.schedule?.runAt)}.`);
        await loadSchedules();
      } else {
        flashStatus(`Sent to ${response?.totalRecipients || 0} recipients.`);
        await loadHistory();
      }
      setCompose((prev) => ({ ...prev, title: "", body: "", scheduleAt: "" }));
    } catch (requestError) {
      flashError(requestError.message || "Unable to send notification.");
    } finally {
      setSending(false);
    }
  }

  async function saveAsTemplate() {
    const name = templateName.trim();
    if (!name) {
      flashError("Give the template a name first.");
      return;
    }
    if (!compose.title.trim() || !compose.body.trim()) {
      flashError("Fill in title and body before saving a template.");
      return;
    }
    setSavingTemplate(true);
    setError("");
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
          userIds: compose.audience === "specific_members" ? compose.userIds : []
        }
      });
      flashStatus(`Template "${name}" saved.`);
      setTemplateName("");
      await loadTemplates();
    } catch (requestError) {
      flashError(requestError.message || "Unable to save template.");
    } finally {
      setSavingTemplate(false);
    }
  }

  function applyTemplate(template) {
    if (!template) return;
    setCompose({
      audience: template.audience || "all_active_members",
      category: template.category || "announcements",
      title: template.title || "",
      body: template.body || "",
      deepLink: template.deepLink || "",
      pushRequested: true,
      scheduleAt: "",
      userIds: Array.isArray(template.userIds) ? template.userIds : []
    });
    flashStatus(`Loaded template "${template.name || ""}".`);
  }

  async function deleteTemplate(template) {
    if (!template?.id && !template?._id) return;
    const id = template.id || template._id;
    setError("");
    try {
      await request(`/notifications/templates/${id}`, { method: "DELETE" });
      flashStatus("Template deleted.");
      await loadTemplates();
    } catch (requestError) {
      flashError(requestError.message || "Unable to delete template.");
    }
  }

  async function cancelSchedule(schedule) {
    if (!schedule?.id && !schedule?._id) return;
    const id = schedule.id || schedule._id;
    setError("");
    try {
      await request(`/notifications/schedules/${id}`, { method: "DELETE" });
      flashStatus("Scheduled notification canceled.");
      await loadSchedules();
    } catch (requestError) {
      flashError(requestError.message || "Unable to cancel schedule.");
    }
  }

  const upcomingSchedules = useMemo(
    () => schedules.filter((item) => String(item?.status || "").toLowerCase() === "pending"),
    [schedules]
  );
  const recentSchedules = useMemo(
    () => schedules.filter((item) => String(item?.status || "").toLowerCase() !== "pending").slice(0, 10),
    [schedules]
  );

  if (settingsLoading) {
    return (
      <Card>
        <p className="muted">Loading mobile notification settings…</p>
      </Card>
    );
  }

  return (
    <div className="director-admin-stack">
      <Card>
        <h2 className="pb-section-title">Mobile Notifications</h2>
        <p className="muted">
          Send push notifications to members' phones and control which automatic alerts your camp sends.
          Settings and sends here only affect the mobile app — they do not email anyone.
        </p>
        {error ? <p className="error-text">{error}</p> : null}
        {status ? <p className="success-text">{status}</p> : null}
      </Card>

      <Card>
        <h3 className="pb-section-title">Push & Inbox Controls</h3>
        <form className="director-admin-form-grid" onSubmit={saveSettings}>
          {PREFERENCE_TOGGLES.map(([key, label]) => (
            <label key={key} className="director-admin-inline-check full-width">
              <input
                type="checkbox"
                checked={Boolean(settings[key])}
                onChange={(event) => setSettings((prev) => ({ ...prev, [key]: event.target.checked }))}
              />
              <span>{label}</span>
            </label>
          ))}
          <div className="director-admin-form-actions full-width">
            <Button type="submit" disabled={settingsSaving}>
              {settingsSaving ? "Saving…" : "Save Controls"}
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        <h3 className="pb-section-title">Automatic Notifications</h3>
        <p className="muted">Turn on the events that should auto-push to phones without you lifting a finger.</p>
        <form className="director-admin-form-grid" onSubmit={saveSettings}>
          {AUTOMATIC_TOGGLES.map(([key, label]) => (
            <label key={key} className="director-admin-inline-check full-width">
              <input
                type="checkbox"
                checked={Boolean(settings[key])}
                onChange={(event) => setSettings((prev) => ({ ...prev, [key]: event.target.checked }))}
              />
              <span>{label}</span>
            </label>
          ))}
          <div className="director-admin-form-actions full-width">
            <Button type="submit" disabled={settingsSaving}>
              {settingsSaving ? "Saving…" : "Save Automatic Triggers"}
            </Button>
          </div>
        </form>
      </Card>

      {templates.length ? (
        <Card>
          <h3 className="pb-section-title">Templates</h3>
          <p className="muted">Reusable pushes. Click to load into the composer below.</p>
          <div className="director-admin-table-wrap">
            <table className="director-admin-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Title</th>
                  <th>Category</th>
                  <th>Audience</th>
                  <th style={{ width: 1 }} />
                </tr>
              </thead>
              <tbody>
                {templates.map((template) => (
                  <tr key={template.id || template._id}>
                    <td><strong>{template.name}</strong></td>
                    <td>{template.title}</td>
                    <td>{template.category}</td>
                    <td>{template.audience?.replace(/_/g, " ") || "all active members"}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <Button variant="ghost" onClick={() => applyTemplate(template)}>Load</Button>
                      <Button variant="ghost" onClick={() => deleteTemplate(template)}>Delete</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      <Card>
        <h3 className="pb-section-title">Compose Push</h3>
        <form className="director-admin-form-grid" onSubmit={submitCompose}>
          <label className="full-width">
            Audience
            <Select
              value={compose.audience}
              onChange={(event) => setCompose((prev) => ({ ...prev, audience: event.target.value, userIds: [] }))}
            >
              {AUDIENCE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </Select>
          </label>

          {compose.audience === "specific_members" ? (
            <div className="full-width">
              <label>
                Search Members
                <Input
                  value={memberQuery}
                  onChange={(event) => setMemberQuery(event.target.value)}
                  placeholder="Name or email…"
                />
              </label>
              <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                {compose.userIds.length
                  ? `${compose.userIds.length} member${compose.userIds.length === 1 ? "" : "s"} selected`
                  : "No members selected yet."}
                {compose.userIds.length ? (
                  <Button variant="ghost" onClick={clearSelectedMembers} type="button" style={{ marginLeft: 8 }}>
                    Clear
                  </Button>
                ) : null}
              </div>
              <div
                style={{
                  maxHeight: 220,
                  overflowY: "auto",
                  border: "1px solid var(--pb-border, rgba(0,0,0,0.1))",
                  borderRadius: 8,
                  marginTop: 8
                }}
              >
                {memberSearching ? (
                  <p className="muted" style={{ padding: 12 }}>Searching…</p>
                ) : !memberResults.length ? (
                  <p className="muted" style={{ padding: 12 }}>No members match.</p>
                ) : (
                  memberResults.map((member) => {
                    const id = String(member.id || member._id || member.userId || "");
                    const name = String(
                      member.displayName ||
                        [member.firstName, member.lastName].filter(Boolean).join(" ") ||
                        member.email ||
                        id
                    );
                    const email = String(member.email || "");
                    return (
                      <label
                        key={id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          padding: "8px 12px",
                          borderBottom: "1px solid rgba(0,0,0,0.05)",
                          cursor: "pointer"
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={selectedMemberIds.has(id)}
                          onChange={() => toggleMember(member)}
                        />
                        <span>
                          <strong>{name}</strong>
                          {email && email !== name ? <span className="muted"> · {email}</span> : null}
                        </span>
                      </label>
                    );
                  })
                )}
              </div>
            </div>
          ) : null}

          <label>
            Category
            <Select
              value={compose.category}
              onChange={(event) => setCompose((prev) => ({ ...prev, category: event.target.value }))}
            >
              {CATEGORY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </Select>
          </label>

          <label>
            Schedule For (optional)
            <Input
              type="datetime-local"
              value={compose.scheduleAt}
              onChange={(event) => setCompose((prev) => ({ ...prev, scheduleAt: event.target.value }))}
            />
          </label>

          <label className="full-width">
            Title
            <Input
              value={compose.title}
              maxLength={120}
              placeholder="e.g. Orientation tomorrow at 9am"
              onChange={(event) => setCompose((prev) => ({ ...prev, title: event.target.value }))}
            />
          </label>

          <label className="full-width">
            Body
            <Textarea
              value={compose.body}
              rows={4}
              maxLength={500}
              placeholder="Short message that will appear on lock screens."
              onChange={(event) => setCompose((prev) => ({ ...prev, body: event.target.value }))}
            />
          </label>

          <label className="full-width">
            Deep Link (optional)
            <Input
              value={compose.deepLink}
              placeholder="/events or /notifications"
              onChange={(event) => setCompose((prev) => ({ ...prev, deepLink: event.target.value }))}
            />
          </label>

          <label className="director-admin-inline-check full-width">
            <input
              type="checkbox"
              checked={Boolean(compose.pushRequested)}
              onChange={(event) => setCompose((prev) => ({ ...prev, pushRequested: event.target.checked }))}
            />
            <span>Deliver as push notification (uncheck for inbox only)</span>
          </label>

          <div className="full-width" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Input
              value={templateName}
              placeholder="Template name…"
              onChange={(event) => setTemplateName(event.target.value)}
              style={{ flex: "1 1 220px" }}
            />
            <Button type="button" variant="secondary" disabled={savingTemplate} onClick={saveAsTemplate}>
              {savingTemplate ? "Saving…" : "Save as Template"}
            </Button>
          </div>

          <div className="director-admin-form-actions full-width">
            <Button type="submit" disabled={sending}>
              {sending
                ? compose.scheduleAt ? "Scheduling…" : "Sending…"
                : compose.scheduleAt ? "Schedule Push" : "Send Push Now"}
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        <h3 className="pb-section-title">Upcoming Scheduled Pushes</h3>
        {!upcomingSchedules.length ? (
          <p className="muted">Nothing scheduled.</p>
        ) : (
          <div className="director-admin-table-wrap">
            <table className="director-admin-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Title</th>
                  <th>Audience</th>
                  <th>Category</th>
                  <th style={{ width: 1 }} />
                </tr>
              </thead>
              <tbody>
                {upcomingSchedules.map((item) => (
                  <tr key={item.id || item._id}>
                    <td>{formatDateTime(item.runAt)}</td>
                    <td>{item.title}</td>
                    <td>{String(item.audience || "").replace(/_/g, " ")}</td>
                    <td>{item.category}</td>
                    <td>
                      <Button variant="ghost" onClick={() => cancelSchedule(item)}>Cancel</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {recentSchedules.length ? (
        <Card>
          <h3 className="pb-section-title">Recent Scheduled Runs</h3>
          <div className="director-admin-table-wrap">
            <table className="director-admin-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Title</th>
                  <th>Status</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {recentSchedules.map((item) => (
                  <tr key={item.id || item._id}>
                    <td>{formatDateTime(item.runAt)}</td>
                    <td>{item.title}</td>
                    <td>{formatScheduleStatus(item.status)}</td>
                    <td className="muted">{item.error || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      <Card>
        <h3 className="pb-section-title">Recent Sends</h3>
        {!history.length ? (
          <p className="muted">No mobile notification batches yet.</p>
        ) : (
          <div className="director-admin-table-wrap">
            <table className="director-admin-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Category</th>
                  <th>Recipients</th>
                  <th>Delivered</th>
                  <th>Unread</th>
                  <th>Sent</th>
                </tr>
              </thead>
              <tbody>
                {history.map((item) => (
                  <tr key={item.id}>
                    <td>{item.title}</td>
                    <td>{item.category}</td>
                    <td>{item.totalRecipients}</td>
                    <td>{item.pushDelivered}</td>
                    <td>{item.unreadCount}</td>
                    <td>{formatDateTime(item.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
