import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireTenantAuthScope } from "../middleware/tenantAccess.js";
import { ProfileModel, UserModel } from "../db/models/index.js";
import { logTenantEvent } from "../services/analytics.js";
import { isValidObjectId } from "../utils/objectId.js";

const router = Router({ mergeParams: true });

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
  const limit = clampLimit(req.query.limit, 30, 100);
  return { q, roleAtCamp, industry, cityState, limit };
}

function mapNameResult(profile = {}) {
  const firstName = String(profile.firstName || "").trim();
  const lastName = String(profile.lastName || "").trim();
  const socials = profile?.socials && typeof profile.socials === "object" ? profile.socials : {};
  const nickname = String(profile.nickname || socials.nickname || socials.campNickname || "").trim();
  const name = `${firstName} ${lastName}`.trim();
  return {
    id: String(profile._id || profile.id || ""),
    _id: String(profile._id || profile.id || ""),
    userId: String(profile.userId || ""),
    name: name || "Unknown",
    firstName,
    lastName,
    nickname,
    cityState: String(profile.cityState || "").trim(),
    roleAtCamp: String(profile.roleAtCamp || "").trim(),
    industry: String(profile.industry || "").trim(),
    uploads: { photoUrl: String(profile.avatarUrl || "").trim() },
    currentJobs: Array.isArray(profile.currentJobs) ? profile.currentJobs : []
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

async function runSearch(req) {
  const { q, roleAtCamp, industry, cityState, limit } = parseSearchInput(req);
  const rawItems = await ProfileModel.search(req.tenant._id, q, {
    roleAtCamp: roleAtCamp || null,
    industry: industry || null,
    cityState: cityState || null,
    limit
  });
  const items = rawItems.map((profile) => withNickname(profile));

  if (q) {
    await logTenantEvent({
      tenantId: req.tenant._id,
      userId: req.user.id,
      eventType: "directory_search",
      metadata: {
        term: q,
        resultCount: items.length
      }
    }).catch(() => {});
  }

  return {
    q,
    roleAtCamp,
    industry,
    cityState,
    limit,
    items
  };
}

router.get("/", async (req, res) => {
  const disabled = ensureSearchEnabled(req, res);
  if (disabled) return disabled;

  const result = await runSearch(req);

  return res.json({
    total: result.items.length,
    items: result.items,
    query: {
      q: result.q,
      roleAtCamp: result.roleAtCamp,
      industry: result.industry,
      cityState: result.cityState,
      limit: result.limit
    }
  });
});

router.get("/users", async (req, res) => {
  const disabled = ensureSearchEnabled(req, res);
  if (disabled) return disabled;

  const result = await runSearch(req);
  return res.json({
    total: result.items.length,
    items: result.items,
    results: result.items,
    query: {
      q: result.q,
      roleAtCamp: result.roleAtCamp,
      industry: result.industry,
      cityState: result.cityState,
      limit: result.limit
    }
  });
});

router.get("/names", async (req, res) => {
  const disabled = ensureSearchEnabled(req, res);
  if (disabled) return disabled;

  const { q, roleAtCamp, industry, cityState } = parseSearchInput(req);
  const limit = clampLimit(req.query.limit, 10, 25);
  const items = await ProfileModel.search(req.tenant._id, q, {
    roleAtCamp: roleAtCamp || null,
    industry: industry || null,
    cityState: cityState || null,
    limit
  });
  const mapped = items.map((profile) => mapNameResult(profile));

  return res.json({
    total: mapped.length,
    items: mapped,
    results: mapped
  });
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

  if (!profile) {
    return res.status(404).json({
      error: { code: "NOT_FOUND", message: "Profile not found" }
    });
  }

  const mapped = withNickname(profile);
  return res.json({
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
  });
});

export default router;
