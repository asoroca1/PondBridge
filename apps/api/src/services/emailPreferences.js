import crypto from "node:crypto";
import { env } from "../config/env.js";
import {
  EmailPreferenceModel,
  EmailSuppressionModel
} from "../db/models/index.js";

export const COMMUNITY_UPDATES_TOPIC = "community_updates";
const TOKEN_VERSION = "pbep1";
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(value = "") {
  return String(value || "").trim().toLowerCase();
}

function normalizeTopic(value = COMMUNITY_UPDATES_TOPIC) {
  const topic = String(value || COMMUNITY_UPDATES_TOPIC).trim().toLowerCase();
  return /^[a-z][a-z0-9_]{2,80}$/.test(topic) ? topic : COMMUNITY_UPDATES_TOPIC;
}

function tokenKey(secret = "") {
  const normalized = String(secret || "").trim();
  if (normalized.length < 24) {
    const error = new Error("Email preference links are not configured.");
    error.code = "EMAIL_PREFERENCE_TOKEN_NOT_CONFIGURED";
    error.statusCode = 503;
    throw error;
  }
  return crypto.createHash("sha256").update(normalized, "utf8").digest();
}

export function getEmailPreferenceStatus() {
  return {
    configured: String(env.EMAIL_PREFERENCE_TOKEN_SECRET || "").trim().length >= 24,
    topicKey: COMMUNITY_UPDATES_TOPIC
  };
}

export function createEmailPreferenceToken(
  { tenantId, email, topicKey = COMMUNITY_UPDATES_TOPIC },
  { secret = env.EMAIL_PREFERENCE_TOKEN_SECRET, issuedAt = new Date() } = {}
) {
  const normalizedTenantId = String(tenantId || "").trim();
  const normalizedEmail = normalizeEmail(email);
  const normalizedTopic = normalizeTopic(topicKey);
  if (!normalizedTenantId || !EMAIL_REGEX.test(normalizedEmail)) {
    const error = new Error("A valid tenant and recipient are required for email preferences.");
    error.code = "EMAIL_PREFERENCE_TOKEN_INPUT_INVALID";
    error.statusCode = 400;
    throw error;
  }
  const payload = JSON.stringify({
    tenantId: normalizedTenantId,
    email: normalizedEmail,
    topicKey: normalizedTopic,
    issuedAt: new Date(issuedAt).toISOString()
  });
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", tokenKey(secret), iv);
  cipher.setAAD(Buffer.from(TOKEN_VERSION, "utf8"));
  const encrypted = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    TOKEN_VERSION,
    iv.toString("base64url"),
    encrypted.toString("base64url"),
    tag.toString("base64url")
  ].join(".");
}

export function readEmailPreferenceToken(
  token = "",
  { secret = env.EMAIL_PREFERENCE_TOKEN_SECRET } = {}
) {
  const parts = String(token || "").trim().split(".");
  if (parts.length !== 4 || parts[0] !== TOKEN_VERSION || String(token).length > 3000) {
    const error = new Error("This email preference link is invalid.");
    error.code = "EMAIL_PREFERENCE_TOKEN_INVALID";
    error.statusCode = 400;
    throw error;
  }
  try {
    const iv = Buffer.from(parts[1], "base64url");
    const encrypted = Buffer.from(parts[2], "base64url");
    const tag = Buffer.from(parts[3], "base64url");
    if (iv.length !== 12 || tag.length !== 16 || encrypted.length === 0) throw new Error("invalid");
    const decipher = crypto.createDecipheriv("aes-256-gcm", tokenKey(secret), iv);
    decipher.setAAD(Buffer.from(TOKEN_VERSION, "utf8"));
    decipher.setAuthTag(tag);
    const payload = JSON.parse(
      Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8")
    );
    const tenantId = String(payload?.tenantId || "").trim();
    const email = normalizeEmail(payload?.email || "");
    const topicKey = normalizeTopic(payload?.topicKey);
    const issuedAt = new Date(payload?.issuedAt || "");
    if (
      !tenantId ||
      !EMAIL_REGEX.test(email) ||
      Number.isNaN(issuedAt.getTime()) ||
      issuedAt.getTime() > Date.now() + 5 * 60 * 1000
    ) {
      throw new Error("invalid");
    }
    return { tenantId, email, topicKey, issuedAt: issuedAt.toISOString() };
  } catch (cause) {
    if (cause?.code === "EMAIL_PREFERENCE_TOKEN_NOT_CONFIGURED") throw cause;
    const error = new Error("This email preference link is invalid.");
    error.code = "EMAIL_PREFERENCE_TOKEN_INVALID";
    error.statusCode = 400;
    throw error;
  }
}

export function buildEmailPreferenceUrls({ tenantId, email, topicKey } = {}) {
  const token = createEmailPreferenceToken({ tenantId, email, topicKey });
  const encoded = encodeURIComponent(token);
  return {
    token,
    manageUrl: `${String(env.FRONTEND_ORIGIN || "").replace(/\/+$/, "")}/email-preferences?token=${encoded}`,
    oneClickUrl: `${String(env.PUBLIC_API_ORIGIN || "").replace(/\/+$/, "")}/api/public/email-preferences/one-click?token=${encoded}`
  };
}

export async function resolveEmailRecipientEligibility({
  tenantId,
  recipients = [],
  topicKey = COMMUNITY_UPDATES_TOPIC
} = {}) {
  const normalized = [...new Set((Array.isArray(recipients) ? recipients : [])
    .map(normalizeEmail)
    .filter((email) => EMAIL_REGEX.test(email)))];
  if (!tenantId || normalized.length === 0) {
    return {
      deliverableRecipients: [],
      excludedRecipients: [],
      suppressedRecipients: [],
      unsubscribedRecipients: []
    };
  }
  const [suppressions, preferences] = await Promise.all([
    env.EMAIL_SUPPRESSION_ENABLED === false
      ? []
      : EmailSuppressionModel.findActiveByEmails(normalized),
    EmailPreferenceModel.findUnsubscribedByEmails(tenantId, normalized, topicKey)
  ]);
  const suppressedSet = new Set(suppressions.map((item) => normalizeEmail(item?.email)).filter(Boolean));
  const unsubscribedSet = new Set(preferences.map((item) => normalizeEmail(item?.email)).filter(Boolean));
  const excludedSet = new Set([...suppressedSet, ...unsubscribedSet]);
  return {
    deliverableRecipients: normalized.filter((email) => !excludedSet.has(email)),
    excludedRecipients: normalized.filter((email) => excludedSet.has(email)),
    suppressedRecipients: [...suppressedSet],
    unsubscribedRecipients: [...unsubscribedSet]
  };
}

export async function setEmailPreferenceFromToken({
  token,
  status = "unsubscribed",
  source = "recipient"
} = {}) {
  const payload = readEmailPreferenceToken(token);
  const preference = await EmailPreferenceModel.setStatus({
    tenantId: payload.tenantId,
    email: payload.email,
    topicKey: payload.topicKey,
    status,
    source,
    metadata: { tokenVersion: TOKEN_VERSION }
  });
  return { payload, preference };
}

export function maskPreferenceEmail(value = "") {
  const email = normalizeEmail(value);
  const [local = "", domain = ""] = email.split("@");
  if (!local || !domain) return "this address";
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"•".repeat(Math.max(2, Math.min(8, local.length - visible.length)))}@${domain}`;
}
