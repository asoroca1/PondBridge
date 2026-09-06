/**
 * How the director dashboard writes dates.
 *
 * There were five near-identical copies of this across the admin pages and two
 * places that missed the convention entirely: the Giving ledger printed
 * "9/2/2026" from a bare toLocaleDateString(), and a cause's timeline printed
 * the raw stored string, "2026-03-08". Everything else says "Sep 2, 2026".
 *
 * One module so the answer is the same everywhere.
 */

const DATE_ONLY = { month: "short", day: "numeric", year: "numeric" };
const DATE_AND_TIME = { dateStyle: "medium", timeStyle: "short" };

function parse(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** A moment in time: "Sep 2, 2026". */
export function formatDate(value, fallback = "") {
  const parsed = parse(value);
  return parsed ? parsed.toLocaleDateString(undefined, DATE_ONLY) : fallback;
}

/** A moment in time, to the minute: "Sep 2, 2026, 9:06 PM". */
export function formatDateTime(value, fallback = "") {
  const parsed = parse(value);
  return parsed ? parsed.toLocaleString(undefined, DATE_AND_TIME) : fallback;
}

/**
 * A calendar day that was stored without a time, like "2026-03-08".
 *
 * Read in UTC on purpose. `new Date("2026-03-08")` is midnight UTC, and
 * formatting that in any negative-offset timezone gives the day before — a
 * campaign that starts on the 8th would be shown starting on the 7th to every
 * director in the Americas.
 */
export function formatDay(value, fallback = "") {
  const parsed = parse(value);
  return parsed
    ? parsed.toLocaleDateString(undefined, { ...DATE_ONLY, timeZone: "UTC" })
    : fallback;
}

/**
 * A span of calendar days, where either end may be open.
 * "Mar 8, 2026 — Ongoing", "When approved — Jun 1, 2026".
 */
export function formatDayRange(start, end, { startFallback = "", endFallback = "" } = {}) {
  return `${formatDay(start, startFallback)} — ${formatDay(end, endFallback)}`;
}
