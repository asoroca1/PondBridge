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
  Video
} from "lucide-react";
import EventRoster from "./EventRoster.jsx";
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
  onAddRegistration,
  onSetRegistrationRole,
  onRemoveRegistration,
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
        {event.host?.fullName ? (
          <div>
            <Users aria-hidden="true" />
            <span>Hosted by {event.host.fullName}</span>
          </div>
        ) : null}
      </div>

      {online ? (
        <div className="pb-events-meeting">
          <div>
            <strong>{PROVIDER_LABELS[event.meetingProvider] || "Online meeting"}</strong>
            <small>
              {event.meetingUrl
                ? "Only members who RSVP “Going” can open the room."
                // Publishing no longer waits on the link, so this is a reminder
                // rather than a blocker.
                : "No meeting link yet. Members can register now; add it before it starts."}
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

      <EventRoster
        responses={responses}
        seminar={seminar}
        request={request}
        busyProfileId={rosterBusyId}
        onAdd={onAddRegistration}
        onSetRole={onSetRegistrationRole}
        onRemove={onRemoveRegistration}
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

      {event.summary ? <p className="pb-events-detail-summary">{event.summary}</p> : null}
      {event.bodyHtml ? (
        <div className="pb-events-detail-body" dangerouslySetInnerHTML={{ __html: event.bodyHtml }} />
      ) : null}
    </div>
  );
}
