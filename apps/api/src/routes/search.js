import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireTenantAuthScope } from "../middleware/tenantAccess.js";
import { ProfileModel, UserModel } from "../db/models/index.js";
import { logTenantEvent } from "../services/analytics.js";
import { isValidObjectId } from "../utils/objectId.js";
import { createTtlCache } from "../utils/ttlCache.js";

const router = Router({ mergeParams: true });
const SEARCH_CACHE_CONTROL = "private, max-age=15, stale-while-revalidate=45";
const searchResponseCache = createTtlCache({ ttlMs: 15_000, maxEntries: 500 });
const searchNamesResponseCache = createTtlCache({ ttlMs: 15_000, maxEntries: 800 });
const searchUserResponseCache = createTtlCache({ ttlMs: 15_000, maxEntries: 1200 });

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

router.use(...requireTenantAuthScope, searchRateLimiter);

function ensureSearchEnabled(req, res) {
  if (req.tenant?.modules?.search === false) {
    return res.status(403).json({
      error: {
        code: "MODULE_DISABLED",
        message: "Search is disabled for this camp."
      }
    });
  }
  return null;
}

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

function parseSearchInput(req) {
  const q = normalizeSearchText(req.query.q, 140);
  const roleAtCamp = normalizeSearchText(req.query.roleAtCamp || req.query.role || req.query.cedarRoles, 80);
  const industry = normalizeSearchText(req.query.industry || req.query.industries, 80);
  const city = normalizeSearchText(req.query.city, 80);
  const state = normalizeSearchText(req.query.state, 40);
  const cityState = normalizeSearchText(req.query.cityState || [city, state].filter(Boolean).join(" "), 120);
  const sort = String(req.query.sort || "name").trim().toLowerCase() === "recent" ? "recent" : "name";
  const limit = clampLimit(req.query.limit, 24, 100);
  const offset = clampOffset(req.query.offset, 0);
  const fetchLimit = clampLimit(req.query.fetchLimit, 300, 1000);
  return { q, roleAtCamp, industry, cityState, sort, limit, offset, fetchLimit };
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

function buildSearchNamesCacheKey(req, { q, roleAtCamp, industry, cityState, limit }) {
  return [
    "search-names",
    String(req.tenant?._id || ""),
    q,
    roleAtCamp,
    industry,
    cityState,
    String(limit || "")
  ].join(":");
}

function buildSearchUserCacheKey(req, id = "") {
  return [
    "search-user",
    String(req.tenant?._id || ""),
    normalizeEntityId(id)
  ].join(":");
}

function sortSearchItems(items = [], sort = "name") {
  const list = Array.isArray(items) ? [...items] : [];
  if (sort === "recent") {
    return list.sort((left, right) => {
      const leftTs = new Date(left?.createdAt || left?.updatedAt || 0).getTime();
      const rightTs = new Date(right?.createdAt || right?.updatedAt || 0).getTime();
      if (leftTs !== rightTs) return rightTs - leftTs;
      const leftName = `${left?.lastName || ""} ${left?.firstName || ""}`.trim().toLowerCase();
      const rightName = `${right?.lastName || ""} ${right?.firstName || ""}`.trim().toLowerCase();
      return leftName.localeCompare(rightName);
    });
  }
  return list.sort((left, right) => {
    const leftName = `${left?.lastName || ""} ${left?.firstName || ""}`.trim().toLowerCase();
    const rightName = `${right?.lastName || ""} ${right?.firstName || ""}`.trim().toLowerCase();
    if (leftName !== rightName) return leftName.localeCompare(rightName);
    const leftTs = new Date(left?.createdAt || left?.updatedAt || 0).getTime();
    const rightTs = new Date(right?.createdAt || right?.updatedAt || 0).getTime();
    return rightTs - leftTs;
  });
}

async function runSearch(req) {
  const { q, roleAtCamp, industry, cityState, sort, limit, offset, fetchLimit } = parseSearchInput(req);
  const cacheKey = [
    "search",
    String(req.tenant?._id || ""),
    String(req.user?.id || ""),
    q,
    roleAtCamp,
    industry,
    cityState,
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
    roleAtCamp: roleAtCamp || null,
    industry: industry || null,
    cityState: cityState || null,
    limit: fetchLimit,
    maxLimit: 1000
  });
  const allItems = sortSearchItems(rawItems.map((profile) => withNickname(profile)), sort);
  const total = allItems.length;
  const items = allItems.slice(offset, offset + limit).map((profile) => mapSearchSummary(profile));

  if (q) {
    await logTenantEvent({
      tenantId: req.tenant._id,
      userId: req.user.id,
      eventType: "directory_search",
      metadata: {
        term: q,
        resultCount: total
      }
    }).catch(() => {});
  }

  const payload = {
    q,
    roleAtCamp,
    industry,
    cityState,
    sort,
    limit,
    offset,
    total,
    items
  };
  searchResponseCache.set(cacheKey, payload);
  return payload;
}

router.get("/", async (req, res) => {
  const disabled = ensureSearchEnabled(req, res);
  if (disabled) return disabled;

  const result = await runSearch(req);
  res.set("Cache-Control", SEARCH_CACHE_CONTROL);

  return res.json({
    total: result.total,
    items: result.items,
    query: {
      q: result.q,
      roleAtCamp: result.roleAtCamp,
      industry: result.industry,
      cityState: result.cityState,
      sort: result.sort,
      offset: result.offset,
      limit: result.limit
    }
  });
});

router.get("/users", async (req, res) => {
  const disabled = ensureSearchEnabled(req, res);
  if (disabled) return disabled;

  const result = await runSearch(req);
  res.set("Cache-Control", SEARCH_CACHE_CONTROL);
  return res.json({
    total: result.total,
    items: result.items,
    results: result.items,
    query: {
      q: result.q,
      roleAtCamp: result.roleAtCamp,
      industry: result.industry,
      cityState: result.cityState,
      sort: result.sort,
      offset: result.offset,
      limit: result.limit
    }
  });
});

router.get("/names", async (req, res) => {
  const disabled = ensureSearchEnabled(req, res);
  if (disabled) return disabled;

  const { q, roleAtCamp, industry, cityState } = parseSearchInput(req);
  const limit = clampLimit(req.query.limit, 10, 25);
  const cacheKey = buildSearchNamesCacheKey(req, { q, roleAtCamp, industry, cityState, limit });
  const cached = searchNamesResponseCache.get(cacheKey);
  if (cached) {
    res.set("Cache-Control", SEARCH_CACHE_CONTROL);
    return res.json(cached);
  }
  const items = await ProfileModel.search(req.tenant._id, q, {
    roleAtCamp: roleAtCamp || null,
    industry: industry || null,
    cityState: cityState || null,
    limit
  });
  const mapped = items.map((profile) => mapNameResult(profile));
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

  const cacheKey = buildSearchUserCacheKey(req, id);
  const cached = searchUserResponseCache.get(cacheKey);
  if (cached) {
    res.set("Cache-Control", SEARCH_CACHE_CONTROL);
    return res.json(cached);
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

  if (!profile) {
    return res.status(404).json({
      error: { code: "NOT_FOUND", message: "Profile not found" }
    });
  }

  const mapped = withNickname(profile);
  const payload = {
    user: {
      ...mapped,
      _id: String(mapped._id || mapped.id || ""),
      id: String(mapped._id || mapped.id || ""),
      email: String(user?.email || mapped.email || mapped.emails?.[0] || "").trim().toLowerCase(),
      phone: String(mapped.phone || mapped.phones?.[0] || "").trim(),
      uploads: {
        photoUrl: String(mapped?.uploads?.photoUrl || mapped.photoUrl || mapped.avatarUrl || "").trim()
      }
    }
  };

  // Cache by requested id and by canonical profile/user ids to collapse repeated lookups.
  searchUserResponseCache.set(cacheKey, payload);
  const canonicalProfileId = normalizeEntityId(mapped?._id || mapped?.id);
  if (canonicalProfileId && canonicalProfileId !== id) {
    searchUserResponseCache.set(buildSearchUserCacheKey(req, canonicalProfileId), payload);
  }
  const canonicalUserId = normalizeEntityId(mapped?.userId || user?._id);
  if (canonicalUserId && canonicalUserId !== id && canonicalUserId !== canonicalProfileId) {
    searchUserResponseCache.set(buildSearchUserCacheKey(req, canonicalUserId), payload);
  }

  res.set("Cache-Control", SEARCH_CACHE_CONTROL);
  return res.json(payload);
});

export default router;
