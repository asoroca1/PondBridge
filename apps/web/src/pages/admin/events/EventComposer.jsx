import { useEffect, useMemo, useState } from "react";
import { Button, Input, Select, Textarea } from "@pondbridge/ui";
import { ModalDialog } from "../../../components/admin/AdminUi.jsx";
import {
  AUDIENCES,
  MEETING_PROVIDERS,
  TOPIC_CATEGORIES,
  defaultSlotForDay,
  fromLocalInput,
  toLocalInput
} from "./eventUtils.js";

const BASE = {
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

// Each kind starts from the shape it almost always takes, so the common case
// needs no extra choices.
const TYPE_DEFAULTS = {
  community: { eventType: "community", deliveryMode: "in_person" },
  seminar: { eventType: "seminar", deliveryMode: "online", meetingProvider: "microsoft_teams" }
};

const COPY = {
  community: {
    title: "New event",
    editTitle: "Edit event",
    description: "A gathering members come to. They see it once you publish.",
    titlePlaceholder: "Summer reunion barbecue",
    summaryPlaceholder: "One line members see in the list",
    detailsPlaceholder: "What to expect, what to bring, parking…",
    createLabel: "Create event",
    hostLabel: "Organizer",
    hostHint: "Who members should ask about this."
  },
  seminar: {
    title: "New info session",
    editTitle: "Edit info session",
    description: "An online session you host. Only members who RSVP “Going” get the link.",
    titlePlaceholder: "Breaking into product management",
    summaryPlaceholder: "One line explaining what members will get out of it",
    detailsPlaceholder: "Agenda, who should attend, what to prepare…",
    createLabel: "Create info session",
    hostLabel: "Presenter",
    hostHint: "Shown to members as who is running the session."
  }
};

function initialForm(event, day, type) {
  if (event) {
    return {
      ...BASE,
      ...event,
      topicCategory: event.topicCategory || "",
      meetingProvider: event.meetingProvider || "",
      meetingUrl: event.meetingUrl || "",
      capacity: event.capacity == null ? "" : String(event.capacity),
      startsAt: toLocalInput(event.startsAt),
      endsAt: toLocalInput(event.endsAt),
      rsvpDeadlineAt: toLocalInput(event.rsvpDeadlineAt),
      timezone: event.timezone || "America/New_York"
    };
  }
  return {
    ...BASE,
    ...(TYPE_DEFAULTS[type] || TYPE_DEFAULTS.community),
    ...defaultSlotForDay(day)
  };
}

/**
 * One dialog, two forms. The kind is settled before this opens, so it is shown
 * as a fixed heading rather than a dropdown, and each kind only renders the
 * fields it actually needs.
 */
export default function EventComposer({
  open,
  event = null,
  type = "community",
  day = null,
  saving = false,
  onClose,
  onSave,
  request
}) {
  const eventType = event?.eventType || type;
  const copy = COPY[eventType] || COPY.community;
  const isSeminar = eventType === "seminar";

  const [form, setForm] = useState(() => initialForm(event, day, eventType));
  const [error, setError] = useState("");
  const [hostQuery, setHostQuery] = useState("");
  const [hostResults, setHostResults] = useState([]);
  const [host, setHost] = useState(event?.host || null);

  useEffect(() => {
    if (!open) return;
    setForm(initialForm(event, day, eventType));
    setHost(event?.host || null);
    setHostQuery("");
    setHostResults([]);
    setError("");
  }, [day, event, eventType, open]);

  useEffect(() => {
    const needle = hostQuery.trim();
    if (!open || needle.length < 2) {
      setHostResults([]);
      return undefined;
    }
    let active = true;
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          page: "1", pageSize: "6", q: needle,
          role: "all", year: "all", status: "all", completion: "all", sort: "name_asc"
        });
        const payload = await request(`/members?${params.toString()}`);
        if (active) setHostResults(Array.isArray(payload?.items) ? payload.items : []);
      } catch {
        if (active) setHostResults([]);
      }
    }, 220);
    return () => { active = false; window.clearTimeout(timer); };
  }, [hostQuery, open, request]);

  // An info session can also be held in a room; an event can also be streamed.
  // Both stay possible, just never the starting assumption.
  const alsoInPerson = isSeminar && form.deliveryMode === "hybrid";
  const alsoOnline = !isSeminar && ["online", "hybrid"].includes(form.deliveryMode);
  const showLocation = !isSeminar || alsoInPerson;
  const showMeeting = isSeminar || alsoOnline;

  const providerOptions = useMemo(
    () => (isSeminar ? MEETING_PROVIDERS.filter((item) => item.value) : MEETING_PROVIDERS),
    [isSeminar]
  );

  function patch(changes) {
    setForm((prev) => ({ ...prev, ...changes }));
  }

  function submit() {
    if (!form.title.trim()) {
      setError("Give it a title.");
      return;
    }
    if (!form.startsAt) {
      setError("Choose when it starts.");
      return;
    }
    if (form.endsAt && new Date(form.endsAt) <= new Date(form.startsAt)) {
      setError("The end time must come after the start time.");
      return;
    }
    setError("");
    onSave?.({
      ...form,
      eventType,
      capacity: form.capacity === "" ? null : Number(form.capacity),
      startsAt: fromLocalInput(form.startsAt),
      endsAt: fromLocalInput(form.endsAt),
      rsvpDeadlineAt: fromLocalInput(form.rsvpDeadlineAt),
      hostProfileId: host?.id || form.hostProfileId || ""
    });
  }

  return (
    <ModalDialog
      open={open}
      title={event ? copy.editTitle : copy.title}
      description={copy.description}
      onClose={saving ? undefined : onClose}
      className="director-admin-modal pb-events-composer-modal"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="button" onClick={submit} loading={saving}>
            {event ? "Save changes" : copy.createLabel}
          </Button>
        </>
      }
    >
      <div className="pb-events-composer">
        <div className="pb-events-form-grid">
          <label className="pb-events-field is-full">
            <span>Title</span>
            <Input
              value={form.title}
              onChange={(e) => patch({ title: e.target.value })}
              placeholder={copy.titlePlaceholder}
              maxLength={160}
            />
          </label>

          {isSeminar ? (
            <>
              <label className="pb-events-field">
                <span>Topic</span>
                <Select value={form.topicCategory} onChange={(e) => patch({ topicCategory: e.target.value })}>
                  {TOPIC_CATEGORIES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
              </label>
              <label className="pb-events-field">
                <span>Topic headline <small>optional</small></span>
                <Input
                  value={form.topicTitle}
                  onChange={(e) => patch({ topicTitle: e.target.value })}
                  placeholder="What it covers, in a few words"
                />
              </label>
            </>
          ) : null}

          <label className="pb-events-field">
            <span>Starts</span>
            <Input type="datetime-local" value={form.startsAt} onChange={(e) => patch({ startsAt: e.target.value })} />
          </label>
          <label className="pb-events-field">
            <span>Ends</span>
            <Input type="datetime-local" value={form.endsAt} onChange={(e) => patch({ endsAt: e.target.value })} />
          </label>

          <label className="pb-events-field">
            <span>{isSeminar ? "Registration closes" : "RSVP closes"} <small>optional</small></span>
            <Input
              type="datetime-local"
              value={form.rsvpDeadlineAt}
              onChange={(e) => patch({ rsvpDeadlineAt: e.target.value })}
            />
          </label>
          <label className="pb-events-field">
            <span>{isSeminar ? "Seat limit" : "Capacity"} <small>optional</small></span>
            <Input
              type="number"
              min="1"
              value={form.capacity}
              onChange={(e) => patch({ capacity: e.target.value })}
              placeholder="No limit"
            />
          </label>

          {showMeeting ? (
            <>
              <label className="pb-events-field">
                <span>Platform</span>
                <Select value={form.meetingProvider} onChange={(e) => patch({ meetingProvider: e.target.value })}>
                  {providerOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
              </label>
              <label className="pb-events-field">
                <span>Meeting link</span>
                <Input
                  value={form.meetingUrl}
                  onChange={(e) => patch({ meetingUrl: e.target.value })}
                  placeholder="https://teams.microsoft.com/l/meetup-join/…"
                />
                <small>Shared only with members who RSVP “Going”. Required to publish.</small>
              </label>
            </>
          ) : null}

          {showLocation ? (
            <>
              <label className="pb-events-field">
                <span>Place</span>
                <Input
                  value={form.locationName}
                  onChange={(e) => patch({ locationName: e.target.value })}
                  placeholder="Main lodge"
                />
              </label>
              <label className="pb-events-field">
                <span>Address <small>optional</small></span>
                <Input
                  value={form.locationAddress}
                  onChange={(e) => patch({ locationAddress: e.target.value })}
                  placeholder="120 Camp Road, Casco, ME"
                />
              </label>
            </>
          ) : null}

          <label className="pb-events-field">
            <span>Who it's for</span>
            <Select value={form.audience} onChange={(e) => patch({ audience: e.target.value })}>
              {AUDIENCES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </label>
          <label className="pb-events-field">
            <span>{isSeminar ? "Also in person?" : "Also online?"}</span>
            <Select value={form.deliveryMode} onChange={(e) => patch({ deliveryMode: e.target.value })}>
              {isSeminar ? (
                <>
                  <option value="online">Online only</option>
                  <option value="hybrid">Online and in person</option>
                </>
              ) : (
                <>
                  <option value="in_person">In person only</option>
                  <option value="hybrid">In person and online</option>
                  <option value="online">Online only</option>
                </>
              )}
            </Select>
          </label>

          <div className="pb-events-field is-full">
            <span>{copy.hostLabel} <small>optional</small></span>
            {host ? (
              <span className="pb-events-host">
                {host.fullName}
                <button type="button" onClick={() => { setHost(null); patch({ hostProfileId: "" }); }}>Remove</button>
              </span>
            ) : (
              <>
                <Input
                  value={hostQuery}
                  onChange={(e) => setHostQuery(e.target.value)}
                  placeholder={`Search members — ${copy.hostHint.toLowerCase()}`}
                />
                {hostResults.length ? (
                  <ul className="pb-events-host-results">
                    {hostResults.map((member) => (
                      <li key={member.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setHost({ id: member.id, fullName: member.fullName });
                            patch({ hostProfileId: member.id });
                            setHostQuery("");
                          }}
                        >
                          <strong>{member.fullName || "Member"}</strong>
                          <small>{member.email}</small>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            )}
          </div>

          <label className="pb-events-field is-full">
            <span>Short summary</span>
            <Input
              value={form.summary}
              onChange={(e) => patch({ summary: e.target.value })}
              placeholder={copy.summaryPlaceholder}
              maxLength={280}
            />
          </label>

          <label className="pb-events-field is-full">
            <span>Details <small>optional</small></span>
            <Textarea
              value={form.bodyHtml}
              rows={3}
              onChange={(e) => patch({ bodyHtml: e.target.value })}
              placeholder={copy.detailsPlaceholder}
            />
          </label>
        </div>

        {error ? <p className="error-text" role="alert">{error}</p> : null}
      </div>
    </ModalDialog>
  );
}
