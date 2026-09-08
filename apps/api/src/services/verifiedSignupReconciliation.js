import { createClerkClient } from "@clerk/backend";
import { SIGNUP_CONSENT_POLICY, validateSignupLegalAgreement } from "./signupConsentReceipts.js";
import { env } from "../config/env.js";
import { getSupabaseAdmin } from "../db/supabaseAdmin.js";
import { TenantModel, TenantAdminAuditLogModel } from "../db/models/index.js";
import { evaluateFeatureRollout } from "./featureRollouts.js";
import { resolveTenantAccessPolicy, isEmailAllowedByPolicy } from "./accessPolicy.js";

export const VERIFIED_SIGNUP_REVIEW_FLAG = "verified_signup_review_reconciliation_v1";
const TARGET_SLUG = "greenlane";
const PAGE_SIZE = 100;
const POLL_MS = 60_000;
const clerk = env.CLERK_SECRET_KEY ? createClerkClient({ secretKey: env.CLERK_SECRET_KEY }) : null;
let timer;
let active;
let stopped = true;
const normalize = (value) => String(value || "").trim();
const emailOf = (value) => normalize(value).toLowerCase();

// Only call with a fresh Clerk Backend API record; no HTTP body, OTP event,
// in-memory branding hint or unverified secondary address can supply identity.
export function verifiedMemberSignupCandidate(user = {}) {
  if (!normalize(user.id) || user.banned || user.locked) return null;
  const metadata = user.unsafeMetadata || {};
  if (normalize(metadata.tenantSlug).toLowerCase() !== TARGET_SLUG || metadata.signupAudience !== "member") return null;
  const primary = (user.emailAddresses || []).find((item) => item.id === user.primaryEmailAddressId);
  if (primary?.verification?.status !== "verified") return null;
  const email = emailOf(primary.emailAddress);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  const publicMetadata = user.publicMetadata || {};
  if (publicMetadata.tenantSlug && normalize(publicMetadata.tenantSlug).toLowerCase() !== TARGET_SLUG) return null;
  return { clerkUserId: normalize(user.id), email,
    firstName: normalize(user.firstName).slice(0, 100), lastName: normalize(user.lastName).slice(0, 100),
    claimedTenantId: normalize(publicMetadata.tenantId || publicMetadata.tenant_id || metadata.tenantId || metadata.tenant_id) };
}

async function enabledTenant() {
  const tenant = await TenantModel.findBySlug(TARGET_SLUG);
  if (!tenant || tenant.status !== "active" || !resolveTenantAccessPolicy(tenant).requireApproval) return null;
  const rollout = await evaluateFeatureRollout(VERIFIED_SIGNUP_REVIEW_FLAG, tenant);
  return rollout.enabled ? tenant : null;
}

async function reconcileRecord(user, tenant, source, apply = true) {
  const candidate = verifiedMemberSignupCandidate(user);
  if (!candidate) return { outcome: "ineligible_identity" };
  if (candidate.claimedTenantId && candidate.claimedTenantId !== String(tenant._id)) return { outcome: "conflicting_tenant" };
  if (!isEmailAllowedByPolicy(resolveTenantAccessPolicy(tenant), candidate.email)) return { outcome: "email_policy" };
  const { data, error } = await getSupabaseAdmin().rpc("reconcile_verified_signup_review", {
    p_tenant: String(tenant._id), p_clerk_user_id: candidate.clerkUserId,
    p_email: candidate.email, p_first_name: candidate.firstName, p_last_name: candidate.lastName, p_source: source, p_apply: apply
  });
  if (error) throw error; // Webhooks return failure; periodic cursor does not advance.
  const result = data?.[0] || { outcome: "skipped" };
  if (result.outcome === "created") {
    await TenantAdminAuditLogModel.create({ tenantId: tenant._id, actorUserId: null,
      event: "verified_signup_request_recovered", metadata: { source, requestId: result.request_id,
        clerkUserId: candidate.clerkUserId, requiresConsent: true } }).catch(() => {});
  }
  let consent = null;
  if (apply === true && result.request_id && ["created", "existing_request"].includes(result.outcome)) {
    // Missing/invalid metadata cannot invent acceptance. The RPC may only reuse
    // an immutable receipt already recorded for this exact identity/policy.
    const agreement = validateSignupLegalAgreement(user.unsafeMetadata?.signupLegalAgreement);
    const ingestion = await getSupabaseAdmin().rpc("ingest_verified_signup_consent_receipt", {
      p_tenant: String(tenant._id), p_request: result.request_id,
      p_clerk_user_id: candidate.clerkUserId, p_verified_email: candidate.email,
      p_policy: SIGNUP_CONSENT_POLICY, p_agreement: agreement
    });
    if (ingestion.error) throw ingestion.error; // Keep this scan page for retry.
    consent = ingestion.data;
    if (!["recorded", "existing_receipt", "no_receipt", "ineligible_request"].includes(consent?.outcome)) {
      throw Object.assign(new Error("Consent receipt was not accepted by the database"), { code: "CONSENT_RECEIPT_REJECTED" });
    }
  }
  return { outcome: result.outcome, ...(result.request_id ? { requestId: result.request_id } : {}),
    ...(consent && consent.outcome !== "no_receipt" && consent.outcome !== "ineligible_request" ? { consent } : {}) };
}

// Also used by the operator's reviewed, ID-based repair. Never accepts an email
// or client-provided profile as evidence. A recorded director decision may be
// activated only after an actual, validated consent receipt is persisted.
export async function reconcileVerifiedSignupByClerkId(clerkUserId, { source = "operator_repair", apply = false } = {}) {
  if (!clerk) return { outcome: "clerk_unavailable" };
  if (!/^user_[A-Za-z0-9]+$/.test(normalize(clerkUserId))) return { outcome: "ineligible_identity" };
  const tenant = await enabledTenant();
  if (!tenant) return { outcome: "disabled" };
  let user;
  try { user = await clerk.users.getUser(normalize(clerkUserId)); }
  catch (error) {
    if (Number(error?.status || error?.statusCode) === 404) return { outcome: "deleted_identity" };
    throw error;
  }
  return reconcileRecord(user, tenant, source, apply);
}

export async function runVerifiedSignupReconciliationPage() {
  if (!clerk) return { outcome: "clerk_unavailable" };
  const tenant = await enabledTenant();
  if (!tenant) return { outcome: "disabled" };
  const client = getSupabaseAdmin();
  const claim = await client.rpc("claim_signup_review_scan", { p_tenant: String(tenant._id) });
  if (claim.error) throw claim.error;
  const lease = claim.data?.[0];
  if (!lease) return { outcome: "not_due" };
  let nextOffset = lease.scan_offset;
  try {
    // Stable ascending creation order; repeat complete scans so later email
    // verification, deletes between pages and missed webhook deliveries heal.
    const page = await clerk.users.getUserList({ limit: PAGE_SIZE, offset: lease.scan_offset, orderBy: "+created_at" });
    const records = (page.data || []).slice(0, PAGE_SIZE);
    let created = 0;
    for (const user of records) {
      if (!verifiedMemberSignupCandidate(user)) continue;
      const result = await reconcileRecord(user, tenant, "periodic_scan");
      if (result.outcome === "created") created += 1;
    }
    nextOffset = records.length < PAGE_SIZE || lease.scan_offset + records.length >= page.totalCount
      ? 0 : lease.scan_offset + records.length;
    const completed = await client.rpc("finish_signup_review_scan", {
      p_tenant: String(tenant._id), p_lease: lease.lease_token, p_offset: nextOffset
    });
    if (completed.error) throw completed.error;
    if (!completed.data) throw Object.assign(new Error("Signup reconciliation lease expired"), { code: "SIGNUP_SCAN_LEASE_LOST" });
    return { outcome: "scanned", scanned: records.length, created, nextOffset };
  } catch (error) {
    // Keep the previous page on error. A lost acknowledgement only replays an
    // idempotent page; the four-minute DB lease also recovers process crashes.
    await client.rpc("finish_signup_review_scan", {
      p_tenant: String(tenant._id), p_lease: lease.lease_token, p_offset: lease.scan_offset,
      p_error: String(error?.code || "SIGNUP_SCAN_FAILED").replace(/[^A-Z0-9_]/gi, "_").slice(0, 100)
    }).catch(() => {});
    throw error;
  }
}

export function startVerifiedSignupReconciliation() {
  if (!clerk || !stopped) return;
  stopped = false;
  const tick = async () => {
    if (stopped) return;
    active = runVerifiedSignupReconciliationPage().catch((error) => {
      console.error("[signup-reconciliation] scan failed", { code: error?.code || "SIGNUP_SCAN_FAILED" });
    });
    await active; active = null;
    if (!stopped) { timer = setTimeout(tick, POLL_MS); timer.unref?.(); }
  };
  timer = setTimeout(tick, 5000); timer.unref?.();
}

export async function stopVerifiedSignupReconciliation() {
  stopped = true; clearTimeout(timer); await active;
}
