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
  rpc.mockImplementation(async (name) => ({ data: name === "reconcile_verified_signup_review" ? [{ outcome: "would_create" }] : true }));
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
  rpc.mockResolvedValue({ data: [{ outcome: "created", request_id: "pending-id" }] });
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
    : name === "reconcile_verified_signup_review" ? [{ outcome: "created", request_id: "pending-id" }] : true }));
  expect(await runVerifiedSignupReconciliationPage()).toEqual({ outcome: "scanned", scanned: 2, created: 1, nextOffset: 0 });
  expect(getUserList).toHaveBeenCalledWith({ limit: 100, offset: 0, orderBy: "+created_at" });
  expect(rpc.mock.calls.filter(([name]) => name === "reconcile_verified_signup_review")).toHaveLength(1);
  expect(rpc).toHaveBeenCalledWith("finish_signup_review_scan", expect.objectContaining({ p_offset: 0 }));
});
test("failed provider page retains offset and records only a redacted error code", async () => {
  rpc.mockImplementation(async (name) => ({ data: name === "claim_signup_review_scan" ? [{ scan_offset: 100, lease_token: "lease" }] : true }));
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
