import {
  ProfileModel,
  TenantModel,
  UserModel
} from "../db/models/index.js";
import { sendMobileNotificationBatch } from "./mobileNotifications.js";

export const MAX_MESSAGE_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export const MESSAGE_ATTACHMENT_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "video/mp4",
  "video/quicktime",
  "video/webm"
]);

function normalizeSegment(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function validDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function normalizeMessageKind(raw = "") {
  const kind = String(raw || "text").trim().toLowerCase();
  if (kind === "text" || kind === "image" || kind === "file") return kind;
  return "text";
}

export function clampReadAt(value, now = new Date()) {
  const ceiling = validDate(now) || new Date();
  const requested = validDate(value) || ceiling;
  return requested.getTime() > ceiling.getTime() ? ceiling : requested;
}

export function advanceReadBy(readBy = [], userId = "", readAt = new Date()) {
  const id = String(userId || "").trim();
  if (!id) return Array.isArray(readBy) ? [...readBy] : [];

  const nextAt = validDate(readAt) || new Date();
  const next = Array.isArray(readBy) ? readBy.map((entry) => ({ ...entry })) : [];
  const index = next.findIndex((entry) => String(entry?.userId || "") === id);
  if (index < 0) {
    next.push({ userId: id, lastReadAt: nextAt });
    return next;
  }

  const previousAt = validDate(next[index]?.lastReadAt);
  if (!previousAt || nextAt.getTime() > previousAt.getTime()) {
    next[index] = { ...next[index], userId: id, lastReadAt: nextAt };
  }
  return next;
}

export function hasConversationMessage(conversation = {}) {
  const message = conversation?.lastMessage;
  if (!message || typeof message !== "object") return false;
  return Boolean(
    String(message.senderId || "").trim() ||
      String(message.text || "").trim() ||
      message.media?.url ||
      message.createdAt
  );
}

export function normalizeStoredMessageMedia(
  media = {},
  { tenantSlug = "", scope = "chat", entityId = "", objectProxyBaseUrl = "", kind = "file" } = {}
) {
  if (!media || typeof media !== "object") return null;

  const safeTenant = normalizeSegment(tenantSlug);
  const safeScope = String(scope || "chat")
    .split("/")
    .map((segment) => normalizeSegment(segment))
    .filter(Boolean)
    .join("/");
  const safeEntityId = normalizeSegment(entityId);
  const key = String(media.key || "").trim();
  const expectedPrefix = `${safeTenant}/${safeScope}/${safeEntityId}/`;
  if (!safeTenant || !safeScope || !safeEntityId || !key.startsWith(expectedPrefix)) {
    const error = new Error("Attachment does not belong to this conversation or forum.");
    error.statusCode = 400;
    error.code = "INVALID_ATTACHMENT_SCOPE";
    throw error;
  }

  const mime = String(media.mime || "").trim().toLowerCase();
  if (!MESSAGE_ATTACHMENT_MIME_TYPES.has(mime)) {
    const error = new Error("This attachment type is not supported.");
    error.statusCode = 400;
    error.code = "UNSUPPORTED_ATTACHMENT_TYPE";
    throw error;
  }
  if (kind === "image" && !mime.startsWith("image/")) {
    const error = new Error("Image messages require an image attachment.");
    error.statusCode = 400;
    error.code = "INVALID_ATTACHMENT_TYPE";
    throw error;
  }

  const size = Number(media.size || 0);
  if (!Number.isFinite(size) || size < 0 || size > MAX_MESSAGE_ATTACHMENT_BYTES) {
    const error = new Error("Attachment must be 20 MB or smaller.");
    error.statusCode = size > MAX_MESSAGE_ATTACHMENT_BYTES ? 413 : 400;
    error.code = size > MAX_MESSAGE_ATTACHMENT_BYTES ? "FILE_TOO_LARGE" : "INVALID_UPLOAD_SIZE";
    throw error;
  }

  const proxyBase = String(objectProxyBaseUrl || "").replace(/\/+$/, "");
  if (!proxyBase) {
    const error = new Error("Attachment delivery is unavailable for this request.");
    error.statusCode = 503;
    error.code = "ATTACHMENT_DELIVERY_UNAVAILABLE";
    throw error;
  }

  return {
    url: `${proxyBase}?key=${encodeURIComponent(key)}`,
    key,
    mime,
    name: String(media.name || "attachment").trim().slice(0, 240) || "attachment",
    size: Math.trunc(size)
  };
}

export function buildConversationNotification({ conversation = {}, senderName = "", message = {} } = {}) {
  const group = String(conversation?.type || "") === "group";
  const kind = normalizeMessageKind(message?.kind);
  const sender = String(senderName || "A camp member").trim() || "A camp member";
  const attachmentLabel = kind === "image" ? "a photo" : kind === "file" ? "a file" : "a message";
  const groupName = String(conversation?.name || "Group chat").trim() || "Group chat";
  const conversationId = String(conversation?._id || conversation?.id || "");

  return {
    kind: "chat_message_received",
    category: "community",
    title: group ? groupName : `New message from ${sender}`,
    body: group ? `${sender} sent ${attachmentLabel}.` : `${sender} sent you ${attachmentLabel}.`,
    deepLink: `/chat-rooms?tab=${group ? "groups" : "personal"}&conversation=${encodeURIComponent(conversationId)}`,
    data: {
      conversationId,
      conversationType: group ? "group" : "dm",
      senderId: String(message?.senderId || "")
    }
  };
}

export async function notifyConversationParticipants({
  tenant = null,
  conversation = {},
  message = {},
  senderId = "",
  excludeUserIds = []
} = {}) {
  const tenantId = String(tenant?._id || tenant?.id || conversation?.tenantId || "").trim();
  const sender = String(senderId || message?.senderId || "").trim();
  const excluded = new Set((Array.isArray(excludeUserIds) ? excludeUserIds : []).map(String));
  const userIds = [...new Set((conversation?.participantIds || []).map(String))].filter(
    (userId) => userId && userId !== sender && !excluded.has(userId)
  );
  if (!tenantId || !sender || !userIds.length) return { totalRecipients: 0, notifications: [] };

  const resolvedTenant = tenant || (await TenantModel.findById(tenantId));
  if (!resolvedTenant) return { totalRecipients: 0, notifications: [] };

  const [profile, user] = await Promise.all([
    ProfileModel.findOne(tenantId, { userId: sender }).catch(() => null),
    UserModel.findOne(tenantId, { _id: sender }).catch(() => null)
  ]);
  const senderName =
    `${String(profile?.firstName || "").trim()} ${String(profile?.lastName || "").trim()}`.trim() ||
    String(user?.email || "").split("@")[0] ||
    "A camp member";
  const notification = buildConversationNotification({ conversation, senderName, message });

  return sendMobileNotificationBatch({
    tenant: resolvedTenant,
    userIds,
    createdByUserId: sender,
    ...notification,
    batchId: `chat-message-${String(message?._id || message?.id || Date.now())}`
  });
}
