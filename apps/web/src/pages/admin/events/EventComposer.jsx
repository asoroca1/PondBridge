import { useEffect, useMemo, useState } from "react";
import { Button, Input, Select, Textarea } from "@pondbridge/ui";
import { ModalDialog } from "../../../components/admin/AdminUi.jsx";
import {
  AUDIENCES,
  DELIVERY_MODES,
  EVENT_TYPES,
  MEETING_PROVIDERS,
  TOPIC_CATEGORIES,
  defaultSlotForDay,
  fromLocalInput,
  toLocalInput
} from "./eventUtils.js";

const EMPTY = {
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

function fromEvent(event = null, day = null) {
  if (!event) return { ...EMPTY, ...defaultSlotForDay(day) };
  return {
    ...EMPTY,
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

/**
 * One dialog for creating and editing. Online-only fields appear when the
 * delivery mode needs them, so an in-person picnic never has to look at a
 * meeting-provider dropdown.
 */
export default function EventComposer({
  open,
  event = null,
  day = null,
  saving = false,
  onClose,
  onSave,
  request
}) {
  const [form, setForm] = useState(() => fromEvent(event, day));
  const [error, setError] = useState("");
  const [hostQuery, setHostQuery] = useState("");
  const [hostResults, setHostResults] = useState([]);
  const [host, setHost] = useState(event?.host || null);

  useEffect(() => {
    if (!open) return;
    setForm(fromEvent(event, day));
    setHost(event?.host || null);
    setHostQuery("");
    setHostResults([]);
    setError("");
  }, [day, event, open]);

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

  const online = useMemo(
    () => ["online", "hybrid"].includes(form.deliveryMode),
    [form.deliveryMode]
  );
  const inPerson = form.deliveryMode !== "online";

  function patch(changes) {
    setForm((prev) => ({ ...prev, ...changes }));
  }

  function submit() {
    if (!form.title.trim()) {
      setError("Give the event a title.");
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
      title={event ? "Edit event" : "New event"}
      description="Members see this once you publish."
      onClose={saving ? undefined : onClose}
      className="director-admin-modal pb-events-composer-modal"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="button" onClick={submit} loading={saving}>
            {event ? "Save changes" : "Create event"}
          </Button>
        </>
      }
    >
      <div className="pb-events-composer">
        <label className="pb-events-field is-title">
          <span>Title</span>
          <Input
            value={form.title}
            onChange={(e) => patch({ title: e.target.value })}
            placeholder="Summer reunion barbecue"
            maxLength={160}
            autoFocus
          />
        </label>

        <div className="pb-events-field-row">
          <label className="pb-events-field">
            <span>Kind</span>
            <Select value={form.eventType} onChange={(e) => patch({ eventType: e.target.value })}>
              {EVENT_TYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </label>
          <label className="pb-events-field">
            <span>Where it happens</span>
            <Select value={form.deliveryMode} onChange={(e) => patch({ deliveryMode: e.target.value })}>
              {DELIVERY_MODES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </label>
          <label className="pb-events-field">
            <span>Who it's for</span>
            <Select value={form.audience} onChange={(e) => patch({ audience: e.target.value })}>
              {AUDIENCES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </label>
        </div>

        <div className="pb-events-field-row">
          <label className="pb-events-field">
            <span>Starts</span>
            <Input type="datetime-local" value={form.startsAt} onChange={(e) => patch({ startsAt: e.target.value })} />
          </label>
          <label className="pb-events-field">
            <span>Ends</span>
            <Input type="datetime-local" value={form.endsAt} onChange={(e) => patch({ endsAt: e.target.value })} />
          </label>
          <label className="pb-events-field">
            <span>RSVP closes <small>(optional)</small></span>
            <Input
              type="datetime-local"
              value={form.rsvpDeadlineAt}
              onChange={(e) => patch({ rsvpDeadlineAt: e.target.value })}
            />
          </label>
        </div>

        {inPerson ? (
          <div className="pb-events-field-row">
            <label className="pb-events-field">
              <span>Place</span>
              <Input
                value={form.locationName}
                onChange={(e) => patch({ locationName: e.target.value })}
                placeholder="Main lodge"
              />
            </label>
            <label className="pb-events-field is-wide">
              <span>Address</span>
              <Input
                value={form.locationAddress}
                onChange={(e) => patch({ locationAddress: e.target.value })}
                placeholder="120 Camp Road, Casco, ME"
              />
            </label>
          </div>
        ) : null}

        {online ? (
          <div className="pb-events-field-row">
            <label className="pb-events-field">
              <span>Meeting platform</span>
              <Select value={form.meetingProvider} onChange={(e) => patch({ meetingProvider: e.target.value })}>
                {MEETING_PROVIDERS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            </label>
            <label className="pb-events-field is-wide">
              <span>Meeting link</span>
              <Input
                value={form.meetingUrl}
                onChange={(e) => patch({ meetingUrl: e.target.value })}
                placeholder="https://teams.microsoft.com/l/meetup-join/…"
              />
              <small>Only shared with members who RSVP “Going”.</small>
            </label>
          </div>
        ) : null}

        {form.eventType === "seminar" ? (
          <div className="pb-events-field-row">
            <label className="pb-events-field">
              <span>Topic</span>
              <Select value={form.topicCategory} onChange={(e) => patch({ topicCategory: e.target.value })}>
                {TOPIC_CATEGORIES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            </label>
            <label className="pb-events-field is-wide">
              <span>Topic headline</span>
              <Input
                value={form.topicTitle}
                onChange={(e) => patch({ topicTitle: e.target.value })}
                placeholder="Breaking into product management"
              />
            </label>
          </div>
        ) : null}

        <div className="pb-events-field-row">
          <label className="pb-events-field is-wide">
            <span>Host <small>(optional)</small></span>
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
                  placeholder="Search members"
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
          </label>
          <label className="pb-events-field">
            <span>Capacity <small>(optional)</small></span>
            <Input
              type="number"
              min="1"
              value={form.capacity}
              onChange={(e) => patch({ capacity: e.target.value })}
              placeholder="No limit"
            />
          </label>
        </div>

        <label className="pb-events-field">
          <span>Short summary</span>
          <Input
            value={form.summary}
            onChange={(e) => patch({ summary: e.target.value })}
            placeholder="One line members see in the list"
            maxLength={280}
          />
        </label>

        <label className="pb-events-field">
          <span>Details</span>
          <Textarea
            value={form.bodyHtml}
            rows={5}
            onChange={(e) => patch({ bodyHtml: e.target.value })}
            placeholder="What to expect, what to bring, parking…"
          />
        </label>

        {error ? <p className="error-text" role="alert">{error}</p> : null}
      </div>
    </ModalDialog>
  );
}
