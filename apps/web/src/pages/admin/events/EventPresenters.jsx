import { useState } from "react";
import { Mic, UserRound, X } from "lucide-react";
import MemberPicker from "./MemberPicker.jsx";

function initials(fullName = "") {
  return fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");
}

/**
 * Who is running the event. Adding someone here also puts them on the guest
 * list as going, and removing them undoes both — so the two lists can never
 * tell different stories about the same person.
 */
export default function EventPresenters({
  presenters = [],
  seminar = false,
  request,
  busyProfileId = "",
  onAdd,
  onRemove
}) {
  const [adding, setAdding] = useState(false);
  const label = seminar ? "Presenters" : "Hosts";
  const emptyHint = seminar
    ? "No presenter yet. An info session needs at least one before it can be published."
    : "No host yet. Add whoever members should ask about this event.";

  return (
    <section className="pb-events-presenters">
      <header>
        <h3>
          <Mic aria-hidden="true" />
          {label}
        </h3>
        <button type="button" onClick={() => setAdding((prev) => !prev)}>
          {adding ? "Done" : `Add ${seminar ? "presenter" : "host"}`}
        </button>
      </header>

      {presenters.length ? (
        <ul className="pb-events-presenter-list">
          {presenters.map((person, index) => (
            <li key={person.id}>
              <span className="pb-events-presenter-avatar" aria-hidden="true">
                {person.avatarUrl ? (
                  <img src={person.avatarUrl} alt="" />
                ) : initials(person.fullName) ? (
                  <em>{initials(person.fullName)}</em>
                ) : (
                  <UserRound size={15} />
                )}
              </span>
              <span className="pb-events-presenter-name">
                <strong>{person.fullName}</strong>
                <small>
                  {index === 0 ? "Lead · " : ""}
                  {person.roleAtCamp || person.industry || "Registered member"}
                </small>
              </span>
              <span className="pb-events-presenter-going">Going</span>
              <button
                type="button"
                aria-label={`Remove ${person.fullName}`}
                disabled={busyProfileId === person.id}
                onClick={() => onRemove?.(person)}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="pb-events-presenters-empty">{emptyHint}</p>
      )}

      {adding ? (
        <MemberPicker
          request={request}
          placeholder={`Search members to add as a ${seminar ? "presenter" : "host"}`}
          excludeIds={presenters.map((person) => person.id)}
          disabled={Boolean(busyProfileId)}
          onSelect={(member) => onAdd?.(member)}
        />
      ) : null}
      <p className="pb-events-presenters-note">
        Everyone here is marked as going and{seminar ? " can open the room without an RSVP." : " is shown to members as running this event."}
      </p>
    </section>
  );
}
