import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Badge, Button, Card, Input, Select, Textarea } from "@pondbridge/ui";
import { PageHeader } from "../../components/admin/AdminUi.jsx";
import { uploadTenantImage } from "../../lib/imageUploads.js";
import { tenantRoute } from "../../lib/tenantRouting.js";
import useAdminApi from "./useAdminApi.js";

const DEFAULT_EVENT_FORM = {
  eventType: "community",
  deliveryMode: "in_person",
  topicCategory: "",
  topicTitle: "",
  audience: "all_members",
  meetingProvider: "",
  meetingUrl: "",
  hostProfileId: "",
  capacity: "",
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
const DEFAULT_MEMBER_FILTERS = {
  staffMin: "",
  staffMax: ""
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
    eventType: item.eventType || "community",
    deliveryMode: item.deliveryMode || "in_person",
    topicCategory: item.topicCategory || "",
    topicTitle: item.topicTitle || "",
    audience: item.audience || "all_members",
    meetingProvider: item.meetingProvider || "",
    meetingUrl: item.meetingUrl || "",
    hostProfileId: item.hostProfileId || "",
    capacity: item.capacity || "",
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
  const { slug, token, request } = useAdminApi();
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
  const [memberFilters, setMemberFilters] = useState(DEFAULT_MEMBER_FILTERS);
  const [memberResults, setMemberResults] = useState([]);
  const [hostQuery, setHostQuery] = useState("");
  const [hostResults, setHostResults] = useState([]);
  const [hostProfile, setHostProfile] = useState(null);
  const [searchingHosts, setSearchingHosts] = useState(false);
  const [selectedMembersById, setSelectedMembersById] = useState({});
  const [searchingMembers, setSearchingMembers] = useState(false);
  const scheduleNoun = eventForm.eventType === "seminar" ? "seminar" : "event";
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [coverUploading, setCoverUploading] = useState(false);
  const [coverUploadError, setCoverUploadError] = useState("");
  const [coverInputKey, setCoverInputKey] = useState(0);
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

  async function loadDetail(eventId, { resetComposer = false } = {}) {
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
      setHostProfile(payload?.item?.host || null);
      if (resetComposer) {
        setEmailForm({
          kind: "invite",
          subject: payload?.item ? suggestedSubject("invite", payload.item.title) : "",
          bodyHtml: "",
          recipientProfileIds: []
        });
        setSelectedMembersById({});
        setMemberQuery("");
        setMemberResults([]);
      }
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
      setHostProfile(null);
      return;
    }
    loadDetail(selectedEventId, { resetComposer: true });
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
    const hasMemberFilters = Object.values(memberFilters).some((value) => String(value || "").trim());
    if (term.length < 2 && !hasMemberFilters) {
      setMemberResults([]);
      return undefined;
    }
    setSearchingMembers(true);
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams();
      params.set("pageSize", "8");
      if (term) params.set("q", term);
      if (memberFilters.staffMin.trim()) params.set("staffMin", memberFilters.staffMin.trim());
      if (memberFilters.staffMax.trim()) params.set("staffMax", memberFilters.staffMax.trim());
      request(`/members?${params.toString()}`)
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
  }, [memberFilters, memberQuery, emailForm.recipientProfileIds, request]);

  useEffect(() => {
    const term = hostQuery.trim();
    if (term.length < 2) {
      setHostResults([]);
      return undefined;
    }

    setSearchingHosts(true);
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({
        q: term,
        status: "active",
        pageSize: "8"
      });
      request(`/members?${params.toString()}`)
        .then((payload) => {
          setHostResults(Array.isArray(payload?.items) ? payload.items : []);
        })
        .catch((requestError) => {
          setError(requestError.message || "Failed to search registered hosts.");
        })
        .finally(() => setSearchingHosts(false));
    }, 220);

    return () => window.clearTimeout(timer);
  }, [hostQuery, request]);

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
    setHostProfile(null);
    setHostQuery("");
    setHostResults([]);
    setEmailForm({ ...DEFAULT_EMAIL_FORM });
    setCoverUploadError("");
    setCoverInputKey((value) => value + 1);
    setStatus("");
    setError("");
  }

  function updateEventField(key, value) {
    setEventForm((current) => ({ ...current, [key]: value }));
  }

  function updateEventType(value) {
    setEventForm((current) => ({
      ...current,
      eventType: value,
      deliveryMode:
        value === "seminar" && current.deliveryMode === "in_person"
          ? "online"
          : current.deliveryMode
    }));
  }

  async function handleCoverFileChange(event) {
    const file = event.target.files?.[0] || null;
    if (!file) return;

    setCoverUploading(true);
    setCoverUploadError("");
    try {
      const objectUrl = await uploadTenantImage({
        slug,
        token,
        file,
        scope: "event-cover"
      });
      setEventForm((current) => ({ ...current, coverImageUrl: objectUrl }));
    } catch (uploadError) {
      setCoverUploadError(uploadError.message || "Failed to upload cover image.");
    } finally {
      setCoverUploading(false);
      setCoverInputKey((value) => value + 1);
    }
  }

  function clearCoverImage() {
    setEventForm((current) => ({ ...current, coverImageUrl: "" }));
    setCoverUploadError("");
    setCoverInputKey((value) => value + 1);
  }

  function buildEventPayload() {
    return {
      eventType: eventForm.eventType,
      deliveryMode: eventForm.deliveryMode,
      topicCategory: eventForm.topicCategory,
      topicTitle: eventForm.topicTitle,
      audience: eventForm.audience,
      meetingProvider: eventForm.meetingProvider,
      meetingUrl: eventForm.meetingUrl,
      hostProfileId: eventForm.hostProfileId,
      capacity: eventForm.capacity || null,
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

  function selectHost(member) {
    setHostProfile(member);
    setEventForm((current) => ({ ...current, hostProfileId: member.id }));
    setHostQuery("");
    setHostResults([]);
  }

  function clearHost() {
    setHostProfile(null);
    setEventForm((current) => ({ ...current, hostProfileId: "" }));
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
      setStatus(
        selectedEventId
          ? `${scheduleNoun === "seminar" ? "Seminar" : "Event"} saved.`
          : `Draft ${scheduleNoun} created.`
      );
      await loadList(nextId);
      setSelectedEventId(nextId);
      if (nextId) {
        await loadDetail(nextId);
      }
    } catch (requestError) {
      setError(requestError.message || `Failed to save ${scheduleNoun}.`);
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
          ? `${scheduleNoun === "seminar" ? "Seminar" : "Event"} published.`
          : action === "unpublish"
          ? `${scheduleNoun === "seminar" ? "Seminar" : "Event"} moved back to draft.`
          : `${scheduleNoun === "seminar" ? "Seminar" : "Event"} canceled.`
      );
      await loadList(selectedEventId);
      setDetail((current) => ({ ...(current || {}), item: response?.item || current?.item }));
      await loadDetail(selectedEventId);
    } catch (requestError) {
      setError(requestError.message || `Failed to update ${scheduleNoun}.`);
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

  function updateMemberFilter(key, value) {
    const normalized = String(value || "").replace(/[^\d]/g, "").slice(0, 4);
    setMemberFilters((current) => ({ ...current, [key]: normalized }));
  }

  function clearMemberFilters() {
    setMemberFilters(DEFAULT_MEMBER_FILTERS);
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
          className="director-events-page-header"
          title="Events & Seminars"
          subtitle="Run community events and registered-member online seminars from one workspace."
          actions={
            <div className="director-admin-page-actions director-events-toolbar">
              <Select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="all">All statuses</option>
                <option value="draft">Drafts</option>
                <option value="published">Published</option>
                <option value="canceled">Canceled</option>
              </Select>
              <Button variant="secondary" onClick={startNewEvent}>New Event or Seminar</Button>
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
            <h2 className="pb-section-title">Schedule</h2>
            <p className="muted">Pick an event or seminar to edit.</p>
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
                    <div>
                      <span className={`director-event-type-label is-${item.eventType || "community"}`}>
                        {item.eventType === "seminar" ? "Seminar" : "Event"}
                      </span>
                      <strong>{item.title}</strong>
                    </div>
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
              <h2 className="pb-section-title">
                {selectedEventId
                  ? `Edit ${eventForm.eventType === "seminar" ? "Seminar" : "Event"}`
                  : `Create ${eventForm.eventType === "seminar" ? "Seminar" : "Event"}`}
              </h2>
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
              <div className="full-width director-event-type-picker" role="group" aria-label="Schedule type">
                <button
                  type="button"
                  aria-pressed={eventForm.eventType === "community"}
                  className={eventForm.eventType === "community" ? "is-active" : ""}
                  onClick={() => updateEventType("community")}
                >
                  <strong>Community event</strong>
                  <span>Reunions, gatherings, and in-person camp moments.</span>
                </button>
                <button
                  type="button"
                  aria-pressed={eventForm.eventType === "seminar"}
                  className={eventForm.eventType === "seminar" ? "is-active" : ""}
                  onClick={() => updateEventType("seminar")}
                >
                  <strong>Online seminar</strong>
                  <span>Career, college, and mentorship sessions for registered members.</span>
                </button>
              </div>
              <label className="full-width">
                {eventForm.eventType === "seminar" ? "Seminar title" : "Event title"}
                <Input
                  value={eventForm.title}
                  onChange={(event) => updateEventField("title", event.target.value)}
                  placeholder={
                    eventForm.eventType === "seminar"
                      ? "Inside Investment Banking: Alumni Career Seminar"
                      : "Camp Cedar Alumni Weekend"
                  }
                />
              </label>
              {eventForm.eventType === "seminar" ? (
                <section className="full-width director-seminar-settings" aria-labelledby="director-seminar-settings-title">
                  <div className="director-seminar-settings-head">
                    <div>
                      <p className="events-message-eyebrow">Registered-member seminar</p>
                      <h3 id="director-seminar-settings-title">Program & meeting room</h3>
                    </div>
                    <span>Meeting links stay private until an attending member opens the room.</span>
                  </div>
                  <div className="director-events-form-grid">
                    <label>
                      Topic
                      <Input
                        value={eventForm.topicTitle}
                        onChange={(event) => updateEventField("topicTitle", event.target.value)}
                        placeholder="Investment Banking"
                      />
                    </label>
                    <label>
                      Program track
                      <Select
                        value={eventForm.topicCategory}
                        onChange={(event) => updateEventField("topicCategory", event.target.value)}
                      >
                        <option value="">Select a track</option>
                        <option value="career">Careers</option>
                        <option value="college">College</option>
                        <option value="financial_literacy">Financial literacy</option>
                        <option value="networking">Networking</option>
                        <option value="other">Other</option>
                      </Select>
                    </label>
                    <label>
                      Intended audience
                      <Select
                        value={eventForm.audience}
                        onChange={(event) => updateEventField("audience", event.target.value)}
                      >
                        <option value="all_members">All members</option>
                        <option value="students">Students</option>
                        <option value="young_alumni">Young alumni</option>
                        <option value="parents">Parents</option>
                        <option value="college_applicants">College applicants</option>
                        <option value="career_explorers">Career explorers</option>
                      </Select>
                    </label>
                    <label>
                      Format
                      <Select
                        value={eventForm.deliveryMode}
                        onChange={(event) => updateEventField("deliveryMode", event.target.value)}
                      >
                        <option value="online">Online</option>
                        <option value="hybrid">Online + in person</option>
                      </Select>
                    </label>
                    <label>
                      Meeting provider
                      <Select
                        value={eventForm.meetingProvider}
                        onChange={(event) => updateEventField("meetingProvider", event.target.value)}
                      >
                        <option value="">Detect from link</option>
                        <option value="zoom">Zoom</option>
                        <option value="microsoft_teams">Microsoft Teams</option>
                        <option value="google_meet">Google Meet</option>
                        <option value="other">Other secure link</option>
                      </Select>
                    </label>
                    <label>
                      Registration capacity
                      <Input
                        type="number"
                        min="1"
                        max="10000"
                        value={eventForm.capacity}
                        onChange={(event) => updateEventField("capacity", event.target.value)}
                        placeholder="Unlimited"
                      />
                    </label>
                    <label className="full-width">
                      Private meeting link
                      <Input
                        type="url"
                        value={eventForm.meetingUrl}
                        onChange={(event) => updateEventField("meetingUrl", event.target.value)}
                        placeholder="https://zoom.us/j/..."
                        autoComplete="off"
                      />
                      <span className="director-seminar-field-note">
                        Never shown in event lists or emails. Members must sign in and RSVP Going to open it.
                      </span>
                    </label>
                    <div className="full-width director-seminar-host-picker">
                      <label>
                        Registered seminar host
                        <Input
                          value={hostQuery}
                          onChange={(event) => setHostQuery(event.target.value)}
                          placeholder="Search the network by name or email"
                        />
                      </label>
                      {searchingHosts ? <p className="muted">Searching registered members...</p> : null}
                      {hostResults.length > 0 ? (
                        <div className="director-events-member-results">
                          {hostResults.map((member) => (
                            <button
                              key={member.id}
                              type="button"
                              className="director-events-member-result"
                              onClick={() => selectHost(member)}
                            >
                              <strong>{member.fullName || member.email}</strong>
                              <span>{member.role || member.email || "Network member"}</span>
                            </button>
                          ))}
                        </div>
                      ) : null}
                      {hostProfile ? (
                        <div className="director-seminar-selected-host">
                          <div>
                            <span>Host</span>
                            <strong>{hostProfile.fullName || hostProfile.email || "Registered member"}</strong>
                            <small>{hostProfile.roleAtCamp || hostProfile.role || hostProfile.industry || "Network member"}</small>
                          </div>
                          <Button type="button" variant="secondary" size="sm" onClick={clearHost}>
                            Change
                          </Button>
                        </div>
                      ) : (
                        <p className="director-seminar-field-note">
                          Only an active member profile in this camp can be assigned as host.
                        </p>
                      )}
                    </div>
                  </div>
                </section>
              ) : null}
              <label className="full-width">
                Summary
                <Textarea value={eventForm.summary} onChange={(event) => updateEventField("summary", event.target.value)} placeholder="A short overview for event cards and the hero section." />
              </label>
              <label className="full-width">
                Event details
                <Textarea value={eventForm.bodyHtml} onChange={(event) => updateEventField("bodyHtml", event.target.value)} placeholder="Write event details here. Plain text paragraphs are supported." rows={10} />
              </label>
              <div className="full-width ev-cover-field">
                <span>Cover image</span>
                <div className="ev-cover-upload">
                  <Input
                    key={coverInputKey}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                    onChange={handleCoverFileChange}
                  />
                  <div className="ev-cover-upload-actions">
                    <p className="muted">
                      Upload a PNG, JPG, WebP, GIF, or SVG cover image.
                      {coverUploading ? " Uploading..." : ""}
                    </p>
                    {eventForm.coverImageUrl ? (
                      <Button type="button" variant="secondary" size="sm" onClick={clearCoverImage} disabled={coverUploading}>
                        Remove image
                      </Button>
                    ) : null}
                  </div>
                  {coverUploadError ? <p className="error-text">{coverUploadError}</p> : null}
                  {eventForm.coverImageUrl ? (
                    <div className="ev-cover-preview">
                      <img src={eventForm.coverImageUrl} alt="Event cover preview" />
                    </div>
                  ) : null}
                </div>
              </div>
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
              {eventForm.deliveryMode !== "online" ? (
                <>
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
                    <Input value={eventForm.locationAddress} onChange={(event) => updateEventField("locationAddress", event.target.value)} placeholder="123 Camp Road, City, State" />
                  </label>
                </>
              ) : null}
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
                Cancel {scheduleNoun === "seminar" ? "Seminar" : "Event"}
              </Button>
            </div>
          </Card>

          <Card>
            <div className="director-events-section-head">
              <h2 className="pb-section-title">
                {scheduleNoun === "seminar" ? "Seminar Email" : "Event Email"}
              </h2>
              <p className="muted">Select members from the network and send invites, reminders, updates, or cancellations.</p>
            </div>
            {!selectedEventId ? (
              <p className="muted">Create the {scheduleNoun} first to unlock member emails.</p>
            ) : selectedEvent?.status === "draft" ? (
              <p className="muted">Publish the {scheduleNoun} before sending member emails.</p>
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
                  <div className="director-events-member-filter-grid">
                    <label>
                      Staff years min
                      <Input
                        type="text"
                        inputMode="numeric"
                        value={memberFilters.staffMin}
                        onChange={(event) => updateMemberFilter("staffMin", event.target.value)}
                        placeholder="year"
                      />
                    </label>
                    <label>
                      Staff years max
                      <Input
                        type="text"
                        inputMode="numeric"
                        value={memberFilters.staffMax}
                        onChange={(event) => updateMemberFilter("staffMax", event.target.value)}
                        placeholder="year"
                      />
                    </label>
                  </div>
                  <div className="director-events-member-filter-actions">
                    <p className="muted">Use a staff year range to narrow the member picker before sending.</p>
                    {memberFilters.staffMin || memberFilters.staffMax ? (
                      <Button type="button" variant="secondary" size="sm" onClick={clearMemberFilters}>
                        Clear Staff Years
                      </Button>
                    ) : null}
                  </div>
                  <label className="full-width">
                    Search members
                    <Input
                      value={memberQuery}
                      onChange={(event) => setMemberQuery(event.target.value)}
                      placeholder="Search by name or email, or use staff years only"
                    />
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
                {detail?.item?.eventType === "seminar" ? (
                  <div>
                    <strong>{detail?.item?.joinAccessCount || 0}</strong>
                    <span>Room opens</span>
                  </div>
                ) : null}
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
