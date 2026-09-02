import { createClerkClient } from "@clerk/backend";
import { verifyWebhook } from "@clerk/backend/webhooks";
import { env } from "../config/env.js";
import {
  AccessRequestModel,
  InviteModel,
  TenantModel,
  UserModel
} from "../db/models/index.js";
import {
  sendPasswordChangedEmail,
  sendPasswordResetCodeEmail,
  sendRelayedClerkEmail,
  sendVerificationCodeEmail
} from "./email.js";
import { logLine } from "./logger.js";
import { recallSignupIntent } from "./signupIntent.js";

const RESERVED_SUBDOMAINS = new Set(["www", "app", "api", "super"]);
const recentVerificationDispatches = new Map();
const RECENT_VERIFICATION_TTL_MS = 15 * 60 * 1000;
const clerkClient = env.CLERK_SECRET_KEY
  ? createClerkClient({ secretKey: env.CLERK_SECRET_KEY })
  : null;

function createWebhookError(message, statusCode = 400, code = "CLERK_WEBHOOK_INVALID") {
  const error = new Error(String(message || "Invalid Clerk webhook request."));
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function normalizeEmail(value = "") {
  return String(value || "").trim().toLowerCase();
}

function normalizeSlug(value = "") {
  return String(value || "").trim().toLowerCase();
}

function safeString(value = "") {
  return String(value || "").trim();
}

function nowMs() {
  return Date.now();
}

function cleanupRecentDispatches(now = nowMs()) {
  for (const [key, expiresAt] of recentVerificationDispatches.entries()) {
    if (Number(expiresAt || 0) <= now) recentVerificationDispatches.delete(key);
  }
}

function hasRecentDispatch(key = "", now = nowMs()) {
  cleanupRecentDispatches(now);
  const expiresAt = Number(recentVerificationDispatches.get(key) || 0);
  return expiresAt > now;
}

function markRecentDispatch(key = "", now = nowMs()) {
  if (!key) return;
  recentVerificationDispatches.set(key, now + RECENT_VERIFICATION_TTL_MS);
}

// Clerk can raise several verification.code_sent events for a single signup,
// each with its own code, and preparing a new code invalidates the previous
// one. Sending every event mails the user codes that are already dead. Hold a
// send briefly instead and mail only the newest code of a burst, so one signup
// produces one usable email.
const VERIFICATION_COLLAPSE_MS = 3000;
const pendingVerificationSends = new Map();

// Clerk names the template in `slug` (verification_code, reset_password_code,
// password_changed, ...). Classify rather than special-case, so switching off
// Clerk delivery for a template we have not designed for still sends
// something instead of silently sending nothing.
const CLERK_EMAIL_KIND = {
  VERIFICATION_CODE: "verification_code",
  PASSWORD_RESET_CODE: "password_reset_code",
  PASSWORD_CHANGED: "password_changed",
  RELAY: "relay"
};

export function classifyClerkEmail(emailResource = {}, { hasOtpCode = false } = {}) {
  const slug = safeString(emailResource?.slug).toLowerCase();
  // Order matters: reset_password_code contains "password" too.
  if (slug.includes("reset") && slug.includes("password")) return CLERK_EMAIL_KIND.PASSWORD_RESET_CODE;
  // Only an actual change gets the bespoke notice. Anything else about a
  // password (removal, for instance) relays Clerk's own accurate wording.
  if (slug.includes("password") && slug.includes("changed")) return CLERK_EMAIL_KIND.PASSWORD_CHANGED;
  if (hasOtpCode) return CLERK_EMAIL_KIND.VERIFICATION_CODE;
  return CLERK_EMAIL_KIND.RELAY;
}

function verificationCollapseKey(recipientEmail = "") {
  return normalizeEmail(recipientEmail);
}

function scheduleVerificationSend(request = {}) {
  const base = verificationCollapseKey(request.recipientEmail);
  if (!base) return false;
  // Scope the key by kind so a password-change notice cannot supersede a
  // verification code that is still waiting, or vice versa.
  const key = `${base}/${request.kind || "verification_code"}`;

  const existing = pendingVerificationSends.get(key);
  if (existing && request.collapsible !== false) {
    // A newer code supersedes the one still waiting. Clerk has already
    // invalidated the older one, so the newest is the only sendable code.
    existing.request = request;
    logLine("info", "clerk.verification.superseded", {
      emailId: request.emailId,
      supersededEmailId: existing.request?.emailId || ""
    });
    return true;
  }

  const entry = { request, timer: null };
  if (existing) {
    // Non-collapsible: let the queued one stand and send this separately.
    pendingVerificationSends.delete(key);
  }
  entry.timer = setTimeout(() => {
    pendingVerificationSends.delete(key);
    const pending = entry.request;
    logLine("info", "clerk.verification.dispatch", {
      emailId: pending.emailId,
      signUpAttemptId: pending.signUpAttemptId,
      audience: pending.audience,
      tenantSlug: pending.tenantSlug || "none",
      kind: pending.kind
    });
    const senders = {
      [CLERK_EMAIL_KIND.VERIFICATION_CODE]: sendVerificationCodeEmail,
      [CLERK_EMAIL_KIND.PASSWORD_RESET_CODE]: sendPasswordResetCodeEmail,
      [CLERK_EMAIL_KIND.PASSWORD_CHANGED]: sendPasswordChangedEmail,
      [CLERK_EMAIL_KIND.RELAY]: sendRelayedClerkEmail
    };
    const send = senders[pending.kind] || sendVerificationCodeEmail;
    Promise.resolve(send(pending.send)).catch((error) => {
      logLine("error", "clerk.verification.dispatch_failed", {
        emailId: pending.emailId,
        message: String(error?.message || error)
      });
    });
  }, VERIFICATION_COLLAPSE_MS);

  pendingVerificationSends.set(key, entry);
  return false;
}

function verificationDispatchFingerprint({ recipientEmail = "", otpCode = "", audience = "", tenantSlug = "" } = {}) {
  return [
    "clerk-verification",
    normalizeEmail(recipientEmail),
    safeString(otpCode),
    safeString(audience).toLowerCase(),
    normalizeSlug(tenantSlug)
  ].filter(Boolean).join("/");
}

function requestBodyText(req) {
  if (Buffer.isBuffer(req.body)) return req.body.toString("utf8");
  if (typeof req.body === "string") return req.body;
  return JSON.stringify(req.body || {});
}

function requestHeaders(req) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers || {})) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item != null) headers.append(name, String(item));
      }
      continue;
    }
    if (value != null) headers.set(name, String(value));
  }
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  return headers;
}

async function verifyClerkWebhookRequest(req) {
  if (!env.CLERK_WEBHOOK_SIGNING_SECRET) {
    throw createWebhookError(
      "CLERK_WEBHOOK_SIGNING_SECRET is not configured.",
      500,
      "CLERK_WEBHOOK_CONFIG_MISSING"
    );
  }

  const request = new Request("https://pondbridge.internal/api/webhooks/clerk", {
    method: String(req.method || "POST").toUpperCase(),
    headers: requestHeaders(req),
    body: requestBodyText(req)
  });

  try {
    return await verifyWebhook(request, {
      signingSecret: env.CLERK_WEBHOOK_SIGNING_SECRET
    });
  } catch (error) {
    throw createWebhookError(
      String(error?.message || "Clerk webhook signature verification failed."),
      400,
      "CLERK_WEBHOOK_SIGNATURE_INVALID"
    );
  }
}

function recursiveStringValues(value, out = [], depth = 0) {
  if (depth > 5 || value == null) return out;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    const next = safeString(value);
    if (next) out.push(next);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) recursiveStringValues(item, out, depth + 1);
    return out;
  }
  if (typeof value === "object") {
    for (const item of Object.values(value)) recursiveStringValues(item, out, depth + 1);
  }
  return out;
}

function slugFromTenantHost(hostname = "") {
  const host = safeString(hostname).toLowerCase();
  if (!host) return "";

  // Clerk payloads may contain a production continuation URL while this
  // worker is running in staging or local development. Preserve that tenant
  // hint as well as recognizing the environment's active base domain.
  const baseDomains = new Set([
    safeString(env.APP_BASE_DOMAIN).toLowerCase(),
    "pondbridgealumni.com"
  ]);
  for (const baseDomain of baseDomains) {
    if (!baseDomain || !host.endsWith(`.${baseDomain}`)) continue;
    const candidate = host.slice(0, -1 * (baseDomain.length + 1)).split(".")[0] || "";
    const normalizedCandidate = normalizeSlug(candidate);
    if (!normalizedCandidate || RESERVED_SUBDOMAINS.has(normalizedCandidate)) return "";
    return normalizedCandidate;
  }
  return "";
}

export function extractVerificationRouteHint(value = "") {
  const raw = safeString(value);
  if (!raw) return null;

  let tenantSlug = "";
  let host = "";
  let audience = "";

  const directSlugMatch = raw.match(/\/t\/([a-z0-9-]+)(?:[/?#]|$)/i);
  if (directSlugMatch?.[1]) tenantSlug = normalizeSlug(directSlugMatch[1]);

  const fullUrlMatch = raw.match(/https?:\/\/[^\s"'<>]+/i);
  const urlCandidate = fullUrlMatch?.[0] || (raw.startsWith("http://") || raw.startsWith("https://") ? raw : "");
  if (urlCandidate) {
    try {
      const url = new URL(urlCandidate);
      host = safeString(url.hostname).toLowerCase();
      if (!tenantSlug) tenantSlug = slugFromTenantHost(url.hostname);
      const path = `${url.pathname}${url.search}`.toLowerCase();
      if (path.includes("/director-create-account")) audience = "director";
      else if (path.includes("/create-account")) audience = "member";
    } catch {
      // Ignore URL parse failures and continue with string heuristics.
    }
  }

  if (!host) {
    const hostMatch = raw.match(/([a-z0-9-]+\.[a-z0-9.-]+\.[a-z]{2,}|[a-z0-9-]+\.localhost)/i);
    if (hostMatch?.[1]) {
      host = safeString(hostMatch[1]).toLowerCase();
      if (!tenantSlug) tenantSlug = slugFromTenantHost(host);
    }
  }

  const lowered = raw.toLowerCase();
  if (!audience) {
    if (lowered.includes("/director-create-account")) audience = "director";
    else if (lowered.includes("/create-account")) audience = "member";
  }

  if (!tenantSlug && !host && !audience) return null;
  return { tenantSlug, host, audience };
}

function firstOtpCode(data = {}) {
  const candidates = [
    data?.otp_code,
    data?.otpCode,
    data?.verification_code,
    data?.verificationCode,
    data?.code
  ];
  for (const candidate of candidates) {
    const normalized = safeString(candidate);
    if (/^\d{4,8}$/.test(normalized)) return normalized;
  }
  return "";
}

function firstSignUpAttemptId(data = {}) {
  const candidates = [
    data?.sign_up_id,
    data?.signUpId,
    data?.signup_id,
    data?.signupId
  ];
  for (const candidate of candidates) {
    const normalized = safeString(candidate);
    if (normalized) return normalized;
  }
  return "";
}

export function extractVerificationSignUpHint(unsafeMetadata = {}) {
  const source = unsafeMetadata && typeof unsafeMetadata === "object" ? unsafeMetadata : {};
  const tenantSlug = normalizeSlug(
    source?.tenantSlug ||
    source?.tenant_slug ||
    source?.slug
  );
  const rawAudience = safeString(
    source?.signupAudience ||
    source?.signup_audience ||
    source?.audience
  ).toLowerCase();
  const audience = rawAudience === "director" ? "director" : rawAudience === "member" ? "member" : "";

  if (!tenantSlug && !audience) return null;
  return { tenantSlug, audience };
}

async function resolveSignUpAttemptHint(emailResource = {}) {
  const signUpAttemptId = firstSignUpAttemptId(emailResource?.data || {});
  if (!signUpAttemptId) {
    logLine("warn", "clerk.verification.hint_unavailable", { reason: "no_sign_up_id" });
    return null;
  }
  if (!clerkClient?.signUps?.get) {
    logLine("warn", "clerk.verification.hint_unavailable", { reason: "clerk_client_unavailable" });
    return null;
  }

  try {
    const signUpAttempt = await clerkClient.signUps.get(signUpAttemptId);
    const unsafeMetadata =
      signUpAttempt?.unsafeMetadata && typeof signUpAttempt.unsafeMetadata === "object"
        ? signUpAttempt.unsafeMetadata
        : {};
    const hint = extractVerificationSignUpHint(unsafeMetadata);
    if (!hint?.tenantSlug) {
      // The signup carried no tenant slug, so branding will fall back to
      // PondBridge. Record it rather than failing over in silence.
      logLine("warn", "clerk.verification.hint_missing_tenant", {
        signUpAttemptId,
        metadataKeys: Object.keys(unsafeMetadata).join(",") || "none"
      });
    }
    return hint;
  } catch (error) {
    logLine("error", "clerk.verification.hint_lookup_failed", {
      signUpAttemptId,
      message: String(error?.message || error)
    });
    return null;
  }
}

async function resolveEmailAssociationHint(recipientEmail = "") {
  const email = normalizeEmail(recipientEmail);
  if (!email) return null;

  const memberships = await UserModel.findMembershipsByEmail(email);
  const membershipTenantIds = [...new Set(
    (memberships || []).map((item) => safeString(item?.tenantId)).filter(Boolean)
  )];
  if (membershipTenantIds.length === 1) {
    const audience = (memberships || []).some((item) =>
      Array.isArray(item?.roles) && item.roles.includes("tenant_admin")
    )
      ? "director"
      : "member";
    return { tenantId: membershipTenantIds[0], audience };
  }

  const invites = await InviteModel.acrossTenants().find({ email, usedAt: null });
  const activeInvites = (invites || []).filter((invite) => {
    const expiresAt = invite?.expiresAt ? new Date(invite.expiresAt) : null;
    return !expiresAt || Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() > nowMs();
  });
  const inviteTenantIds = [...new Set(
    activeInvites.map((item) => safeString(item?.tenantId)).filter(Boolean)
  )];
  if (inviteTenantIds.length === 1) {
    const audience = activeInvites.some((item) => safeString(item?.roleToAssign) === "tenant_admin")
      ? "director"
      : "member";
    return { tenantId: inviteTenantIds[0], audience };
  }

  const pendingRequests = await AccessRequestModel.acrossTenants().find({ email, status: "pending" });
  const requestTenantIds = [...new Set(
    (pendingRequests || []).map((item) => safeString(item?.tenantId)).filter(Boolean)
  )];
  if (requestTenantIds.length === 1) {
    return { tenantId: requestTenantIds[0], audience: "member" };
  }

  return null;
}

async function resolveTenantFromHint(hint = {}) {
  const tenantSlug = normalizeSlug(hint?.tenantSlug);
  const host = safeString(hint?.host).toLowerCase();
  const tenantId = safeString(hint?.tenantId);
  if (tenantSlug) {
    const bySlug = await TenantModel.findBySlug(tenantSlug);
    if (bySlug) return bySlug;
  }
  if (host) {
    const byDomain = await TenantModel.findByDomain(host);
    if (byDomain) return byDomain;
  }
  if (tenantId) {
    const byId = await TenantModel.findById(tenantId);
    if (byId) return byId;
  }
  return null;
}

async function resolveVerificationContext(emailResource = {}) {
  // Clerk's payload has no tenant of its own, so the intent the signup flow
  // recorded against this address outranks everything we could infer.
  const intentHint = recallSignupIntent(emailResource?.to_email_address);
  if (intentHint?.tenantSlug) {
    const intentTenant = await resolveTenantFromHint(intentHint);
    if (intentTenant) {
      return {
        tenant: intentTenant,
        audience: intentHint.audience === "director" ? "director" : "member",
        source: "signup_intent"
      };
    }
    logLine("warn", "clerk.verification.intent_tenant_missing", { tenantSlug: intentHint.tenantSlug });
  }

  const signUpAttemptHint = await resolveSignUpAttemptHint(emailResource);
  const routeHints = recursiveStringValues({
    subject: emailResource?.subject,
    body: emailResource?.body,
    bodyPlain: emailResource?.body_plain,
    data: emailResource?.data
  })
    .map((value) => extractVerificationRouteHint(value))
    .filter(Boolean);
  const routeHint = routeHints.find((hint) => hint?.tenantSlug || hint?.host || hint?.audience) || null;
  const associationHint = await resolveEmailAssociationHint(emailResource?.to_email_address);

  const primaryHint = signUpAttemptHint || routeHint || associationHint || {};
  const secondaryHint = signUpAttemptHint ? {} : routeHint ? associationHint || {} : {};
  const primaryTenant = await resolveTenantFromHint(primaryHint);
  const secondaryTenant = primaryTenant ? null : await resolveTenantFromHint(secondaryHint);
  const tenant = primaryTenant || secondaryTenant;
  const audienceHint = signUpAttemptHint || primaryHint || secondaryHint || associationHint || {};
  const audience = safeString(audienceHint?.audience || "").toLowerCase() === "director"
    ? "director"
    : "member";
  const source = signUpAttemptHint
    ? "signup_attempt"
    : routeHint && primaryTenant
      ? "route"
      : associationHint && tenant
        ? "email_association"
        : "none";

  return { tenant, audience, source };
}

// An email address is a global identity, not tenant context. It can belong to
// Cedar today and be used to create a completely different camp tomorrow.
// Memberships, invites, and access requests are therefore useful fallbacks for
// account notices, but they must never choose the brand for a new-account OTP.
export function enforceVerificationBrandIsolation(context = {}, kind = "") {
  if (kind !== CLERK_EMAIL_KIND.VERIFICATION_CODE || context?.source !== "email_association") {
    return context;
  }
  return {
    ...context,
    tenant: null,
    audience: "member",
    source: "email_association_neutralized"
  };
}

export async function processClerkWebhookRequest(req) {
  const event = await verifyClerkWebhookRequest(req);
  if (event?.type !== "email.created") {
    return { ok: true, ignored: true, reason: "unsupported_event_type" };
  }

  const emailResource = event?.data || {};
  const recipientEmail = normalizeEmail(emailResource?.to_email_address || "");
  // Clerk sends no tenant of its own, so record what the payload does carry.
  // Logged before the OTP gate: a template that keys its code differently would
  // otherwise be dropped here with nothing to show why.
  logLine("info", "clerk.verification.payload_shape", {
    topLevelKeys: Object.keys(emailResource || {}).sort().join(","),
    dataKeys: Object.keys(emailResource?.data || {}).sort().join(","),
    userId: safeString(emailResource?.user_id) || "none",
    emailAddressId: safeString(emailResource?.email_address_id) || "none",
    slug: safeString(emailResource?.slug) || "none"
  });

  const otpCode = firstOtpCode(emailResource?.data || {});
  if (!recipientEmail) {
    return { ok: true, ignored: true, reason: "no_recipient" };
  }

  const kind = classifyClerkEmail(emailResource, { hasOtpCode: Boolean(otpCode) });
  const needsCode =
    kind === CLERK_EMAIL_KIND.VERIFICATION_CODE || kind === CLERK_EMAIL_KIND.PASSWORD_RESET_CODE;
  if (needsCode && !otpCode) {
    // Clerk is no longer delivering this template, so dropping it would leave
    // the member with no code at all. Record the keys it did send.
    logLine("error", "clerk.verification.code_missing", {
      slug: safeString(emailResource?.slug) || "none",
      kind,
      dataKeys: Object.keys(emailResource?.data || {}).sort().join(",")
    });
    return { ok: true, ignored: true, reason: "code_missing" };
  }
  if (kind === CLERK_EMAIL_KIND.RELAY) {
    logLine("warn", "clerk.verification.relaying_unknown_template", {
      slug: safeString(emailResource?.slug) || "none"
    });
  }

  const context = enforceVerificationBrandIsolation(
    await resolveVerificationContext(emailResource),
    kind
  );
  const signUpAttemptId = firstSignUpAttemptId(emailResource?.data || {});
  if (signUpAttemptId && context.audience !== "director" && !context.tenant) {
    throw createWebhookError(
      "Member verification email is missing tenant context.",
      503,
      "CLERK_VERIFICATION_TENANT_REQUIRED"
    );
  }
  const emailId = safeString(emailResource?.id);
  const dispatchKey = verificationDispatchFingerprint({
    recipientEmail,
    otpCode,
    audience: context.audience,
    tenantSlug: context?.tenant?.slug
  });
  if ((emailId && hasRecentDispatch(emailId)) || (dispatchKey && hasRecentDispatch(dispatchKey))) {
    return {
      ok: true,
      ignored: true,
      reason: "duplicate_recent_dispatch",
      emailId
    };
  }

  if (emailId) markRecentDispatch(emailId);
  if (dispatchKey) markRecentDispatch(dispatchKey);

  const requestIp = safeString(event?.event_attributes?.http_request?.client_ip);
  const sendPayload = needsCode
    ? {
        tenant: context.tenant,
        email: recipientEmail,
        code: otpCode,
        audience: context.audience,
        requestIp,
        requestedAt: new Date(),
        idempotencyKey: dispatchKey
      }
    : kind === CLERK_EMAIL_KIND.PASSWORD_CHANGED
      ? {
          tenant: context.tenant,
          email: recipientEmail,
          accountEmail: recipientEmail,
          idempotencyKey: dispatchKey
        }
      : {
          tenant: context.tenant,
          email: recipientEmail,
          subject: safeString(emailResource?.subject),
          html: String(emailResource?.body || ""),
          text: String(emailResource?.body_plain || ""),
          idempotencyKey: dispatchKey
        };

  const collapsed = scheduleVerificationSend({
    recipientEmail,
    audience: context.audience,
    tenantSlug: safeString(context?.tenant?.slug),
    emailId,
    signUpAttemptId,
    kind,
    // Only codes supersede one another. A notification is a distinct event and
    // must never be swallowed by a code burst.
    collapsible: needsCode,
    send: sendPayload
  });

  const result = { mode: collapsed ? "superseded" : "queued" };

  return {
    ok: true,
    delivered: true,
    emailId,
    audience: context.audience,
    tenantSlug: safeString(context?.tenant?.slug),
    mode: safeString(result?.mode)
  };
}
