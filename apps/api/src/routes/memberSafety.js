import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireTenantAuthScope } from "../middleware/tenantAccess.js";
import { ConversationModel, MemberBlockModel, ProfileModel } from "../db/models/index.js";
import {
  createContentReport,
  createMemberBlock,
  findMemberBlockBetween,
  listMemberBlocks,
  resolveTenantMemberUser
} from "../services/memberSafety.js";
import { notifyTenantAdmins } from "../services/mobileNotifications.js";
import { evictUserFromRealtimeRoom } from "../services/socketServer.js";

const router = Router({ mergeParams: true });

const safetyWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) =>
    [
      "member-safety",
      String(req.tenant?._id || req.params?.slug || ""),
      String(req.user?.id || ""),
      String(req.ip || "")
    ].join(":"),
  message: {
    error: {
      code: "RATE_LIMITED",
      message: "Too many safety actions. Please wait and try again."
    }
  }
});

router.use(...requireTenantAuthScope);

function memberName(profile = {}) {
  return [profile?.firstName, profile?.lastName].filter(Boolean).join(" ").trim() || "Member";
}

router.get("/blocks", async (req, res) => {
  const blocks = await listMemberBlocks(req.tenant._id, req.user.id);
  const items = await Promise.all(
    blocks.map(async (block) => {
      const profile = await ProfileModel.findOne(req.tenant._id, { userId: block.blockedUserId });
      return {
        id: String(block._id || block.id || ""),
        blockedUserId: String(block.blockedUserId || ""),
        profileId: String(profile?._id || profile?.id || ""),
        name: memberName(profile),
        avatarUrl: String(profile?.avatarUrl || ""),
        createdAt: block.createdAt || null
      };
    })
  );
  return res.json({ items });
});

router.get("/blocks/status/:targetId", async (req, res) => {
  const member = await resolveTenantMemberUser(req.tenant._id, req.params.targetId);
  if (!member) {
    return res.status(404).json({ error: { code: "MEMBER_NOT_FOUND", message: "Member not found." } });
  }
  const targetUserId = String(member.user?._id || "");
  const block = await findMemberBlockBetween(req.tenant._id, req.user.id, targetUserId);
  const blockedByMe = Boolean(block && String(block.blockerUserId) === String(req.user.id));
  return res.json({
    blocked: Boolean(block),
    blockedByMe,
    directContactAllowed: !block,
    targetUserId
  });
});

router.post("/blocks", safetyWriteLimiter, async (req, res) => {
  const result = await createMemberBlock({
    tenantId: req.tenant._id,
    blockerUserId: req.user.id,
    targetId: req.body?.targetUserId || req.body?.targetId
  });

  const blockedUserId = String(result.block?.blockedUserId || "");
  if (blockedUserId) {
    const dm = await ConversationModel.findDm(
      req.tenant._id,
      [String(req.user.id), blockedUserId].sort()
    );
    if (dm?._id) {
      const room = `conversation:${String(dm._id)}`;
      evictUserFromRealtimeRoom(req.user.id, room);
      evictUserFromRealtimeRoom(blockedUserId, room);
    }
  }

  return res.status(result.created ? 201 : 200).json({
    created: result.created,
    block: {
      id: String(result.block?._id || result.block?.id || ""),
      blockedUserId: String(result.block?.blockedUserId || ""),
      profileId: String(result.member?.profile?._id || result.member?.profile?.id || ""),
      name: memberName(result.member?.profile),
      createdAt: result.block?.createdAt || null
    },
    message: result.created
      ? "Member blocked. One-to-one contact is now disabled."
      : "This member is already blocked."
  });
});

router.delete("/blocks/:targetId", safetyWriteLimiter, async (req, res) => {
  const member = await resolveTenantMemberUser(req.tenant._id, req.params.targetId);
  if (!member) {
    return res.status(404).json({ error: { code: "MEMBER_NOT_FOUND", message: "Member not found." } });
  }
  const block = await MemberBlockModel.findOne(req.tenant._id, {
    blockerUserId: req.user.id,
    blockedUserId: member.user._id
  });
  if (block) await MemberBlockModel.delete(block._id);
  return res.json({ ok: true, removed: Boolean(block) });
});

router.post("/reports", safetyWriteLimiter, async (req, res) => {
  const result = await createContentReport({
    tenantId: req.tenant._id,
    reporterUserId: req.user.id,
    input: req.body
  });

  if (result.created) {
    await notifyTenantAdmins({
      tenant: req.tenant,
      createdByUserId: req.user.id,
      kind: "content_report_created",
      title: "New community safety report",
      body: "A member submitted a report that needs review.",
      deepLink: `/t/${req.tenant.slug}/admin/dashboard`,
      data: { reportId: String(result.report?._id || "") }
    }).catch(() => {});
  }

  return res.status(result.created ? 201 : 200).json({
    created: result.created,
    report: {
      id: String(result.report?._id || result.report?.id || ""),
      status: String(result.report?.status || "open"),
      createdAt: result.report?.createdAt || null
    },
    message: result.created
      ? "Report submitted to the camp's moderation team."
      : "You already have an open report for this item."
  });
});

export default router;
