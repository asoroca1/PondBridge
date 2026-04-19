import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Badge, Button, Card, Input, Select, Textarea } from "@pondbridge/ui";
import { PageHeader } from "../../components/admin/AdminUi.jsx";
import useAdminApi from "./useAdminApi.js";

const INVITE_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVITE_HIDDEN_STORAGE_PREFIX = "pb_admin_hidden_invites";
const INVITE_SUBJECT_FIELD_ID = "invite-custom-subject";
const INVITE_MESSAGE_FIELD_ID = "invite-custom-message";
const MERGE_TOKEN_OPTIONS = [
  { label: "First Name", token: "{{firstName}}" },
  { label: "Last Name", token: "{{lastName}}" },
  { label: "Network Name", token: "{{networkName}}" }
];
const DEFAULT_EVENT_FORM = {
  title: "",
  summary: "",
  bodyHtml: "",
  coverImageUrl: "",
  startsAt: "",
  endsAt: "",
  timezone: "America/New_York",
  locationName: "",
  locationAddress: "",
  rsvpDeadlineAt: ""
};

function formatDateTime(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString();
}

function statusTone(status = "") {
  const key = String(status || "").trim().toLowerCase();
  if (["active", "sent", "used", "live", "approved", "paid"].includes(key)) return "success";
  if (["pending", "scheduled", "trialing", "in_setup", "in_progress"].includes(key)) return "warning";
  if (["failed", "denied", "past_due", "removed", "flagged", "canceled", "expired"].includes(key)) return "danger";
  return "neutral";
}

function createInviteRow() {
  return {
    id: `invite_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    firstName: "",
    lastName: "",
    email: ""
  };
}

function normalizeInviteName(value = "") {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeInviteEmail(value = "") {
  return String(value || "").trim().toLowerCase();
}

function isValidInviteEmail(value = "") {
  return INVITE_EMAIL_REGEX.test(normalizeInviteEmail(value));
}

function toApiDateTimeValue(value = "") {
  return value ? new Date(value).toISOString() : null;
}

function insertTokenAtSelection({ value = "", token = "", start = 0, end = 0 } = {}) {
  const currentValue = String(value || "");
  const safeToken = String(token || "");
  const selectionStart = Math.max(0, Number(start) || 0);
  const selectionEnd = Math.max(selectionStart, Number(end) || selectionStart);
  const nextValue =
    currentValue.slice(0, selectionStart) +
    safeToken +
    currentValue.slice(selectionEnd);
  const nextCursor = selectionStart + safeToken.length;
  return { nextValue, nextCursor };
}

function hiddenInvitesStorageKey(slug = "") {
  return `${INVITE_HIDDEN_STORAGE_PREFIX}:${String(slug || "").trim().toLowerCase() || "default"}`;
}

function readHiddenInviteIds(slug = "") {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(hiddenInvitesStorageKey(slug));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.map((item) => String(item || "").trim()).filter(Boolean))];
  } catch {
    return [];
  }
}

function writeHiddenInviteIds(slug = "", ids = []) {
  if (typeof window === "undefined") return;
  try {
    const normalized = [...new Set((Array.isArray(ids) ? ids : []).map((item) => String(item || "").trim()).filter(Boolean))];
    localStorage.setItem(hiddenInvitesStorageKey(slug), JSON.stringify(normalized));
  } catch {
    // ignore storage failures
  }
}

export default function DirectorAdminInvitesPage() {
  const { slug, request, download } = useAdminApi();
  const [rows, setRows] = useState([createInviteRow()]);
  const [file, setFile] = useState(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [sending, setSending] = useState(false);
  const [loadingInvites, setLoadingInvites] = useState(true);
  const [inviteStatusFilter, setInviteStatusFilter] = useState("pending");
  const [customSubject, setCustomSubject] = useState("");
  const [customMessage, setCustomMessage] = useState("");
  const [invites, setInvites] = useState([]);
  const [hiddenInviteIds, setHiddenInviteIds] = useState([]);
  const [eventModalOpen, setEventModalOpen] = useState(false);
  const [eventSaving, setEventSaving] = useState(false);
  const [eventError, setEventError] = useState("");
  const [eventForm, setEventForm] = useState({ ...DEFAULT_EVENT_FORM });
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [result, setResult] = useState(null);

  useEffect(() => {
    setHiddenInviteIds(readHiddenInviteIds(slug));
  }, [slug]);

  const loadInvites = useCallback(async () => {
    setLoadingInvites(true);
    setError("");
    try {
      const filter = String(inviteStatusFilter || "pending").trim();
      const query = filter === "all" ? "" : `?status=${encodeURIComponent(filter)}`;
      const payload = await request(`/invites${query}`);
      setInvites(Array.isArray(payload?.items) ? payload.items : []);
    } catch (requestError) {
      setError(requestError.message || "Unable to load invites.");
    } finally {
      setLoadingInvites(false);
    }
  }, [inviteStatusFilter, request]);

  useEffect(() => {
    loadInvites();
  }, [loadInvites]);

  const visibleInvites = useMemo(() => {
    if (!invites.length) return [];
    const hiddenSet = new Set(hiddenInviteIds);
    return invites.filter((invite) => !hiddenSet.has(String(invite?.id || "")));
  }, [hiddenInviteIds, invites]);

  const hiddenInvitesInCurrentFilter = Math.max(0, invites.length - visibleInvites.length);

  function hideInviteFromView(inviteId = "") {
    const normalized = String(inviteId || "").trim();
    if (!normalized) return;
    setHiddenInviteIds((current) => {
      if (current.includes(normalized)) return current;
      const next = [...current, normalized];
      writeHiddenInviteIds(slug, next);
      return next;
    });
    setStatus("Invite removed from this view.");
  }

  function clearVisibleInvitesFromView() {
    const idsToHide = visibleInvites
      .map((invite) => String(invite?.id || "").trim())
      .filter(Boolean);
    if (!idsToHide.length) return;
    setHiddenInviteIds((current) => {
      const next = [...new Set([...current, ...idsToHide])];
      writeHiddenInviteIds(slug, next);
      return next;
    });
    setStatus(`Cleared ${idsToHide.length} invite${idsToHide.length === 1 ? "" : "s"} from this view.`);
  }

  function restoreClearedInvites() {
    setHiddenInviteIds([]);
    writeHiddenInviteIds(slug, []);
    setStatus("Restored cleared invites.");
  }

  function updateRow(rowId, key, value) {
    setRows((current) =>
      current.map((row) =>
        row.id === rowId
          ? {
              ...row,
              [key]: key === "email" ? normalizeInviteEmail(value) : normalizeInviteName(value)
            }
          : row
      )
    );
  }

  function addRow() {
    setRows((current) => [...current, createInviteRow()]);
  }

  function removeRow(rowId) {
    setRows((current) => {
      if (current.length <= 1) return [createInviteRow()];
      return current.filter((row) => row.id !== rowId);
    });
  }

  function openEventModal() {
    setEventForm({ ...DEFAULT_EVENT_FORM });
    setEventError("");
    setEventModalOpen(true);
  }

  function closeEventModal() {
    if (eventSaving) return;
    setEventModalOpen(false);
    setEventError("");
  }

  function updateEventField(key, value) {
    setEventForm((current) => ({ ...current, [key]: value }));
  }

  function insertMergeToken(fieldId, setter, token) {
    if (typeof document === "undefined") {
      setter((current) => `${String(current || "")}${token}`);
      return;
    }

    const field = document.getElementById(fieldId);
    const currentValue = String(field?.value || "");
    const { nextValue, nextCursor } = insertTokenAtSelection({
      value: currentValue,
      token,
      start: field?.selectionStart,
      end: field?.selectionEnd
    });

    setter(nextValue);
    window.requestAnimationFrame(() => {
      const refreshedField = document.getElementById(fieldId);
      if (!refreshedField || typeof refreshedField.focus !== "function") return;
      refreshedField.focus();
      if (typeof refreshedField.setSelectionRange === "function") {
        refreshedField.setSelectionRange(nextCursor, nextCursor);
      }
    });
  }

  async function createEvent(event) {
    event.preventDefault();
    setEventSaving(true);
    setEventError("");
    setStatus("");

    try {
      const response = await request("/events", {
        method: "POST",
        body: {
          title: eventForm.title,
          summary: eventForm.summary,
          bodyHtml: eventForm.bodyHtml,
          coverImageUrl: eventForm.coverImageUrl,
          startsAt: toApiDateTimeValue(eventForm.startsAt),
          endsAt: toApiDateTimeValue(eventForm.endsAt),
          timezone: eventForm.timezone,
          locationName: eventForm.locationName,
          locationAddress: eventForm.locationAddress,
          rsvpDeadlineAt: toApiDateTimeValue(eventForm.rsvpDeadlineAt)
        }
      });
      const createdTitle = String(response?.item?.title || eventForm.title || "Event").trim();
      setStatus(`Draft event "${createdTitle}" created.`);
      setEventModalOpen(false);
      setEventForm({ ...DEFAULT_EVENT_FORM });
    } catch (requestError) {
      setEventError(requestError.message || "Failed to create event.");
    } finally {
      setEventSaving(false);
    }
  }

  async function downloadTemplate() {
    setError("");
    try {
      const blob = await download("/invites/template.csv");
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "pondbridge-invites-template.csv";
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (requestError) {
      setError(requestError.message || "Unable to download invite template.");
    }
  }

  async function sendInvites(event) {
    event.preventDefault();
    setError("");
    setStatus("");
    setResult(null);

    const enteredRows = rows
      .map((row) => ({
        firstName: normalizeInviteName(row.firstName),
        lastName: normalizeInviteName(row.lastName),
        email: normalizeInviteEmail(row.email)
      }))
      .filter((row) => row.firstName || row.lastName || row.email);

    const missingEmailRows = enteredRows.filter(
      (row) => !row.email && (row.firstName || row.lastName)
    );
    if (missingEmailRows.length > 0) {
      setError("Every row with a name must include an email address.");
      return;
    }

    const invalidEmailRows = enteredRows.filter((row) => row.email && !isValidInviteEmail(row.email));
    if (invalidEmailRows.length > 0) {
      setError("One or more emails are invalid. Please fix and retry.");
      return;
    }

    const dedupedRecipients = Array.from(
      enteredRows
        .filter((row) => row.email)
        .reduce((map, row) => {
          const existing = map.get(row.email);
          if (!existing) {
            map.set(row.email, row);
            return map;
          }
          map.set(row.email, {
            email: row.email,
            firstName: existing.firstName || row.firstName,
            lastName: existing.lastName || row.lastName
          });
          return map;
        }, new Map())
        .values()
    );

    if (!file && dedupedRecipients.length === 0) {
      setError("Add at least one invite row or upload a CSV file.");
      return;
    }

    setSending(true);
    try {
      const formData = new FormData();
      formData.append("roleToAssign", "user");
      if (dedupedRecipients.length > 0) {
        formData.append("recipients", JSON.stringify(dedupedRecipients));
      }
      if (customSubject.trim()) {
        formData.append("customSubject", customSubject);
      }
      if (customMessage.trim()) {
        formData.append("customMessage", customMessage);
      }
      if (file) {
        formData.append("file", file);
      }

      const response = await request("/invites/send", {
        method: "POST",
        body: formData
      });

      setResult(response);
      setStatus(
        `Invites processed. Created ${response.createdCount || 0}, sent ${response.sentCount || 0}, skipped ${
          Array.isArray(response.skipped) ? response.skipped.length : 0
        }.`
      );
      setRows([createInviteRow()]);
      setFile(null);
      setFileInputKey((value) => value + 1);
      await loadInvites();
    } catch (requestError) {
      setError(requestError.message || "Failed to send invites.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="director-admin-stack">
      <Card>
        <PageHeader
          title="Invite Members"
          subtitle="Invite people with first name, last name, and email. Accounts are created only when they accept and sign up."
          actions={
            <>
              <Button variant="secondary" onClick={openEventModal}>
                Create Event
              </Button>
              <Button variant="secondary" onClick={downloadTemplate}>
                Download Template CSV
              </Button>
            </>
          }
        />
        <form onSubmit={sendInvites}>
          <div className="director-admin-table-wrap">
            <table className="director-admin-table" style={{ minWidth: 720 }}>
              <thead>
                <tr>
                  <th>First Name</th>
                  <th>Last Name</th>
                  <th>Email</th>
                  <th aria-label="Row actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Input
                        value={row.firstName}
                        placeholder="First name"
                        onChange={(event) => updateRow(row.id, "firstName", event.target.value)}
                      />
                    </td>
                    <td>
                      <Input
                        value={row.lastName}
                        placeholder="Last name"
                        onChange={(event) => updateRow(row.id, "lastName", event.target.value)}
                      />
                    </td>
                    <td>
                      <Input
                        type="email"
                        value={row.email}
                        placeholder="name@email.com"
                        onChange={(event) => updateRow(row.id, "email", event.target.value)}
                      />
                    </td>
                    <td>
                      <Button type="button" variant="secondary" size="sm" onClick={() => removeRow(row.id)}>
                        Remove
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="inline-actions">
            <Button type="button" variant="secondary" onClick={addRow}>
              Add Row
            </Button>
            <Button type="button" variant="secondary" onClick={() => setRows([createInviteRow()])}>
              Clear Rows
            </Button>
          </div>

          <div className="director-admin-upload-box">
            <p>Optional: upload CSV with `firstName`, `lastName`, and `email` columns.</p>
            <Input
              key={fileInputKey}
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => setFile(event.target.files?.[0] || null)}
            />
            {file ? (
              <p className="muted">
                CSV selected: <strong>{file.name}</strong>
              </p>
            ) : null}
          </div>

          <div className="director-admin-upload-box">
            <p>Optional: personalize the invite email for this send.</p>
            <p className="muted">
              Tap a merge field button to drop it into the subject or message at your cursor.
            </p>
            <div style={{ display: "grid", gap: 12 }}>
              <div>
                <label htmlFor="invite-custom-subject" style={{ display: "block", fontWeight: 600, marginBottom: 6 }}>
                  Email subject
                </label>
                <div className="director-admin-token-row" aria-label="Insert merge field into invite subject">
                  {MERGE_TOKEN_OPTIONS.map((item) => (
                    <Button
                      key={`subject_${item.token}`}
                      type="button"
                      variant="secondary"
                      className="director-admin-token-button"
                      onClick={() => insertMergeToken(INVITE_SUBJECT_FIELD_ID, setCustomSubject, item.token)}
                    >
                      {item.label}
                    </Button>
                  ))}
                </div>
                <Input
                  id={INVITE_SUBJECT_FIELD_ID}
                  value={customSubject}
                  placeholder="You're invited to {{networkName}}, {{firstName}}"
                  onChange={(event) => setCustomSubject(event.target.value)}
                />
              </div>
              <div>
                <label htmlFor="invite-custom-message" style={{ display: "block", fontWeight: 600, marginBottom: 6 }}>
                  Personal message
                </label>
                <div className="director-admin-token-row" aria-label="Insert merge field into invite message">
                  {MERGE_TOKEN_OPTIONS.map((item) => (
                    <Button
                      key={`message_${item.token}`}
                      type="button"
                      variant="secondary"
                      className="director-admin-token-button"
                      onClick={() => insertMergeToken(INVITE_MESSAGE_FIELD_ID, setCustomMessage, item.token)}
                    >
                      {item.label}
                    </Button>
                  ))}
                </div>
                <Textarea
                  id={INVITE_MESSAGE_FIELD_ID}
                  rows={6}
                  value={customMessage}
                  placeholder={"Hi {{firstName}},\n\nI'd love for you to join our PondBridge community this season."}
                  onChange={(event) => setCustomMessage(event.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="inline-actions">
            <Button type="submit" disabled={sending}>
              {sending ? "Sending Invites..." : "Send Invites"}
            </Button>
            <Link className="link-button secondary" to={`/t/${slug}/admin/members`}>
              View Members
            </Link>
          </div>
        </form>
        {error ? <p className="error-text">{error}</p> : null}
        {status ? <p className="success-text">{status}</p> : null}
      </Card>

      {result?.skipped?.length ? (
        <Card>
          <h2 className="pb-section-title">Skipped Invites</h2>
          <div className="director-admin-table-wrap">
            <table className="director-admin-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {result.skipped.map((item) => (
                  <tr key={`${item.email}_${item.reason}`}>
                    <td>{item.email || "-"}</td>
                    <td>{item.reason || "Skipped"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      <Card>
        <div className="director-admin-invite-toolbar">
          <div className="director-admin-invite-toolbar-left">
            <h2 className="pb-section-title">Invite Status</h2>
            <Select
              className="director-admin-invite-filter-select"
              value={inviteStatusFilter}
              onChange={(event) => setInviteStatusFilter(event.target.value)}
            >
              <option value="pending">Pending</option>
              <option value="used">Used</option>
              <option value="expired">Expired</option>
              <option value="all">All</option>
            </Select>
          </div>
          <div className="director-admin-invite-toolbar-right">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={clearVisibleInvitesFromView}
              disabled={loadingInvites || visibleInvites.length === 0}
            >
              Clear Visible
            </Button>
            {hiddenInviteIds.length ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={restoreClearedInvites}
              >
                Restore Cleared
              </Button>
            ) : null}
          </div>
        </div>
        {loadingInvites ? (
          <p className="muted">Loading invites...</p>
        ) : invites.length === 0 ? (
          <p className="muted">No invites found for this filter.</p>
        ) : visibleInvites.length === 0 ? (
          <p className="muted">All invites in this filter are cleared from view.</p>
        ) : (
          <div className="director-admin-table-wrap">
            <table className="director-admin-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Created</th>
                  <th>Expires</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleInvites.map((invite) => {
                  const expired = invite?.expiresAt ? new Date(invite.expiresAt) <= new Date() : false;
                  const inviteStatus = invite?.usedAt ? "used" : expired ? "expired" : "pending";
                  return (
                    <tr key={invite.id}>
                      <td>{invite.email || "-"}</td>
                      <td>{invite.roleToAssign === "tenant_admin" ? "Admin" : "Member"}</td>
                      <td>{formatDateTime(invite.createdAt)}</td>
                      <td>{formatDateTime(invite.expiresAt)}</td>
                      <td>
                        <Badge tone={statusTone(inviteStatus)}>
                          {inviteStatus.charAt(0).toUpperCase() + inviteStatus.slice(1)}
                        </Badge>
                      </td>
                      <td>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => hideInviteFromView(invite.id)}
                        >
                          Clear
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!loadingInvites && hiddenInvitesInCurrentFilter > 0 ? (
          <p className="muted">{hiddenInvitesInCurrentFilter} invite(s) currently hidden in this filter.</p>
        ) : null}
      </Card>

      {eventModalOpen ? (
        <div className="pb-admin-ui-modal-backdrop" role="dialog" aria-modal="true" onClick={closeEventModal}>
          <div className="pb-admin-ui-modal director-admin-event-modal" onClick={(event) => event.stopPropagation()}>
            <h3>Create Event</h3>
            <p>Draft a new event from the invites page, then publish it later when you are ready.</p>
            <form className="director-events-form-grid director-admin-event-modal-form" onSubmit={createEvent}>
              <label className="full-width">
                Event title
                <Input
                  value={eventForm.title}
                  onChange={(event) => updateEventField("title", event.target.value)}
                  placeholder="Camp Cedar Alumni Weekend"
                />
              </label>
              <label className="full-width">
                Summary
                <Textarea
                  value={eventForm.summary}
                  onChange={(event) => updateEventField("summary", event.target.value)}
                  placeholder="A short overview for the event card and hero section."
                />
              </label>
              <label className="full-width">
                Event details
                <Textarea
                  rows={8}
                  value={eventForm.bodyHtml}
                  onChange={(event) => updateEventField("bodyHtml", event.target.value)}
                  placeholder="Share the schedule, who should attend, and what to expect."
                />
              </label>
              <label className="full-width">
                Cover image URL
                <Input
                  value={eventForm.coverImageUrl}
                  onChange={(event) => updateEventField("coverImageUrl", event.target.value)}
                  placeholder="https://..."
                />
              </label>
              <label>
                Starts at
                <Input
                  type="datetime-local"
                  value={eventForm.startsAt}
                  onChange={(event) => updateEventField("startsAt", event.target.value)}
                />
              </label>
              <label>
                Ends at
                <Input
                  type="datetime-local"
                  value={eventForm.endsAt}
                  onChange={(event) => updateEventField("endsAt", event.target.value)}
                />
              </label>
              <label>
                Timezone
                <Input
                  value={eventForm.timezone}
                  onChange={(event) => updateEventField("timezone", event.target.value)}
                  placeholder="America/New_York"
                />
              </label>
              <label>
                RSVP deadline
                <Input
                  type="datetime-local"
                  value={eventForm.rsvpDeadlineAt}
                  onChange={(event) => updateEventField("rsvpDeadlineAt", event.target.value)}
                />
              </label>
              <label>
                Location name
                <Input
                  value={eventForm.locationName}
                  onChange={(event) => updateEventField("locationName", event.target.value)}
                  placeholder="Camp Cedar waterfront"
                />
              </label>
              <label>
                Location address
                <Input
                  value={eventForm.locationAddress}
                  onChange={(event) => updateEventField("locationAddress", event.target.value)}
                  placeholder="123 Camp Road, City, State"
                />
              </label>
              {eventError ? <p className="error-text">{eventError}</p> : null}
              <div className="pb-admin-ui-modal-actions">
                <Button type="button" variant="secondary" onClick={closeEventModal} disabled={eventSaving}>
                  Cancel
                </Button>
                <Button type="submit" disabled={eventSaving}>
                  {eventSaving ? "Creating..." : "Create Draft"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
