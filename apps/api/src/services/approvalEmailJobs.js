import { env } from "../config/env.js";
import { AccessRequestModel, UserModel } from "../db/models/index.js";
import {
  buildAccessApprovalEmail,
  buildAccessConsentPendingEmail,
  sendTransactionalEmail
} from "./email.js";
import { recoveredRequestRequiresConsent } from "./signupRecoveryConsent.js";
import {
  jobError,
  jobFingerprint,
  readJobByKey,
  registerJobHandler,
  saveJob
} from "./durableJobs.js";

export const APPROVAL_EMAIL_JOB_KIND = "approval_email";

export function approvalEmailJobKey(requestId = "", phase = "active") {
  const normalizedRequestId = String(requestId || "").trim();
  return phase === "consent_pending"
    ? `access-preapproval/${normalizedRequestId}`
    : `access-approval/${normalizedRequestId}`;
}

export function approvalPreapprovalEmailJobKey(requestId = "") {
  return approvalEmailJobKey(requestId, "consent_pending");
}

function sameInstant(left, right) {
  const leftMs = Date.parse(String(left || ""));
  const rightMs = Date.parse(String(right || ""));
  return Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs === rightMs;
}

function isMatchingConsentPendingRequest(request, payload, { email, recoveredClerkUserId }) {
  const recoveryClerkUserId = String(request?.profilePayload?.socials?.signupRecovery?.clerkUserId || "").trim();
  return request?.status === "pending"
    && String(request?.email || "").trim().toLowerCase() === email
    && String(request?.recoveredClerkUserId || "").trim() === recoveredClerkUserId
    && recoveryClerkUserId === recoveredClerkUserId
    && Boolean(String(request?.directorApprovedByUserId || "").trim())
    && sameInstant(request?.directorApprovedAt, payload?.directorApprovedAt)
    && recoveredRequestRequiresConsent(request);
}

function retryableProviderFailure(error = {}) {
  const code = String(error?.code || "");
  if (["EMAIL_PROVIDER_TEMPORARY", "EMAIL_SUPPRESSION_UNAVAILABLE"].includes(code)) return true;
  if (["EMAIL_PROVIDER_REJECTED", "INVALID_EMAIL_ADDRESS", "RECIPIENT_REQUIRED"].includes(code)) return false;
  return !error?.statusCode || error.statusCode === 429 || error.statusCode >= 500;
}

function transportFingerprint(message = {}) {
  return jobFingerprint({
    version: 1,
    mode: String(env.EMAIL_MODE || "mock"),
    providerEndpoint: String(env.RESEND_API_BASE_URL || ""),
    providerAccount: String(env.RESEND_API_KEY || ""),
    from: message.from
  });
}

function terminalState(job, code) {
  return {
    cursor: 1,
    state: {
      accepted: Number(job.state?.accepted || 0),
      skipped: 1,
      outcome: code
    }
  };
}

export async function processApprovalEmailJob(job, { tenant }) {
  const payload = job.payload || {};
  const phase = String(payload.phase || "active").trim();
  const requestId = String(payload.requestId || "").trim();
  const approvedUserId = String(payload.approvedUserId || "").trim();
  const recoveredClerkUserId = String(payload.recoveredClerkUserId || "").trim();
  const email = String(payload.email || "").trim().toLowerCase();
  const consentPending = phase === "consent_pending";
  if (!requestId || !email || job.total !== 1
    || (consentPending && (!recoveredClerkUserId || !payload.directorApprovedAt))
    || (!consentPending && (phase !== "active" || !approvedUserId))) {
    throw jobError("APPROVAL_EMAIL_PAYLOAD_INVALID");
  }

  const request = await AccessRequestModel.findOne(job.tenant_id, { _id: requestId });
  if (tenant.status !== "active") return terminalState(job, "TENANT_INACTIVE");
  if (consentPending) {
    if (!isMatchingConsentPendingRequest(request, payload, { email, recoveredClerkUserId })) {
      return terminalState(job, "PREAPPROVAL_NO_LONGER_CURRENT");
    }
  } else {
    const user = await UserModel.findOne(job.tenant_id, { _id: approvedUserId });
    if (!request || request.status !== "approved" || String(request.approvedUserId || "") !== approvedUserId) {
      return terminalState(job, "APPROVAL_NO_LONGER_CURRENT");
    }
    if (!user || user.status !== "active" || String(user.email || "").trim().toLowerCase() !== email) {
      return terminalState(job, "APPROVED_MEMBER_NO_LONGER_ACTIVE");
    }
  }
  if (!['mock', 'resend'].includes(String(env.EMAIL_MODE || "mock"))) {
    throw jobError("APPROVAL_EMAIL_DURABLE_TRANSPORT_UNSUPPORTED");
  }

  let prepared = job.state?.prepared;
  if (!prepared) {
    const message = (consentPending ? buildAccessConsentPendingEmail : buildAccessApprovalEmail)({
      tenant,
      email,
      firstName: String(payload.firstName || "").trim()
    });
    prepared = {
      ...message,
      transport: transportFingerprint(message),
      idempotencyKey: approvalEmailJobKey(requestId, phase)
    };
    if (Buffer.byteLength(JSON.stringify(prepared), "utf8") > 250_000) {
      throw jobError("APPROVAL_EMAIL_CONTENT_TOO_LARGE");
    }
    await saveJob(job, { state: { ...job.state, prepared } });
  } else if (prepared.transport !== transportFingerprint(prepared)) {
    throw jobError("APPROVAL_EMAIL_TRANSPORT_CHANGED_REVIEW_REQUIRED");
  }

  if (job.leaseLost) throw jobError("JOB_LEASE_LOST");
  try {
    const result = await sendTransactionalEmail({
      from: prepared.from,
      to: prepared.to,
      replyTo: prepared.replyTo,
      subject: prepared.subject,
      text: prepared.text,
      html: prepared.html,
      tags: prepared.tags,
      idempotencyKey: prepared.idempotencyKey,
      suppressionFailClosed: true
    });
    if (!String(result?.messageId || "").trim()) {
      throw Object.assign(new Error("Provider acceptance did not include a message ID."), {
        code: "APPROVAL_EMAIL_ACCEPTANCE_UNCERTAIN",
        statusCode: 503
      });
    }
    return {
      cursor: 1,
      state: {
        accepted: 1,
        skipped: 0,
        outcome: "provider_accepted",
        providerMessageId: String(result?.messageId || "")
      }
    };
  } catch (error) {
    if (error?.code === "RECIPIENT_SUPPRESSED") {
      throw jobError("APPROVAL_EMAIL_RECIPIENT_SUPPRESSED");
    }
    throw jobError("APPROVAL_EMAIL_PROVIDER_UNAVAILABLE", retryableProviderFailure(error));
  }
}

export async function hasDurableApprovalEmailIntent(tenantId, requestId, phase = "active") {
  return Boolean(await readJobByKey(tenantId, APPROVAL_EMAIL_JOB_KIND, approvalEmailJobKey(requestId, phase)));
}

export async function readApprovalEmailIntent(tenantId, requestId, phase = "active") {
  return readJobByKey(tenantId, APPROVAL_EMAIL_JOB_KIND, approvalEmailJobKey(requestId, phase));
}

export async function readPreapprovalEmailIntent(tenantId, requestId) {
  return readApprovalEmailIntent(tenantId, requestId, "consent_pending");
}

registerJobHandler(APPROVAL_EMAIL_JOB_KIND, processApprovalEmailJob);
