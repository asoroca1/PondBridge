import { Router } from "express";
import { requireTenantAuthScope } from "../middleware/tenantAccess.js";
import {
  GivingCauseModel,
  GivingCauseUpdateModel,
  GivingDonationModel,
  ProfileModel
} from "../db/models/index.js";
import { getHiddenProfileIds } from "../services/memberTiers.js";
import {
  buildGivingSummary,
  createGivingError,
  normalizeCheckoutPreferences,
  normalizeGivingWritePayload,
  resolveGivingSlug,
  serializeGivingCause,
  serializeGivingUpdate,
  serializePublicDonation
} from "../services/giving.js";
import { sanitizeText } from "../utils/sanitize.js";

const router = Router({ mergeParams: true });

router.use(...requireTenantAuthScope);

function toId(value = "") {
  return String(value || "").trim();
}

function isDirector(user = {}) {
  const roles = Array.isArray(user?.roles) ? user.roles : [];
  return roles.includes("tenant_admin") || roles.includes("super_admin") || roles.includes("admin");
}

function creatorName(profile = {}, user = {}) {
  return `${profile?.firstName || ""} ${profile?.lastName || ""}`.trim() || String(user?.email || "Member");
}

function creatorAffiliation(profile = {}, requested = "") {
  const explicit = sanitizeText(String(requested || "").trim()).slice(0, 80);
  return explicit || String(profile?.roleAtCamp || "Alumni").trim().slice(0, 80);
}

async function resolveUniqueCauseSlug(tenantId, title = "") {
  const base = resolveGivingSlug(title, "cause");
  let candidate = base;
  let counter = 2;
  while (await GivingCauseModel.findOne(tenantId, { slug: candidate })) {
    candidate = `${base}-${counter}`;
    counter += 1;
  }
  return candidate;
}

async function loadCause(tenantId, causeIdOrSlug = "") {
  const key = toId(causeIdOrSlug);
  if (!key) return null;
  return (
    (await GivingCauseModel.findOne(tenantId, { _id: key })) ||
    (await GivingCauseModel.findOne(tenantId, { slug: key }))
  );
}

router.get("/", async (req, res) => {
  const causes = await GivingCauseModel.find(
    req.tenant._id,
    { status: { $in: ["active", "completed"] } },
    { sort: { featured: -1, createdAt: -1 }, limit: 200 }
  );
  const items = causes
    .map((cause) => serializeGivingCause(cause, { viewerUserId: req.user.id }))
    .sort((left, right) => {
      if (left.isGeneralFund !== right.isGeneralFund) return left.isGeneralFund ? -1 : 1;
      if (left.featured !== right.featured) return left.featured ? -1 : 1;
      return new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime();
    });

  const myProposals = await GivingCauseModel.find(
    req.tenant._id,
    {
      createdByUserId: req.user.id,
      status: { $in: ["pending", "changes_requested", "rejected"] }
    },
    { sort: { createdAt: -1 }, limit: 20 }
  );

  return res.json({
    summary: buildGivingSummary(causes),
    featured: items.filter((item) => item.status === "active" && item.featured),
    active: items.filter((item) => item.status === "active"),
    completed: items.filter((item) => item.status === "completed"),
    myProposals: myProposals.map((cause) => serializeGivingCause(cause, { viewerUserId: req.user.id })),
    categories: ["camperships", "facilities", "traditions", "programs", "memorial", "other"]
  });
});

router.post("/causes", async (req, res) => {
  const director = isDirector(req.user);
  const profile = await ProfileModel.findByUserId(req.tenant._id, req.user.id);
  if (!profile) {
    throw createGivingError(
      "Complete your member profile before creating a cause.",
      "GIVING_PROFILE_REQUIRED",
      403
    );
  }

  const payload = normalizeGivingWritePayload(req.body || {});
  const slug = await resolveUniqueCauseSlug(req.tenant._id, payload.title);
  const now = new Date();
  const created = await GivingCauseModel.create({
    tenantId: req.tenant._id,
    slug,
    ...payload,
    createdByUserId: req.user.id,
    createdByProfileId: toId(profile?._id || profile?.id),
    creatorName: creatorName(profile, req.user),
    creatorAffiliation: creatorAffiliation(profile, req.body?.creatorAffiliation),
    origin: director ? "official" : "alumni_led",
    status: director ? "active" : "pending",
    approvedByUserId: director ? req.user.id : null,
    approvedAt: director ? now : null,
    startDate: payload.startDate || now.toISOString().slice(0, 10),
    fundraisingOpen: true,
    featured: false,
    isGeneralFund: false
  });

  return res.status(201).json({
    ok: true,
    item: serializeGivingCause(created, { viewerUserId: req.user.id }),
    message: director
      ? "Your official cause is live."
      : "Your cause was sent to the camp directors for review."
  });
});

router.patch("/:causeId", async (req, res) => {
  const cause = await loadCause(req.tenant._id, req.params.causeId);
  const ownsCause = cause && toId(cause.createdByUserId) === toId(req.user.id);
  if (!cause || !ownsCause || !["pending", "changes_requested"].includes(cause.status)) {
    throw createGivingError("This proposal cannot be edited.", "GIVING_CAUSE_NOT_EDITABLE", 403);
  }

  const payload = normalizeGivingWritePayload(req.body || {}, { partial: true });
  const startDate = Object.prototype.hasOwnProperty.call(payload, "startDate") ? payload.startDate : cause.startDate;
  const endDate = Object.prototype.hasOwnProperty.call(payload, "endDate") ? payload.endDate : cause.endDate;
  if (startDate && endDate && endDate < startDate) {
    throw createGivingError("The end date must be after the start date.", "GIVING_TIMELINE_INVALID");
  }
  const updated = await GivingCauseModel.update(cause._id || cause.id, {
    ...payload,
    status: "pending",
    reviewNote: ""
  });

  return res.json({
    ok: true,
    item: serializeGivingCause(updated, { viewerUserId: req.user.id }),
    message: "Your revised cause was sent back for director review."
  });
});

router.post("/:causeId/checkout", async (req, res) => {
  const cause = await loadCause(req.tenant._id, req.params.causeId);
  if (!cause || cause.status !== "active") {
    throw createGivingError("Cause not found.", "GIVING_CAUSE_NOT_FOUND", 404);
  }
  if (!cause.fundraisingOpen) {
    throw createGivingError("This cause is no longer accepting donations.", "GIVING_CAUSE_CLOSED", 409);
  }

  const preferences = normalizeCheckoutPreferences(req.body || {});
  const checkoutUrl = String(cause.externalCheckoutUrl || "").trim();
  if (!checkoutUrl) {
    throw createGivingError(
      "Secure online giving is not connected for this camp yet.",
      "GIVING_PROVIDER_NOT_CONNECTED",
      409
    );
  }

  return res.json({
    ok: true,
    checkoutUrl,
    providerMetadata: {
      causeId: toId(cause._id || cause.id),
      tenantId: req.tenant._id,
      donorUserId: req.user.id,
      ...preferences
    }
  });
});

router.get("/:causeId", async (req, res) => {
  const cause = await loadCause(req.tenant._id, req.params.causeId);
  const visibleToMember = cause && ["active", "completed"].includes(String(cause.status || ""));
  const visibleToCreator = cause && toId(cause.createdByUserId) === toId(req.user.id);
  if (!cause || (!visibleToMember && !visibleToCreator && !isDirector(req.user))) {
    throw createGivingError("Cause not found.", "GIVING_CAUSE_NOT_FOUND", 404);
  }

  const causeId = toId(cause._id || cause.id);
  const [donations, updates] = await Promise.all([
    visibleToMember
      ? GivingDonationModel.find(
          req.tenant._id,
          { causeId, status: "succeeded" },
          { sort: { completedAt: -1 }, limit: 40 }
        )
      : [],
    GivingCauseUpdateModel.find(
      req.tenant._id,
      { causeId },
      { sort: { publishedAt: -1 }, limit: 30 }
    )
  ]);

  // The supporter list names people, so it follows the same visibility rule as
  // the directory. Anonymous donations carry no profile id and are unaffected.
  const hiddenProfileIds = new Set(
    (await getHiddenProfileIds(req.tenant, req.user.id, { user: req.user })).map(String)
  );
  const supporters = donations
    .map(serializePublicDonation)
    .filter((donation) => !hiddenProfileIds.has(String(donation?.donorProfileId || "")));

  return res.json({
    item: serializeGivingCause(cause, { viewerUserId: req.user.id }),
    recentSupporters: supporters,
    updates: updates.map(serializeGivingUpdate)
  });
});

export default router;
