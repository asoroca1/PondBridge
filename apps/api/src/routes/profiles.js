import { Router } from "express";
import { isValidObjectId } from "../utils/objectId.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireTenant } from "../middleware/tenantContext.js";
import { UserModel, ProfileModel } from "../db/models/index.js";
import { logTenantEvent } from "../services/analytics.js";

const router = Router({ mergeParams: true });

router.use(requireAuth, requireTenant);

router.get("/me", async (req, res) => {
  const user = await UserModel.findOne(req.tenant._id, { _id: req.user.id });
  if (!user) {
    return res.status(404).json({
      error: { code: "USER_NOT_FOUND", message: "User not found" }
    });
  }

  const profile = await ProfileModel.findByUserId(req.tenant._id, user._id);

  return res.json({ user, profile });
});

router.put("/me", async (req, res) => {
  const user = await UserModel.findOne(req.tenant._id, { _id: req.user.id });
  if (!user) {
    return res.status(404).json({
      error: { code: "USER_NOT_FOUND", message: "User not found" }
    });
  }

  const update = {
    firstName: String(req.body.firstName || "").trim(),
    lastName: String(req.body.lastName || "").trim(),
    emails: Array.isArray(req.body.emails) ? req.body.emails : undefined,
    phones: Array.isArray(req.body.phones) ? req.body.phones : undefined,
    cityState: String(req.body.cityState || "").trim(),
    roleAtCamp: String(req.body.roleAtCamp || "").trim(),
    highSchool: String(req.body.highSchool || "").trim(),
    colleges: Array.isArray(req.body.colleges) ? req.body.colleges : undefined,
    collegeYears: Array.isArray(req.body.collegeYears) ? req.body.collegeYears : undefined,
    currentJobs: Array.isArray(req.body.currentJobs) ? req.body.currentJobs : undefined,
    pastJobs: Array.isArray(req.body.pastJobs) ? req.body.pastJobs : undefined,
    industry: String(req.body.industry || "").trim(),
    socials: req.body.socials || undefined,
    avatarUrl: String(req.body.avatarUrl || "").trim(),
    bio: String(req.body.bio || "").trim()
  };

  const cleanUpdate = Object.fromEntries(
    Object.entries(update).filter(([, value]) => value !== undefined)
  );

  const existing = await ProfileModel.findByUserId(req.tenant._id, user._id);
  if (!existing) {
    return res.status(404).json({
      error: { code: "PROFILE_NOT_FOUND", message: "Profile not found" }
    });
  }

  const profile = await ProfileModel.update(existing._id, cleanUpdate);

  await logTenantEvent({
    tenantId: req.tenant._id,
    userId: req.user.id,
    eventType: "profile_updated",
    metadata: { target: "self" }
  }).catch(() => {});

  return res.json({ profile });
});

router.get("/", async (req, res) => {
  const q = String(req.query.q || "").trim();
  const roleAtCamp = String(req.query.roleAtCamp || "").trim();
  const industry = String(req.query.industry || "").trim();
  const cityState = String(req.query.cityState || "").trim();
  const limit = Math.min(Number(req.query.limit || 30), 100);

  const items = await ProfileModel.search(req.tenant._id, q, {
    roleAtCamp: roleAtCamp || null,
    industry: industry || null,
    cityState: cityState || null,
    limit
  });

  return res.json({ total: items.length, items });
});

router.get("/:profileId", async (req, res) => {
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

  return res.json({ profile });
});

export default router;
