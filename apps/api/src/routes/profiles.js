import { Router } from "express";
import rateLimit from "express-rate-limit";
import { isValidObjectId } from "../utils/objectId.js";
import { requireTenantAuthScope } from "../middleware/tenantAccess.js";
import { requireTenantModule } from "../middleware/requireFeature.js";
import { UserModel, ProfileModel } from "../db/models/index.js";
import { logTenantEvent } from "../services/analytics.js";
import { sanitizeText } from "../utils/sanitize.js";
import { createTtlCache } from "../utils/ttlCache.js";
import { filterProfileContactFields, normalizeProfilePrivacy } from "../services/profilePrivacy.js";
import {
  canonicalizeCityName,
  canonicalizeCountryName,
  composeCityState,
  parseCityStateDetailed
} from "../utils/location.js";
import {
  findMemberBlockBetween,
  getMutuallyBlockedUserIds,
  isSafetyModerator
} from "../services/memberSafety.js";

const router = Router({ mergeParams: true });
const PROFILE_LIST_CACHE_CONTROL = "private, max-age=15, stale-while-revalidate=45";
const profileListResponseCache = createTtlCache({ ttlMs: 15_000, maxEntries: 400 });

const profileUpdateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: "RATE_LIMITED",
      message: "Too many profile updates. Please wait a few minutes and try again."
    }
  }
});

router.use(...requireTenantAuthScope);

function withNickname(profile = {}) {
  const socials = profile?.socials && typeof profile.socials === "object" ? profile.socials : {};
  return {
    ...profile,
    nickname: String(profile.nickname || socials.nickname || socials.campNickname || "").trim()
  };
}

function mapProfileSummary(profile = {}) {
  const withNick = withNickname(profile);
  return {
    id: String(withNick._id || withNick.id || ""),
    _id: String(withNick._id || withNick.id || ""),
    userId: String(withNick.userId || ""),
    firstName: String(withNick.firstName || "").trim(),
    lastName: String(withNick.lastName || "").trim(),
    nickname: String(withNick.nickname || "").trim(),
    roleAtCamp: String(withNick.roleAtCamp || "").trim(),
    cityState: String(withNick.cityState || "").trim(),
    industry: String(withNick.industry || "").trim(),
    avatarUrl: String(withNick.avatarUrl || "").trim(),
    uploads: { photoUrl: String(withNick.avatarUrl || "").trim() },
    currentJobs: Array.isArray(withNick.currentJobs) ? withNick.currentJobs.slice(0, 3) : [],
    createdAt: withNick.createdAt || null,
    updatedAt: withNick.updatedAt || null
  };
}

function hasOwn(body = {}, key = "") {
  return Object.prototype.hasOwnProperty.call(body || {}, key);
}

function normalizeCityStateFromBody(body = {}) {
  const hasLocationFields =
    hasOwn(body, "cityState") ||
    hasOwn(body, "city") ||
    hasOwn(body, "state") ||
    hasOwn(body, "country");

  if (!hasLocationFields) return undefined;

  const direct = String(body.cityState || "").trim();
  if (direct) return composeCityState(parseCityStateDetailed(direct));

  const state = String(body.state || "").trim().toUpperCase();
  const country = canonicalizeCountryName(String(body.country || "").trim());
  const city = canonicalizeCityName(String(body.city || "").trim(), { state, country });
  return composeCityState({ city, state, country });
}

function normalizeCollegeMajorsFromBody(body = {}) {
  if (Array.isArray(body.collegeMajors)) {
    return body.collegeMajors.map((entry) => sanitizeText(String(entry || "").trim()));
  }
  if (Array.isArray(body.education)) {
    return body.education.map((row) => sanitizeText(String(row?.major || "").trim()));
  }
  const fromSocials =
    body.socials && typeof body.socials === "object"
      ? body.socials
      : body.social && typeof body.social === "object"
      ? body.social
      : {};
  if (Array.isArray(fromSocials.collegeMajors)) {
    return fromSocials.collegeMajors.map((entry) => sanitizeText(String(entry || "").trim()));
  }
  if (Array.isArray(fromSocials.educationMajors)) {
    return fromSocials.educationMajors.map((entry) => sanitizeText(String(entry || "").trim()));
  }
  return null;
}

router.get("/me", async (req, res) => {
  const user = await UserModel.findOne(req.tenant._id, { _id: req.user.id });
  if (!user) {
    return res.status(404).json({
      error: { code: "USER_NOT_FOUND", message: "User not found" }
    });
  }

  const profile = await ProfileModel.findByUserId(req.tenant._id, user._id);

  return res.json({ user, profile: withNickname(profile) });
});

router.put("/me", profileUpdateLimiter, async (req, res) => {
  const user = await UserModel.findOne(req.tenant._id, { _id: req.user.id });
  if (!user) {
    return res.status(404).json({
      error: { code: "USER_NOT_FOUND", message: "User not found" }
    });
  }

  const existing = await ProfileModel.findByUserId(req.tenant._id, user._id);
  if (!existing) {
    return res.status(404).json({
      error: { code: "PROFILE_NOT_FOUND", message: "Profile not found" }
    });
  }

  const existingSocials = existing?.socials && typeof existing.socials === "object" ? existing.socials : {};
  const incomingNicknameProvided =
    req.body?.nickname !== undefined ||
    req.body?.campNickname !== undefined ||
    req.body?.social?.nickname !== undefined ||
    req.body?.socials?.nickname !== undefined ||
    req.body?.socials?.campNickname !== undefined;
  const incomingNickname = incomingNicknameProvided
    ? sanitizeText(
        String(
          req.body?.nickname ??
            req.body?.campNickname ??
            req.body?.social?.nickname ??
            req.body?.socials?.nickname ??
            req.body?.socials?.campNickname ??
            ""
        ).trim()
      )
    : "";
  const providedSocials =
    req.body.socials && typeof req.body.socials === "object"
      ? req.body.socials
      : req.body.social && typeof req.body.social === "object"
      ? req.body.social
      : null;
  const incomingCollegeMajors = normalizeCollegeMajorsFromBody(req.body);
  const nextSocials = providedSocials || incomingNicknameProvided
    ? {
        ...existingSocials,
        ...(providedSocials || {}),
        ...(incomingNicknameProvided ? { nickname: incomingNickname, campNickname: incomingNickname } : {}),
        ...(incomingCollegeMajors
          ? { collegeMajors: incomingCollegeMajors, educationMajors: incomingCollegeMajors }
          : {})
      }
    : incomingCollegeMajors
    ? {
        ...existingSocials,
        collegeMajors: incomingCollegeMajors,
        educationMajors: incomingCollegeMajors
      }
    : undefined;
  const incomingEducationRows = Array.isArray(req.body.education)
    ? req.body.education
        .map((row) => ({
          college: sanitizeText(String(row?.college || "").trim()),
          year: sanitizeText(String(row?.year || "").trim()),
          major: sanitizeText(String(row?.major || "").trim())
        }))
        .filter((row) => row.college || row.year || row.major)
    : null;

  const update = {
    firstName: sanitizeText(String(req.body.firstName || "").trim()),
    lastName: sanitizeText(String(req.body.lastName || "").trim()),
    emails: Array.isArray(req.body.emails) ? req.body.emails : undefined,
    phones: Array.isArray(req.body.phones) ? req.body.phones : undefined,
    cityState: normalizeCityStateFromBody(req.body),
    roleAtCamp: sanitizeText(String(req.body.roleAtCamp || "").trim()),
    highSchool: sanitizeText(String(req.body.highSchool || "").trim()),
    colleges: incomingEducationRows
      ? incomingEducationRows.map((row) => row.college)
      : Array.isArray(req.body.colleges)
      ? req.body.colleges
      : undefined,
    collegeYears: incomingEducationRows
      ? incomingEducationRows.map((row) => row.year)
      : Array.isArray(req.body.collegeYears)
      ? req.body.collegeYears
      : undefined,
    currentJobs: Array.isArray(req.body.currentJobs) ? req.body.currentJobs : undefined,
    pastJobs: Array.isArray(req.body.pastJobs) ? req.body.pastJobs : undefined,
    industry: sanitizeText(String(req.body.industry || "").trim()),
    socials: nextSocials,
    privacy: req.body?.privacy !== undefined ? normalizeProfilePrivacy(req.body.privacy) : undefined,
    avatarUrl: String(req.body.avatarUrl || "").trim(),
    bio: sanitizeText(String(req.body.bio || "").trim())
  };

  const cleanUpdate = Object.fromEntries(
    Object.entries(update).filter(([, value]) => value !== undefined)
  );

  const profile = await ProfileModel.update(existing._id, cleanUpdate);
  profileListResponseCache.clear();

  await logTenantEvent({
    tenantId: req.tenant._id,
    userId: req.user.id,
    eventType: "profile_updated",
    metadata: { target: "self" }
  }).catch(() => {});

  return res.json({ profile: withNickname(profile) });
});

router.get("/", requireTenantModule("directory"), async (req, res) => {
  const q = String(req.query.q || "").trim();
  const roleAtCamp = String(req.query.roleAtCamp || "").trim();
  const industry = String(req.query.industry || "").trim();
  const cityState = String(req.query.cityState || "").trim();
  const view = String(req.query.view || "summary").trim().toLowerCase();
  const includeFull = view === "full";
  const limit = Math.min(Math.max(Number(req.query.limit || 30) || 30, 1), 100);
  const blockedUserIds = await getMutuallyBlockedUserIds(req.tenant._id, req.user.id, {
    user: req.user
  });
  const blockedUserIdSet = new Set(blockedUserIds);
  const cacheKey = [
    String(req.tenant?._id || ""),
    String(req.user?.id || ""),
    blockedUserIds.join(","),
    q,
    roleAtCamp,
    industry,
    cityState,
    limit,
    includeFull ? "full" : "summary"
  ].join(":");

  if (!includeFull) {
    const cached = profileListResponseCache.get(cacheKey);
    if (cached) {
      res.set("Cache-Control", PROFILE_LIST_CACHE_CONTROL);
      return res.json(cached);
    }
  }

  const items = await ProfileModel.search(req.tenant._id, q, {
    roleAtCamp: roleAtCamp || null,
    industry: industry || null,
    cityState: cityState || null,
    limit
  });

  const visibleItems = items.filter(
    (profile) => !blockedUserIdSet.has(String(profile?.userId || ""))
  );
  const payload = {
    total: visibleItems.length,
    items: includeFull
      ? visibleItems.map((profile) => withNickname(filterProfileContactFields(profile, req.user)))
      : visibleItems.map((profile) => mapProfileSummary(profile))
  };

  if (!includeFull) {
    profileListResponseCache.set(cacheKey, payload);
    res.set("Cache-Control", PROFILE_LIST_CACHE_CONTROL);
  }

  return res.json(payload);
});

router.get("/:profileId", requireTenantModule("directory"), async (req, res) => {
  const profileId = String(req.params.profileId || "");
  if (!isValidObjectId(profileId)) {
    return res.status(400).json({
      error: { code: "INVALID_ID", message: "Invalid profile id" }
    });
  }

  const profile = await ProfileModel.findOne(req.tenant._id, { _id: profileId });
  if (!profile) {
    return res.status(404).json({
      error: { code: "PROFILE_NOT_FOUND", message: "Profile not found" }
    });
  }

  if (
    !isSafetyModerator(req.user) &&
    profile?.userId &&
    (await findMemberBlockBetween(req.tenant._id, req.user.id, profile.userId))
  ) {
    return res.status(404).json({
      error: { code: "PROFILE_NOT_FOUND", message: "Profile not found" }
    });
  }

  return res.json({
    profile: withNickname(filterProfileContactFields(profile, req.user))
  });
});

export default router;
