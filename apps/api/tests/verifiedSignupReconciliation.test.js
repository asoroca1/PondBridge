import { jest, beforeEach, test, expect } from "@jest/globals";
const rpc = jest.fn();
const getUser = jest.fn();
const getUserList = jest.fn();
const audit = jest.fn();
const rollout = jest.fn();
let tenant;
jest.unstable_mockModule("@clerk/backend", () => ({ createClerkClient: () => ({ users: { getUser, getUserList } }) }));
jest.unstable_mockModule("../src/config/env.js", () => ({ env: { CLERK_SECRET_KEY: "synthetic-test-only" } }));
jest.unstable_mockModule("../src/db/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => ({ rpc }) }));
jest.unstable_mockModule("../src/db/models/index.js", () => ({
  TenantModel: { findBySlug: async () => tenant }, TenantAdminAuditLogModel: { create: audit }
}));
jest.unstable_mockModule("../src/services/featureRollouts.js", () => ({ evaluateFeatureRollout: rollout }));
const { verifiedMemberSignupCandidate, reconcileVerifiedSignupByClerkId, runVerifiedSignupReconciliationPage } =
  await import("../src/services/verifiedSignupReconciliation.js");
const { recoveredRequestRequiresConsent, preserveSignupRecoveryConsent } = await import("../src/services/signupRecoveryConsent.js");
const user = () => ({ id: "user_verified", firstName: "Real", lastName: "Member",
  primaryEmailAddressId: "email_primary", emailAddresses: [{ id: "email_primary", emailAddress: "member@synthetic.invalid", verification: { status: "verified" } }],
  unsafeMetadata: { tenantSlug: "greenlane", signupAudience: "member" }, publicMetadata: {} });
beforeEach(() => {
  jest.clearAllMocks();
  tenant = { _id: "greenlane-id", slug: "greenlane", status: "active", settings: { signupMode: "open", requireSignupApproval: true } };
  rollout.mockResolvedValue({ enabled: true }); getUser.mockResolvedValue(user());
  audit.mockResolvedValue({});
  rpc.mockImplementation(async (name) => ({ data: name === "reconcile_verified_signup_review" ? [{ outcome: "would_create" }] : name === "ingest_verified_signup_consent_receipt" ? { outcome: "no_receipt" } : true }));
});
test.each([
  ["unverified primary", (u) => { u.emailAddresses[0].verification.status = "unverified"; }],
  ["verified secondary only", (u) => { u.primaryEmailAddressId = "unverified"; }],
  ["Cedar signup", (u) => { u.unsafeMetadata.tenantSlug = "cedar"; }],
  ["director signup", (u) => { u.unsafeMetadata.signupAudience = "director"; }],
  ["unrelated signin", (u) => { u.unsafeMetadata = {}; }],
  ["conflicting server tenant", (u) => { u.publicMetadata.tenantSlug = "cedar"; }],
  ["banned account", (u) => { u.banned = true; }],
  ["locked account", (u) => { u.locked = true; }]
])("%s never becomes a recovery candidate", (_label, change) => {
  const record = user(); change(record); expect(verifiedMemberSignupCandidate(record)).toBeNull();
});
test("operator repair reloads real Clerk identity and defaults to dry-run", async () => {
  expect(await reconcileVerifiedSignupByClerkId("user_verified")).toEqual({ outcome: "would_create" });
  expect(getUser).toHaveBeenCalledWith("user_verified");
  expect(rpc).toHaveBeenCalledWith("reconcile_verified_signup_review", expect.objectContaining({ p_apply: false, p_clerk_user_id: "user_verified", p_email: "member@synthetic.invalid" }));
  expect(audit).not.toHaveBeenCalled();
});
test("explicit apply records provenance without inventing consent or notifying", async () => {
  rpc.mockImplementation(async (name) => ({ data: name === "reconcile_verified_signup_review" ? [{ outcome: "created", request_id: "pending-id" }] : { outcome: "no_receipt" } }));
  expect(await reconcileVerifiedSignupByClerkId("user_verified", { apply: true })).toEqual({ outcome: "created", requestId: "pending-id" });
  expect(rpc.mock.calls[0][1].p_apply).toBe(true);
  expect(audit).toHaveBeenCalledWith(expect.objectContaining({ event: "verified_signup_request_recovered", metadata: expect.objectContaining({ requiresConsent: true }) }));
});
test.each(["rollout", "gate", "inactive"])("%s disabled performs no identity read or write", async (kind) => {
  if (kind === "rollout") rollout.mockResolvedValue({ enabled: false });
  if (kind === "gate") tenant.settings.requireSignupApproval = false;
  if (kind === "inactive") tenant.status = "inactive";
  expect((await reconcileVerifiedSignupByClerkId("user_verified", { apply: true })).outcome).toBe("disabled");
  expect(getUser).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
});
test("conflicting tenant ID in a verified record cannot target GreenLane", async () => {
  const record = user(); record.publicMetadata.tenantId = "cedar-id"; getUser.mockResolvedValue(record);
  expect((await reconcileVerifiedSignupByClerkId("user_verified", { apply: true })).outcome).toBe("conflicting_tenant");
  expect(rpc).not.toHaveBeenCalled();
});
test("bounded page persists its position and completes cycles without using other-camp users", async () => {
  const cedar = user(); cedar.unsafeMetadata.tenantSlug = "cedar";
  getUserList.mockResolvedValue({ data: [user(), cedar], totalCount: 2 });
  rpc.mockImplementation(async (name) => ({ data: name === "claim_signup_review_scan" ? [{ scan_offset: 0, lease_token: "lease" }]
    : name === "reconcile_verified_signup_review" ? [{ outcome: "created", request_id: "pending-id" }] : name === "ingest_verified_signup_consent_receipt" ? { outcome: "no_receipt" } : true }));
  expect(await runVerifiedSignupReconciliationPage()).toEqual({ outcome: "scanned", scanned: 2, created: 1, nextOffset: 0 });
  expect(getUserList).toHaveBeenCalledWith({ limit: 100, offset: 0, orderBy: "+created_at" });
  expect(rpc.mock.calls.filter(([name]) => name === "reconcile_verified_signup_review")).toHaveLength(1);
  expect(rpc).toHaveBeenCalledWith("finish_signup_review_scan", expect.objectContaining({ p_offset: 0 }));
});
test("failed provider page retains offset and records only a redacted error code", async () => {
  rpc.mockImplementation(async (name) => ({ data: name === "claim_signup_review_scan" ? [{ scan_offset: 100, lease_token: "lease" }] : name === "ingest_verified_signup_consent_receipt" ? { outcome: "no_receipt" } : true }));
  getUserList.mockRejectedValue(Object.assign(new Error("private provider details"), { code: "PROVIDER_UNAVAILABLE" }));
  await expect(runVerifiedSignupReconciliationPage()).rejects.toThrow();
  expect(rpc).toHaveBeenCalledWith("finish_signup_review_scan", { p_tenant: "greenlane-id", p_lease: "lease", p_offset: 100, p_error: "PROVIDER_UNAVAILABLE" });
  expect(JSON.stringify(rpc.mock.calls)).not.toContain("private provider details");
});
test("recovered consent marker cannot authorize approval without real legal and age acceptance", () => {
  const pending = { recoveredClerkUserId: "user_verified", profilePayload: { socials: { signupRecovery: { clerkUserId: "user_verified", requiresConsent: false } } } };
  expect(recoveredRequestRequiresConsent(pending)).toBe(true);
  const actual = { socials: { legalAgreement: { accepted: true, ageEligibilityConfirmed: true, acceptedAt: "2026-09-08T00:00:00Z" } } };
  const completed = preserveSignupRecoveryConsent(pending, actual);
  expect(completed.socials.signupRecovery.clerkUserId).toBe("user_verified");
  expect(completed.socials.signupRecovery.requiresConsent).toBe(false);
  expect(recoveredRequestRequiresConsent({ profilePayload: completed })).toBe(false);
  const retry = preserveSignupRecoveryConsent({ recoveredClerkUserId: "user_verified", profilePayload: completed }, { firstName: "Real" });
  expect(retry.socials.legalAgreement).toEqual(actual.socials.legalAgreement);
  expect(recoveredRequestRequiresConsent({ profilePayload: {} })).toBe(false);
});

function signupAgreement() {
  return { version: 1, accepted: true, ageEligibilityConfirmed: true, termsVersion: "2026-03-04", privacyVersion: "2026-03-04", minimumAge: 14,
    agePolicyVersion: "2026-07-14", acceptedAt: new Date(Date.now() - 1000).toISOString() };
}
test("lost browser state is recovered only from the freshly loaded verified Clerk record", async () => {
  const record = user(); record.unsafeMetadata.signupLegalAgreement = signupAgreement(); getUser.mockResolvedValue(record);
  rpc.mockImplementation(async (name) => ({ data: name === "reconcile_verified_signup_review" ? [{ outcome: "existing_request", request_id: "pending-id" }]
    : { outcome: "recorded", receiptId: "receipt-id", activated: false } }));
  const result = await reconcileVerifiedSignupByClerkId("user_verified", { apply: true });
  expect(getUser).toHaveBeenCalledWith("user_verified");
  expect(rpc).toHaveBeenCalledWith("ingest_verified_signup_consent_receipt", {
    p_tenant: "greenlane-id", p_request: "pending-id", p_clerk_user_id: "user_verified", p_verified_email: "member@synthetic.invalid",
    p_policy: { version: 1, termsVersion: "2026-03-04", privacyVersion: "2026-03-04", agePolicyVersion: "2026-07-14", minimumAge: 14 },
    p_agreement: record.unsafeMetadata.signupLegalAgreement
  });
  expect(result.consent).toMatchObject({ outcome: "recorded", activated: false });
});
test("dry-run never ingests consent even when metadata contains a valid assertion", async () => {
  const record = user(); record.unsafeMetadata.signupLegalAgreement = signupAgreement(); getUser.mockResolvedValue(record);
  rpc.mockResolvedValue({ data: [{ outcome: "existing_request", request_id: "pending-id" }] });
  await reconcileVerifiedSignupByClerkId("user_verified");
  expect(rpc).toHaveBeenCalledTimes(1);
});
test("unchecked or stale metadata is never passed as an acceptance", async () => {
  const record = user(); record.unsafeMetadata.signupLegalAgreement = { ...signupAgreement(), accepted: false }; getUser.mockResolvedValue(record);
  rpc.mockImplementation(async (name) => ({ data: name === "reconcile_verified_signup_review" ? [{ outcome: "created", request_id: "pending-id" }] : { outcome: "no_receipt" } }));
  await reconcileVerifiedSignupByClerkId("user_verified", { apply: true });
  expect(rpc).toHaveBeenCalledWith("ingest_verified_signup_consent_receipt", expect.objectContaining({ p_agreement: null }));
});
test("receipt failure retains the scan page for retry instead of reporting healthy success", async () => {
  const record = user(); record.unsafeMetadata.signupLegalAgreement = signupAgreement(); getUserList.mockResolvedValue({ data: [record], totalCount: 1 });
  rpc.mockImplementation(async (name) => name === "ingest_verified_signup_consent_receipt"
    ? { error: { code: "RECEIPT_DB_UNAVAILABLE" } }
    : { data: name === "claim_signup_review_scan" ? [{ scan_offset: 100, lease_token: "lease" }]
      : name === "reconcile_verified_signup_review" ? [{ outcome: "existing_request", request_id: "pending-id" }] : true });
  await expect(runVerifiedSignupReconciliationPage()).rejects.toMatchObject({ code: "RECEIPT_DB_UNAVAILABLE" });
  expect(rpc).toHaveBeenCalledWith("finish_signup_review_scan", expect.objectContaining({ p_offset: 100, p_error: "RECEIPT_DB_UNAVAILABLE" }));
});

test("unexpected SQL validation disagreement is a retryable scan failure, not silent success", async () => {
  const record = user(); record.unsafeMetadata.signupLegalAgreement = signupAgreement(); getUser.mockResolvedValue(record);
  rpc.mockImplementation(async (name) => ({ data: name === "reconcile_verified_signup_review" ? [{ outcome: "existing_request", request_id: "pending-id" }]
    : { outcome: "invalid_receipt" } }));
  await expect(reconcileVerifiedSignupByClerkId("user_verified", { apply: true })).rejects.toMatchObject({ code: "CONSENT_RECEIPT_REJECTED" });
});
