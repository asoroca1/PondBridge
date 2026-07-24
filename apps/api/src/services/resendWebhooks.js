import crypto from "crypto";
import { env } from "../config/env.js";
import {
  AnalyticsEventModel,
  EmailBroadcastModel,
  EmailSuppressionModel,
  ResendWebhookEventModel,
  TenantModel,
  UserModel
} from "../db/models/index.js";

const TRACKED_EMAIL_EVENTS = new Set([
  "email.sent",
  "email.delivered",
  "email.bounced",
  "email.complained",
  "email.clicked",
  "email.failed",
  "email.delivery_delayed",
  "email.suppressed"
]);

function createWebhookError(message, statusCode = 400, code = "WEBHOOK_INVALID") {
  const error = new Error(String(message || "Invalid webhook request."));
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function normalizeEmail(value = "") {
  return String(value || "").trim().toLowerCase();
}

function asHeaderValue(value) {
  if (Array.isArray(value)) return String(value[0] || "").trim();
  return String(value || "").trim();
}

function normalizeEventTimestamp(input) {
  if (!input) return new Date();
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return new Date();
  return parsed;
}

function normalizeTags(tags) {
  if (!tags) return [];
  if (Array.isArray(tags)) {
    return tags
      .map((tag) => ({
        name: String(tag?.name || "").trim(),
        value: String(tag?.value || "").trim()
      }))
      .filter((tag) => tag.name && tag.value);
  }
  if (typeof tags === "object") {
    return Object.entries(tags)
      .map(([name, value]) => ({
        name: String(name || "").trim(),
        value: String(value || "").trim()
      }))
      .filter((tag) => tag.name && tag.value);
  }
  return [];
}

function findTagValue(tags = [], key = "") {
  const target = String(key || "").trim().toLowerCase();
  const match = (Array.isArray(tags) ? tags : []).find(
    (tag) => String(tag?.name || "").trim().toLowerCase() === target
  );
  return String(match?.value || "").trim();
}

function extractRecipients(data = {}) {
  if (Array.isArray(data?.to)) {
    const emails = data.to.map((entry) => normalizeEmail(entry)).filter(Boolean);
    return emails.length > 0 ? emails : [""];
  }
  const single = normalizeEmail(data?.to || "");
  return single ? [single] : [""];
}

function normalizeWebhookSecret(secret = "") {
  const raw = String(secret || "").trim();
  if (!raw) return "";
  if (raw.startsWith("whsec_")) {
    return raw.slice("whsec_".length);
  }
  return raw;
}

function parseSignatureCandidates(signatureHeader = "") {
  const raw = String(signatureHeader || "").trim();
  if (!raw) return [];
  return raw
    .split(/\s+/g)
    .map((segment) => String(segment || "").trim())
    .filter(Boolean)
    .map((segment) => {
      const [version, signature] = segment.split(",", 2);
      if (!version || !signature) return null;
      return {
        version: String(version || "").trim().toLowerCase(),
        signature: String(signature || "").trim()
      };
    })
    .filter(Boolean);
}

function safeEqualBase64(a = "", b = "") {
  const left = Buffer.from(String(a || ""), "base64");
  const right = Buffer.from(String(b || ""), "base64");
  if (left.length === 0 || right.length === 0 || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function verifyResendSvixSignature({
  payload,
  svixId,
  svixTimestamp,
  svixSignature,
  webhookSecret
}) {
  const normalizedSecret = normalizeWebhookSecret(webhookSecret);
  if (!normalizedSecret) {
    throw createWebhookError(
      "RESEND_WEBHOOK_SECRET is not configured.",
      500,
      "WEBHOOK_CONFIG_MISSING"
    );
  }

  const timestampSeconds = Number(svixTimestamp);
  if (!Number.isFinite(timestampSeconds)) {
    throw createWebhookError("Invalid svix-timestamp header.", 400, "WEBHOOK_SIGNATURE_INVALID");
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  const tolerance = Number(env.RESEND_WEBHOOK_TOLERANCE_SECONDS || 300);
  if (Math.abs(nowSeconds - timestampSeconds) > tolerance) {
    throw createWebhookError("Webhook timestamp is outside the allowed tolerance window.", 400, "WEBHOOK_SIGNATURE_EXPIRED");
  }

  const candidates = parseSignatureCandidates(svixSignature).filter(
    (entry) => entry.version === "v1"
  );
  if (candidates.length === 0) {
    throw createWebhookError("Missing v1 signature.", 400, "WEBHOOK_SIGNATURE_INVALID");
  }

  const signingSecret = Buffer.from(normalizedSecret, "base64");
  if (signingSecret.length === 0) {
    throw createWebhookError("Invalid webhook signing secret format.", 500, "WEBHOOK_CONFIG_INVALID");
  }

  const signedContent = `${svixId}.${svixTimestamp}.${payload}`;
  const expected = crypto
    .createHmac("sha256", signingSecret)
    .update(signedContent)
    .digest("base64");
  const matched = candidates.some((entry) => safeEqualBase64(entry.signature, expected));
  if (!matched) {
    throw createWebhookError("Webhook signature verification failed.", 400, "WEBHOOK_SIGNATURE_INVALID");
  }
}

async function resolveTenantFromWebhook({ tenantSlug = "", recipients = [] }) {
  const normalizedSlug = String(tenantSlug || "").trim().toLowerCase();
  if (normalizedSlug) {
    const tenant = await TenantModel.findOne({ slug: normalizedSlug });
    if (tenant) return tenant;
  }

  for (const recipient of recipients) {
    const memberships = await UserModel.findMembershipsByEmail(recipient);
    const uniqueTenantIds = [...new Set((memberships || []).map((item) => String(item?.tenantId || "").trim()).filter(Boolean))];
    if (uniqueTenantIds.length === 1) {
      const tenant = await TenantModel.findById(uniqueTenantIds[0]);
      if (tenant) return tenant;
    }
  }
  return null;
}

async function attachSuppressionIfNeeded({
  eventType,
  recipientEmail,
  tenant,
  tenantSlug,
  payload
}) {
  if (!["email.bounced", "email.complained"].includes(eventType)) return;
  if (!recipientEmail) return;

  const bounce = payload?.data?.bounce && typeof payload.data.bounce === "object" ? payload.data.bounce : {};
  const complaint = payload?.data?.complaint && typeof payload.data.complaint === "object" ? payload.data.complaint : {};
  const reason =
    String(
      bounce.message ||
        complaint.message ||
        (eventType === "email.complained"
          ? "Recipient marked the email as spam."
          : "Recipient address bounced.")
    ).trim();

  await EmailSuppressionModel.upsertActive({
    email: recipientEmail,
    reason,
    sourceEventType: eventType,
    tenantId: tenant?._id || null,
    tenantSlug: tenant?.slug || tenantSlug || "",
    lastEmailId: String(payload?.data?.email_id || "").trim(),
    lastBroadcastId: String(payload?.data?.broadcast_id || "").trim(),
    metadata: {
      bounce,
      complaint,
      eventCreatedAt: payload?.created_at || null
    },
    seenAt: normalizeEventTimestamp(payload?.created_at)
  });
}

async function updateBroadcastStatsFromWebhook({
  tenantId,
  eventType,
  emailId,
  pondbridgeBroadcastId,
  occurredAt,
  recipientEmail
}) {
  if (!tenantId || !emailId) return;
  let broadcast = null;
  if (pondbridgeBroadcastId) {
    broadcast = await EmailBroadcastModel.findOne(tenantId, { _id: pondbridgeBroadcastId });
  }
  if (!broadcast) {
    const broadcasts = await EmailBroadcastModel.find(tenantId, {}, {
      sort: { createdAt: -1 },
      limit: 200
    });
    broadcast = (broadcasts || []).find((item) => {
      const immediateMessageIds = item?.stats?.delivery?.messageIds;
      const scheduledMessageIds = item?.stats?.providerSchedule?.messageIds;
      return (
        (Array.isArray(immediateMessageIds) && immediateMessageIds.includes(emailId)) ||
        (Array.isArray(scheduledMessageIds) && scheduledMessageIds.includes(emailId))
      );
    });
  }
  if (!broadcast) return;

  const currentStats = broadcast?.stats && typeof broadcast.stats === "object" ? broadcast.stats : {};
  const currentWebhook = currentStats?.webhook && typeof currentStats.webhook === "object"
    ? currentStats.webhook
    : {};
  const base = {
    totalEvents: Number(currentWebhook.totalEvents || 0),
    sent: Number(currentWebhook.sent || 0),
    delivered: Number(currentWebhook.delivered || 0),
    bounced: Number(currentWebhook.bounced || 0),
    complained: Number(currentWebhook.complained || 0),
    clicked: Number(currentWebhook.clicked || 0),
    failed: Number(currentWebhook.failed || 0),
    deliveryDelayed: Number(currentWebhook.deliveryDelayed || 0),
    suppressed: Number(currentWebhook.suppressed || 0),
    lastEventAt: currentWebhook.lastEventAt || null,
    lastRecipient: currentWebhook.lastRecipient || ""
  };
  base.totalEvents += 1;
  if (eventType === "email.sent") base.sent += 1;
  if (eventType === "email.delivered") base.delivered += 1;
  if (eventType === "email.bounced") base.bounced += 1;
  if (eventType === "email.complained") base.complained += 1;
  if (eventType === "email.clicked") base.clicked += 1;
  if (eventType === "email.failed") base.failed += 1;
  if (eventType === "email.delivery_delayed") base.deliveryDelayed += 1;
  if (eventType === "email.suppressed") base.suppressed += 1;
  base.lastEventAt = occurredAt.toISOString();
  base.lastRecipient = recipientEmail || base.lastRecipient;

  const sentCount =
    Number(currentStats?.delivery?.acceptedCount || 0) ||
    Number(currentStats?.delivery?.sentCount || 0) ||
    Number(broadcast?.recipientCount || 0);
  const clickRate = sentCount > 0 ? Math.round((base.clicked / sentCount) * 1000) / 10 : 0;
  const bounceRate = sentCount > 0 ? Math.round((base.bounced / sentCount) * 1000) / 10 : 0;
  const complaintRate = sentCount > 0 ? Math.round((base.complained / sentCount) * 1000) / 10 : 0;

  const updates = {
    stats: {
      ...currentStats,
      webhook: base,
      clickRate,
      bounceRate,
      complaintRate
    }
  };
  if (eventType === "email.sent" && broadcast.status === "scheduled") {
    updates.status = "sent";
    updates.sentAt = occurredAt;
  } else if (
    eventType === "email.failed" &&
    broadcast.status === "scheduled" &&
    base.sent === 0 &&
    base.failed >= sentCount
  ) {
    updates.status = "failed";
  }
  await EmailBroadcastModel.update(broadcast._id, updates);
}

async function writeTenantAnalyticsEvent({
  tenantId,
  userId = null,
  eventType,
  emailId,
  recipientEmail,
  broadcastId,
  occurredAt
}) {
  if (!tenantId) return;
  await AnalyticsEventModel.create({
    tenantId,
    userId,
    eventType,
    metadata: {
      featureModule: "email",
      emailId,
      broadcastId,
      recipient: recipientEmail
    },
    createdAt: occurredAt
  });
}

export async function processResendWebhookRequest(req) {
  const payloadText = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : String(req.body || "");
  if (!payloadText.trim()) {
    throw createWebhookError("Webhook payload is empty.", 400, "WEBHOOK_PAYLOAD_EMPTY");
  }

  const svixId = asHeaderValue(req.headers["svix-id"]);
  const svixTimestamp = asHeaderValue(req.headers["svix-timestamp"]);
  const svixSignature = asHeaderValue(req.headers["svix-signature"]);
  if (!svixId || !svixTimestamp || !svixSignature) {
    throw createWebhookError("Missing required svix headers.", 400, "WEBHOOK_HEADERS_MISSING");
  }

  verifyResendSvixSignature({
    payload: payloadText,
    svixId,
    svixTimestamp,
    svixSignature,
    webhookSecret: env.RESEND_WEBHOOK_SECRET
  });

  let payload = {};
  try {
    payload = JSON.parse(payloadText);
  } catch {
    throw createWebhookError("Webhook body is not valid JSON.", 400, "WEBHOOK_JSON_INVALID");
  }

  const eventType = String(payload?.type || "").trim();
  if (!eventType) {
    throw createWebhookError("Webhook event type is missing.", 400, "WEBHOOK_EVENT_INVALID");
  }

  if (!TRACKED_EMAIL_EVENTS.has(eventType)) {
    return {
      ok: true,
      processed: 0,
      ignored: true,
      eventType,
      reason: "UNTRACKED_EVENT_TYPE"
    };
  }

  const eventData = payload?.data && typeof payload.data === "object" ? payload.data : {};
  const recipients = extractRecipients(eventData);
  const tags = normalizeTags(eventData.tags);
  const tenantTag = findTagValue(tags, "tenant");
  const pondbridgeBroadcastId = findTagValue(tags, "pondbridge_broadcast");
  const tenant = await resolveTenantFromWebhook({ tenantSlug: tenantTag, recipients });
  const occurredAt = normalizeEventTimestamp(payload?.created_at || eventData?.created_at);
  const emailId = String(eventData?.email_id || "").trim();
  const broadcastId = String(eventData?.broadcast_id || "").trim();

  let inserted = 0;
  let duplicates = 0;
  for (const recipient of recipients) {
    const saved = await ResendWebhookEventModel.insertUnique({
      svixId,
      eventType,
      emailId,
      broadcastId,
      recipientEmail: recipient,
      tenantId: tenant?._id || null,
      tenantSlug: tenant?.slug || tenantTag || "",
      occurredAt,
      payload
    });
    if (!saved) {
      duplicates += 1;
      continue;
    }
    inserted += 1;

    await attachSuppressionIfNeeded({
      eventType,
      recipientEmail: recipient,
      tenant,
      tenantSlug: tenantTag,
      payload
    });

    await updateBroadcastStatsFromWebhook({
      tenantId: tenant?._id || null,
      eventType,
      emailId,
      pondbridgeBroadcastId,
      occurredAt,
      recipientEmail: recipient
    });

    await writeTenantAnalyticsEvent({
      tenantId: tenant?._id || null,
      eventType,
      emailId,
      recipientEmail: recipient,
      broadcastId,
      occurredAt
    });
  }

  return {
    ok: true,
    ignored: false,
    eventType,
    svixId,
    tenantSlug: tenant?.slug || tenantTag || "",
    processed: inserted,
    duplicates
  };
}
