import { composeCityState, parseCityStateDetailed } from "../utils/location.js";

/**
 * Every profile field a questionnaire import can fill, and how to turn a
 * spreadsheet cell into the value that field expects.
 *
 * Two rules run through all of it:
 *
 * 1. A blank cell sets nothing. Questionnaire answers are mostly blank, and an
 *    empty string is a value — it would overwrite on re-import and would show as
 *    an answered-but-empty field. Absent keys are dropped before the payload is
 *    built, never written as "".
 * 2. Deterministic or nothing. A cell that cannot be parsed with confidence comes
 *    back null and lands in the failure report, rather than being guessed at.
 *    Guessing is the model's job, later in the pipeline, and only where it is
 *    shown to a director first.
 */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function text(value) {
  return String(value ?? "").trim();
}

/**
 * Names routinely contain commas — "University of California, Berkeley" — so
 * multi-value name fields split on semicolons and newlines only. Splitting them
 * on commas would quietly turn one college into two, which is worse than leaving
 * a director one row to fix.
 */
function splitNames(value) {
  return text(value)
    .split(/[;\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Years and other comma-safe values, where a comma really is a separator. */
function splitTokens(value) {
  return text(value)
    .split(/[,;\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function dedupe(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/**
 * Camps have been running since long before 2000, so a two-digit year is
 * genuinely ambiguous. The standard window resolves it: a number above the
 * current two-digit year has to be last century.
 */
export function normalizeYear(value, now = new Date()) {
  const raw = text(value);
  const fourDigit = raw.match(/\b(19|20)\d{2}\b/);
  if (fourDigit) return fourDigit[0];

  const twoDigit = raw.match(/^'?(\d{2})$/);
  if (!twoDigit) return null;
  const year = Number(twoDigit[1]);
  const currentTwoDigit = now.getFullYear() % 100;
  return String(year > currentTwoDigit ? 1900 + year : 2000 + year);
}

export function normalizeEmailCell(value) {
  const email = text(value).toLowerCase();
  return EMAIL_REGEX.test(email) ? email : null;
}

export function normalizeCityStateCell(value) {
  const raw = text(value);
  if (!raw) return null;
  return composeCityState(parseCityStateDetailed(raw)) || null;
}

/**
 * People write social accounts every way there is: a bare handle, an @handle, a
 * full URL, a URL without a scheme. Store the handle for the platforms the
 * profile shows as handles, and a canonical URL for LinkedIn, which is what the
 * résumé parser already produces.
 */
export function normalizeSocialCell(value, platform = "") {
  const raw = text(value);
  if (!raw) return null;

  if (platform === "linkedin") {
    const slug = raw.match(/linkedin\.com\/in\/([A-Za-z0-9_%.-]+)/i)?.[1]
      || raw.match(/^@?([A-Za-z0-9_.-]+)$/)?.[1];
    return slug ? `https://www.linkedin.com/in/${slug.replace(/\/+$/, "")}` : null;
  }

  const handle = raw.match(new RegExp(`${platform}\\.com/([A-Za-z0-9_.-]+)`, "i"))?.[1]
    || raw.match(/^@?([A-Za-z0-9_.-]+)$/)?.[1];
  return handle ? handle.replace(/\/+$/, "") : null;
}

/**
 * The catalog the mapping UI offers and the mapper chooses from.
 *
 * `path` is where the value lands in the signup body that profilePayloadFromBody
 * consumes. Job fields are indexed because a questionnaire routinely splits one
 * job across several columns ("Job title", "Employer", "Since"), and they have to
 * compose back into a single entry.
 */
export const IMPORT_FIELDS = Object.freeze([
  { path: "email", label: "Email address", kind: "email", required: true },
  { path: "firstName", label: "First name", kind: "text" },
  { path: "lastName", label: "Last name", kind: "text" },
  { path: "phones", label: "Phone", kind: "nameList" },
  { path: "cityState", label: "City and state", kind: "cityState" },
  { path: "bio", label: "About", kind: "text" },

  { path: "roles", label: "Role at camp", kind: "nameList" },
  { path: "nickname", label: "Camp nickname", kind: "text" },
  { path: "camperYears.firstYear", label: "First year at camp", kind: "year" },
  { path: "camperYears.lastYear", label: "Last year at camp", kind: "year" },
  { path: "camperYears.firstGroup", label: "First bunk or group", kind: "text" },
  { path: "camperYears.lastGroup", label: "Last bunk or group", kind: "text" },

  { path: "highSchool", label: "High school", kind: "text" },
  { path: "colleges", label: "College", kind: "nameList" },
  { path: "collegeYears", label: "Graduation year", kind: "tokenList" },
  { path: "collegeMajors", label: "Major", kind: "nameList" },

  { path: "industry", label: "Industry", kind: "text" },
  { path: "currentJobs.0.role", label: "Current job title", kind: "text" },
  { path: "currentJobs.0.company", label: "Current employer", kind: "text" },
  { path: "currentJobs.0.years", label: "Current job years", kind: "text" },
  { path: "pastJobs.0.role", label: "Past job title", kind: "text" },
  { path: "pastJobs.0.company", label: "Past employer", kind: "text" },
  { path: "pastJobs.0.years", label: "Past job years", kind: "text" },

  { path: "socials.linkedin", label: "LinkedIn", kind: "social" },
  { path: "socials.instagram", label: "Instagram", kind: "social" },
  { path: "socials.facebook", label: "Facebook", kind: "social" }
]);

const FIELD_BY_PATH = new Map(IMPORT_FIELDS.map((field) => [field.path, field]));

export function importFieldByPath(path = "") {
  return FIELD_BY_PATH.get(String(path || "").trim()) || null;
}

export function isKnownImportField(path = "") {
  return FIELD_BY_PATH.has(String(path || "").trim());
}

/**
 * One cell to one field's value. Returns null for "nothing to write here" —
 * blank, or unparseable. The caller never distinguishes the two, because both
 * mean the same thing to the profile: leave it alone.
 */
export function coerceCell(path, rawValue) {
  const field = importFieldByPath(path);
  if (!field) return null;
  if (!text(rawValue)) return null;

  switch (field.kind) {
    case "email":
      return normalizeEmailCell(rawValue);
    case "cityState":
      return normalizeCityStateCell(rawValue);
    case "year":
      return normalizeYear(rawValue);
    case "nameList": {
      const values = dedupe(splitNames(rawValue));
      return values.length ? values : null;
    }
    case "tokenList": {
      const values = dedupe(splitTokens(rawValue));
      return values.length ? values : null;
    }
    case "social":
      return normalizeSocialCell(rawValue, path.split(".")[1] || "");
    case "text":
    default:
      return text(rawValue) || null;
  }
}

function assignPath(target, path, value) {
  const segments = path.split(".");
  let cursor = target;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    const nextIsIndex = /^\d+$/.test(segments[index + 1]);
    if (cursor[segment] === undefined) cursor[segment] = nextIsIndex ? [] : {};
    cursor = cursor[segment];
  }
  const last = segments[segments.length - 1];
  if (Array.isArray(cursor[last]) && Array.isArray(value)) {
    cursor[last] = dedupe([...cursor[last], ...value]);
    return;
  }
  cursor[last] = value;
}

/**
 * Builds the signup-shaped body for one spreadsheet row.
 *
 * `mapping` is column header to field path, or to a list of paths when one answer
 * feeds more than one field — a single "1998-2004" column filling both ends of a
 * camp-year range is the case that makes this necessary rather than convenient.
 *
 * Anything a row leaves blank is simply absent from the result, which is what
 * lets a half-filled questionnaire import without erasing what is already on a
 * profile.
 */
export function buildImportBody(row = {}, mapping = {}) {
  const body = {};
  const skipped = [];

  for (const [column, target] of Object.entries(mapping || {})) {
    const paths = (Array.isArray(target) ? target : [target])
      .map((path) => String(path || "").trim())
      .filter(Boolean);
    if (!paths.length) continue;

    const rawValue = row[column];
    if (!text(rawValue)) continue;

    for (const path of paths) {
      if (!isKnownImportField(path)) {
        skipped.push({ column, path, reason: "unknown_field" });
        continue;
      }
      const value = coerceCell(path, rawValue);
      if (value === null) {
        skipped.push({ column, path, reason: "unparseable" });
        continue;
      }
      assignPath(body, path, value);
    }
  }

  // Job rows are positional, so a mapping that fills only "company" leaves a hole
  // at index 0. Compact them, and drop any entry that ended up with nothing.
  for (const key of ["currentJobs", "pastJobs"]) {
    if (!Array.isArray(body[key])) continue;
    body[key] = body[key]
      .filter(Boolean)
      .map((job) => ({
        role: text(job?.role),
        company: text(job?.company),
        years: text(job?.years)
      }))
      .filter((job) => job.role || job.company);
    if (!body[key].length) delete body[key];
  }

  return { body, skipped };
}
