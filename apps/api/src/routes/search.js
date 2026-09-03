import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireTenantAuthScope } from "../middleware/tenantAccess.js";
import { requireFeature as requireRolloutFeature } from "../middleware/featureFlag.js";
import { requireTenantModule } from "../middleware/requireFeature.js";
import { ProfileModel, UserModel } from "../db/models/index.js";
import { logTenantEvent } from "../services/analytics.js";
import { evaluateFeatureRollout } from "../services/featureRollouts.js";
import { logLine } from "../services/logger.js";
import {
  CAMP_AI_SEARCH_FLAG,
  getCampAiSearchProviderStatus,
  getCampAiSearchUsage,
  normalizeCampAiSearchQuery,
  resolveCampAiSearchPlan,
  runCampAiSearchPlanner
} from "../services/campAiSearch.js";
import { isValidObjectId } from "../utils/objectId.js";
import {
  searchFacetsResponseCache,
  searchNamesResponseCache,
  searchResponseCache
} from "../services/searchCache.js";
import { canViewProfileContact, filterProfileContactFields } from "../services/profilePrivacy.js";
import {
  findMemberBlockBetween,
  isSafetyModerator
} from "../services/memberSafety.js";
import { canAccessMemberProfile, isRemovedProfile } from "../services/memberVisibility.js";
import { getHiddenUserIds, isUserHiddenByTier } from "../services/memberTiers.js";

const router = Router({ mergeParams: true });
const SEARCH_CACHE_CONTROL = "private, max-age=15, stale-while-revalidate=45";
// Facets are invalidated on write now, so the browser copy is the only thing that can
// hide a role a director just added. Keep its window short.
const SEARCH_FACETS_CACHE_CONTROL = "private, max-age=5, stale-while-revalidate=10";
const SEARCH_POOL_DEFAULT = 25_000;

const searchRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 150,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: "RATE_LIMITED",
      message: "Too many search requests. Please wait and try again."
    }
  }
});
const aiSearchRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => [
    "camp-ai-search",
    String(req.tenant?._id || req.params?.slug || ""),
    String(req.user?.id || ""),
    String(req.ip || "")
  ].join(":"),
  message: {
    error: {
      code: "RATE_LIMITED",
      message: "Too many smart search requests. Please wait before trying again."
    }
  }
});

router.use(
  ...requireTenantAuthScope,
  requireTenantModule("search", { message: "Search is disabled for this camp." }),
  searchRateLimiter
);

function clampLimit(value, fallback = 30, max = 100) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), 1), max);
}

function clampOffset(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.trunc(parsed));
}

function normalizeSearchText(value, maxLength = 120) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, maxLength);
}

function normalizeMatchText(value = "") {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9@.\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseSearchList(value, maxLength = 120) {
  return normalizeSearchText(value, maxLength)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseSearchYear(value) {
  const match = String(value || "").match(/\b\d{4}\b/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeYearBounds(minValue, maxValue) {
  const minYear = parseSearchYear(minValue);
  const maxYear = parseSearchYear(maxValue);
  if (minYear === null && maxYear === null) {
    return { minYear: null, maxYear: null };
  }
  if (minYear !== null && maxYear !== null) {
    return {
      minYear: Math.min(minYear, maxYear),
      maxYear: Math.max(minYear, maxYear)
    };
  }
  return {
    minYear: minYear ?? maxYear,
    maxYear: maxYear ?? minYear
  };
}

const US_STATE_CODES_BY_NAME = Object.freeze({
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", "district of columbia": "DC",
  florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL",
  indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA",
  maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK",
  oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI",
  wyoming: "WY", "puerto rico": "PR", "virgin islands": "VI", guam: "GU"
});

const US_STATE_CODE_SET = new Set(Object.values(US_STATE_CODES_BY_NAME));

// Stored locations are "City, ST". Resolve a typed state to that 2-letter form so
// "Massachusetts" matches "Boston, MA"; return "" when it is not a US state so the
// caller can fall back to a free-text match (international locations).
function resolveStateCode(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const upper = raw.toUpperCase();
  if (upper.length === 2 && US_STATE_CODE_SET.has(upper)) return upper;
  const byName = US_STATE_CODES_BY_NAME[raw.toLowerCase().replace(/\s+/g, " ")];
  return byName || "";
}

function splitStoredLocation(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return { city: "", state: "" };
  const idx = raw.lastIndexOf(",");
  if (idx === -1) return { city: raw, state: "" };
  return { city: raw.slice(0, idx).trim(), state: raw.slice(idx + 1).trim() };
}

// City and state are matched as independent predicates. Previously they were joined
// into one substring ("Boston, Massachusetts"), which could never match stored data.
function matchesLocation(profile = {}, { city = "", stateCode = "", stateText = "" } = {}) {
  if (!city && !stateCode && !stateText) return { matched: true, score: 0 };
  const stored = String(profile?.cityState || "").trim();
  if (!stored) return { matched: false, score: 0 };
  const parts = splitStoredLocation(stored);
  let score = 0;

  if (city) {
    const cityHaystack = parts.city || stored;
    if (!matchTextValue(cityHaystack, city)) return { matched: false, score: 0 };
    score += 60;
  }

  if (stateCode) {
    const storedCode = resolveStateCode(parts.state);
    if (storedCode) {
      if (storedCode !== stateCode) return { matched: false, score: 0 };
    } else if (!matchTextValue(stored, stateCode)) {
      return { matched: false, score: 0 };
    }
    score += 40;
  } else if (stateText) {
    // Not a US state (e.g. a country) - fall back to matching the whole location.
    if (!matchTextValue(stored, stateText)) return { matched: false, score: 0 };
    score += 40;
  }

  return { matched: true, score };
}

function extractProfileSocials(profile = {}) {
  return profile?.socials && typeof profile.socials === "object" ? profile.socials : {};
}

function resolveCampRoleValues(profile = {}) {
  const socials = extractProfileSocials(profile);
  return [
    String(profile?.roleAtCamp || "").trim(),
    ...(Array.isArray(socials.roles) ? socials.roles : [])
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function resolveCamperYearsSource(profile = {}) {
  const socials = extractProfileSocials(profile);
  if (socials?.camperYears && typeof socials.camperYears === "object") {
    return socials.camperYears;
  }
  if (profile?.camperYears && typeof profile.camperYears === "object") {
    return profile.camperYears;
  }
  return {};
}

function normalizeYearStints(value = {}) {
  const input = value && typeof value === "object" ? value : {};
  const source = Array.isArray(input.stints) ? input.stints : [];
  let stints = source
    .map((stint) => {
      const startYear = parseSearchYear(stint?.startYear || stint?.firstYear || "");
      const endYear = parseSearchYear(stint?.endYear || stint?.lastYear || "");
      if (startYear === null && endYear === null) return null;
      const normalizedStart = startYear ?? endYear;
      const normalizedEnd = endYear ?? startYear;
      if (normalizedStart === null || normalizedEnd === null) return null;
      return {
        startYear: Math.min(normalizedStart, normalizedEnd),
        endYear: Math.max(normalizedStart, normalizedEnd)
      };
    })
    .filter(Boolean);

  if (!stints.length) {
    const firstYear = parseSearchYear(input.firstYear || "");
    const lastYear = parseSearchYear(input.lastYear || "");
    if (firstYear !== null || lastYear !== null) {
      const normalizedStart = firstYear ?? lastYear;
      const normalizedEnd = lastYear ?? firstYear;
      if (normalizedStart !== null && normalizedEnd !== null) {
        stints = [
          {
            startYear: Math.min(normalizedStart, normalizedEnd),
            endYear: Math.max(normalizedStart, normalizedEnd)
          }
        ];
      }
    }
  }

  return stints.sort((left, right) => {
    if (left.startYear !== right.startYear) return left.startYear - right.startYear;
    return left.endYear - right.endYear;
  });
}

function extractYearNumbers(values = []) {
  if (!Array.isArray(values)) return [];
  const years = [];
  values.forEach((value) => {
    const matches = String(value || "").match(/\b\d{4}\b/g) || [];
    matches.forEach((match) => {
      const parsed = Number(match);
      if (Number.isFinite(parsed)) years.push(parsed);
    });
  });
  return years;
}

function matchTextValue(value = "", term = "") {
  const normalizedValue = normalizeMatchText(value);
  const normalizedTerm = normalizeMatchText(term);
  if (!normalizedTerm) return false;
  return normalizedValue.includes(normalizedTerm);
}

function matchAnyText(values = [], terms = []) {
  if (!terms.length) return { matched: true, score: 0 };
  const haystacks = (Array.isArray(values) ? values : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  if (!haystacks.length) return { matched: false, score: 0 };

  const matchedTerms = terms.filter((term) => haystacks.some((value) => matchTextValue(value, term)));
  return {
    matched: matchedTerms.length > 0,
    score: matchedTerms.length * 40
  };
}

function jobFieldValues(job = {}, field = "company") {
  if (!job || typeof job !== "object") return [];
  if (field === "role") {
    return [job.role, job.title, job.jobTitle].map((value) => String(value || "").trim()).filter(Boolean);
  }
  return [job.company, job.organization, job.org]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function matchJobs(jobs = [], term = "", field = "company") {
  const normalizedTerm = normalizeMatchText(term);
  if (!normalizedTerm) return false;
  return (Array.isArray(jobs) ? jobs : []).some((job) =>
    jobFieldValues(job, field).some((value) => matchTextValue(value, normalizedTerm))
  );
}

function rangeContainsAnyYear(years = [], minYear = null, maxYear = null) {
  if (minYear === null && maxYear === null) return true;
  const floor = minYear ?? maxYear;
  const ceiling = maxYear ?? minYear;
  return years.some((year) => year >= floor && year <= ceiling);
}

function rangesOverlap(startA, endA, startB, endB) {
  return startA <= endB && startB <= endA;
}

function matchesCamperYears(profile = {}, minYear = null, maxYear = null) {
  if (minYear === null && maxYear === null) {
    return { matched: true, score: 0 };
  }

  const targetStart = minYear ?? maxYear;
  const targetEnd = maxYear ?? minYear;
  const stints = normalizeYearStints(resolveCamperYearsSource(profile));
  if (!stints.length) return { matched: false, score: 0 };

  const matched = stints.some((stint) =>
    rangesOverlap(stint.startYear, stint.endYear, targetStart, targetEnd)
  );
  return { matched, score: matched ? 70 : 0 };
}

function filterAndRankSearchItems(items = [], filters = {}) {
  const {
    cedarRoleTerms = [],
    industryTerms = [],
    city = "",
    stateCode = "",
    stateText = "",
    roleTitle = "",
    company = "",
    college = "",
    gradMinYear = null,
    gradMaxYear = null,
    camperMinYear = null,
    camperMaxYear = null
  } = filters;

  return (Array.isArray(items) ? items : [])
    .map((profile) => {
      let filterScore = 0;

      if (cedarRoleTerms.length) {
        const roleMatch = matchAnyText(resolveCampRoleValues(profile), cedarRoleTerms);
        if (!roleMatch.matched) return null;
        filterScore += 100 + roleMatch.score;
      }

      if (industryTerms.length) {
        const industryMatch = matchAnyText([profile?.industry || ""], industryTerms);
        if (!industryMatch.matched) return null;
        filterScore += 80 + industryMatch.score;
      }

      const locationMatch = matchesLocation(profile, { city, stateCode, stateText });
      if (!locationMatch.matched) return null;
      filterScore += locationMatch.score;

      if (company) {
        const currentCompanyMatch = matchJobs(profile?.currentJobs || [], company, "company");
        const pastCompanyMatch = matchJobs(profile?.pastJobs || [], company, "company");
        if (!currentCompanyMatch && !pastCompanyMatch) return null;
        filterScore += currentCompanyMatch ? 260 : 160;
      }

      if (roleTitle) {
        const currentRoleMatch = matchJobs(profile?.currentJobs || [], roleTitle, "role");
        const pastRoleMatch = matchJobs(profile?.pastJobs || [], roleTitle, "role");
        if (!currentRoleMatch && !pastRoleMatch) return null;
        filterScore += currentRoleMatch ? 220 : 130;
      }

      if (college) {
        const collegeMatch = matchAnyText(profile?.colleges || [], [college]);
        if (!collegeMatch.matched) return null;
        filterScore += 120 + collegeMatch.score;
      }

      if (gradMinYear !== null || gradMaxYear !== null) {
        const collegeYears = extractYearNumbers(profile?.collegeYears || []);
        if (!collegeYears.length || !rangeContainsAnyYear(collegeYears, gradMinYear, gradMaxYear)) {
          return null;
        }
        filterScore += 90;
      }

      const camperMatch = matchesCamperYears(profile, camperMinYear, camperMaxYear);
      if (!camperMatch.matched) return null;
      filterScore += camperMatch.score;

      return { profile, filterScore };
    })
    .filter(Boolean);
}

function parseSearchInput(reqOrQuery) {
  const query = reqOrQuery?.query && typeof reqOrQuery.query === "object"
    ? reqOrQuery.query
    : reqOrQuery && typeof reqOrQuery === "object"
      ? reqOrQuery
      : {};
  const q = normalizeSearchText(query.q, 140);
  const cedarRoleTerms = parseSearchList(query.roleAtCamp || query.cedarRoles, 80);
  const roleAtCamp = cedarRoleTerms.join(", ");
  const industryTerms = parseSearchList(query.industry || query.industries, 80);
  const industry = industryTerms.join(", ");
  const city = normalizeSearchText(query.city, 80);
  const state = normalizeSearchText(query.state, 40);
  const cityState = normalizeSearchText(query.cityState || [city, state].filter(Boolean).join(", "), 120);
  const stateCode = resolveStateCode(state);
  const roleTitle = normalizeSearchText(query.role, 120);
  const company = normalizeSearchText(query.company, 120);
  const college = normalizeSearchText(query.college, 120);
  const { minYear: gradMinYear, maxYear: gradMaxYear } = normalizeYearBounds(
    query.gradMin,
    query.gradMax
  );
  const { minYear: camperMinYear, maxYear: camperMaxYear } = normalizeYearBounds(
    query.camperMin,
    query.camperMax
  );
  const requestedSort = String(query.sort || "").trim().toLowerCase();
  const sort = requestedSort === "recent" || requestedSort === "name" ? requestedSort : "relevance";
  const limit = clampLimit(query.limit, 24, 100);
  const offset = clampOffset(query.offset, 0);
  // Pool size is the server's decision; a client-supplied fetchLimit can only shrink
  // it. Defaults high enough that filter-only searches cover the whole tenant, and the
  // candidate fetch stops early once the tenant is exhausted, so small camps cost one page.
  const fetchLimit = clampLimit(query.fetchLimit, SEARCH_POOL_DEFAULT, SEARCH_POOL_DEFAULT);
  return {
    q,
    cedarRoleTerms,
    roleAtCamp,
    industryTerms,
    industry,
    city,
    state,
    stateCode,
    cityState,
    roleTitle,
    company,
    college,
    gradMinYear,
    gradMaxYear,
    camperMinYear,
    camperMaxYear,
    sort,
    limit,
    offset,
    fetchLimit
  };
}

// Why this profile matched. The card can then show "UCLA '12" or "formerly Acme"
// instead of asking the member to trust the filter and open each profile to check.
function buildMatchReasons(profile = {}, filters = {}) {
  const { college, gradMinYear, gradMaxYear, camperMinYear, camperMaxYear, company, roleTitle } = filters;
  const reasons = [];

  if (college) {
    const matched = (Array.isArray(profile?.colleges) ? profile.colleges : []).find((value) =>
      matchTextValue(value, college)
    );
    if (matched) {
      const years = extractYearNumbers(profile?.collegeYears || []);
      reasons.push({ kind: "college", label: years.length ? `${matched} '${String(years[years.length - 1]).slice(-2)}` : matched });
    }
  }

  if (gradMinYear !== null && gradMinYear !== undefined) {
    const years = extractYearNumbers(profile?.collegeYears || []).filter(
      (year) => year >= (gradMinYear ?? gradMaxYear) && year <= (gradMaxYear ?? gradMinYear)
    );
    if (years.length) reasons.push({ kind: "gradYear", label: `Class of ${years[years.length - 1]}` });
  }

  if (camperMinYear !== null && camperMinYear !== undefined) {
    const stints = normalizeYearStints(resolveCamperYearsSource(profile));
    const hit = stints.find((stint) =>
      rangesOverlap(stint.startYear, stint.endYear, camperMinYear ?? camperMaxYear, camperMaxYear ?? camperMinYear)
    );
    if (hit) {
      reasons.push({
        kind: "camperYears",
        label: hit.startYear === hit.endYear ? `Camper ${hit.startYear}` : `Camper ${hit.startYear}-${hit.endYear}`
      });
    }
  }

  if (company) {
    const current = (Array.isArray(profile?.currentJobs) ? profile.currentJobs : []).find((job) =>
      jobFieldValues(job, "company").some((value) => matchTextValue(value, company))
    );
    const past = (Array.isArray(profile?.pastJobs) ? profile.pastJobs : []).find((job) =>
      jobFieldValues(job, "company").some((value) => matchTextValue(value, company))
    );
    const hit = current || past;
    if (hit) {
      const name = jobFieldValues(hit, "company")[0] || "";
      reasons.push({ kind: "company", label: current ? name : `formerly ${name}` });
    }
  }

  if (roleTitle) {
    const current = (Array.isArray(profile?.currentJobs) ? profile.currentJobs : []).find((job) =>
      jobFieldValues(job, "role").some((value) => matchTextValue(value, roleTitle))
    );
    const past = (Array.isArray(profile?.pastJobs) ? profile.pastJobs : []).find((job) =>
      jobFieldValues(job, "role").some((value) => matchTextValue(value, roleTitle))
    );
    const hit = current || past;
    if (hit) {
      const name = jobFieldValues(hit, "role")[0] || "";
      if (name) reasons.push({ kind: "role", label: current ? name : `formerly ${name}` });
    }
  }

  return reasons;
}

function mapSearchSummary(profile = {}) {
  const firstName = String(profile.firstName || "").trim();
  const lastName = String(profile.lastName || "").trim();
  const cityState = String(profile.cityState || "").trim();
  const socials = profile?.socials && typeof profile.socials === "object" ? profile.socials : {};
  const nickname = String(profile.nickname || socials.nickname || socials.campNickname || "").trim();
  return {
    id: String(profile._id || profile.id || ""),
    _id: String(profile._id || profile.id || ""),
    userId: String(profile.userId || ""),
    firstName,
    lastName,
    nickname,
    cityState,
    location: cityState,
    roleAtCamp: String(profile.roleAtCamp || "").trim(),
    industry: String(profile.industry || "").trim(),
    avatarUrl: String(profile.avatarUrl || "").trim(),
    uploads: { photoUrl: String(profile.avatarUrl || "").trim() },
    currentJobs: Array.isArray(profile.currentJobs) ? profile.currentJobs.slice(0, 3) : [],
    createdAt: profile.createdAt || null,
    updatedAt: profile.updatedAt || null
  };
}

function mapNameResult(profile = {}) {
  const summary = mapSearchSummary(profile);
  const name = `${summary.firstName} ${summary.lastName}`.trim();
  return {
    id: summary.id,
    _id: summary._id,
    userId: summary.userId,
    name: name || "Unknown",
    firstName: summary.firstName,
    lastName: summary.lastName,
    nickname: summary.nickname,
    cityState: summary.cityState,
    roleAtCamp: summary.roleAtCamp,
    industry: summary.industry,
    uploads: summary.uploads,
    currentJobs: summary.currentJobs
  };
}

function withNickname(profile = {}) {
  const socials = profile?.socials && typeof profile.socials === "object" ? profile.socials : {};
  return {
    ...profile,
    nickname: String(profile.nickname || socials.nickname || socials.campNickname || "").trim()
  };
}

function normalizeEntityId(value = "") {
  const id = String(value || "").trim();
  if (!id || id === "undefined" || id === "null") return "";
  return id;
}

function buildSearchNamesCacheKey(req, { q, roleAtCamp, industry, cityState, limit, safetySignature = "" }) {
  return [
    "search-names",
    String(req.tenant?._id || ""),
    String(req.user?.id || ""),
    safetySignature,
    q,
    roleAtCamp,
    industry,
    cityState,
    String(limit || "")
  ].join(":");
}

function compareProfiles(left, right, sort = "name") {
  if (sort === "recent") {
    const leftTs = new Date(left?.createdAt || left?.updatedAt || 0).getTime();
    const rightTs = new Date(right?.createdAt || right?.updatedAt || 0).getTime();
    if (leftTs !== rightTs) return rightTs - leftTs;
    const leftName = `${left?.lastName || ""} ${left?.firstName || ""}`.trim().toLowerCase();
    const rightName = `${right?.lastName || ""} ${right?.firstName || ""}`.trim().toLowerCase();
    return leftName.localeCompare(rightName);
  }
  const leftName = `${left?.lastName || ""} ${left?.firstName || ""}`.trim().toLowerCase();
  const rightName = `${right?.lastName || ""} ${right?.firstName || ""}`.trim().toLowerCase();
  if (leftName !== rightName) return leftName.localeCompare(rightName);
  const leftTs = new Date(left?.createdAt || left?.updatedAt || 0).getTime();
  const rightTs = new Date(right?.createdAt || right?.updatedAt || 0).getTime();
  return rightTs - leftTs;
}

// "relevance" ranks by match quality first; an explicit name/recent choice wins
// outright, with match score only breaking ties.
function buildRankedComparator(sort = "relevance") {
  return (left, right) => {
    if (sort === "relevance") {
      if (right.filterScore !== left.filterScore) return right.filterScore - left.filterScore;
      return compareProfiles(left.profile, right.profile, "name");
    }
    const chosen = compareProfiles(left.profile, right.profile, sort);
    if (chosen !== 0) return chosen;
    return right.filterScore - left.filterScore;
  };
}

async function runSearch(req, { query = req.query, analytics = {} } = {}) {
  const {
    q,
    cedarRoleTerms,
    roleAtCamp,
    industryTerms,
    industry,
    city,
    state,
    stateCode,
    cityState,
    roleTitle,
    company,
    college,
    gradMinYear,
    gradMaxYear,
    camperMinYear,
    camperMaxYear,
    sort,
    limit,
    offset,
    fetchLimit
  } = parseSearchInput(query);
  const hiddenUserIds = await getHiddenUserIds(req.tenant, req.user.id, {
    user: req.user
  });
  const hiddenUserIdSet = new Set(hiddenUserIds);
  const safetySignature = hiddenUserIds.join(",");
  const cacheKey = [
    "search",
    String(req.tenant?._id || ""),
    String(req.user?.id || ""),
    safetySignature,
    q,
    roleAtCamp,
    industry,
    city,
    state,
    stateCode,
    cityState,
    roleTitle,
    company,
    college,
    String(gradMinYear || ""),
    String(gradMaxYear || ""),
    String(camperMinYear || ""),
    String(camperMaxYear || ""),
    sort,
    limit,
    offset,
    fetchLimit
  ].join(":");
  const cached = searchResponseCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const rawItems = await ProfileModel.search(req.tenant._id, q, {
    roleAtCampTerms: cedarRoleTerms,
    industryTerms,
    city: city || null,
    stateCode: stateCode || null,
    cityState: cityState || null,
    limit: fetchLimit,
    maxLimit: SEARCH_POOL_DEFAULT
  });
  const rankedItems = filterAndRankSearchItems(
    rawItems
      .filter((profile) => !hiddenUserIdSet.has(String(profile?.userId || "")))
      .map((profile) => withNickname(profile)),
    {
      cedarRoleTerms,
      industryTerms,
      city,
      stateCode,
      stateText: stateCode ? "" : state,
      roleTitle,
      company,
      college,
      gradMinYear,
      gradMaxYear,
      camperMinYear,
      camperMaxYear
    }
  )
    .sort(buildRankedComparator(sort));
  const total = rankedItems.length;
  const matchFilters = {
    college,
    gradMinYear,
    gradMaxYear,
    camperMinYear,
    camperMaxYear,
    company,
    roleTitle
  };
  const items = rankedItems
    .slice(offset, offset + limit)
    .map((entry) => ({
      ...mapSearchSummary(entry.profile),
      matchReasons: buildMatchReasons(entry.profile, matchFilters)
    }));

  // Members a filter could never match because they have no value for that field.
  // Reported so a narrow result set is explicable rather than looking like an empty camp.
  const poolForCounts = rawItems.filter(
    (profile) => !hiddenUserIdSet.has(String(profile?.userId || ""))
  );
  const excluded = {};
  if (college || gradMinYear !== null || gradMaxYear !== null) {
    excluded.college = poolForCounts.filter(
      (profile) => !(Array.isArray(profile?.colleges) && profile.colleges.length)
    ).length;
  }
  if (gradMinYear !== null || gradMaxYear !== null) {
    excluded.gradYear = poolForCounts.filter(
      (profile) => !extractYearNumbers(profile?.collegeYears || []).length
    ).length;
  }
  if (camperMinYear !== null || camperMaxYear !== null) {
    excluded.camperYears = poolForCounts.filter(
      (profile) => !normalizeYearStints(resolveCamperYearsSource(profile)).length
    ).length;
  }
  if (industryTerms.length) {
    excluded.industry = poolForCounts.filter(
      (profile) => !String(profile?.industry || "").trim()
    ).length;
  }
  if (city || stateCode || (!stateCode && state)) {
    excluded.location = poolForCounts.filter(
      (profile) => !String(profile?.cityState || "").trim()
    ).length;
  }
  if (cedarRoleTerms.length) {
    excluded.campRole = poolForCounts.filter(
      (profile) => !resolveCampRoleValues(profile).length
    ).length;
  }

  if (q || analytics.recordWhenEmpty) {
    await logTenantEvent({
      tenantId: req.tenant._id,
      userId: req.user.id,
      eventType: "directory_search",
      metadata: {
        term: analytics.term === undefined ? q : analytics.term,
        resultCount: total,
        ...(analytics.metadata && typeof analytics.metadata === "object" ? analytics.metadata : {})
      }
    }).catch(() => {});
  }

  const payload = {
    q,
    roleAtCamp,
    industry,
    city,
    state,
    stateCode,
    cityState,
    roleTitle,
    company,
    college,
    gradMinYear,
    gradMaxYear,
    camperMinYear,
    camperMaxYear,
    sort,
    limit,
    offset,
    total,
    excluded,
    poolSize: poolForCounts.length,
    items
  };
  searchResponseCache.set(cacheKey, payload);
  return payload;
}

function mapPublicSearchQuery(result = {}) {
  return {
    q: result.q,
    roleAtCamp: result.roleAtCamp,
    industry: result.industry,
    cityState: result.cityState,
    role: result.roleTitle,
    company: result.company,
    college: result.college,
    gradMin: result.gradMinYear,
    gradMax: result.gradMaxYear,
    camperMin: result.camperMinYear,
    camperMax: result.camperMaxYear,
    sort: result.sort,
    offset: result.offset,
    limit: result.limit
  };
}

function resolveCampSearchContext(tenant = {}) {
  const content = tenant?.content && typeof tenant.content === "object" ? tenant.content : {};
  const campRoles = Array.isArray(content.staffRoles) && content.staffRoles.length
    ? content.staffRoles
    : ["Camper", "Counselor", "JC", "CIT", "Admin"];
  return {
    campRoles,
    campType: String(content.campType || tenant?.settings?.campType || "camp").trim()
  };
}

function planToSearchQuery(plan = {}, input = {}) {
  return {
    q: plan.q || "",
    cedarRoles: Array.isArray(plan.cedarRoles) ? plan.cedarRoles.join(", ") : "",
    industries: Array.isArray(plan.industries) ? plan.industries.join(", ") : "",
    city: plan.city || "",
    state: plan.state || "",
    role: plan.role || "",
    company: plan.company || "",
    college: plan.college || "",
    gradMin: plan.gradMin ?? "",
    gradMax: plan.gradMax ?? "",
    camperMin: plan.camperMin ?? "",
    camperMax: plan.camperMax ?? "",
    sort: String(input?.sort || "relevance"),
    limit: clampLimit(input?.limit, 24, 48),
    offset: clampOffset(input?.offset, 0),
    fetchLimit: 1000
  };
}

// Which values this camp's directory actually contains, with counts. Drives the
// industry/role pickers and the college/company suggestions, so every option offered
// can return at least one member.
router.get("/facets", async (req, res) => {
  const hiddenUserIds = await getHiddenUserIds(req.tenant, req.user.id, { user: req.user });
  const hiddenUserIdSet = new Set(hiddenUserIds);
  const cacheKey = [
    "search-facets",
    String(req.tenant?._id || ""),
    String(req.user?.id || ""),
    hiddenUserIds.join(",")
  ].join(":");

  const cached = searchFacetsResponseCache.get(cacheKey);
  if (cached) {
    res.set("Cache-Control", SEARCH_FACETS_CACHE_CONTROL);
    return res.json(cached);
  }

  const rows = (
    await ProfileModel.search(req.tenant._id, "", {
      limit: SEARCH_POOL_DEFAULT,
      maxLimit: SEARCH_POOL_DEFAULT
    })
  ).filter((profile) => !hiddenUserIdSet.has(String(profile?.userId || "")));

  const tally = (values) => {
    const counts = new Map();
    values.forEach((value) => {
      const label = String(value || "").trim();
      if (!label) return;
      counts.set(label, (counts.get(label) || 0) + 1);
    });
    return [...counts.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value));
  };

  const payload = {
    total: rows.length,
    industries: tally(rows.map((profile) => profile?.industry)),
    campRoles: tally(rows.flatMap((profile) => resolveCampRoleValues(profile))),
    colleges: tally(
      rows.flatMap((profile) => (Array.isArray(profile?.colleges) ? profile.colleges : []))
    ),
    companies: tally(
      rows.flatMap((profile) =>
        [
          ...(Array.isArray(profile?.currentJobs) ? profile.currentJobs : []),
          ...(Array.isArray(profile?.pastJobs) ? profile.pastJobs : [])
        ].flatMap((job) => jobFieldValues(job, "company"))
      )
    ),
    states: tally(
      rows
        .map((profile) => splitStoredLocation(profile?.cityState).state)
        .map((value) => resolveStateCode(value) || value)
    ),
    // How many members carry no value for each optional field. Filtering on one of
    // these excludes them outright, and that used to be invisible.
    missing: {
      industry: rows.filter((profile) => !String(profile?.industry || "").trim()).length,
      location: rows.filter((profile) => !String(profile?.cityState || "").trim()).length,
      campRole: rows.filter((profile) => !resolveCampRoleValues(profile).length).length,
      college: rows.filter(
        (profile) => !(Array.isArray(profile?.colleges) && profile.colleges.length)
      ).length,
      gradYear: rows.filter((profile) => !extractYearNumbers(profile?.collegeYears || []).length).length,
      camperYears: rows.filter(
        (profile) => !normalizeYearStints(resolveCamperYearsSource(profile)).length
      ).length,
      currentJob: rows.filter(
        (profile) => !(Array.isArray(profile?.currentJobs) && profile.currentJobs.length)
      ).length
    }
  };

  searchFacetsResponseCache.set(cacheKey, payload);
  res.set("Cache-Control", SEARCH_FACETS_CACHE_CONTROL);
  return res.json(payload);
});

router.get("/ai/capabilities", async (req, res, next) => {
  try {
    const [rollout, provider] = await Promise.all([
      evaluateFeatureRollout(CAMP_AI_SEARCH_FLAG, req.tenant),
      Promise.resolve(getCampAiSearchProviderStatus())
    ]);
    let usage = null;
    let usageLedgerAvailable = false;
    try {
      usage = await getCampAiSearchUsage(String(req.tenant?._id || ""));
      usageLedgerAvailable = true;
    } catch {
      usage = null;
    }
    return res.json({
      available: Boolean(rollout.enabled && provider.configured && usageLedgerAvailable),
      guidedFallbackAvailable: Boolean(rollout.enabled),
      featureEnabled: Boolean(rollout.enabled),
      rolloutReason: rollout.reason,
      rolloutControlAvailable: Boolean(rollout.controlAvailable),
      providerConfigured: provider.providerConfigured,
      pricingConfigured: provider.pricingConfigured,
      usageLedgerAvailable,
      provider: provider.provider,
      mode: "query_planning_only",
      dataUse: "OpenAI receives only the search sentence and generic camp role labels. PondBridge never sends member profiles, directory results, email addresses, or phone numbers to the model. The AI ledger stores hashes and usage metadata, not the raw sentence.",
      usage,
      promptVersion: provider.promptVersion
    });
  } catch (error) {
    return next(error);
  }
});

router.post(
  "/ai/query",
  aiSearchRateLimiter,
  requireRolloutFeature(CAMP_AI_SEARCH_FLAG),
  async (req, res, next) => {
    const query = normalizeCampAiSearchQuery(req.body?.query || "");
    if (!query) {
      return res.status(400).json({
        error: { code: "AI_SEARCH_QUERY_REQUIRED", message: "Describe who you want to find." }
      });
    }
    const searchContext = resolveCampSearchContext(req.tenant);
    const context = {
      tenantId: String(req.tenant?._id || ""),
      actorUserId: String(req.user?.id || ""),
      requestId: String(req.requestId || ""),
      ...searchContext
    };
    const planned = await resolveCampAiSearchPlan({
      query,
      context,
      planner: runCampAiSearchPlanner
    });
    const { mode, planner } = planned;
    if (mode === "guided_fallback") {
      logLine("warn", "camp_ai_search.fallback", {
        requestId: context.requestId,
        tenantId: context.tenantId,
        actorUserId: context.actorUserId,
        errorCode: planned.errorCode
      });
    }

    try {
      const searchQuery = planToSearchQuery(planner.plan, req.body || {});
      const result = await runSearch(req, {
        query: searchQuery,
        analytics: {
          recordWhenEmpty: true,
          term: "",
          metadata: {
            searchMode: mode,
            aiEnhanced: mode === "ai",
            intent: planner.plan.intent,
            appliedFilterCount: Object.entries(planner.plan)
              .filter(([key, value]) => key !== "intent" && (Array.isArray(value) ? value.length : value !== "" && value !== null))
              .length
          }
        }
      });
      res.set("Cache-Control", "private, no-store");
      return res.json({
        mode,
        degraded: mode !== "ai",
        total: result.total,
        items: result.items,
        results: result.items,
        query: mapPublicSearchQuery(result),
        plan: planner.plan,
        ai: mode === "ai"
          ? {
              generationId: planner.generationId,
              provider: planner.provider,
              generatedAt: planner.generatedAt,
              usage: planner.usage
            }
          : null
      });
    } catch (error) {
      return next(error);
    }
  }
);

router.get("/", async (req, res) => {
  const result = await runSearch(req);
  res.set("Cache-Control", SEARCH_CACHE_CONTROL);

  return res.json({
    total: result.total,
    items: result.items,
    query: mapPublicSearchQuery(result)
  });
});

router.get("/users", async (req, res) => {
  const result = await runSearch(req);
  res.set("Cache-Control", SEARCH_CACHE_CONTROL);
  return res.json({
    total: result.total,
    items: result.items,
    results: result.items,
    query: mapPublicSearchQuery(result)
  });
});

router.get("/names", async (req, res) => {
  const { q, cedarRoleTerms, roleAtCamp, industryTerms, industry, cityState } = parseSearchInput(req);
  const limit = clampLimit(req.query.limit, 10, 25);
  const hiddenUserIds = await getHiddenUserIds(req.tenant, req.user.id, {
    user: req.user
  });
  const hiddenUserIdSet = new Set(hiddenUserIds);
  const cacheKey = buildSearchNamesCacheKey(req, {
    q,
    roleAtCamp,
    industry,
    cityState,
    limit,
    safetySignature: hiddenUserIds.join(",")
  });
  const cached = searchNamesResponseCache.get(cacheKey);
  if (cached) {
    res.set("Cache-Control", SEARCH_CACHE_CONTROL);
    return res.json(cached);
  }
  const items = await ProfileModel.search(req.tenant._id, q, {
    roleAtCampTerms: cedarRoleTerms,
    industryTerms,
    cityState: cityState || null,
    limit
  });
  const mapped = items
    .filter((profile) =>
      !isRemovedProfile(profile) &&
      !hiddenUserIdSet.has(String(profile?.userId || ""))
    )
    .map((profile) => mapNameResult(profile));
  res.set("Cache-Control", SEARCH_CACHE_CONTROL);

  const payload = {
    total: mapped.length,
    items: mapped,
    results: mapped
  };
  searchNamesResponseCache.set(cacheKey, payload);
  return res.json(payload);
});

router.get("/user/:id", async (req, res) => {
  const id = normalizeEntityId(req.params.id);
  if (!isValidObjectId(id)) {
    return res.status(400).json({
      error: { code: "INVALID_ID", message: "Invalid id" }
    });
  }

  let profile = await ProfileModel.findOne(req.tenant._id, { _id: id });
  let user = null;

  if (!profile) {
    profile = await ProfileModel.findOne(req.tenant._id, { userId: id });
  }

  if (!profile) {
    user = await UserModel.findOne(req.tenant._id, { _id: id });
    const profileId = normalizeEntityId(user?.profileId || "");
    if (isValidObjectId(profileId)) {
      profile = await ProfileModel.findOne(req.tenant._id, { _id: profileId });
    }
  }

  if (!user && profile?.userId) {
    user = await UserModel.findOne(req.tenant._id, { _id: profile.userId });
  }

  if (!canAccessMemberProfile({ profile, user })) {
    return res.status(404).json({
      error: { code: "NOT_FOUND", message: "Profile not found" }
    });
  }

  if (
    !isSafetyModerator(req.user) &&
    profile?.userId &&
    ((await findMemberBlockBetween(req.tenant._id, req.user.id, profile.userId)) ||
      (await isUserHiddenByTier(req.tenant, req.user.id, profile.userId, { user: req.user })))
  ) {
    return res.status(404).json({
      error: { code: "NOT_FOUND", message: "Profile not found" }
    });
  }

  const emailVisible = canViewProfileContact(profile, "email", req.user);
  const mapped = withNickname(filterProfileContactFields(profile, req.user));
  const payload = {
    user: {
      ...mapped,
      _id: String(mapped._id || mapped.id || ""),
      id: String(mapped._id || mapped.id || ""),
      email: String(emailVisible ? user?.email || mapped.email || mapped.emails?.[0] || "" : "").trim().toLowerCase(),
      phone: String(mapped.phone || mapped.phones?.[0] || "").trim(),
      uploads: {
        photoUrl: String(mapped?.uploads?.photoUrl || mapped.photoUrl || mapped.avatarUrl || "").trim()
      }
    }
  };

  res.set("Cache-Control", "private, no-store");
  return res.json(payload);
});

export default router;

// Exported for unit tests; these are pure helpers with no request or database access.
export const __testables = {
  resolveStateCode,
  splitStoredLocation,
  matchesLocation,
  parseSearchInput,
  filterAndRankSearchItems,
  compareProfiles,
  buildRankedComparator,
  buildMatchReasons
};
