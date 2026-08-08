import { CalendarDays, MapPin, Video } from "lucide-react";
import { eventAccent, formatWhen, formatWhere, isOnline, statusTone } from "./eventUtils.js";

/**
 * The flat agenda behind Upcoming / Drafts / Past. Grouped by day so a busy
 * reunion weekend reads as one block rather than a wall of rows.
 */
export default function EventsAgenda({ events = [], selectedId = "", onSelect, emptyLabel = "Nothing here yet." }) {
  if (!events.length) {
    return (
      <div className="pb-events-agenda-empty">
        <CalendarDays aria-hidden="true" />
        <p>{emptyLabel}</p>
      </div>
    );
  }

  const groups = [];
  let currentKey = "";
  for (const event of events) {
    const label = event.startsAt
      ? new Date(event.startsAt).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })
      : "Date to be decided";
    if (label !== currentKey) {
      groups.push({ label, items: [] });
      currentKey = label;
    }
    groups[groups.length - 1].items.push(event);
  }

  return (
    <div className="pb-events-agenda">
      {groups.map((group) => (
        <section key={group.label}>
          <h3>{group.label}</h3>
          <ul>
            {group.items.map((event) => (
              <li key={event.id}>
                <button
                  type="button"
                  className={event.id === selectedId ? "is-selected" : ""}
                  onClick={() => onSelect?.(event.id)}
                >
                  <i className={`pb-events-rail-accent is-${eventAccent(event)}`} aria-hidden="true" />
                  <span className="pb-events-agenda-main">
                    <strong>{event.title || "Untitled event"}</strong>
                    <small>{formatWhen(event)}</small>
                    <small className="pb-events-agenda-where">
                      {isOnline(event) ? <Video aria-hidden="true" /> : <MapPin aria-hidden="true" />}
                      {formatWhere(event)}
                    </small>
                  </span>
                  <span className="pb-events-agenda-meta">
                    <span className={`pb-events-status tone-${statusTone(event.status)}`}>{event.status}</span>
                    <small>{event.counts?.attending || 0} going</small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
