import {
  canonicalizeCityName,
  canonicalizeCountryName,
  composeCityState,
  parseCityStateDetailed
} from "../utils/location.js";

/**
 * Turns a signup body into a complete profile payload.
 *
 * Lifted out of the access route unchanged so the questionnaire importer can
 * write profiles through exactly the same normalizers a person's own signup
 * uses. Two implementations would drift, and the drift would show up as
 * imported members who cannot be found by the same search that finds everyone
 * else — camp years and college majors in particular live inside the socials
 * blob rather than in columns, and only this code puts them there correctly.
 *
 * Note: routes/tenantAuth.js and routes/legacyCedarCompat.js still carry their
 * own copies of these helpers. Folding them in here is worth doing, but it
 * touches three signup paths and belongs in its own change.
 */

function normalizeEmail(value = "") {
  return String(value || "").trim().toLowerCase();
}

export function normalizeCamperYears(value = {}) {
  const input = value && typeof value === "object" ? value : {};
  const validYear = (year = "") => {
    const normalized = String(year || "").trim();
    return /^\d{4}$/.test(normalized) ? normalized : "";
  };
  return {
    firstYear: validYear(input.firstYear),
    firstGroup: String(input.firstGroup || "").trim(),
    lastYear: validYear(input.lastYear),
    lastGroup: String(input.lastGroup || "").trim()
  };
}

export function normalizeRoleList(value = []) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  const seen = new Set();
  const ordered = [];
  values.forEach((entry) => {
    const role = String(entry || "").trim();
    const key = role.toLowerCase();
    if (!role || seen.has(key)) return;
    seen.add(key);
    ordered.push(role);
  });
  return ordered;
}

export function normalizeCollegeMajors(value = []) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry || "").trim());
}

export function normalizeCityStateFromBody(body = {}) {
  const direct = String(body.cityState || "").trim();
  if (direct) return composeCityState(parseCityStateDetailed(direct));
  const state = String(body.state || "").trim().toUpperCase();
  const country = canonicalizeCountryName(String(body.country || "").trim());
  const city = canonicalizeCityName(String(body.city || "").trim(), { state, country });
  return composeCityState({ city, state, country });
}

export function normalizeSocialsFromBody(body = {}, roleList = []) {
  const fromSocials = body.socials && typeof body.socials === "object" ? body.socials : {};
  const fromSocial = body.social && typeof body.social === "object" ? body.social : {};
  const merged = { ...fromSocials, ...fromSocial };
  // Reserved recovery provenance is supplied only by the server.
  delete merged.signupRecovery;
  const nickname = String(
    body.nickname ??
      body.campNickname ??
      merged.nickname ??
      merged.campNickname ??
      ""
  ).trim();
  const normalizedCamperYears = normalizeCamperYears(
    body.camperYears && typeof body.camperYears === "object" ? body.camperYears : merged.camperYears || {}
  );
  const normalizedRoles = normalizeRoleList(
    roleList.length ? roleList : Array.isArray(merged.roles) ? merged.roles : []
  );
  const normalizedCollegeMajors = normalizeCollegeMajors(
    Array.isArray(body.collegeMajors)
      ? body.collegeMajors
      : Array.isArray(body.education)
      ? body.education.map((row) => String(row?.major || "").trim())
      : Array.isArray(merged.collegeMajors)
      ? merged.collegeMajors
      : Array.isArray(merged.educationMajors)
      ? merged.educationMajors
      : []
  );
  return {
    ...merged,
    ...(nickname ? { nickname, campNickname: nickname } : {}),
    camperYears: normalizedCamperYears,
    roles: normalizedRoles,
    ...(normalizedCollegeMajors.length
      ? { collegeMajors: normalizedCollegeMajors, educationMajors: normalizedCollegeMajors }
      : {})
  };
}

export function normalizeJobRows(rows = []) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => ({
    role: String(row?.role || "").trim(),
    company: String(row?.company || "").trim(),
    years: String(row?.years || "").trim()
  }));
}

export function profilePayloadFromBody(body = {}, identity = {}) {
  const email = normalizeEmail(identity.email || body.email || "");
  const education = Array.isArray(body.education) ? body.education : [];
  const roles = normalizeRoleList(Array.isArray(body.roles) ? body.roles : [body.roleAtCamp]);
  const phones = Array.isArray(body.phones)
    ? body.phones.map((entry) => String(entry || "").trim()).filter(Boolean)
    : body.phone
    ? [String(body.phone).trim()]
    : [];
  return {
    firstName: String(body.firstName || "").trim(),
    lastName: String(body.lastName || "").trim(),
    emails: email ? [email] : [],
    phones,
    cityState: normalizeCityStateFromBody(body),
    roleAtCamp: String(roles[0] || "").trim(),
    highSchool: String(body.highSchool || "").trim(),
    colleges: Array.isArray(body.colleges)
      ? body.colleges
      : education.map((row) => String(row?.college || "").trim()).filter(Boolean),
    collegeYears: Array.isArray(body.collegeYears)
      ? body.collegeYears
      : education.map((row) => String(row?.year || "").trim()).filter(Boolean),
    currentJobs: normalizeJobRows(body.currentJobs),
    pastJobs: normalizeJobRows(body.pastJobs),
    industry: String(body.industry || "").trim(),
    socials: normalizeSocialsFromBody(body, roles),
    bio: String(body.bio || "").trim(),
    avatarUrl: String(body.uploads?.photoUrl || body.avatarUrl || body.photoUrl || "").trim()
  };
}
