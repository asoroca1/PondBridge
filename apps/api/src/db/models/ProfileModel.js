import { createModel, toDoc } from "./_factory.js";
import { getSupabaseAdmin } from "../supabaseAdmin.js";

const COLUMNS = {
  id: "id",
  tenantId: "tenant_id",
  userId: "user_id",
  tenantMembershipId: "tenant_membership_id",
  firstName: "first_name",
  lastName: "last_name",
  emails: "emails",
  phones: "phones",
  cityState: "city_state",
  roleAtCamp: "role_at_camp",
  highSchool: "high_school",
  colleges: "colleges",
  collegeYears: "college_years",
  currentJobs: "current_jobs",
  pastJobs: "past_jobs",
  industry: "industry",
  socials: "socials",
  privacy: "privacy",
  avatarUrl: "avatar_url",
  bio: "bio",
  status: "status",
  flaggedReason: "flagged_reason",
  accessTierId: "access_tier_id",
  accessTierRank: "access_tier_rank",
  createdAt: "created_at",
  updatedAt: "updated_at"
};

const base = createModel("profiles", COLUMNS);
const SEARCH_CANDIDATE_SELECT_SQL = [
  "id",
  "tenant_id",
  "user_id",
  "first_name",
  "last_name",
  "emails",
  "city_state",
  "role_at_camp",
  "high_school",
  "colleges",
  "college_years",
  "current_jobs",
  "past_jobs",
  "industry",
  "socials",
  "privacy",
  "avatar_url",
  "created_at",
  "updated_at",
  "status",
  "access_tier_rank"
].join(",");

function clampLimit(value, fallback = 30, max = 100) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), 1), max);
}

function normalizeText(value = "") {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9@.\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitTokens(value = "") {
  return normalizeText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
}

function buildTrigrams(value = "") {
  const source = `  ${normalizeText(value)}  `;
  if (source.trim().length <= 1) return new Set();
  const grams = new Set();
  for (let index = 0; index <= source.length - 3; index += 1) {
    grams.add(source.slice(index, index + 3));
  }
  return grams;
}

function trigramSimilarity(a = "", b = "") {
  const left = buildTrigrams(a);
  const right = buildTrigrams(b);
  if (!left.size || !right.size) return 0;
  let common = 0;
  for (const gram of left) {
    if (right.has(gram)) common += 1;
  }
  const total = left.size + right.size;
  if (!total) return 0;
  return (2 * common) / total;
}

function trigramSimilarityWithCache(a = "", b = "", cache = null) {
  if (!cache) return trigramSimilarity(a, b);
  const leftKey = `left:${a}`;
  const rightKey = `right:${b}`;
  let left = cache.get(leftKey);
  if (!left) {
    left = buildTrigrams(a);
    cache.set(leftKey, left);
  }
  let right = cache.get(rightKey);
  if (!right) {
    right = buildTrigrams(b);
    cache.set(rightKey, right);
  }
  if (!left.size || !right.size) return 0;
  let common = 0;
  for (const gram of left) {
    if (right.has(gram)) common += 1;
  }
  const total = left.size + right.size;
  if (!total) return 0;
  return (2 * common) / total;
}

function minSimilarityFor(query = "") {
  const length = normalizeText(query).length;
  if (length <= 3) return 0.4;
  if (length <= 5) return 0.3;
  return 0.22;
}

function minTokenSimilarity(token = "") {
  const length = normalizeText(token).length;
  if (length <= 2) return 1;
  if (length <= 4) return 0.56;
  if (length <= 6) return 0.48;
  return 0.4;
}

function jobsToText(jobs = []) {
  if (!Array.isArray(jobs)) return "";
  return jobs
    .map((job) => {
      if (!job || typeof job !== "object") return "";
      return [job.role || job.title || "", job.company || job.organization || job.org || ""]
        .map((value) => String(value || "").trim())
        .filter(Boolean)
        .join(" ");
    })
    .filter(Boolean)
    .join(" ");
}

function profileNickname(profile = {}) {
  const socials = profile?.socials && typeof profile.socials === "object" ? profile.socials : {};
  return normalizeText(profile.nickname || socials.nickname || socials.campNickname || "");
}

function profileSearchFields(profile = {}) {
  const nickname = profileNickname(profile);
  return {
    fullName: normalizeText(`${profile.firstName || ""} ${nickname ? `${nickname} ` : ""}${profile.lastName || ""}`),
    nickname,
    role: normalizeText(profile.roleAtCamp || ""),
    industry: normalizeText(profile.industry || ""),
    cityState: normalizeText(profile.cityState || ""),
    emails: normalizeText(Array.isArray(profile.emails) ? profile.emails.join(" ") : ""),
    highSchool: normalizeText(profile.highSchool || ""),
    colleges: normalizeText(Array.isArray(profile.colleges) ? profile.colleges.join(" ") : ""),
    jobs: normalizeText(jobsToText(profile.currentJobs)),
    pastJobs: normalizeText(jobsToText(profile.pastJobs))
  };
}

function toWordBag(values = []) {
  const words = new Set();
  (Array.isArray(values) ? values : []).forEach((value) => {
    splitTokens(value).forEach((token) => {
      if (token.length > 1) words.add(token);
    });
  });
  return [...words];
}

function scoreProfileForQuery(profile = {}, query = "") {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return { keep: true, score: 0 };

  const tokens = splitTokens(normalizedQuery);
  const fields = profileSearchFields(profile);
  const haystacks = [
    fields.fullName,
    fields.nickname,
    fields.emails,
    fields.role,
    fields.industry,
    fields.cityState,
    fields.highSchool,
    fields.colleges,
    fields.jobs,
    fields.pastJobs
  ].filter(Boolean);
  const wordBag = toWordBag(haystacks);
  const similarityCache = new Map();

  const exactName = fields.fullName === normalizedQuery ? 1 : 0;
  const prefixName = fields.fullName.startsWith(normalizedQuery) ? 1 : 0;
  const exactContains = haystacks.some((value) => value.includes(normalizedQuery)) ? 1 : 0;

  let tokenContainsHits = 0;
  let tokenPrefixHits = 0;
  let tokenFuzzyHits = 0;
  let tokenFuzzyStrength = 0;
  tokens.forEach((token) => {
    if (!token) return;
    if (haystacks.some((value) => value.includes(token))) tokenContainsHits += 1;
    if (haystacks.some((value) => value.startsWith(token) || value.includes(` ${token}`))) {
      tokenPrefixHits += 1;
    }
    let bestTokenSimilarity = 0;
    wordBag.forEach((word) => {
      const similarity = trigramSimilarityWithCache(token, word, similarityCache);
      if (similarity > bestTokenSimilarity) bestTokenSimilarity = similarity;
    });
    tokenFuzzyStrength += bestTokenSimilarity;
    if (bestTokenSimilarity >= minTokenSimilarity(token)) {
      tokenFuzzyHits += 1;
    }
  });

  let maxSimilarity = 0;
  haystacks.forEach((value) => {
    const similarity = trigramSimilarityWithCache(normalizedQuery, value, similarityCache);
    if (similarity > maxSimilarity) maxSimilarity = similarity;
  });

  const similarityThreshold = minSimilarityFor(normalizedQuery);
  const tokenCoverage = tokens.length ? tokenContainsHits / tokens.length : 0;
  const tokenFuzzyCoverage = tokens.length ? tokenFuzzyHits / tokens.length : 0;
  const keep =
    exactName === 1 ||
    prefixName === 1 ||
    exactContains === 1 ||
    tokenContainsHits > 0 ||
    (tokens.length > 0 && tokenFuzzyHits > 0 && tokenFuzzyCoverage >= 0.5) ||
    maxSimilarity >= similarityThreshold;

  const score =
    exactName * 240 +
    prefixName * 160 +
    exactContains * 110 +
    tokenCoverage * 52 +
    tokenPrefixHits * 26 +
    tokenContainsHits * 18 +
    tokenFuzzyHits * 24 +
    tokenFuzzyStrength * 18 +
    maxSimilarity * 100;

  return { keep, score, maxSimilarity };
}

function uniqueProfiles(items = []) {
  const seen = new Set();
  return (Array.isArray(items) ? items : []).filter((item) => {
    const id = String(item?._id || item?.id || "").trim();
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function fuzzyRankProfiles(items = [], query = "", limit = 30) {
  const ranked = uniqueProfiles(items)
    .map((profile) => ({
      profile,
      meta: scoreProfileForQuery(profile, query)
    }))
    .filter((entry) => entry.meta.keep)
    .sort((left, right) => {
      if (right.meta.score !== left.meta.score) return right.meta.score - left.meta.score;
      const lastA = String(left.profile.lastName || "").toLowerCase();
      const lastB = String(right.profile.lastName || "").toLowerCase();
      if (lastA !== lastB) return lastA.localeCompare(lastB);
      const firstA = String(left.profile.firstName || "").toLowerCase();
      const firstB = String(right.profile.firstName || "").toLowerCase();
      return firstA.localeCompare(firstB);
    });

  return ranked.slice(0, limit).map((entry) => entry.profile);
}

async function fetchCandidateProfiles(tenantId, opts = {}, limit = 200) {
  let query = getSupabaseAdmin()
    .from("profiles")
    .select(SEARCH_CANDIDATE_SELECT_SQL)
    .eq("tenant_id", tenantId)
    .neq("status", "removed")
    .order("last_name", { ascending: true })
    .order("first_name", { ascending: true })
    .limit(limit);

  if (opts.roleAtCamp) {
    query = query.ilike("role_at_camp", `%${String(opts.roleAtCamp).trim()}%`);
  }
  if (opts.industry) {
    query = query.ilike("industry", `%${String(opts.industry).trim()}%`);
  }
  if (opts.cityState) {
    query = query.ilike("city_state", `%${String(opts.cityState).trim()}%`);
  }
  // A viewer at rank N sees rank N and every larger rank. Untagged profiles
  // carry no rank, so they are only excluded when the camp parks untagged
  // members above the viewer.
  if (Number.isFinite(Number(opts.viewerTierRank))) {
    const viewerRank = Number(opts.viewerTierRank);
    const untaggedRank = Number(opts.untaggedTierRank);
    query =
      Number.isFinite(untaggedRank) && untaggedRank < viewerRank
        ? query.gte("access_tier_rank", viewerRank)
        : query.or(`access_tier_rank.gte.${viewerRank},access_tier_rank.is.null`);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map((row) => toDoc(row, COLUMNS));
}

async function runRpcSearch(tenantId, query = "", opts = {}, limit = 30) {
  const { data, error } = await getSupabaseAdmin().rpc("search_profiles", {
    p_tenant_id: tenantId,
    p_query: query || "",
    p_role_at_camp: opts.roleAtCamp || null,
    p_industry: opts.industry || null,
    p_city_state: opts.cityState || null,
    p_limit: limit,
    // Only sent once a camp has switched tiering on, so an API release that
    // lands before the migration keeps calling the original six-argument form.
    ...(Number.isFinite(Number(opts.viewerTierRank))
      ? {
          p_viewer_tier_rank: Number(opts.viewerTierRank),
          p_untagged_tier_rank: Number.isFinite(Number(opts.untaggedTierRank))
            ? Number(opts.untaggedTierRank)
            : null
        }
      : {})
  });
  if (error) throw error;
  return (data || []).map((row) => toDoc(row, COLUMNS));
}

function isSearchRpcUnavailable(error) {
  const code = String(error?.code || "").toUpperCase();
  const message = String(error?.message || error?.details || "").toLowerCase();
  return (
    code === "PGRST202" ||
    message.includes("search_profiles") ||
    message.includes("function public.search_profiles") ||
    message.includes("does not exist")
  );
}

export const ProfileModel = {
  ...base,
  COLUMNS,

  async search(tenantId, query, opts = {}) {
    const maxLimit = clampLimit(opts.maxLimit || 100, 100, 1000);
    const limit = clampLimit(opts.limit || 30, 30, maxLimit);
    const normalizedQuery = normalizeText(query || "");
    const strictLimit = normalizedQuery ? Math.max(limit, 60) : limit;

    if (!normalizedQuery) {
      const noQueryRows = await fetchCandidateProfiles(tenantId, opts, limit);
      return noQueryRows.slice(0, limit);
    }

    let strictMatches = [];
    let usedRpcFallback = false;
    try {
      strictMatches = await runRpcSearch(tenantId, query || "", opts, strictLimit);
    } catch (error) {
      if (!isSearchRpcUnavailable(error)) throw error;
      usedRpcFallback = true;
    }

    if (usedRpcFallback) {
      const fallbackLimit = Math.min(Math.max(strictLimit * 20, 120), 700);
      const fallbackPool = await fetchCandidateProfiles(tenantId, opts, fallbackLimit);
      if (!normalizedQuery) return fallbackPool.slice(0, limit);
      const rankedFallback = fuzzyRankProfiles(fallbackPool, normalizedQuery, limit);
      return rankedFallback.slice(0, limit);
    }

    if (!normalizedQuery) return strictMatches.slice(0, limit);

    const rankedStrict = fuzzyRankProfiles(strictMatches, normalizedQuery, limit);
    if (rankedStrict.length >= limit) return rankedStrict;

    const candidatePoolLimit = Math.min(Math.max(limit * 24, 120), 700);
    const supplemental = await fetchCandidateProfiles(tenantId, opts, candidatePoolLimit);
    const rankedMerged = fuzzyRankProfiles([...strictMatches, ...supplemental], normalizedQuery, limit);

    if (rankedMerged.length > 0) return rankedMerged;
    return strictMatches.slice(0, limit);
  },

  async findByUserId(tenantId, userId) {
    const { data, error } = await getSupabaseAdmin()
      .from("profiles")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    return toDoc(data, COLUMNS);
  }
};
