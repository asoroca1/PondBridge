import { resolveProfileFields } from "@pondbridge/shared";
import { resolveContent } from "./onboarding.js";

/**
 * Blank the profile fields a camp has stopped collecting, on its way out to
 * another member.
 *
 * Modules already work this way — `requireTenantModule` refuses the request
 * rather than trusting the client to hide the page — so a director's choice
 * about profile content is enforced in the same place rather than only in the
 * UI. Nothing is deleted: this clears values on the response object, and
 * switching the field back on shows the stored answers again.
 *
 * This must never be applied to a payload that an editor writes back:
 * `GET /me` and the director's `GET /members/:id/full` both round-trip their
 * whole response on save, so blanking a field there would erase it on the next
 * save rather than hide it. Those two stay whole; see the call sites.
 */

const EMPTY_STINTS = Object.freeze({ stints: [] });

// What "not collected" looks like for each key, across both the raw profile
// shape (colleges/phones/socials) and the mapped one the legacy routes emit
// (education/social/city). Applying both is cheaper than knowing which shape
// arrived, and blanking a field that is not present is a no-op.
const BLANK_BY_FIELD = {
  nickname: (out, socials) => {
    out.nickname = "";
    socials.nickname = "";
    socials.campNickname = "";
  },
  maidenName: (out, socials) => {
    out.maidenName = "";
    socials.maidenName = "";
  },
  phone: (out) => {
    out.phone = "";
    out.phones = [];
  },
  location: (out) => {
    out.cityState = "";
    out.city = "";
    out.state = "";
    out.country = "";
    out.region = "";
    out.location = "";
  },
  campRoles: (out, socials) => {
    out.roleAtCamp = "";
    out.role = "";
    out.roles = [];
    socials.roles = [];
  },
  camperYears: (out, socials) => {
    out.camperYears = { ...EMPTY_STINTS };
    out.camperYearStints = [];
    socials.camperYears = { ...EMPTY_STINTS };
  },
  staffYears: (out, socials) => {
    out.staffYears = { ...EMPTY_STINTS };
    out.staffYearStints = [];
    socials.staffYears = { ...EMPTY_STINTS };
  },
  highSchool: (out) => {
    out.highSchool = "";
  },
  college: (out) => {
    out.colleges = [];
    out.collegeYears = [];
    out.education = [];
  },
  collegeMajor: (out, socials) => {
    out.collegeMajors = [];
    socials.collegeMajors = [];
    socials.educationMajors = [];
    if (Array.isArray(out.education)) {
      out.education = out.education.map((row) => ({ ...row, major: "" }));
    }
  },
  greekLife: (out, socials) => {
    out.collegeGreek = [];
    socials.collegeGreek = [];
    if (Array.isArray(out.education)) {
      out.education = out.education.map((row) => ({ ...row, greek: "" }));
    }
  },
  industry: (out) => {
    out.industry = "";
  },
  currentJobs: (out) => {
    out.currentJobs = [];
  },
  pastJobs: (out) => {
    out.pastJobs = [];
  },
  socialLinkedin: (out, socials, social) => {
    socials.linkedin = "";
    social.linkedin = "";
  },
  socialInstagram: (out, socials, social) => {
    socials.instagram = "";
    social.instagram = "";
  },
  socialFacebook: (out, socials, social) => {
    socials.facebook = "";
    social.facebook = "";
  }
};

/** The camp's resolved field map, cheap enough to call per request. */
export function resolveTenantProfileFieldSettings(tenant) {
  return resolveProfileFields(resolveContent(tenant || {}).profileFields);
}

export function stripDisabledProfileFields(profile, tenant, { fields = null } = {}) {
  if (!profile || typeof profile !== "object") return profile;
  const resolved = fields || resolveTenantProfileFieldSettings(tenant);

  const disabled = Object.keys(BLANK_BY_FIELD).filter((key) => resolved[key] === false);
  if (!disabled.length) return profile;

  const out = { ...profile };
  // Copied rather than mutated: these objects come straight off a model doc,
  // and a cached row must not be blanked for every later reader.
  const socials = { ...(out.socials && typeof out.socials === "object" ? out.socials : {}) };
  const social = { ...(out.social && typeof out.social === "object" ? out.social : {}) };

  for (const key of disabled) BLANK_BY_FIELD[key](out, socials, social);

  if (out.socials !== undefined || Object.keys(socials).length) out.socials = socials;
  if (out.social !== undefined || Object.keys(social).length) out.social = social;
  return out;
}

/** List helper, so a route does not resolve the tenant's settings per row. */
export function stripDisabledProfileFieldsFromList(profiles, tenant) {
  const list = Array.isArray(profiles) ? profiles : [];
  if (!list.length) return list;
  const fields = resolveTenantProfileFieldSettings(tenant);
  return list.map((profile) => stripDisabledProfileFields(profile, tenant, { fields }));
}
