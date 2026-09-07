import crypto from "crypto";
import { env } from "../config/env.js";
import {
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
    const saved = await ResendWebhookEventModel.processAtomically({
      svixId,
      eventType,
      emailId,
      broadcastId,
      recipientEmail: recipient,
      tenantId: tenant?._id || null,
      tenantSlug: tenant?.slug || tenantTag || "",
      occurredAt,
      payload,
      pondbridgeBroadcastId
    });
    if (!saved) {
      duplicates += 1;
      continue;
    }
    inserted += 1;
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
