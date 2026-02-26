import nodemailer from "nodemailer";
import { env } from "../config/env.js";
import {
  inviteTemplate,
  magicLinkTemplate,
  welcomeTemplate,
  accessApprovedTemplate,
  accessDeniedTemplate
} from "./emailTemplates.js";

let transport = null;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESEND_TRANSIENT_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);
const RESEND_TRANSIENT_ERROR_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN", "ENOTFOUND"]);

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
    replyTo: replyToList[0] || ""
  };
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
        content
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
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${env.RESEND_API_BASE_URL}/emails`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      const responseBody = await response.json().catch(() => ({}));
      if (response.ok) {
        return {
          ok: true,
          messageId: String(responseBody?.id || ""),
          responseBody
        };
      }

      const message = String(
        responseBody?.message || responseBody?.name || responseBody?.error?.message || ""
      ).trim();
      const code = String(responseBody?.error?.code || responseBody?.code || "").trim().toUpperCase();
      const retryable = shouldRetryResend(response.status, code);

      const error = createEmailError(
        `Resend email send failed (${response.status}): ${message || "Unknown API error."}`,
        retryable ? "EMAIL_PROVIDER_TEMPORARY" : "EMAIL_PROVIDER_REJECTED",
        retryable ? 503 : 502,
        { status: response.status, code, retryable }
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

async function sendResendEmail({ to, cc, bcc, replyTo, subject, text, html, attachments }) {
  ensureConfiguredForMode("resend");

  const normalized = normalizeRecipients({ to, cc, bcc, replyTo });
  const normalizedAttachments = normalizeAttachments(attachments);
  if (normalized.to.length === 0) {
    throw createEmailError("Missing recipient email address.", "RECIPIENT_REQUIRED", 400);
  }
  const cleanSubject = String(subject || "").trim();
  if (!cleanSubject) {
    throw createEmailError("Email subject is required.", "EMAIL_SUBJECT_REQUIRED", 400);
  }

  const payload = {
    from: env.EMAIL_FROM,
    to: normalized.to,
    subject: cleanSubject
  };

  if (normalized.cc.length > 0) payload.cc = normalized.cc;
  if (normalized.bcc.length > 0) payload.bcc = normalized.bcc;
  if (normalized.replyTo) payload.reply_to = normalized.replyTo;
  if (html) payload.html = html;
  if (text) payload.text = text;
  if (!payload.html && !payload.text) payload.text = " ";
  if (normalizedAttachments.length > 0) {
    payload.attachments = normalizedAttachments.map((item) => ({
      filename: item.filename,
      content: item.content.toString("base64")
    }));
  }

  const result = await sendResendRequest(payload);

  return { ok: true, mode: "resend", messageId: String(result.messageId || "") };
}

async function sendSmtpEmail({ to, cc, bcc, replyTo, subject, text, html, attachments }) {
  ensureConfiguredForMode("smtp");
  const normalized = normalizeRecipients({ to, cc, bcc, replyTo });
  const normalizedAttachments = normalizeAttachments(attachments);
  if (normalized.to.length === 0) {
    throw createEmailError("Missing recipient email address.", "RECIPIENT_REQUIRED", 400);
  }

  const cleanSubject = String(subject || "").trim();
  if (!cleanSubject) {
    throw createEmailError("Email subject is required.", "EMAIL_SUBJECT_REQUIRED", 400);
  }

  const result = await getTransport().sendMail({
    from: env.EMAIL_FROM,
    to: normalized.to,
    cc: normalized.cc.length > 0 ? normalized.cc : undefined,
    bcc: normalized.bcc.length > 0 ? normalized.bcc : undefined,
    replyTo: normalized.replyTo || undefined,
    subject: cleanSubject,
    text,
    html,
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

export function inviteLink({ tenantSlug, token, email }) {
  return `${env.FRONTEND_ORIGIN}/t/${tenantSlug}/create-account?inviteToken=${encodeURIComponent(
    token
  )}&email=${encodeURIComponent(email)}`;
}

export function magicLink({ tenantSlug, token }) {
  return `${env.FRONTEND_ORIGIN}/t/${tenantSlug}/login?magicToken=${encodeURIComponent(token)}`;
}

export async function sendTransactionalEmail({
  to,
  cc,
  bcc,
  replyTo,
  subject,
  text,
  html,
  attachments,
  modeOverride = ""
}) {
  const mode = String(modeOverride || getEmailMode()).trim().toLowerCase();
  assertEmailMode(mode);

  if (mode === "mock") {
    const normalized = normalizeRecipients({ to, cc, bcc, replyTo });
    if (normalized.to.length === 0) {
      throw createEmailError("Missing recipient email address.", "RECIPIENT_REQUIRED", 400);
    }
    const cleanSubject = String(subject || "").trim();
    if (!cleanSubject) {
      throw createEmailError("Email subject is required.", "EMAIL_SUBJECT_REQUIRED", 400);
    }
    console.log("[email:mock]", {
      to: normalized.to,
      cc: normalized.cc,
      bcc: normalized.bcc,
      subject: cleanSubject,
      attachments: normalizeAttachments(attachments).map((item) => item.filename)
    });
    return { ok: true, mode: "mock", messageId: "mock-message" };
  }

  if (mode === "resend") {
    return sendResendEmail({ to, cc, bcc, replyTo, subject, text, html, attachments });
  }

  if (mode === "smtp") {
    return sendSmtpEmail({ to, cc, bcc, replyTo, subject, text, html, attachments });
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
  recipients = [],
  cc,
  bcc,
  replyTo,
  subject,
  text,
  html,
  attachments,
  modeOverride = "",
  strategy = "per-recipient",
  batchSize = env.EMAIL_BROADCAST_BATCH_SIZE,
  maxRecipients = env.EMAIL_BROADCAST_MAX_RECIPIENTS
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

  const normalizedBatchSize = toBoundedInt(batchSize, 40, 1, 200);
  const batches = chunk(recipientList, normalizedBatchSize);
  const normalizedStrategy = String(strategy || "per-recipient").trim().toLowerCase();
  const failures = [];
  const messageIds = [];
  let sentCount = 0;
  let batchesSucceeded = 0;

  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index];
    let batchHadFailure = false;

    if (normalizedStrategy === "bcc-batch") {
      const to = batch[0];
      const batchBcc = dedupeList([...(batch.slice(1) || []), ...toAddressList(bcc)]);
      try {
        const result = await sendTransactionalEmail({
          to,
          cc,
          bcc: batchBcc.length > 0 ? batchBcc : undefined,
          replyTo,
          subject,
          text,
          html,
          attachments,
          modeOverride
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
        try {
          const result = await sendTransactionalEmail({
            to: recipient,
            cc,
            bcc,
            replyTo,
            subject,
            text,
            html,
            attachments,
            modeOverride
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
    ok: failures.length === 0,
    attemptedCount: recipientList.length,
    sentCount,
    failedCount: Math.max(0, recipientList.length - sentCount),
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
  firstName = "",
  lastName = ""
}) {
  const link = inviteLink({ tenantSlug: tenant.slug, token, email });
  const { subject, text, html } = inviteTemplate({
    tenantName: tenant.name,
    link,
    roleToAssign,
    expiresAt,
    firstName,
    lastName
  });

  return sendTransactionalEmail({ to: email, subject, text, html });
}

export async function sendMagicLinkEmail({ tenant, email, token, expiresAt }) {
  const link = magicLink({ tenantSlug: tenant.slug, token });
  const { subject, text, html } = magicLinkTemplate({
    tenantName: tenant.name,
    link,
    expiresAt
  });

  return sendTransactionalEmail({ to: email, subject, text, html });
}

export async function sendWelcomeEmail({ tenant, firstName, email }) {
  const { subject, text, html } = welcomeTemplate({
    tenantName: tenant.name,
    firstName
  });

  return sendTransactionalEmail({ to: email, subject, text, html });
}

export async function sendAccessDecisionEmail({ tenant, email, firstName, approved, reason, loginUrl }) {
  if (approved) {
    const resolvedLoginUrl = loginUrl || `${env.FRONTEND_ORIGIN}/t/${tenant.slug}/login`;
    const { subject, text, html } = accessApprovedTemplate({
      tenantName: tenant.name,
      firstName,
      loginUrl: resolvedLoginUrl
    });
    return sendTransactionalEmail({ to: email, subject, text, html });
  }

  const { subject, text, html } = accessDeniedTemplate({
    tenantName: tenant.name,
    firstName,
    reason
  });
  return sendTransactionalEmail({ to: email, subject, text, html });
}
