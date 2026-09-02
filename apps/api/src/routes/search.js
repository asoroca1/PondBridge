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
import { createTtlCache } from "../utils/ttlCache.js";
import { canViewProfileContact, filterProfileContactFields } from "../services/profilePrivacy.js";
import {
  findMemberBlockBetween,
  isSafetyModerator
} from "../services/memberSafety.js";
import { canAccessMemberProfile, isRemovedProfile } from "../services/memberVisibility.js";
import { getHiddenUserIds, isUserHiddenByTier } from "../services/memberTiers.js";

const router = Router({ mergeParams: true });
const SEARCH_CACHE_CONTROL = "private, max-age=15, stale-while-revalidate=45";
const searchResponseCache = createTtlCache({ ttlMs: 15_000, maxEntries: 500 });
const searchNamesResponseCache = createTtlCache({ ttlMs: 15_000, maxEntries: 800 });

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
    cityState = "",
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

      if (cityState) {
        if (!matchTextValue(profile?.cityState || "", cityState)) return null;
        filterScore += 60;
      }

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
  const sort = String(query.sort || "name").trim().toLowerCase() === "recent" ? "recent" : "name";
  const limit = clampLimit(query.limit, 24, 100);
  const offset = clampOffset(query.offset, 0);
  const fetchLimit = clampLimit(query.fetchLimit, 300, 1000);
  return {
    q,
    cedarRoleTerms,
    roleAtCamp,
    industryTerms,
    industry,
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

async function runSearch(req, { query = req.query, analytics = {} } = {}) {
  const {
    q,
    cedarRoleTerms,
    roleAtCamp,
    industryTerms,
    industry,
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
    roleAtCamp: cedarRoleTerms.length === 1 ? cedarRoleTerms[0] : null,
    industry: industryTerms.length === 1 ? industryTerms[0] : null,
    cityState: cityState || null,
    limit: fetchLimit,
    maxLimit: 1000
  });
  const rankedItems = filterAndRankSearchItems(
    rawItems
      .filter((profile) => !hiddenUserIdSet.has(String(profile?.userId || "")))
      .map((profile) => withNickname(profile)),
    {
      cedarRoleTerms,
      industryTerms,
      cityState,
      roleTitle,
      company,
      college,
      gradMinYear,
      gradMaxYear,
      camperMinYear,
      camperMaxYear
    }
  )
    .sort((left, right) => {
      if (right.filterScore !== left.filterScore) return right.filterScore - left.filterScore;
      return compareProfiles(left.profile, right.profile, sort);
    });
  const total = rankedItems.length;
  const items = rankedItems
    .slice(offset, offset + limit)
    .map((entry) => mapSearchSummary(entry.profile));

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
    sort: String(input?.sort || "name"),
    limit: clampLimit(input?.limit, 24, 48),
    offset: clampOffset(input?.offset, 0),
    fetchLimit: 1000
  };
}

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
    roleAtCamp: cedarRoleTerms.length === 1 ? cedarRoleTerms[0] : null,
    industry: industryTerms.length === 1 ? industryTerms[0] : null,
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
