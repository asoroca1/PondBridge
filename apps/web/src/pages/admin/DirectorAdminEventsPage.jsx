import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Badge, Button, Card, Input, Select, Textarea } from "@pondbridge/ui";
import { PageHeader } from "../../components/admin/AdminUi.jsx";
import { tenantRoute } from "../../lib/tenantRouting.js";
import useAdminApi from "./useAdminApi.js";

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

const DEFAULT_EMAIL_FORM = {
  kind: "invite",
  subject: "",
  bodyHtml: "",
  recipientProfileIds: []
};

function toLocalDateTimeValue(value = "") {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const offset = parsed.getTimezoneOffset() * 60 * 1000;
  return new Date(parsed.getTime() - offset).toISOString().slice(0, 16);
}

function toApiDateTimeValue(value = "") {
  return value ? new Date(value).toISOString() : null;
}

function applyEventToForm(item = null) {
  if (!item) return { ...DEFAULT_EVENT_FORM };
  return {
    title: item.title || "",
    summary: item.summary || "",
    bodyHtml: item.bodyHtml || "",
    coverImageUrl: item.coverImageUrl || "",
    startsAt: toLocalDateTimeValue(item.startsAt),
    endsAt: toLocalDateTimeValue(item.endsAt),
    timezone: item.timezone || "America/New_York",
    locationName: item.locationName || "",
    locationAddress: item.locationAddress || "",
    rsvpDeadlineAt: toLocalDateTimeValue(item.rsvpDeadlineAt)
  };
}

function statusTone(status = "") {
  if (status === "published") return "success";
  if (status === "canceled") return "danger";
  return "warning";
}

function kindLabel(kind = "") {
  if (kind === "invite") return "Invite";
  if (kind === "reminder") return "Reminder";
  if (kind === "cancellation") return "Cancellation";
  return "Update";
}

function suggestedSubject(kind = "", title = "") {
  const safeTitle = String(title || "Community event").trim();
  if (kind === "invite") return `You're invited: ${safeTitle}`;
  if (kind === "reminder") return `Reminder: ${safeTitle}`;
  if (kind === "cancellation") return `Canceled: ${safeTitle}`;
  return `Update: ${safeTitle}`;
}

export default function DirectorAdminEventsPage() {
  const { slug, request } = useAdminApi();
  const [items, setItems] = useState([]);
  const [moduleEnabled, setModuleEnabled] = useState(true);
  const [platformDisabled, setPlatformDisabled] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [eventForm, setEventForm] = useState(DEFAULT_EVENT_FORM);
  const [emailForm, setEmailForm] = useState(DEFAULT_EMAIL_FORM);
  const [memberQuery, setMemberQuery] = useState("");
  const [memberResults, setMemberResults] = useState([]);
  const [selectedMembersById, setSelectedMembersById] = useState({});
  const [searchingMembers, setSearchingMembers] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  async function loadList(nextSelectedEventId = selectedEventId) {
    setLoading(true);
    setError("");
    try {
      const query = statusFilter === "all" ? "" : `?status=${encodeURIComponent(statusFilter)}`;
      const payload = await request(`/events${query}`);
      const nextItems = Array.isArray(payload?.items) ? payload.items : [];
      setItems(nextItems);
      setModuleEnabled(payload?.moduleEnabled !== false);
      setPlatformDisabled(Boolean(payload?.platformDisabled));
      if (!nextSelectedEventId && nextItems.length > 0) {
        setSelectedEventId(nextItems[0].id);
      }
    } catch (requestError) {
      setError(requestError.message || "Failed to load events.");
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(eventId) {
    if (!eventId) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    setError("");
    try {
      const payload = await request(`/events/${eventId}`);
      setDetail(payload);
      setEventForm(applyEventToForm(payload?.item || null));
    } catch (requestError) {
      setError(requestError.message || "Failed to load event detail.");
    } finally {
      setDetailLoading(false);
    }
  }

  useEffect(() => {
    loadList();
  }, [statusFilter]);

  useEffect(() => {
    if (!selectedEventId) {
      setDetail(null);
      setEventForm({ ...DEFAULT_EVENT_FORM });
      return;
    }
    loadDetail(selectedEventId);
  }, [selectedEventId]);

  useEffect(() => {
    setEmailForm({
      kind: "invite",
      subject: detail?.item ? suggestedSubject("invite", detail.item.title) : "",
      bodyHtml: "",
      recipientProfileIds: []
    });
    setMemberQuery("");
    setMemberResults([]);
  }, [selectedEventId]);

  useEffect(() => {
    const missingIds = emailForm.recipientProfileIds.filter((id) => !selectedMembersById[id]);
    if (!missingIds.length) return;
    request(`/members/lookup?ids=${encodeURIComponent(missingIds.join(","))}`)
      .then((payload) => {
        const next = Array.isArray(payload?.items) ? payload.items : [];
        setSelectedMembersById((current) => {
          const updated = { ...current };
          next.forEach((item) => {
            updated[item.id] = item;
          });
          return updated;
        });
      })
      .catch(() => {});
  }, [emailForm.recipientProfileIds, request, selectedMembersById]);

  useEffect(() => {
    const term = memberQuery.trim();
    if (term.length < 2) {
      setMemberResults([]);
      return undefined;
    }
    setSearchingMembers(true);
    const timer = window.setTimeout(() => {
      request(`/members?q=${encodeURIComponent(term)}&pageSize=8`)
        .then((payload) => {
          const next = Array.isArray(payload?.items) ? payload.items : [];
          setMemberResults(next.filter((item) => !emailForm.recipientProfileIds.includes(item.id)));
          setSelectedMembersById((current) => {
            const updated = { ...current };
            next.forEach((item) => {
              updated[item.id] = item;
            });
            return updated;
          });
        })
        .catch((requestError) => {
          setError(requestError.message || "Failed to search members.");
        })
        .finally(() => setSearchingMembers(false));
    }, 220);

    return () => window.clearTimeout(timer);
  }, [memberQuery, emailForm.recipientProfileIds, request]);

  const selectedMembers = useMemo(
    () =>
      emailForm.recipientProfileIds
        .map((id) => selectedMembersById[id])
        .filter(Boolean),
    [emailForm.recipientProfileIds, selectedMembersById]
  );

  const selectedEvent = detail?.item || items.find((item) => item.id === selectedEventId) || null;

  function startNewEvent() {
    setSelectedEventId("");
    setDetail(null);
    setEventForm({ ...DEFAULT_EVENT_FORM });
    setEmailForm({ ...DEFAULT_EMAIL_FORM });
    setStatus("");
    setError("");
  }

  function updateEventField(key, value) {
    setEventForm((current) => ({ ...current, [key]: value }));
  }

  function buildEventPayload() {
    return {
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
    };
  }

  async function saveEvent() {
    setSaving(true);
    setError("");
    setStatus("");
    try {
      const payload = buildEventPayload();
      const response = selectedEventId
        ? await request(`/events/${selectedEventId}`, {
            method: "PATCH",
            body: payload
          })
        : await request("/events", {
            method: "POST",
            body: payload
          });
      const nextId = response?.item?.id || selectedEventId;
      setStatus(selectedEventId ? "Event saved." : "Draft event created.");
      await loadList(nextId);
      setSelectedEventId(nextId);
      if (nextId) {
        await loadDetail(nextId);
      }
    } catch (requestError) {
      setError(requestError.message || "Failed to save event.");
    } finally {
      setSaving(false);
    }
  }

  async function runEventAction(action) {
    if (!selectedEventId) return;
    setSaving(true);
    setError("");
    setStatus("");
    try {
      const response = await request(`/events/${selectedEventId}/${action}`, {
        method: "POST"
      });
      setStatus(
        action === "publish"
          ? "Event published."
          : action === "unpublish"
          ? "Event moved back to draft."
          : "Event canceled."
      );
      await loadList(selectedEventId);
      setDetail((current) => ({ ...(current || {}), item: response?.item || current?.item }));
      await loadDetail(selectedEventId);
    } catch (requestError) {
      setError(requestError.message || "Failed to update event.");
    } finally {
      setSaving(false);
    }
  }

  function addRecipient(member) {
    setEmailForm((current) => ({
      ...current,
      recipientProfileIds: current.recipientProfileIds.includes(member.id)
        ? current.recipientProfileIds
        : [...current.recipientProfileIds, member.id]
    }));
    setSelectedMembersById((current) => ({ ...current, [member.id]: member }));
    setMemberQuery("");
    setMemberResults([]);
  }

  function removeRecipient(profileId) {
    setEmailForm((current) => ({
      ...current,
      recipientProfileIds: current.recipientProfileIds.filter((id) => id !== profileId)
    }));
  }

  async function sendEventEmail() {
    if (!selectedEventId) return;
    setSending(true);
    setError("");
    setStatus("");
    try {
      await request(`/events/${selectedEventId}/messages/send`, {
        method: "POST",
        body: emailForm
      });
      setStatus("Event email sent.");
      setEmailForm((current) => ({
        ...current,
        subject: suggestedSubject(current.kind, selectedEvent?.title || ""),
        bodyHtml: "",
        recipientProfileIds: []
      }));
      await loadDetail(selectedEventId);
      await loadList(selectedEventId);
    } catch (requestError) {
      setError(requestError.message || "Failed to send event email.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="director-admin-stack">
      <Card>
        <PageHeader
          title="Events"
          subtitle="Create polished event pages, collect RSVPs, and send member invites from one workspace."
          actions={
            <div className="director-admin-page-actions">
              <Select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="all">All statuses</option>
                <option value="draft">Drafts</option>
                <option value="published">Published</option>
                <option value="canceled">Canceled</option>
              </Select>
              <Button variant="secondary" onClick={startNewEvent}>New Event</Button>
            </div>
          }
        />
        {!moduleEnabled ? (
          <p className="muted">
            {platformDisabled
              ? "Events are temporarily hidden from members across all networks."
              : "Events are currently hidden from members because the module is disabled in Features & Modules."}
          </p>
        ) : null}
        {error ? <p className="error-text">{error}</p> : null}
        {status ? <p className="success-text">{status}</p> : null}
      </Card>

      <section className="director-events-layout">
        <Card className="director-events-list-card">
          <div className="director-events-section-head">
            <h2 className="pb-section-title">Event List</h2>
            <p className="muted">Pick an event to edit or start a new one.</p>
          </div>
          {loading ? (
            <p className="muted">Loading events...</p>
          ) : items.length === 0 ? (
            <div className="director-events-empty-state">
              <p className="events-message-eyebrow">Start Here</p>
              <h3>Create your first event</h3>
              <p className="muted">
                Draft the event page, save it, then publish when you are ready for members to see it.
              </p>
              <div className="director-events-action-row">
                <Button onClick={startNewEvent}>Create First Event</Button>
              </div>
            </div>
          ) : (
            <div className="director-events-list">
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`director-events-list-item ${selectedEventId === item.id ? "is-active" : ""}`.trim()}
                  onClick={() => setSelectedEventId(item.id)}
                >
                  <div className="director-events-list-item-top">
                    <strong>{item.title}</strong>
                    <Badge tone={statusTone(item.status)}>{item.status}</Badge>
                  </div>
                  <p>{item.summary || item.bodyExcerpt || "No summary yet."}</p>
                  <div className="director-events-list-item-meta">
                    <span>{item.startsAt ? new Date(item.startsAt).toLocaleString() : "Date TBD"}</span>
                    <span>{item.counts?.attending || 0} attending</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </Card>

        <div className="director-events-main">
          <Card>
            <div className="director-events-section-head">
              <h2 className="pb-section-title">{selectedEventId ? "Edit Event" : "Create Event"}</h2>
              {selectedEventId ? (
                <p className="muted">
                  <Link to={tenantRoute(slug, `/events/${selectedEventId}`)}>Open member-facing page</Link>
                </p>
              ) : (
                <p className="muted">Draft the page first, then publish when it is ready.</p>
              )}
            </div>
            {detailLoading ? <p className="muted">Loading event editor...</p> : null}
            <form className="director-events-form-grid" onSubmit={(event) => event.preventDefault()}>
              <label className="full-width">
                Event title
                <Input value={eventForm.title} onChange={(event) => updateEventField("title", event.target.value)} placeholder="Camp Cedar Alumni Weekend" />
              </label>
              <label className="full-width">
                Summary
                <Textarea value={eventForm.summary} onChange={(event) => updateEventField("summary", event.target.value)} placeholder="A short overview for event cards and the hero section." />
              </label>
              <label className="full-width">
                Event details
                <Textarea value={eventForm.bodyHtml} onChange={(event) => updateEventField("bodyHtml", event.target.value)} placeholder="Write event details here. Plain text paragraphs are supported." rows={10} />
              </label>
              <label className="full-width">
                Cover image URL
                <Input value={eventForm.coverImageUrl} onChange={(event) => updateEventField("coverImageUrl", event.target.value)} placeholder="https://..." />
              </label>
              <label>
                Starts at
                <Input type="datetime-local" value={eventForm.startsAt} onChange={(event) => updateEventField("startsAt", event.target.value)} />
              </label>
              <label>
                Ends at
                <Input type="datetime-local" value={eventForm.endsAt} onChange={(event) => updateEventField("endsAt", event.target.value)} />
              </label>
              <label>
                Timezone
                <Input value={eventForm.timezone} onChange={(event) => updateEventField("timezone", event.target.value)} placeholder="America/New_York" />
              </label>
              <label>
                RSVP deadline
                <Input type="datetime-local" value={eventForm.rsvpDeadlineAt} onChange={(event) => updateEventField("rsvpDeadlineAt", event.target.value)} />
              </label>
              <label>
                Location name
                <Input value={eventForm.locationName} onChange={(event) => updateEventField("locationName", event.target.value)} placeholder="Camp Cedar waterfront" />
              </label>
              <label>
                Location address
                <Input value={eventForm.locationAddress} onChange={(event) => updateEventField("locationAddress", event.target.value)} placeholder="123 Camp Road, City, State" />
              </label>
            </form>
            <div className="director-events-action-row">
              <Button onClick={saveEvent} disabled={saving}>{saving ? "Saving..." : selectedEventId ? "Save Changes" : "Create Draft"}</Button>
              {selectedEvent?.status !== "published" ? (
                <Button variant="secondary" onClick={() => runEventAction("publish")} disabled={!selectedEventId || saving}>
                  Publish
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => runEventAction("unpublish")} disabled={!selectedEventId || saving}>
                  Move To Draft
                </Button>
              )}
              <Button variant="secondary" onClick={() => runEventAction("cancel")} disabled={!selectedEventId || saving}>
                Cancel Event
              </Button>
            </div>
          </Card>

          <Card>
            <div className="director-events-section-head">
              <h2 className="pb-section-title">Event Email</h2>
              <p className="muted">Select members from the network and send invites, reminders, updates, or cancellations.</p>
            </div>
            {!selectedEventId ? (
              <p className="muted">Create the event first to unlock member emails.</p>
            ) : selectedEvent?.status === "draft" ? (
              <p className="muted">Publish the event before sending event emails.</p>
            ) : (
              <>
                <div className="director-events-form-grid">
                  <label>
                    Email type
                    <Select
                      value={emailForm.kind}
                      onChange={(event) =>
                        setEmailForm((current) => ({
                          ...current,
                          kind: event.target.value,
                          subject: current.subject ? current.subject : suggestedSubject(event.target.value, selectedEvent?.title || "")
                        }))
                      }
                    >
                      <option value="invite">Invite</option>
                      <option value="reminder">Reminder</option>
                      <option value="update">Update</option>
                      <option value="cancellation">Cancellation</option>
                    </Select>
                  </label>
                  <label className="full-width">
                    Subject
                    <Input
                      value={emailForm.subject}
                      onChange={(event) => setEmailForm((current) => ({ ...current, subject: event.target.value }))}
                      placeholder={suggestedSubject(emailForm.kind, selectedEvent?.title || "")}
                    />
                  </label>
                  <label className="full-width">
                    Message
                    <Textarea
                      rows={7}
                      value={emailForm.bodyHtml}
                      onChange={(event) => setEmailForm((current) => ({ ...current, bodyHtml: event.target.value }))}
                      placeholder="Write the message members should receive before the event details block."
                    />
                  </label>
                </div>

                <div className="director-events-member-picker">
                  <label className="full-width">
                    Search members
                    <Input value={memberQuery} onChange={(event) => setMemberQuery(event.target.value)} placeholder="Search by name or email" />
                  </label>
                  {searchingMembers ? <p className="muted">Searching members...</p> : null}
                  {memberResults.length > 0 ? (
                    <div className="director-events-member-results">
                      {memberResults.map((member) => (
                        <button key={member.id} type="button" className="director-events-member-result" onClick={() => addRecipient(member)}>
                          <strong>{member.fullName || member.email}</strong>
                          <span>{member.email}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <div className="director-events-selected-members">
                    {selectedMembers.map((member) => (
                      <div key={member.id} className="director-events-selected-chip">
                        <div>
                          <strong>{member.fullName || member.email}</strong>
                          <span>{member.email}</span>
                        </div>
                        <button type="button" onClick={() => removeRecipient(member.id)}>Remove</button>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="director-events-action-row">
                  <Button onClick={sendEventEmail} disabled={sending}>
                    {sending ? "Sending..." : `Send ${kindLabel(emailForm.kind)}`}
                  </Button>
                </div>
              </>
            )}
          </Card>

          {selectedEventId ? (
            <Card>
              <div className="director-events-section-head">
                <h2 className="pb-section-title">Responses & History</h2>
                <p className="muted">Track RSVP totals and see the latest event emails sent.</p>
              </div>
              <div className="director-events-summary-row">
                <div>
                  <strong>{detail?.item?.counts?.attending || 0}</strong>
                  <span>Attending</span>
                </div>
                <div>
                  <strong>{detail?.item?.counts?.maybe || 0}</strong>
                  <span>Maybe</span>
                </div>
                <div>
                  <strong>{detail?.item?.counts?.notAttending || 0}</strong>
                  <span>Not attending</span>
                </div>
              </div>

              {Array.isArray(detail?.responses) && detail.responses.length > 0 ? (
                <div className="director-admin-table-wrap">
                  <table className="director-admin-table">
                    <thead>
                      <tr>
                        <th>Member</th>
                        <th>Email</th>
                        <th>Status</th>
                        <th>Responded</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.responses.map((response) => (
                        <tr key={response.id}>
                          <td>{response.fullName}</td>
                          <td>{response.email || "-"}</td>
                          <td><Badge tone={response.status === "attending" ? "success" : response.status === "maybe" ? "warning" : "neutral"}>{response.status}</Badge></td>
                          <td>{response.respondedAt ? new Date(response.respondedAt).toLocaleString() : "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="muted">No RSVP responses yet.</p>
              )}

              {Array.isArray(detail?.messages) && detail.messages.length > 0 ? (
                <div className="director-events-message-list">
                  {detail.messages.map((message) => (
                    <div key={message.id} className="director-events-message-item">
                      <div className="director-events-message-item-top">
                        <strong>{message.subject}</strong>
                        <Badge tone={message.kind === "cancellation" ? "danger" : message.kind === "invite" ? "success" : "warning"}>
                          {kindLabel(message.kind)}
                        </Badge>
                      </div>
                      <p>{message.recipientCount} recipients • {message.sentAt ? new Date(message.sentAt).toLocaleString() : "Drafted"}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted">No event emails sent yet.</p>
              )}
            </Card>
          ) : null}
        </div>
      </section>
    </div>
  );
}
