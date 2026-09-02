import { Button } from "@pondbridge/ui";
import {
  Ban,
  CalendarDays,
  Copy,
  ExternalLink,
  Mail,
  MapPin,
  Pencil,
  Send,
  Users,
  Video,
  X
} from "lucide-react";
import EventPresenters from "./EventPresenters.jsx";
import {
  PROVIDER_LABELS,
  eventAccent,
  formatDayLong,
  formatWhen,
  formatWhere,
  isOnline,
  statusTone
} from "./eventUtils.js";

function Stat({ label, value, tone = "" }) {
  return (
    <div className={`pb-events-stat ${tone}`.trim()}>
      <strong>{value}</strong>
      <small>{label}</small>
    </div>
  );
}

/**
 * The reading pane: everything a director needs to answer "is this ready and
 * who is coming?", with the actions that stage of the event allows.
 */
export default function EventDetailPane({
  event,
  responses = [],
  request,
  busy = "",
  rosterBusyId = "",
  memberUrl = "",
  onAddPresenter,
  onRemovePresenter,
  onRemoveAttendee,
  onEdit,
  onPublish,
  onUnpublish,
  onCancel,
  onInvite,
  onCopyLink
}) {
  if (!event) {
    return (
      <div className="pb-events-detail is-empty">
        <CalendarDays aria-hidden="true" />
        <p>Select an event to see its details, attendees, and what to do next.</p>
      </div>
    );
  }

  const counts = event.counts || {};
  const online = isOnline(event);
  const seminar = event.eventType === "seminar";
  const presenters = Array.isArray(event.presenters) ? event.presenters : [];
  const guests = Array.isArray(responses) ? responses : [];
  const canPublish = event.status === "draft";
  const canUnpublish = event.status === "published";
  const canCancel = event.status !== "canceled";

  return (
    <div className="pb-events-detail">
      <header className="pb-events-detail-head">
        <div>
          <span className={`pb-events-tag is-${eventAccent(event)}`}>
            {event.eventType === "seminar" ? "Info session" : "Event"}
          </span>
          <span className={`pb-events-status tone-${statusTone(event.status)}`}>{event.status}</span>
          {event.phase ? <span className="pb-events-phase">{event.phase}</span> : null}
        </div>
        <h2>{event.title || "Untitled event"}</h2>
        <p className="pb-events-detail-when">{formatDayLong(event.startsAt)}</p>
      </header>

      <div className="pb-events-detail-facts">
        <div>
          <CalendarDays aria-hidden="true" />
          <span>{formatWhen(event)}</span>
        </div>
        <div>
          {online ? <Video aria-hidden="true" /> : <MapPin aria-hidden="true" />}
          <span>{formatWhere(event)}</span>
        </div>
      </div>

      {online ? (
        <div className="pb-events-meeting">
          <div>
            <strong>{PROVIDER_LABELS[event.meetingProvider] || "Online meeting"}</strong>
            <small>
              {event.meetingUrl
                ? "Only members who RSVP “Going” can open the room."
                : "No meeting link yet — add one before publishing."}
            </small>
          </div>
          {event.meetingUrl ? (
            <div className="pb-events-meeting-actions">
              <Button type="button" variant="secondary" size="sm" onClick={() => onCopyLink?.(event.meetingUrl)}>
                <Copy aria-hidden="true" />
                Copy link
              </Button>
              <a className="link-button" href={event.meetingUrl} target="_blank" rel="noopener noreferrer">
                <Video aria-hidden="true" />
                Join
              </a>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="pb-events-stats">
        <Stat label="Going" value={counts.attending || 0} tone="is-going" />
        <Stat label="Maybe" value={counts.maybe || 0} />
        <Stat label="Can't go" value={counts.notAttending || 0} />
        {event.capacity ? <Stat label="Capacity" value={event.capacity} /> : null}
      </div>

      <EventPresenters
        presenters={presenters}
        seminar={seminar}
        request={request}
        busyProfileId={rosterBusyId}
        onAdd={onAddPresenter}
        onRemove={onRemovePresenter}
      />

      <div className="pb-events-detail-actions">
        <Button type="button" onClick={() => onEdit?.(event)}>
          <Pencil aria-hidden="true" />
          Edit
        </Button>
        {canPublish ? (
          <Button type="button" variant="secondary" onClick={() => onPublish?.(event)} loading={busy === "publish"}>
            <Send aria-hidden="true" />
            Publish
          </Button>
        ) : null}
        {canUnpublish ? (
          <Button type="button" variant="secondary" onClick={() => onUnpublish?.(event)} loading={busy === "unpublish"}>
            Unpublish
          </Button>
        ) : null}
        <Button type="button" variant="secondary" onClick={() => onInvite?.(event)}>
          <Mail aria-hidden="true" />
          Invite &amp; remind
        </Button>
        {memberUrl ? (
          <a className="link-button secondary" href={memberUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink aria-hidden="true" />
            View as member
          </a>
        ) : null}
        {canCancel ? (
          <Button type="button" variant="ghost" onClick={() => onCancel?.(event)} loading={busy === "cancel"}>
            <Ban aria-hidden="true" />
            Cancel event
          </Button>
        ) : null}
      </div>

      {guests.length ? (
        <section className="pb-events-roster">
          <header>
            <h3>
              <Users aria-hidden="true" />
              Guest list
            </h3>
            <small>{guests.length} responded</small>
          </header>
          <ul>
            {guests.map((person) => (
              <li key={person.id}>
                <span className="pb-events-roster-name">
                  <strong>{person.fullName}</strong>
                  <small>{person.email}</small>
                </span>
                <span className={`pb-events-roster-status is-${String(person.status || "").replace("_", "-")}`}>
                  {person.status === "attending"
                    ? "Going"
                    : person.status === "maybe"
                      ? "Maybe"
                      : "Can’t go"}
                </span>
                {person.isPresenter ? (
                  <span className="pb-events-roster-tag">{seminar ? "Presenter" : "Host"}</span>
                ) : null}
                <button
                  type="button"
                  className="pb-events-roster-remove"
                  aria-label={`Remove ${person.fullName}`}
                  disabled={rosterBusyId === person.profileId}
                  onClick={() => onRemoveAttendee?.(person)}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {event.summary ? <p className="pb-events-detail-summary">{event.summary}</p> : null}
      {event.bodyHtml ? (
        <div className="pb-events-detail-body" dangerouslySetInnerHTML={{ __html: event.bodyHtml }} />
      ) : null}
    </div>
  );
}
