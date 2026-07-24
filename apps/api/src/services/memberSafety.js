import {
  ContentReportModel,
  ConversationModel,
  ForumModel,
  ForumPostModel,
  MemberBlockModel,
  MessageModel,
  PhotoModel,
  ProfileModel,
  UserModel
} from "../db/models/index.js";
import { isValidObjectId } from "../utils/objectId.js";
import { sanitizeText } from "../utils/sanitize.js";

export const REPORT_TARGET_TYPES = Object.freeze([
  "member",
  "message",
  "forum",
  "forum_post",
  "photo",
  "photo_comment"
]);

export const REPORT_REASONS = Object.freeze([
  "harassment",
  "spam",
  "privacy",
  "impersonation",
  "inappropriate",
  "safety",
  "other"
]);

export const REPORT_STATUSES = Object.freeze(["open", "reviewing", "resolved", "dismissed"]);

function safetyError(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function normalizeId(value = "") {
  return String(value || "").trim();
}

function plainSafetyText(value = "", maxLength = 1200) {
  return sanitizeText(
    String(value || "")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  ).slice(0, maxLength);
}

export function isUniqueConstraintError(error) {
  const code = String(error?.code || "").trim();
  const message = String(error?.message || "").toLowerCase();
  return code === "23505" || message.includes("duplicate key") || message.includes("unique constraint");
}

export function normalizeReportInput(input = {}) {
  const targetType = String(input?.targetType || "").trim().toLowerCase();
  const rawTargetId = normalizeId(input?.targetId);
  const parentId = normalizeId(input?.parentId);
  const reason = String(input?.reason || "").trim().toLowerCase();
  const details = plainSafetyText(input?.details, 1200);

  if (!REPORT_TARGET_TYPES.includes(targetType)) {
    throw safetyError("Choose a valid item to report.", "INVALID_REPORT_TARGET");
  }
  if (!REPORT_REASONS.includes(reason)) {
    throw safetyError("Choose a reason for this report.", "INVALID_REPORT_REASON");
  }

  if (targetType === "photo_comment") {
    const parts = rawTargetId.includes(":") ? rawTargetId.split(":", 2) : [parentId, rawTargetId];
    const [photoId, commentId] = parts.map(normalizeId);
    if (!isValidObjectId(photoId) || !isValidObjectId(commentId)) {
      throw safetyError("A valid photo and comment are required.", "INVALID_REPORT_TARGET");
    }
    return { targetType, targetId: `${photoId}:${commentId}`, reason, details };
  }

  if (!isValidObjectId(rawTargetId)) {
    throw safetyError("A valid report target is required.", "INVALID_REPORT_TARGET");
  }

  return { targetType, targetId: rawTargetId, reason, details };
}

export function normalizeReportReviewInput(input = {}) {
  const status = String(input?.status || "").trim().toLowerCase();
  const resolutionNote = plainSafetyText(input?.resolutionNote, 1200);
  if (!REPORT_STATUSES.includes(status)) {
    throw safetyError("Choose a valid report status.", "INVALID_REPORT_STATUS");
  }
  if ((status === "resolved" || status === "dismissed") && !resolutionNote) {
    throw safetyError(
      "Add a short resolution note before closing this report.",
      "REPORT_RESOLUTION_NOTE_REQUIRED"
    );
  }
  return { status, resolutionNote };
}

export async function resolveTenantMemberUser(tenantId, rawTargetId) {
  const targetId = normalizeId(rawTargetId);
  if (!isValidObjectId(targetId)) return null;

  let user = await UserModel.findOne(tenantId, { _id: targetId });
  let profile = null;
  if (!user) {
    profile = await ProfileModel.findOne(tenantId, { _id: targetId });
    if (!profile) profile = await ProfileModel.findOne(tenantId, { userId: targetId });
    if (profile?.userId) user = await UserModel.findOne(tenantId, { _id: profile.userId });
  }
  if (!profile && user?._id) profile = await ProfileModel.findOne(tenantId, { userId: user._id });
  return user ? { user, profile } : null;
}

export async function findMemberBlockBetween(tenantId, leftUserId, rightUserId) {
  const left = normalizeId(leftUserId);
  const right = normalizeId(rightUserId);
  if (!tenantId || !left || !right || left === right) return null;

  const [outgoing, incoming] = await Promise.all([
    MemberBlockModel.findOne(tenantId, { blockerUserId: left, blockedUserId: right }),
    MemberBlockModel.findOne(tenantId, { blockerUserId: right, blockedUserId: left })
  ]);
  return outgoing || incoming || null;
}

export async function assertDirectContactAllowed(tenantId, leftUserId, rightUserId) {
  const block = await findMemberBlockBetween(tenantId, leftUserId, rightUserId);
  if (!block) return;
  throw safetyError(
    "Direct contact is unavailable because one of these members has blocked the other.",
    "MEMBER_BLOCKED",
    403
  );
}

export async function assertConversationDirectContactAllowed(tenantId, conversation = {}, actorUserId = "") {
  if (String(conversation?.type || "").trim().toLowerCase() !== "dm") return;
  const actorId = normalizeId(actorUserId);
  const otherUserId = (conversation?.participantIds || [])
    .map(normalizeId)
    .find((userId) => userId && userId !== actorId);
  if (otherUserId) await assertDirectContactAllowed(tenantId, actorId, otherUserId);
}

export async function listMemberBlocks(tenantId, blockerUserId) {
  return MemberBlockModel.find(
    tenantId,
    { blockerUserId: normalizeId(blockerUserId) },
    { sort: { createdAt: -1 }, limit: 500 }
  );
}

export function isSafetyModerator(user = {}) {
  const roles = Array.isArray(user?.roles) ? user.roles : [];
  return roles.some((role) => ["admin", "tenant_admin", "super_admin"].includes(String(role || "").toLowerCase()));
}

export async function getMutuallyBlockedUserIds(tenantId, userId, { user = null } = {}) {
  const normalizedUserId = normalizeId(userId);
  if (!tenantId || !normalizedUserId || isSafetyModerator(user || {})) return [];
  const [outgoing, incoming] = await Promise.all([
    MemberBlockModel.find(tenantId, { blockerUserId: normalizedUserId }, { limit: 500 }),
    MemberBlockModel.find(tenantId, { blockedUserId: normalizedUserId }, { limit: 500 })
  ]);
  return [
    ...new Set([
      ...outgoing.map((row) => normalizeId(row.blockedUserId)),
      ...incoming.map((row) => normalizeId(row.blockerUserId))
    ].filter(Boolean))
  ].sort();
}

export async function createMemberBlock({ tenantId, blockerUserId, targetId }) {
  const member = await resolveTenantMemberUser(tenantId, targetId);
  if (!member) throw safetyError("Member not found in this camp.", "MEMBER_NOT_FOUND", 404);

  const blockedUserId = normalizeId(member.user?._id);
  if (blockedUserId === normalizeId(blockerUserId)) {
    throw safetyError("You cannot block yourself.", "CANNOT_BLOCK_SELF");
  }

  const existing = await MemberBlockModel.findOne(tenantId, {
    blockerUserId: normalizeId(blockerUserId),
    blockedUserId
  });
  if (existing) return { block: existing, member, created: false };

  try {
    const block = await MemberBlockModel.create({
      tenantId,
      blockerUserId: normalizeId(blockerUserId),
      blockedUserId
    });
    return { block, member, created: true };
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const block = await MemberBlockModel.findOne(tenantId, {
      blockerUserId: normalizeId(blockerUserId),
      blockedUserId
    });
    if (!block) throw error;
    return { block, member, created: false };
  }
}

export async function resolveReportTarget(tenantId, normalizedInput, { viewerUserId = "" } = {}) {
  const { targetType, targetId } = normalizedInput;
  if (targetType === "member") {
    const member = await resolveTenantMemberUser(tenantId, targetId);
    if (!member) return null;
    const name = [member.profile?.firstName, member.profile?.lastName].filter(Boolean).join(" ").trim();
    return {
      targetId: normalizeId(member.user?._id),
      targetAuthorUserId: normalizeId(member.user?._id),
      preview: name || "Member profile"
    };
  }

  if (targetType === "message") {
    const message = await MessageModel.findOne(tenantId, { _id: targetId, deletedAt: null });
    if (message && viewerUserId) {
      const conversation = await ConversationModel.findOne(tenantId, {
        _id: message.conversationId,
        participantIds: { $contains: [normalizeId(viewerUserId)] }
      });
      if (!conversation) return null;
    }
    return message
      ? {
          targetId,
          targetAuthorUserId: normalizeId(message.senderId),
          contextId: normalizeId(message.conversationId),
          preview: String(message.text || (message.kind === "image" ? "Photo message" : "File message"))
        }
      : null;
  }

  if (targetType === "forum") {
    const forum = await ForumModel.findOne(tenantId, { _id: targetId });
    return forum
      ? {
          targetId,
          targetAuthorUserId: normalizeId(forum.creatorId || forum.createdBy),
          contextId: targetId,
          preview: String(forum.name || "Forum")
        }
      : null;
  }

  if (targetType === "forum_post") {
    const post = await ForumPostModel.findOne(tenantId, { _id: targetId, deletedAt: null });
    return post
      ? {
          targetId,
          targetAuthorUserId: normalizeId(post.authorId),
          contextId: normalizeId(post.forumId),
          preview: String(post.text || (post.kind === "image" ? "Photo post" : "File post"))
        }
      : null;
  }

  if (targetType === "photo") {
    const photo = await PhotoModel.findOne(tenantId, { _id: targetId });
    return photo
      ? {
          targetId,
          targetAuthorUserId: normalizeId(photo.ownerId),
          preview: String(photo.caption || "Photo")
        }
      : null;
  }

  const [photoId, commentId] = targetId.split(":", 2);
  const photo = await PhotoModel.findOne(tenantId, { _id: photoId });
  const comment = (photo?.comments || []).find((entry) => normalizeId(entry?._id) === commentId);
  return comment
    ? {
        targetId,
        targetAuthorUserId: normalizeId(comment.authorId),
        preview: String(comment.text || "Photo comment")
      }
    : null;
}

export async function createContentReport({ tenantId, reporterUserId, input }) {
  const normalized = normalizeReportInput(input);
  const target = await resolveReportTarget(tenantId, normalized, {
    viewerUserId: reporterUserId
  });
  if (!target) throw safetyError("The reported item was not found in this camp.", "REPORT_TARGET_NOT_FOUND", 404);
  if (target.targetAuthorUserId === normalizeId(reporterUserId)) {
    throw safetyError("You cannot report your own content.", "CANNOT_REPORT_SELF");
  }

  const filter = {
    reporterUserId: normalizeId(reporterUserId),
    targetType: normalized.targetType,
    targetId: target.targetId,
    status: { $in: ["open", "reviewing"] }
  };
  const existing = await ContentReportModel.findOne(tenantId, filter);
  if (existing) return { report: existing, target, created: false };

  try {
    const report = await ContentReportModel.create({
      tenantId,
      reporterUserId: normalizeId(reporterUserId),
      targetType: normalized.targetType,
      targetId: target.targetId,
      targetAuthorUserId: target.targetAuthorUserId || null,
      reason: normalized.reason,
      details: normalized.details,
      status: "open"
    });
    return { report, target, created: true };
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const report = await ContentReportModel.findOne(tenantId, filter);
    if (!report) throw error;
    return { report, target, created: false };
  }
}

export function reportPreview(value = "") {
  const normalized = plainSafetyText(value, 10000);
  return normalized.length > 240 ? `${normalized.slice(0, 237)}...` : normalized;
}
