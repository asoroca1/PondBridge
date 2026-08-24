import { useState } from "react";
import { Mic, UserRound, Users, X } from "lucide-react";
import MemberPicker from "./MemberPicker.jsx";
import { splitRoster } from "./eventUtils.js";

function initials(fullName = "") {
  return fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");
}

function statusLabel(status = "") {
  if (status === "attending") return "Going";
  if (status === "maybe") return "Maybe";
  if (status === "not_attending") return "Can’t go";
  return "No answer";
}

function Person({ person, busy, actionLabel, onSetRole, onRemove }) {
  return (
    <li>
      <span className="pb-events-roster-avatar" aria-hidden="true">
        {person.avatarUrl ? (
          <img src={person.avatarUrl} alt="" />
        ) : initials(person.fullName) ? (
          <em>{initials(person.fullName)}</em>
        ) : (
          <UserRound size={15} />
        )}
      </span>
      <span className="pb-events-roster-name">
        <strong>{person.fullName}</strong>
        <small>{person.email || person.roleAtCamp || "Registered member"}</small>
      </span>
      <span
        className={`pb-events-roster-status is-${String(person.status || "").replace("_", "-")}`}
      >
        {statusLabel(person.status)}
      </span>
      <button
        type="button"
        className="pb-events-roster-role"
        disabled={busy}
        onClick={() => onSetRole?.(person)}
      >
        {actionLabel}
      </button>
      <button
        type="button"
        className="pb-events-roster-remove"
        aria-label={`Remove ${person.fullName}`}
        disabled={busy}
        onClick={() => onRemove?.(person)}
      >
        <X size={14} aria-hidden="true" />
      </button>
    </li>
  );
}

/**
 * Who is running the session and who is coming to it, in one place. Members can
 * still register themselves; this is the director's side of the same roster, so
 * a presenter can be lined up before anyone signs up.
 */
export default function EventRoster({
  responses = [],
  seminar = false,
  request,
  busyProfileId = "",
  onAdd,
  onSetRole,
  onRemove
}) {
  const [adding, setAdding] = useState(false);

  const { presenters, attendees } = splitRoster(responses);
  const noun = seminar ? "presenter" : "host";

  return (
    <>
      <section className="pb-events-roster">
        <header>
          <h3>
            <Mic aria-hidden="true" />
            {seminar ? "Presenters" : "Hosts"}
          </h3>
          <button type="button" onClick={() => setAdding((prev) => !prev)}>
            {adding ? "Done" : `Add ${noun}`}
          </button>
        </header>

        {presenters.length ? (
          <ul>
            {presenters.map((person) => (
              <Person
                key={person.profileId}
                person={person}
                busy={busyProfileId === person.profileId}
                actionLabel="Make attendee"
                onSetRole={(target) => onSetRole?.(target, "attendee")}
                onRemove={onRemove}
              />
            ))}
          </ul>
        ) : (
          <p className="pb-events-roster-empty">
            No {noun} yet. Search the network to add one — they are marked as going
            straight away.
          </p>
        )}

        {adding ? (
          <MemberPicker
            request={request}
            placeholder={`Search members to add as a ${noun}`}
            excludeIds={presenters.map((person) => person.profileId)}
            disabled={Boolean(busyProfileId)}
            onSelect={(member) => onAdd?.(member, "presenter")}
          />
        ) : null}
      </section>

      {attendees.length ? (
        <section className="pb-events-roster">
          <header>
            <h3>
              <Users aria-hidden="true" />
              Registered
            </h3>
            <small>{attendees.length} on the list</small>
          </header>
          <ul>
            {attendees.map((person) => (
              <Person
                key={person.profileId}
                person={person}
                busy={busyProfileId === person.profileId}
                actionLabel={`Make ${noun}`}
                onSetRole={(target) => onSetRole?.(target, "presenter")}
                onRemove={onRemove}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
