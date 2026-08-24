// Shared vocabulary and date maths for the director events workspace.

export const EVENT_TYPES = [
  { value: "community", label: "Event" },
  { value: "seminar", label: "Info session" }
];

export const DELIVERY_MODES = [
  { value: "in_person", label: "In person" },
  { value: "online", label: "Online" },
  { value: "hybrid", label: "Hybrid" }
];

export const TOPIC_CATEGORIES = [
  { value: "", label: "No topic" },
  { value: "career", label: "Career" },
  { value: "college", label: "College" },
  { value: "financial_literacy", label: "Financial literacy" },
  { value: "networking", label: "Networking" },
  { value: "other", label: "Other" }
];

export const AUDIENCES = [
  { value: "all_members", label: "All members" },
  { value: "students", label: "Students" },
  { value: "young_alumni", label: "Young alumni" },
  { value: "parents", label: "Parents" },
  { value: "college_applicants", label: "College applicants" },
  { value: "career_explorers", label: "Career explorers" }
];

export const MEETING_PROVIDERS = [
  { value: "", label: "No meeting link" },
  { value: "microsoft_teams", label: "Microsoft Teams" },
  { value: "zoom", label: "Zoom" },
  { value: "google_meet", label: "Google Meet" },
  { value: "other", label: "Other" }
];

export const PROVIDER_LABELS = Object.fromEntries(MEETING_PROVIDERS.map((item) => [item.value, item.label]));

export const VIEWS = [
  { key: "calendar", label: "Calendar" },
  { key: "upcoming", label: "Upcoming" },
  { key: "drafts", label: "Drafts" },
  { key: "past", label: "Past" }
];

export function statusTone(status = "") {
  if (status === "published") return "success";
  if (status === "canceled") return "danger";
  return "muted";
}

export function isOnline(event = {}) {
  return ["online", "hybrid"].includes(event.deliveryMode);
}

/** Events read as one of these at a glance, which drives their colour. */
export function eventAccent(event = {}) {
  if (event.status === "canceled") return "canceled";
  if (event.status === "draft") return "draft";
  return event.eventType === "seminar" ? "seminar" : "community";
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

export function startOfDay(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function sameDay(a, b) {
  if (!a || !b) return false;
  const left = new Date(a);
  const right = new Date(b);
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

export function addMonths(date, delta) {
  const next = new Date(date);
  next.setDate(1);
  next.setMonth(next.getMonth() + delta);
  return next;
}

export function dayKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/**
 * The six-week grid a month calendar needs, always starting on Sunday so every
 * month renders the same shape and the layout never jumps.
 */
export function monthGrid(monthDate) {
  const first = new Date(monthDate);
  first.setDate(1);
  first.setHours(0, 0, 0, 0);
  const start = new Date(first);
  start.setDate(1 - first.getDay());

  const weeks = [];
  const cursor = new Date(start);
  for (let week = 0; week < 6; week += 1) {
    const days = [];
    for (let day = 0; day < 7; day += 1) {
      days.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(days);
  }
  return weeks;
}

export function groupByDay(events = []) {
  const map = new Map();
  for (const event of events) {
    if (!event?.startsAt) continue;
    const key = dayKey(event.startsAt);
    if (!key) continue;
    const bucket = map.get(key) || [];
    bucket.push(event);
    map.set(key, bucket);
  }
  for (const bucket of map.values()) {
    bucket.sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
  }
  return map;
}

export function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function formatDayLong(value) {
  if (!value) return "Date to be decided";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date to be decided";
  return date.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

/** "Thu, Aug 14 · 6:00 – 7:30 PM" — the one line that answers "when?". */
export function formatWhen(event = {}) {
  if (!event.startsAt) return "Date to be decided";
  const start = new Date(event.startsAt);
  if (Number.isNaN(start.getTime())) return "Date to be decided";
  const day = start.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  const startTime = formatTime(event.startsAt);
  if (!event.endsAt) return `${day} · ${startTime}`;
  const end = new Date(event.endsAt);
  if (Number.isNaN(end.getTime())) return `${day} · ${startTime}`;
  return sameDay(start, end)
    ? `${day} · ${startTime} – ${formatTime(event.endsAt)}`
    : `${day} ${startTime} → ${end.toLocaleDateString([], { month: "short", day: "numeric" })} ${formatTime(event.endsAt)}`;
}

export function formatWhere(event = {}) {
  if (isOnline(event)) {
    const provider = PROVIDER_LABELS[event.meetingProvider] || "Online";
    return event.deliveryMode === "hybrid"
      ? `${event.locationName || "In person"} + ${provider}`
      : provider;
  }
  return event.locationName || "Location to be decided";
}

export function toLocalInput(value = "") {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const offset = parsed.getTimezoneOffset() * 60 * 1000;
  return new Date(parsed.getTime() - offset).toISOString().slice(0, 16);
}

export function fromLocalInput(value = "") {
  return value ? new Date(value).toISOString() : null;
}

/**
 * The first thing wrong with the form, or "" when it is ready to save.
 *
 * An undated info session skips the date checks entirely; that is the whole
 * point of leaving it undated.
 */
export function findEventFormProblem({ form = {}, undated = false } = {}) {
  if (!String(form.title || "").trim()) return "Give it a title.";
  if (undated) return "";
  if (!form.startsAt) return "Choose when it starts.";
  if (form.endsAt && new Date(form.endsAt) <= new Date(form.startsAt)) {
    return "The end time must come after the start time.";
  }
  return "";
}

/**
 * What gets sent to the server.
 *
 * An undated session sends its dates as explicit nulls rather than leaving them
 * out, so turning a scheduled session back into an undated one clears the date
 * already stored against it instead of keeping it.
 */
export function buildEventSavePayload({
  form = {},
  eventType = "community",
  undated = false,
  host = null
} = {}) {
  return {
    ...form,
    eventType,
    capacity: form.capacity === "" ? null : Number(form.capacity),
    startsAt: undated ? null : fromLocalInput(form.startsAt),
    endsAt: undated ? null : fromLocalInput(form.endsAt),
    rsvpDeadlineAt: fromLocalInput(form.rsvpDeadlineAt),
    hostProfileId: host?.id || form.hostProfileId || ""
  };
}

/** A new event defaults to the next clean hour on the chosen day. */
export function defaultSlotForDay(day) {
  const base = day ? new Date(day) : new Date();
  const now = new Date();
  if (sameDay(base, now)) {
    base.setHours(now.getHours() + 1, 0, 0, 0);
  } else {
    base.setHours(18, 0, 0, 0);
  }
  const end = new Date(base);
  end.setHours(end.getHours() + 1);
  return { startsAt: toLocalInput(base), endsAt: toLocalInput(end) };
}

/**
 * Splits an event's registrations into the people running it and everyone else.
 * Someone who declined is never shown as a presenter, even if they were signed
 * up as one before they changed their answer.
 */
export function splitRoster(responses = []) {
  const rows = Array.isArray(responses) ? responses : [];
  const presenters = rows.filter(
    (person) => person?.registrationRole === "presenter" && person?.status !== "not_attending"
  );
  const attendees = rows.filter(
    (person) => person?.registrationRole !== "presenter" || person?.status === "not_attending"
  );
  return { presenters, attendees };
}
