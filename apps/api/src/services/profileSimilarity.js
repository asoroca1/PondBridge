/**
 * Scoring for "related profiles".
 *
 * Two changes drive this over the original scorer:
 *
 * 1. Camp era counts. Members record camper and staff stints when they fill in
 *    their profile, but those live in the `socials` blob and the old scorer
 *    never read them — so two people who were at camp the same summers scored
 *    zero unless they happened to share an industry. Overlapping years is the
 *    plainest reason two alumni actually know each other.
 *
 * 2. Matches are weighted by how rare they are. "Camper" describes most of a
 *    camp network, so two people sharing it says almost nothing; "Waterfront
 *    Director" says a lot. Flat weights treated those as equal evidence.
 */

const CAMP_ERA_MAX = 6;
const INDUSTRY_MAX = 6;
const COMPANY_MAX = 5;
const COLLEGE_MAX = 4;
const LOCATION_MAX = 3;
const ROLE_MAX = 3;
const SCHOOL_MAX = 2;

// A stint longer than this is a data-entry slip, not a camp career.
const MAX_STINT_YEARS = 30;
const EARLIEST_YEAR = 1900;

export function normalizeLoose(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function toSet(values = []) {
  return new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => normalizeLoose(value))
      .filter(Boolean)
  );
}

export function overlapCount(aSet, bSet) {
  if (!aSet?.size || !bSet?.size) return 0;
  let count = 0;
  for (const value of aSet) {
    if (bSet.has(value)) count += 1;
  }
  return count;
}

export function topCompanies(profile = {}) {
  return toSet((profile.currentJobs || []).map((job) => job?.company || ""));
}

function parseYear(value) {
  const match = String(value ?? "").match(/\d{4}/);
  if (!match) return 0;
  const year = Number(match[0]);
  const currentYear = new Date().getUTCFullYear();
  if (year < EARLIEST_YEAR || year > currentYear + 1) return 0;
  return year;
}

function addRange(years, startValue, endValue) {
  const start = parseYear(startValue);
  if (!start) return;
  const parsedEnd = parseYear(endValue);
  const end = parsedEnd && parsedEnd >= start ? parsedEnd : start;
  const capped = Math.min(end, start + MAX_STINT_YEARS);
  for (let year = start; year <= capped; year += 1) years.add(year);
}

/**
 * Every year a person was at camp, from camper and staff stints alike. Older
 * profiles carry a flat firstYear/lastYear pair instead of stints, so both
 * shapes are read.
 */
export function campYearSet(profile = {}) {
  const socials = profile?.socials && typeof profile.socials === "object" ? profile.socials : {};
  const years = new Set();

  for (const key of ["camperYears", "staffYears"]) {
    const group = socials[key];
    if (!group || typeof group !== "object") continue;

    for (const stint of Array.isArray(group.stints) ? group.stints : []) {
      addRange(years, stint?.startYear ?? stint?.firstYear, stint?.endYear ?? stint?.lastYear);
    }
    addRange(years, group.firstYear, group.lastYear);
  }

  return years;
}

/**
 * How common each value is across the network, so a match can be weighted by
 * what it actually tells you. Built once per request from the same candidate
 * pool being scored.
 */
export function buildCorpusStats(profiles = []) {
  const stats = {
    total: 0,
    role: new Map(),
    industry: new Map(),
    location: new Map()
  };

  const bump = (map, value) => {
    const key = normalizeLoose(value);
    if (!key) return;
    map.set(key, (map.get(key) || 0) + 1);
  };

  for (const profile of Array.isArray(profiles) ? profiles : []) {
    stats.total += 1;
    bump(stats.role, profile?.roleAtCamp);
    bump(stats.industry, profile?.industry);
    bump(stats.location, profile?.cityState);
  }

  return stats;
}

/**
 * 0 when everyone shares the value, approaching 1 when almost nobody does.
 * Falls back to a middling weight when there is no corpus to judge against, so
 * a small network still ranks rather than flattening to zero.
 */
export function rarity(stats, field, value) {
  const total = Number(stats?.total || 0);
  if (!total) return 0.6;
  const key = normalizeLoose(value);
  if (!key) return 0;
  const seen = Number(stats?.[field]?.get?.(key) || 0);
  if (!seen) return 0.6;
  const share = seen / total;
  // log-shaped so the drop-off is gentle in the middle and sharp at ubiquity.
  return Math.max(0, Math.min(1, Math.log(1 / share) / Math.log(total + 1)));
}

function matches(a, b) {
  const left = normalizeLoose(a);
  const right = normalizeLoose(b);
  return Boolean(left) && left === right;
}

export function scoreSimilarity(target, candidate, stats = null) {
  let score = 0;
  const reasons = [];

  // --- Camp era ---------------------------------------------------------
  const sharedYears = overlapCount(campYearSet(target), campYearSet(candidate));
  if (sharedYears > 0) {
    // One summer together already means something; three or more is as strong
    // as this signal gets.
    const strength = 0.5 + 0.5 * Math.min(1, (sharedYears - 1) / 2);
    score += CAMP_ERA_MAX * strength;
    reasons.push("camp");
  }

  // --- Career -----------------------------------------------------------
  if (matches(target?.industry, candidate?.industry)) {
    score += INDUSTRY_MAX * Math.max(0.35, rarity(stats, "industry", candidate?.industry));
    reasons.push("industry");
  }

  const companyOverlap = overlapCount(topCompanies(target), topCompanies(candidate));
  if (companyOverlap > 0) {
    score += Math.min(COMPANY_MAX, companyOverlap * 2.5);
    reasons.push("company");
  }

  // --- Education --------------------------------------------------------
  const collegeOverlap = overlapCount(toSet(target?.colleges), toSet(candidate?.colleges));
  if (collegeOverlap > 0) {
    score += Math.min(COLLEGE_MAX, collegeOverlap * 2);
    reasons.push("college");
  }

  if (matches(target?.highSchool, candidate?.highSchool)) {
    score += SCHOOL_MAX;
    reasons.push("school");
  }

  // --- Where they are ---------------------------------------------------
  if (matches(target?.cityState, candidate?.cityState)) {
    score += LOCATION_MAX * Math.max(0.4, rarity(stats, "location", candidate?.cityState));
    reasons.push("location");
  }

  // --- Role at camp -----------------------------------------------------
  // Left unweighted this would fire on most pairs in the network.
  if (matches(target?.roleAtCamp, candidate?.roleAtCamp)) {
    const weight = rarity(stats, "role", candidate?.roleAtCamp);
    const points = ROLE_MAX * weight;
    if (points >= 0.25) {
      score += points;
      reasons.push("role");
    }
  }

  return { score: Math.round(score * 100) / 100, reasons };
}
