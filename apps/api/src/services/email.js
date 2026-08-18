import nodemailer from "nodemailer";
import { defaultNetworkDisplayNameForCamp, normalizeCampType } from "@pondbridge/shared";
import { env } from "../config/env.js";
import { EmailSuppressionModel } from "../db/models/index.js";
import { buildTenantUrls } from "../utils/domainProvisioning.js";
import {
  inviteTemplate,
  magicLinkTemplate,
  verificationCodeTemplate,
  passwordResetCodeTemplate,
  welcomeTemplate,
  accessApprovedTemplate,
  accessDeniedTemplate
} from "./emailTemplates.js";

let transport = null;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESEND_TRANSIENT_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);
const RESEND_TRANSIENT_ERROR_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN", "ENOTFOUND"]);
const RESEND_TAG_TOKEN_REGEX = /^[A-Za-z0-9_-]+$/;
const RESEND_HEADER_NAME_REGEX = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const HEX_COLOR_REGEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function toBoundedInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

function asBoolean(value, fallback = false) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return fallback;
  return ["1", "true", "yes", "on"].includes(normalized);
}

function getEmailMode() {
  return String(env.EMAIL_MODE || "mock").trim().toLowerCase();
}

function normalizeEmailAddress(value = "") {
  return String(value || "").trim().toLowerCase();
}

function suppressionsEnabled() {
  return Boolean(env.EMAIL_SUPPRESSION_ENABLED !== false);
}

function extractEmailAddress(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const angleMatch = raw.match(/<\s*([^<>]+?)\s*>$/);
  const candidate = angleMatch ? angleMatch[1] : raw;
  return normalizeEmailAddress(candidate);
}

function isValidEmailAddress(value = "") {
  return EMAIL_REGEX.test(normalizeEmailAddress(value));
}

function isValidFromAddress(value = "") {
  return isValidEmailAddress(extractEmailAddress(value));
}

function emailDomain(value = "") {
  const email = extractEmailAddress(value);
  const atIndex = email.lastIndexOf("@");
  if (atIndex < 0) return "";
  return email.slice(atIndex + 1);
}

function dedupeList(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).filter(Boolean))];
}

function normalizeString(value = "") {
  return String(value || "").trim();
}

function sanitizeSenderName(value = "", fallback = "PondBridge") {
  const cleaned = String(value || "")
    .replace(/[<>\r\n"]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 96);
  return cleaned || fallback;
}

function normalizeNetworkDisplayName(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ");
}

function genericNetworkDisplayName(value = "") {
  const normalized = normalizeNetworkDisplayName(value);
  if (!normalized) return true;
  return [
    "camp alumni network",
    "camp alumnae network",
    "your camp alumni network",
    "your camp alumnae network",
    "alumni network",
    "alumnae network"
  ].includes(normalized);
}

function titleCaseWords(value = "") {
  return String(value || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
    .trim();
}

function nameFromTenantSlug(slug = "") {
  const words = String(slug || "")
    .trim()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ");
  return titleCaseWords(words);
}

function resolveTenantNetworkName(tenant = {}) {
  const campType = normalizeCampType(tenant?.content?.campType || tenant?.settings?.campType || "coed");
  const configured = String(tenant?.content?.networkDisplayName || "").trim();
  if (configured && !genericNetworkDisplayName(configured)) return configured;
  const tenantName = String(tenant?.name || "").trim();
  if (tenantName) return defaultNetworkDisplayNameForCamp(tenantName, campType);
  const slugName = nameFromTenantSlug(tenant?.slug || "");
  if (slugName) return defaultNetworkDisplayNameForCamp(slugName, campType);
  return defaultNetworkDisplayNameForCamp("Your Camp", campType);
}

function normalizeHttpUrl(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    return url.toString();
  } catch {
    return "";
  }
}

function normalizeBrandColor(value = "", fallback = "#002b5c") {
  const candidate = String(value || "").trim();
  if (HEX_COLOR_REGEX.test(candidate)) return candidate;
  return fallback;
}

function tenantFromAddress(baseAddress = "", tenant = {}) {
  const normalizedBase = extractEmailAddress(baseAddress);
  if (!normalizedBase) return "";
  const atIndex = normalizedBase.lastIndexOf("@");
  if (atIndex <= 0 || atIndex === normalizedBase.length - 1) return normalizedBase;
  const domain = normalizedBase.slice(atIndex + 1);
  const mode = getEmailMode();
  if (mode !== "resend") return normalizedBase;

  const tenantToken = String(tenant?.slug || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 42);
  if (!tenantToken) return normalizedBase;

  const localPartPrefix = "network";
  const maxLocalLength = 64;
  const suffixBudget = Math.max(0, maxLocalLength - (localPartPrefix.length + 1));
  const boundedToken = tenantToken.slice(0, suffixBudget);
  return `${localPartPrefix}+${boundedToken}@${domain}`;
}

function normalizeFromAddress(value = "") {
  const candidate = normalizeString(value || env.EMAIL_FROM || "");
  if (!candidate) {
    throw createEmailError("Sender from-address is required.", "EMAIL_FROM_REQUIRED", 500);
  }
  if (!isValidFromAddress(candidate)) {
    throw createEmailError(
      `Invalid sender from-address: ${candidate}`,
      "INVALID_FROM_ADDRESS",
      400
    );
  }
  return candidate;
}

export function buildTenantEmailBranding(tenant = {}, { senderName = "" } = {}) {
  const networkName = resolveTenantNetworkName(tenant);
  const safeSenderName = sanitizeSenderName(senderName || networkName, "PondBridge");
  const baseFromAddress = tenantFromAddress(env.EMAIL_FROM || "", tenant);
  const themeSource = {
    ...(tenant?.theme && typeof tenant.theme === "object" ? tenant.theme : {}),
    ...(tenant?.onboardingDraft?.theme && typeof tenant.onboardingDraft.theme === "object"
      ? tenant.onboardingDraft.theme
      : {})
  };
  const from = baseFromAddress
    ? `${safeSenderName} <${baseFromAddress}>`
    : normalizeFromAddress(env.EMAIL_FROM || "");
  const contactEmail = normalizeEmailAddress(tenant?.content?.contactEmail || "");
  const replyTo = isValidEmailAddress(contactEmail) ? contactEmail : "";
  const brandPrimary = normalizeBrandColor(themeSource?.brandPrimary || "", "#002b5c");
  const logoUrl = normalizeHttpUrl(themeSource?.logoUrl || "");
  return {
    networkName,
    from: normalizeFromAddress(from),
    replyTo,
    brandPrimary,
    logoUrl
  };
}

export function buildPondBridgeEmailBranding({ senderName = "PondBridge" } = {}) {
  const safeSenderName = sanitizeSenderName(senderName || "PondBridge", "PondBridge");
  const baseFromAddress =
    extractEmailAddress(env.EMAIL_FROM || "") ||
    extractEmailAddress(normalizeFromAddress(env.EMAIL_FROM || ""));
  const from = normalizeFromAddress(`${safeSenderName} <${baseFromAddress}>`);
  return {
    networkName: "PondBridge",
    from,
    replyTo: "",
    brandPrimary: "#002b5c",
    logoUrl: ""
  };
}

function toAddressList(value) {
  const values = Array.isArray(value) ? value : String(value || "").split(",");
  return dedupeList(values.map((item) => normalizeEmailAddress(item)).filter(Boolean));
}

function createEmailError(message, code = "EMAIL_SEND_FAILED", statusCode = 502, details = null) {
  const error = new Error(String(message || "Email send failed."));
  error.code = code;
  error.statusCode = statusCode;
  if (details) error.details = details;
  return error;
}

async function findSuppressedRecipients(recipients = []) {
  if (!suppressionsEnabled()) return [];
  const normalized = dedupeList((Array.isArray(recipients) ? recipients : [])
    .map((value) => normalizeEmailAddress(value))
    .filter(Boolean));
  if (normalized.length === 0) return [];
  try {
    return await EmailSuppressionModel.findActiveByEmails(normalized);
  } catch (error) {
    console.warn("[email] suppression lookup failed", {
      message: String(error?.message || "unknown")
    });
    return [];
  }
}

async function assertRecipientsNotSuppressed(recipients = []) {
  const suppressedRows = await findSuppressedRecipients(recipients);
  if (suppressedRows.length === 0) return;
  const blocked = suppressedRows
    .map((item) => normalizeEmailAddress(item?.email || ""))
    .filter(Boolean);
  throw createEmailError(
    `Recipient is suppressed: ${blocked.join(", ")}`,
    "RECIPIENT_SUPPRESSED",
    409,
    { recipients: blocked }
  );
}

function validateAddressList(values = [], fieldName = "recipients") {
  const invalid = values.filter((value) => !isValidEmailAddress(value));
  if (invalid.length === 0) return;
  throw createEmailError(
    `Invalid ${fieldName}: ${invalid.join(", ")}`,
    "INVALID_EMAIL_ADDRESS",
    400,
    { field: fieldName, invalid }
  );
}

function normalizeRecipients({ to, cc, bcc, replyTo }) {
  const toList = toAddressList(to);
  const ccList = toAddressList(cc);
  const bccList = toAddressList(bcc);
  const replyToList = toAddressList(replyTo);

  validateAddressList(toList, "to");
  validateAddressList(ccList, "cc");
  validateAddressList(bccList, "bcc");
  validateAddressList(replyToList, "replyTo");

  const toSet = new Set(toList);
  const ccFiltered = ccList.filter((email) => !toSet.has(email));
  const ccSet = new Set(ccFiltered);
  const bccFiltered = bccList.filter((email) => !toSet.has(email) && !ccSet.has(email));

  return {
    to: toList,
    cc: ccFiltered,
    bcc: bccFiltered,
    replyTo: replyToList[0] || "",
    replyToList
  };
}

function normalizeIdempotencyKey(value = "", fieldName = "idempotencyKey") {
  const key = normalizeString(value);
  if (!key) return "";
  if (key.length > 256) {
    throw createEmailError(
      `${fieldName} must be 256 characters or less.`,
      "INVALID_IDEMPOTENCY_KEY",
      400
    );
  }
  return key;
}

function buildScopedIdempotencyKey(baseKey = "", suffix = "") {
  const normalizedBase = normalizeIdempotencyKey(baseKey, "idempotencyKey");
  if (!normalizedBase) return "";
  const normalizedSuffix = normalizeString(suffix)
    .replace(/\s+/g, "-")
    .replace(/[^\w.\-/:]/g, "")
    .slice(0, 96);
  if (!normalizedSuffix) return normalizedBase;
  const delimiter = normalizedBase.includes("/") ? ":" : "/";
  const full = `${normalizedBase}${delimiter}${normalizedSuffix}`;
  return full.length <= 256 ? full : full.slice(0, 256);
}

function normalizeResendHeaders(headers = {}) {
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) return {};
  const normalized = {};
  for (const [rawName, rawValue] of Object.entries(headers)) {
    const name = normalizeString(rawName);
    const value = normalizeString(rawValue);
    if (!name || !value) continue;
    if (!RESEND_HEADER_NAME_REGEX.test(name)) {
      throw createEmailError(
        `Invalid header name "${name}".`,
        "INVALID_EMAIL_HEADER",
        400
      );
    }
    const lowered = name.toLowerCase();
    if (["authorization", "content-type", "idempotency-key"].includes(lowered)) continue;
    normalized[name] = value;
  }
  return normalized;
}

function normalizeResendTags(tags = []) {
  let list = [];
  if (Array.isArray(tags)) list = tags;
  else if (tags && typeof tags === "object") {
    list = Object.entries(tags).map(([name, value]) => ({ name, value }));
  }
  if (list.length === 0) return [];

  const toTagToken = (value, fallback = "tag") => {
    const token = normalizeString(value)
      .replace(/[^A-Za-z0-9_-]/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 256);
    return token || fallback;
  };

  return list
    .map((item = {}) => {
      const rawName = normalizeString(item.name);
      const rawValue = normalizeString(item.value);
      if (!rawName || !rawValue) return null;
      const name = toTagToken(rawName, "tag");
      const value = toTagToken(rawValue, "value");
      if (!RESEND_TAG_TOKEN_REGEX.test(name) || !RESEND_TAG_TOKEN_REGEX.test(value)) return null;
      return { name, value };
    })
    .filter(Boolean);
}

function normalizeTopicId(value = "") {
  return normalizeString(value);
}

function normalizeScheduledAt(value = "") {
  return normalizeString(value);
}

function normalizeAttachmentFilename(value = "", fallback = "attachment.pdf") {
  const normalized = String(value || "")
    .trim()
    .replace(/[\/\\]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[^\w.\- ()]/g, "")
    .slice(0, 140);
  return normalized || fallback;
}

function normalizeAttachments(attachments = []) {
  const list = Array.isArray(attachments) ? attachments : [];
  if (list.length === 0) return [];

  return list
    .map((item, index) => {
      const filename = normalizeAttachmentFilename(
        item?.filename,
        `attachment-${index + 1}.pdf`
      );
      const contentType = String(
        item?.contentType || item?.mimeType || item?.type || "application/octet-stream"
      ).trim();
      const contentId = String(item?.contentId || item?.content_id || "").trim();

      const rawContent = item?.content;
      let content = null;
      if (Buffer.isBuffer(rawContent)) {
        content = rawContent;
      } else if (rawContent instanceof Uint8Array) {
        content = Buffer.from(rawContent);
      } else if (typeof rawContent === "string" && rawContent.trim()) {
        // Accept base64 payloads from callers that do not pass Buffers.
        content = Buffer.from(rawContent, "base64");
      }

      if (!content || content.length === 0) {
        throw createEmailError(
          `Attachment "${filename}" is missing file content.`,
          "ATTACHMENT_CONTENT_REQUIRED",
          400
        );
      }

      return {
        filename,
        contentType,
        content,
        contentId
      };
    })
    .filter(Boolean);
}

function computeResendRetryDelay(attemptNumber) {
  const baseDelay = toBoundedInt(env.RESEND_RETRY_BASE_DELAY_MS, 300, 0, 10_000);
  if (baseDelay <= 0) return 0;
  const multiplier = Math.max(1, attemptNumber);
  const jitter = Math.floor(Math.random() * 100);
  return Math.min(baseDelay * 2 ** (multiplier - 1) + jitter, 30_000);
}

function shouldRetryResend(statusCode, errorCode = "") {
  if (RESEND_TRANSIENT_STATUS_CODES.has(Number(statusCode))) return true;
  const normalizedErrorCode = String(errorCode || "").trim().toUpperCase();
  return RESEND_TRANSIENT_ERROR_CODES.has(normalizedErrorCode);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, Number(ms) || 0));
  });
}

async function sendResendRequest(payload) {
  const maxRetries = toBoundedInt(env.RESEND_MAX_RETRIES, 2, 0, 5);
  const timeoutMs = toBoundedInt(env.RESEND_REQUEST_TIMEOUT_MS, 12_000, 1000, 60_000);
  const resendUserAgent = normalizeString(env.RESEND_USER_AGENT || "pondbridge-api/1.0");
  const endpointPath = normalizeString(payload?.endpointPath || "/emails") || "/emails";
  const method = normalizeString(payload?.method || "POST").toUpperCase();
  const idempotencyKey = normalizeIdempotencyKey(payload?.idempotencyKey || "");
  const requestHeaders = normalizeResendHeaders(payload?.headers || {});
  const requestPayload = payload?.body;
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${env.RESEND_API_BASE_URL}${endpointPath}`, {
        method,
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
          "User-Agent": resendUserAgent,
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
          ...requestHeaders
        },
        ...(requestPayload === undefined ? {} : { body: JSON.stringify(requestPayload) }),
        signal: controller.signal
      });

      const responseBody = await response.json().catch(() => ({}));
      if (response.ok) {
        const messageIds = Array.isArray(responseBody?.data)
          ? responseBody.data
              .map((item) => String(item?.id || "").trim())
              .filter(Boolean)
          : [];
        return {
          ok: true,
          messageId: String(responseBody?.id || messageIds[0] || ""),
          messageIds,
          responseBody
        };
      }

      const message = String(
        responseBody?.message || responseBody?.name || responseBody?.error?.message || ""
      ).trim();
      const code = String(responseBody?.error?.code || responseBody?.code || "").trim().toUpperCase();
      const retryable = shouldRetryResend(response.status, code);

      const error = createEmailError(
        `Resend request failed (${response.status}): ${message || "Unknown API error."}`,
        retryable ? "EMAIL_PROVIDER_TEMPORARY" : "EMAIL_PROVIDER_REJECTED",
        retryable ? 503 : 502,
        { status: response.status, code, retryable, endpointPath }
      );
      lastError = error;
      if (!retryable || attempt >= maxRetries) throw error;
      await sleep(computeResendRetryDelay(attempt + 1));
    } catch (error) {
      const isAbortError = String(error?.name || "").toLowerCase() === "aborterror";
      const errorCode = String(error?.code || "").toUpperCase();
      const retryable = isAbortError || shouldRetryResend(503, errorCode);
      lastError = error;
      if (!retryable || attempt >= maxRetries) {
        if (error?.code) throw error;
        throw createEmailError(
          isAbortError ? "Resend request timed out." : `Resend request failed: ${error?.message || "unknown error"}`,
          retryable ? "EMAIL_PROVIDER_TEMPORARY" : "EMAIL_PROVIDER_REJECTED",
          retryable ? 503 : 502,
          { retryable, errorCode }
        );
      }
      await sleep(computeResendRetryDelay(attempt + 1));
    } finally {
      clearTimeout(timeout);
    }
  }

  if (lastError) throw lastError;
  throw createEmailError("Resend request failed with unknown state.", "EMAIL_PROVIDER_REJECTED", 502);
}

function ensureConfiguredForMode(mode) {
  const normalizedMode = String(mode || "").trim().toLowerCase();
  if (normalizedMode === "mock") return;

  const missing = [];
  if (!env.EMAIL_FROM) missing.push("EMAIL_FROM");
  else if (!isValidFromAddress(env.EMAIL_FROM)) missing.push("EMAIL_FROM(valid sender address)");
  if (normalizedMode === "smtp") {
    if (!env.SMTP_HOST) missing.push("SMTP_HOST");
    if (!env.SMTP_PORT) missing.push("SMTP_PORT");
  }
  if (normalizedMode === "resend" && !env.RESEND_API_KEY) {
    missing.push("RESEND_API_KEY");
  }
  if (missing.length > 0) {
    throw createEmailError(
      `Missing ${normalizedMode.toUpperCase()} settings: ${missing.join(", ")}.`,
      "EMAIL_CONFIG_MISSING",
      500
    );
  }
}

export function getEmailServiceStatus() {
  const mode = getEmailMode();
  const missing = [];
  if (mode !== "mock" && !env.EMAIL_FROM) missing.push("EMAIL_FROM");
  if (mode !== "mock" && env.EMAIL_FROM && !isValidFromAddress(env.EMAIL_FROM)) {
    missing.push("EMAIL_FROM(valid sender address)");
  }
  if (mode === "smtp") {
    if (!env.SMTP_HOST) missing.push("SMTP_HOST");
    if (!env.SMTP_PORT) missing.push("SMTP_PORT");
  }
  if (mode === "resend" && !env.RESEND_API_KEY) missing.push("RESEND_API_KEY");
  const from = String(env.EMAIL_FROM || "").trim();
  const fromDomain = emailDomain(from);
  const appDomain = String(env.APP_BASE_DOMAIN || "").trim().toLowerCase();
  const warnings = [];

  if (mode === "resend" && fromDomain.endsWith("resend.dev")) {
    warnings.push(
      "EMAIL_FROM is using resend.dev. Switch to a verified pondbridgealumni.com sender for branded delivery."
    );
  }

  if (
    mode === "resend" &&
    fromDomain &&
    appDomain &&
    fromDomain !== appDomain &&
    !fromDomain.endsWith(`.${appDomain}`)
  ) {
    warnings.push(
      `EMAIL_FROM domain (${fromDomain}) does not match APP_BASE_DOMAIN (${appDomain}).`
    );
  }

  return {
    mode,
    configured: missing.length === 0,
    missing,
    warnings,
    from,
    fromDomain
  };
}

export function getEmailSchedulingStatus() {
  const service = getEmailServiceStatus();
  return {
    available: service.mode === "resend" && service.configured,
    mode: service.mode,
    configured: service.configured,
    missing: service.missing
  };
}

export async function cancelScheduledTransactionalEmail(messageId) {
  const normalizedMessageId = normalizeString(messageId);
  if (!normalizedMessageId) {
    throw createEmailError(
      "Scheduled email provider ID is required.",
      "SCHEDULED_EMAIL_ID_REQUIRED",
      400
    );
  }
  ensureConfiguredForMode("resend");
  const result = await sendResendRequest({
    endpointPath: `/emails/${encodeURIComponent(normalizedMessageId)}/cancel`,
    method: "POST"
  });
  return {
    ok: true,
    mode: "resend",
    messageId: normalizedMessageId,
    responseBody: result.responseBody
  };
}

function getTransport() {
  if (transport) return transport;

  transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: asBoolean(env.SMTP_SECURE, false),
    auth:
      env.SMTP_USER && env.SMTP_PASS
        ? {
            user: env.SMTP_USER,
            pass: env.SMTP_PASS
          }
        : undefined
  });

  return transport;
}

async function sendResendEmail({
  from,
  to,
  cc,
  bcc,
  replyTo,
  subject,
  text,
  html,
  attachments,
  headers,
  tags,
  scheduledAt,
  topicId,
  idempotencyKey
}) {
  ensureConfiguredForMode("resend");

  const normalized = normalizeRecipients({ to, cc, bcc, replyTo });
  const normalizedAttachments = normalizeAttachments(attachments);
  const normalizedHeaders = normalizeResendHeaders(headers);
  const normalizedTags = normalizeResendTags(tags);
  const normalizedTopicId = normalizeTopicId(topicId);
  const normalizedScheduledAt = normalizeScheduledAt(scheduledAt);
  const normalizedFrom = normalizeFromAddress(from || env.EMAIL_FROM);
  if (normalized.to.length === 0) {
    throw createEmailError("Missing recipient email address.", "RECIPIENT_REQUIRED", 400);
  }
  await assertRecipientsNotSuppressed(normalized.to);
  const cleanSubject = String(subject || "").trim();
  if (!cleanSubject) {
    throw createEmailError("Email subject is required.", "EMAIL_SUBJECT_REQUIRED", 400);
  }

  const payload = {
    from: normalizedFrom,
    to: normalized.to,
    subject: cleanSubject
  };

  if (normalized.cc.length > 0) payload.cc = normalized.cc;
  if (normalized.bcc.length > 0) payload.bcc = normalized.bcc;
  if (normalized.replyToList.length > 0) {
    payload.reply_to = normalized.replyToList.length === 1
      ? normalized.replyToList[0]
      : normalized.replyToList;
  }
  if (Object.keys(normalizedHeaders).length > 0) payload.headers = normalizedHeaders;
  if (normalizedTags.length > 0) payload.tags = normalizedTags;
  if (normalizedTopicId) payload.topic_id = normalizedTopicId;
  if (normalizedScheduledAt) payload.scheduled_at = normalizedScheduledAt;
  if (html) payload.html = html;
  if (text) payload.text = text;
  if (!payload.html && !payload.text) payload.text = " ";
  if (normalizedAttachments.length > 0) {
    payload.attachments = normalizedAttachments.map((item) => ({
      filename: item.filename,
      content: item.content.toString("base64"),
      content_type: item.contentType || undefined,
      ...(item.contentId ? { content_id: item.contentId } : {})
    }));
  }

  const result = await sendResendRequest({
    endpointPath: "/emails",
    idempotencyKey,
    body: payload
  });

  return { ok: true, mode: "resend", messageId: String(result.messageId || "") };
}

async function sendSmtpEmail({
  from,
  to,
  cc,
  bcc,
  replyTo,
  subject,
  text,
  html,
  attachments,
  headers,
  idempotencyKey
}) {
  ensureConfiguredForMode("smtp");
  const normalized = normalizeRecipients({ to, cc, bcc, replyTo });
  const normalizedAttachments = normalizeAttachments(attachments);
  const normalizedHeaders = normalizeResendHeaders(headers);
  const normalizedIdempotencyKey = normalizeIdempotencyKey(idempotencyKey || "");
  const normalizedFrom = normalizeFromAddress(from || env.EMAIL_FROM);
  if (normalized.to.length === 0) {
    throw createEmailError("Missing recipient email address.", "RECIPIENT_REQUIRED", 400);
  }
  await assertRecipientsNotSuppressed(normalized.to);

  const cleanSubject = String(subject || "").trim();
  if (!cleanSubject) {
    throw createEmailError("Email subject is required.", "EMAIL_SUBJECT_REQUIRED", 400);
  }

  const smtpHeaders = {
    ...normalizedHeaders,
    ...(normalizedIdempotencyKey ? { "Resend-Idempotency-Key": normalizedIdempotencyKey } : {})
  };

  const result = await getTransport().sendMail({
    from: normalizedFrom,
    to: normalized.to,
    cc: normalized.cc.length > 0 ? normalized.cc : undefined,
    bcc: normalized.bcc.length > 0 ? normalized.bcc : undefined,
    replyTo: normalized.replyTo || undefined,
    subject: cleanSubject,
    text,
    html,
    headers: Object.keys(smtpHeaders).length > 0 ? smtpHeaders : undefined,
    attachments:
      normalizedAttachments.length > 0
        ? normalizedAttachments.map((item) => ({
            filename: item.filename,
            content: item.content,
            contentType: item.contentType
          }))
        : undefined
  });

  return { ok: true, mode: "smtp", messageId: String(result?.messageId || "") };
}

function trimTrailingSlashes(value = "") {
  return String(value || "").trim().replace(/\/+$/, "");
}

function resolveTenantAppBaseUrl({ tenant = null, tenantSlug = "" } = {}) {
  const normalizedSlug = String(tenantSlug || tenant?.slug || "").trim().toLowerCase();
  const tenantForUrl = tenant && typeof tenant === "object" ? { ...tenant, slug: normalizedSlug || tenant?.slug } : { slug: normalizedSlug };
  const tenantUrls = buildTenantUrls(tenantForUrl);
  const tenantAppUrl = trimTrailingSlashes(tenantUrls?.appUrl || "");
  if (tenantAppUrl) return tenantAppUrl;

  const frontendOrigin = trimTrailingSlashes(env.FRONTEND_ORIGIN || "");
  if (!frontendOrigin) return "";
  if (!normalizedSlug) return frontendOrigin;
  return `${frontendOrigin}/t/${normalizedSlug}`;
}

export function inviteLink({ tenant = null, tenantSlug = "", token, email }) {
  const base = resolveTenantAppBaseUrl({ tenant, tenantSlug });
  return `${base}/create-account?inviteToken=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
}

export function magicLink({ tenant = null, tenantSlug = "", token }) {
  const base = resolveTenantAppBaseUrl({ tenant, tenantSlug });
  return `${base}/login?magicToken=${encodeURIComponent(token)}`;
}

export async function sendTransactionalEmail({
  from,
  to,
  cc,
  bcc,
  replyTo,
  subject,
  text,
  html,
  attachments,
  headers,
  tags,
  scheduledAt,
  topicId,
  idempotencyKey,
  modeOverride = ""
}) {
  const mode = String(modeOverride || getEmailMode()).trim().toLowerCase();
  assertEmailMode(mode);
  const normalizedFrom = normalizeFromAddress(from || env.EMAIL_FROM);

  if (mode === "mock") {
    const normalized = normalizeRecipients({ to, cc, bcc, replyTo });
    if (normalized.to.length === 0) {
      throw createEmailError("Missing recipient email address.", "RECIPIENT_REQUIRED", 400);
    }
    await assertRecipientsNotSuppressed(normalized.to);
    const cleanSubject = String(subject || "").trim();
    if (!cleanSubject) {
      throw createEmailError("Email subject is required.", "EMAIL_SUBJECT_REQUIRED", 400);
    }
    console.log("[email:mock]", {
      from: normalizedFrom,
      to: normalized.to,
      cc: normalized.cc,
      bcc: normalized.bcc,
      subject: cleanSubject,
      headers: normalizeResendHeaders(headers),
      tags: normalizeResendTags(tags),
      topicId: normalizeTopicId(topicId),
      scheduledAt: normalizeScheduledAt(scheduledAt),
      idempotencyKey: normalizeIdempotencyKey(idempotencyKey || ""),
      attachments: normalizeAttachments(attachments).map((item) => item.filename)
    });
    return { ok: true, mode: "mock", messageId: "mock-message" };
  }

  if (mode === "resend") {
    return sendResendEmail({
      from: normalizedFrom,
      to,
      cc,
      bcc,
      replyTo,
      subject,
      text,
      html,
      attachments,
      headers,
      tags,
      scheduledAt,
      topicId,
      idempotencyKey
    });
  }

  if (mode === "smtp") {
    return sendSmtpEmail({
      from: normalizedFrom,
      to,
      cc,
      bcc,
      replyTo,
      subject,
      text,
      html,
      attachments,
      headers,
      idempotencyKey
    });
  }

  throw createEmailError("Unsupported EMAIL_MODE. Use one of: mock, smtp, resend.", "EMAIL_MODE_INVALID", 500);
}

function assertEmailMode(mode) {
  if (["mock", "smtp", "resend"].includes(mode)) return;
  throw createEmailError("Unsupported EMAIL_MODE. Use one of: mock, smtp, resend.", "EMAIL_MODE_INVALID", 500);
}

function chunk(values, size) {
  const out = [];
  const chunkSize = Math.max(1, Math.trunc(size) || 1);
  for (let index = 0; index < values.length; index += chunkSize) {
    out.push(values.slice(index, index + chunkSize));
  }
  return out;
}

export async function sendBulkTransactionalEmail({
  from,
  recipients = [],
  cc,
  bcc,
  replyTo,
  subject,
  text,
  html,
  attachments,
  headers,
  tags,
  scheduledAt,
  topicId,
  idempotencyKey,
  modeOverride = "",
  strategy = "per-recipient",
  batchSize = env.EMAIL_BROADCAST_BATCH_SIZE,
  maxRecipients = env.EMAIL_BROADCAST_MAX_RECIPIENTS,
  personalizer = null
}) {
  const recipientList = dedupeList(
    (Array.isArray(recipients) ? recipients : []).map((item) => normalizeEmailAddress(item)).filter(Boolean)
  );
  validateAddressList(recipientList, "recipients");
  if (recipientList.length === 0) {
    throw createEmailError("No valid recipients provided.", "RECIPIENT_REQUIRED", 400);
  }

  const maxAllowed = toBoundedInt(maxRecipients, 500, 1, 5000);
  if (recipientList.length > maxAllowed) {
    throw createEmailError(
      `Recipient count exceeds maximum allowed (${maxAllowed}).`,
      "TOO_MANY_RECIPIENTS",
      400,
      { maxRecipients: maxAllowed, requested: recipientList.length }
    );
  }

  const cleanSubject = String(subject || "").trim();
  if (!cleanSubject) {
    throw createEmailError("Email subject is required.", "EMAIL_SUBJECT_REQUIRED", 400);
  }

  const mode = String(modeOverride || getEmailMode()).trim().toLowerCase();
  assertEmailMode(mode);
  const suppressedRows = await findSuppressedRecipients(recipientList);
  const suppressedSet = new Set(
    suppressedRows.map((item) => normalizeEmailAddress(item?.email || "")).filter(Boolean)
  );
  const deliverableRecipients = recipientList.filter((email) => !suppressedSet.has(email));
  const normalizedBatchSize = toBoundedInt(batchSize, 40, 1, 200);
  const normalizedAttachments = normalizeAttachments(attachments);
  const normalizedHeaders = normalizeResendHeaders(headers);
  const normalizedTags = normalizeResendTags(tags);
  const normalizedScheduledAt = normalizeScheduledAt(scheduledAt);
  const normalizedTopicId = normalizeTopicId(topicId);
  const normalizedIdempotencyKey = normalizeIdempotencyKey(idempotencyKey || "");
  const normalizedStrategy = String(strategy || "per-recipient").trim().toLowerCase();
  const normalizedFrom = normalizeFromAddress(from || env.EMAIL_FROM);
  const resendBatchEnabled = asBoolean(env.RESEND_BATCH_ENABLED, true);

  const canUseResendBatchApi =
    mode === "resend" &&
    resendBatchEnabled &&
    normalizedStrategy === "per-recipient" &&
    normalizedAttachments.length === 0 &&
    !normalizedScheduledAt &&
    !personalizer;

  const effectiveBatchSize = canUseResendBatchApi
    ? Math.min(normalizedBatchSize, 100)
    : normalizedBatchSize;
  const batches = chunk(deliverableRecipients, effectiveBatchSize);
  const failures = [];
  const messageIds = [];
  let sentCount = 0;
  let batchesSucceeded = 0;
  let attemptedCursor = 0;

  const ccList = toAddressList(cc);
  const bccList = toAddressList(bcc);
  const replyToList = toAddressList(replyTo);
  validateAddressList(ccList, "cc");
  validateAddressList(bccList, "bcc");
  validateAddressList(replyToList, "replyTo");

  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index];
    let batchHadFailure = false;

    if (canUseResendBatchApi) {
      const batchPayload = batch.map((recipient) => {
        const ccFiltered = ccList.filter((email) => email !== recipient);
        const ccSet = new Set(ccFiltered);
        const bccFiltered = bccList.filter((email) => email !== recipient && !ccSet.has(email));
        const item = {
          from: normalizedFrom,
          to: [recipient],
          subject: cleanSubject
        };
        if (ccFiltered.length > 0) item.cc = ccFiltered;
        if (bccFiltered.length > 0) item.bcc = bccFiltered;
        if (replyToList.length > 0) {
          item.reply_to = replyToList.length === 1 ? replyToList[0] : replyToList;
        }
        if (Object.keys(normalizedHeaders).length > 0) item.headers = normalizedHeaders;
        if (normalizedTags.length > 0) item.tags = normalizedTags;
        if (normalizedTopicId) item.topic_id = normalizedTopicId;
        if (html) item.html = html;
        if (text) item.text = text;
        if (!item.html && !item.text) item.text = " ";
        return item;
      });

      try {
        const result = await sendResendRequest({
          endpointPath: "/emails/batch",
          idempotencyKey: buildScopedIdempotencyKey(
            normalizedIdempotencyKey,
            `batch-${index + 1}`
          ),
          body: batchPayload
        });
        sentCount += batch.length;
        if (Array.isArray(result.messageIds) && result.messageIds.length > 0) {
          messageIds.push(...result.messageIds.map((id) => String(id)));
        }
      } catch (error) {
        batchHadFailure = true;
        failures.push({
          batch: index + 1,
          recipients: batch,
          code: String(error?.code || "EMAIL_SEND_FAILED"),
          message: String(error?.message || "Email send failed.")
        });
      }
      if (!batchHadFailure) {
        batchesSucceeded += 1;
      }
      continue;
    }

    if (normalizedStrategy === "bcc-batch") {
      const to = batch[0];
      const batchBcc = dedupeList([...(batch.slice(1) || []), ...bccList]);
      try {
        const result = await sendTransactionalEmail({
          from: normalizedFrom,
          to,
          cc,
          bcc: batchBcc.length > 0 ? batchBcc : undefined,
          replyTo,
          subject: cleanSubject,
          text,
          html,
          attachments: normalizedAttachments,
          headers: normalizedHeaders,
          tags: normalizedTags,
          topicId: normalizedTopicId,
          scheduledAt: normalizedScheduledAt,
          idempotencyKey: buildScopedIdempotencyKey(
            normalizedIdempotencyKey,
            `bcc-batch-${index + 1}`
          ),
          modeOverride: mode
        });
        sentCount += batch.length;
        if (result?.messageId) messageIds.push(String(result.messageId));
      } catch (error) {
        batchHadFailure = true;
        failures.push({
          batch: index + 1,
          recipients: batch,
          code: String(error?.code || "EMAIL_SEND_FAILED"),
          message: String(error?.message || "Email send failed.")
        });
      }
    } else {
      for (const recipient of batch) {
        attemptedCursor += 1;
        const personalized = typeof personalizer === "function" ? personalizer(recipient) : null;
        try {
          const result = await sendTransactionalEmail({
            from: normalizedFrom,
            to: recipient,
            cc,
            bcc,
            replyTo,
            subject: cleanSubject,
            text: personalized?.text || text,
            html: personalized?.html || html,
            attachments: normalizedAttachments,
            headers: personalized?.headers
              ? normalizeResendHeaders({ ...normalizedHeaders, ...personalized.headers })
              : normalizedHeaders,
            tags: normalizedTags,
            topicId: normalizedTopicId,
            scheduledAt: normalizedScheduledAt,
            idempotencyKey: buildScopedIdempotencyKey(
              normalizedIdempotencyKey,
              `recipient-${attemptedCursor}`
            ),
            modeOverride: mode
          });
          sentCount += 1;
          if (result?.messageId) messageIds.push(String(result.messageId));
        } catch (error) {
          batchHadFailure = true;
          failures.push({
            batch: index + 1,
            recipients: [recipient],
            code: String(error?.code || "EMAIL_SEND_FAILED"),
            message: String(error?.message || "Email send failed.")
          });
        }
      }
    }

    if (!batchHadFailure) {
      batchesSucceeded += 1;
    }
  }

  return {
    ok: failures.length === 0 && suppressedSet.size === 0,
    attemptedCount: recipientList.length,
    sentCount,
    failedCount: Math.max(0, recipientList.length - sentCount),
    suppressedCount: suppressedSet.size,
    suppressedRecipients: [...suppressedSet].slice(0, 100),
    batchesAttempted: batches.length,
    batchesSucceeded,
    batchesFailed: Math.max(0, batches.length - batchesSucceeded),
    messageIds,
    failures
  };
}

export async function sendInviteEmail({
  tenant,
  email,
  token,
  roleToAssign,
  expiresAt,
  replyTo = "",
  customSubject = "",
  customMessage = "",
  firstName = "",
  lastName = ""
}) {
  const branding = buildTenantEmailBranding(tenant);
  const mergeTagValues = {
    firstName: String(firstName || "").trim() || "there",
    lastName: String(lastName || "").trim(),
    networkName: String(branding.networkName || tenant?.name || tenant?.slug || "").trim()
  };
  const applyInviteMergeTags = (value = "") =>
    String(value || "").replace(/\{\{(firstName|lastName|networkName)\}\}/g, (_match, key) =>
      mergeTagValues[key] || ""
    );
  const resolvedReplyTo = isValidEmailAddress(replyTo)
    ? normalizeEmailAddress(replyTo)
    : branding.replyTo;
  const link = inviteLink({ tenant, token, email });
  const { subject, text, html } = inviteTemplate({
    tenantName: branding.networkName,
    link,
    roleToAssign,
    expiresAt,
    customSubject: applyInviteMergeTags(customSubject),
    customMessage: applyInviteMergeTags(customMessage),
    firstName,
    lastName,
    brandPrimary: branding.brandPrimary,
    logoUrl: branding.logoUrl
  });

  return sendTransactionalEmail({
    from: branding.from,
    to: email,
    ...(resolvedReplyTo ? { replyTo: resolvedReplyTo } : {}),
    subject,
    text,
    html,
    idempotencyKey: buildScopedIdempotencyKey(`invite/${tenant.slug}`, token),
    tags: [
      { name: "category", value: "invite" },
      { name: "tenant", value: tenant.slug || "tenant" }
    ]
  });
}

export async function sendMagicLinkEmail({ tenant, email, token, expiresAt }) {
  const branding = buildTenantEmailBranding(tenant);
  const link = magicLink({ tenant, token });
  const { subject, text, html } = magicLinkTemplate({
    tenantName: branding.networkName,
    link,
    expiresAt,
    brandPrimary: branding.brandPrimary,
    logoUrl: branding.logoUrl
  });

  return sendTransactionalEmail({
    from: branding.from,
    to: email,
    ...(branding.replyTo ? { replyTo: branding.replyTo } : {}),
    subject,
    text,
    html,
    idempotencyKey: buildScopedIdempotencyKey(`magic-link/${tenant.slug}`, token),
    tags: [
      { name: "category", value: "magic_link" },
      { name: "tenant", value: tenant.slug || "tenant" }
    ]
  });
}

export async function sendWelcomeEmail({ tenant, firstName, email }) {
  const branding = buildTenantEmailBranding(tenant);
  const { subject, text, html } = welcomeTemplate({
    tenantName: branding.networkName,
    firstName,
    brandPrimary: branding.brandPrimary,
    logoUrl: branding.logoUrl
  });

  return sendTransactionalEmail({
    from: branding.from,
    to: email,
    ...(branding.replyTo ? { replyTo: branding.replyTo } : {}),
    subject,
    text,
    html,
    idempotencyKey: buildScopedIdempotencyKey(`welcome/${tenant.slug}`, email),
    tags: [
      { name: "category", value: "welcome" },
      { name: "tenant", value: tenant.slug || "tenant" }
    ]
  });
}

export async function sendVerificationCodeEmail({
  tenant = null,
  email,
  code,
  audience = "member",
  requestIp = "",
  requestedAt = null,
  idempotencyKey = ""
}) {
  const normalizedAudience = String(audience || "member").trim().toLowerCase();
  const useSystemBranding = normalizedAudience === "director" || !tenant;
  const branding = useSystemBranding
    ? buildPondBridgeEmailBranding()
    : buildTenantEmailBranding(tenant);
  const { subject, text, html } = verificationCodeTemplate({
    brandName: branding.networkName,
    code,
    audience: normalizedAudience,
    requestIp,
    requestedAt,
    brandPrimary: branding.brandPrimary,
    logoUrl: branding.logoUrl
  });

  return sendTransactionalEmail({
    from: branding.from,
    to: email,
    ...(branding.replyTo ? { replyTo: branding.replyTo } : {}),
    subject,
    text,
    html,
    idempotencyKey,
    tags: [
      { name: "category", value: "clerk_verification_code" },
      { name: "audience", value: normalizedAudience || "member" },
      ...(tenant?.slug ? [{ name: "tenant", value: String(tenant.slug) }] : [])
    ]
  });
}

export async function sendPasswordResetCodeEmail({
  tenant = null,
  email,
  code,
  requestIp = "",
  requestedAt = null,
  idempotencyKey = ""
}) {
  // A reset always belongs to an existing member, so brand it for their camp
  // whenever the tenant resolved; fall back to PondBridge only if it did not.
  const branding = tenant ? buildTenantEmailBranding(tenant) : buildPondBridgeEmailBranding();
  const { subject, text, html } = passwordResetCodeTemplate({
    brandName: branding.networkName,
    code,
    requestIp,
    requestedAt,
    brandPrimary: branding.brandPrimary,
    logoUrl: branding.logoUrl
  });

  return sendTransactionalEmail({
    from: branding.from,
    to: email,
    ...(branding.replyTo ? { replyTo: branding.replyTo } : {}),
    subject,
    text,
    html,
    idempotencyKey,
    tags: [
      { name: "category", value: "clerk_password_reset_code" },
      ...(tenant?.slug ? [{ name: "tenant", value: String(tenant.slug) }] : [])
    ]
  });
}

export async function sendAccessDecisionEmail({ tenant, email, firstName, approved, reason, loginUrl }) {
  const branding = buildTenantEmailBranding(tenant);
  if (approved) {
    const resolvedLoginUrl = loginUrl || `${resolveTenantAppBaseUrl({ tenant })}/login`;
    const { subject, text, html } = accessApprovedTemplate({
      tenantName: branding.networkName,
      firstName,
      loginUrl: resolvedLoginUrl
    });
    return sendTransactionalEmail({
      from: branding.from,
      to: email,
      ...(branding.replyTo ? { replyTo: branding.replyTo } : {}),
      subject,
      text,
      html,
      tags: [
        { name: "category", value: "access_approved" },
        { name: "tenant", value: tenant.slug || "tenant" }
      ]
    });
  }

  const { subject, text, html } = accessDeniedTemplate({
    tenantName: branding.networkName,
    firstName,
    reason
  });
  return sendTransactionalEmail({
    from: branding.from,
    to: email,
    ...(branding.replyTo ? { replyTo: branding.replyTo } : {}),
    subject,
    text,
    html,
    tags: [
      { name: "category", value: "access_denied" },
      { name: "tenant", value: tenant.slug || "tenant" }
    ]
  });
}
