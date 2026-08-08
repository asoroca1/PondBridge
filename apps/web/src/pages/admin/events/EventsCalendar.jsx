import { useMemo } from "react";
import { Button } from "@pondbridge/ui";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import {
  addMonths,
  dayKey,
  eventAccent,
  formatTime,
  groupByDay,
  monthGrid,
  sameDay
} from "./eventUtils.js";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MAX_CHIPS = 3;

/**
 * Month grid. Clicking empty space in a day starts a new event at a sensible
 * time on that day, the way a calendar app does — rather than making the
 * director open a form and type the date they already picked.
 */
export default function EventsCalendar({
  month,
  onMonthChange,
  events = [],
  selectedId = "",
  onSelect,
  onCreateOnDay
}) {
  const weeks = useMemo(() => monthGrid(month), [month]);
  const byDay = useMemo(() => groupByDay(events), [events]);
  const today = new Date();
  const monthLabel = month.toLocaleDateString([], { month: "long", year: "numeric" });

  return (
    <div className="pb-events-calendar">
      <header className="pb-events-calendar-head">
        <div className="pb-events-calendar-nav">
          <button type="button" onClick={() => onMonthChange(addMonths(month, -1))} aria-label="Previous month">
            <ChevronLeft aria-hidden="true" />
          </button>
          <strong>{monthLabel}</strong>
          <button type="button" onClick={() => onMonthChange(addMonths(month, 1))} aria-label="Next month">
            <ChevronRight aria-hidden="true" />
          </button>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={() => onMonthChange(new Date())}>
          Today
        </Button>
      </header>

      <div className="pb-events-weekdays" aria-hidden="true">
        {WEEKDAYS.map((day) => <span key={day}>{day}</span>)}
      </div>

      <div className="pb-events-grid">
        {weeks.map((week, weekIndex) => (
          week.map((day) => {
            const key = dayKey(day);
            const dayEvents = byDay.get(key) || [];
            const outside = day.getMonth() !== month.getMonth();
            const isToday = sameDay(day, today);
            return (
              <div
                key={`${weekIndex}-${key}`}
                className={`pb-events-day ${outside ? "is-outside" : ""} ${isToday ? "is-today" : ""}`.trim()}
              >
                <div className="pb-events-day-head">
                  <span>{day.getDate()}</span>
                  <button
                    type="button"
                    className="pb-events-day-add"
                    onClick={() => onCreateOnDay?.(day)}
                    aria-label={`New event on ${day.toLocaleDateString()}`}
                  >
                    <Plus aria-hidden="true" />
                  </button>
                </div>
                <div className="pb-events-day-body">
                  {dayEvents.slice(0, MAX_CHIPS).map((event) => (
                    <button
                      key={event.id}
                      type="button"
                      className={`pb-events-chip is-${eventAccent(event)} ${event.id === selectedId ? "is-selected" : ""}`.trim()}
                      onClick={() => onSelect?.(event.id)}
                      title={`${event.title} — ${formatTime(event.startsAt)}`}
                    >
                      <i aria-hidden="true" />
                      <span className="pb-events-chip-time">{formatTime(event.startsAt)}</span>
                      <span className="pb-events-chip-title">{event.title || "Untitled"}</span>
                    </button>
                  ))}
                  {dayEvents.length > MAX_CHIPS ? (
                    <button
                      type="button"
                      className="pb-events-chip-more"
                      onClick={() => onSelect?.(dayEvents[MAX_CHIPS].id)}
                    >
                      +{dayEvents.length - MAX_CHIPS} more
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })
        ))}
      </div>
    </div>
  );
}
