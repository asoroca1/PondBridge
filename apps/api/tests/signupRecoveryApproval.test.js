import { jest, beforeEach, test, expect } from "@jest/globals";
import express from "express";
import request from "supertest";
import { patchExpressAsyncErrors } from "../src/utils/patchExpressAsyncErrors.js";
patchExpressAsyncErrors();
const rpc = jest.fn();
jest.unstable_mockModule("../src/db/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => ({ rpc }) }));
const emailModule = await import("../src/services/email.js");
const sendDecision = jest.fn(async () => ({}));
jest.unstable_mockModule("../src/services/email.js", () => ({ ...emailModule, sendAccessDecisionEmail: sendDecision }));
const mobileModule = await import("../src/services/mobileNotifications.js");
jest.unstable_mockModule("../src/services/mobileNotifications.js", () => ({ ...mobileModule, sendMobileNotificationBatch: jest.fn(async () => ({})) }));
const analyticsModule = await import("../src/services/analytics.js");
jest.unstable_mockModule("../src/services/analytics.js", () => ({ ...analyticsModule, logTenantEvent: jest.fn(async () => ({})) }));
jest.unstable_mockModule("../src/middleware/tenantAccess.js", () => ({ requireTenantRoleScope: () => [(req, _res, next) => {
  req.tenant = { _id: "greenlane-id", slug: "greenlane", status: "active" };
  req.user = { id: "director-id", tenantId: "greenlane-id", roles: ["tenant_admin"] }; next();
}] }));
const models = await import("../src/db/models/index.js");
const pending = { _id: "request-id", tenantId: "greenlane-id", email: "verified@synthetic.invalid", status: "pending", recoveredClerkUserId: "user_verified",
  profilePayload: { socials: { signupRecovery: { clerkUserId: "user_verified", requiresConsent: true } } } };
const requestFind = jest.spyOn(models.AccessRequestModel, "findOne");
const requestList = jest.spyOn(models.AccessRequestModel, "find");
const requestUpdate = jest.spyOn(models.AccessRequestModel, "update");
const userFind = jest.spyOn(models.UserModel, "findOne");
const profileFind = jest.spyOn(models.ProfileModel, "findOne");
const activityCreate = jest.spyOn(models.ActivityItemModel, "create");
const requestClaim = jest.spyOn(models.AccessRequestModel, "claimOne");
const userCreate = jest.spyOn(models.UserModel, "create");
const userUpdate = jest.spyOn(models.UserModel, "update");
const profileCreate = jest.spyOn(models.ProfileModel, "create");
const audit = jest.spyOn(models.TenantAdminAuditLogModel, "create");
const { default: routes } = await import("../src/routes/admin.js");
const app = express(); app.use(express.json()); app.use(routes);
app.use((error, _req, res, _next) => res.status(500).json({ error: { code: error.code || "UNEXPECTED_TEST_ERROR" } }));
beforeEach(() => {
  jest.clearAllMocks(); rpc.mockImplementation(() => { throw new Error("Unexpected database RPC"); }); requestFind.mockResolvedValue(pending); requestList.mockResolvedValue([pending]); audit.mockResolvedValue({});
});
function expectNoApprovalWrites() {
  expect(requestUpdate).not.toHaveBeenCalled(); expect(userCreate).not.toHaveBeenCalled();
  expect(userUpdate).not.toHaveBeenCalled(); expect(profileCreate).not.toHaveBeenCalled();
}
test("single director approval is blocked before any membership write when recovered consent is missing", async () => {
  const response = await request(app).post("/members/approvals/request-id/approve").send({});
  expect(response.status).toBe(409);
  expect(response.body.error.code).toBe("RECOVERED_SIGNUP_CONSENT_REQUIRED"); expectNoApprovalWrites();
});
test("bulk director approval leaves recovered pending requests undecided", async () => {
  const response = await request(app).post("/members/approvals/bulk").send({ action: "approve", ids: ["request-id"] });
  expect(response.status).toBe(200); expect(response.body.decided).toBe(0);
  expect(response.body.failed).toEqual([{ requestId: "request-id", code: "RECOVERED_SIGNUP_CONSENT_REQUIRED" }]);
  expectNoApprovalWrites();
});
test("director review list clearly exposes missing consent without treating recovery as consent", async () => {
  const response = await request(app).get("/members/approvals");
  expect(response.status).toBe(200);
  expect(response.body.items[0]).toMatchObject({ requiresConsent: true, recoveredSignup: true, status: "pending" });
  expectNoApprovalWrites();
});

function consentedRequest() {
  const row = { ...pending, recoveredClerkUserId: "user_verified", profilePayload: { socials: {
    ...pending.profilePayload.socials, legalAgreement: { accepted: true, ageEligibilityConfirmed: true }
  } } };
  requestFind.mockResolvedValue(row); requestList.mockResolvedValue([row]);
  rpc.mockResolvedValue({ data: { ok: true, requestId: "request-id", userId: "new-user", profileId: "new-profile", membershipId: "new-membership" }, error: null });
  userFind.mockResolvedValue({ _id: "new-user", clerkUserId: "user_verified", profileId: "new-profile", roles: ["user"] });
  profileFind.mockResolvedValue({ _id: "new-profile", userId: "new-user", tenantMembershipId: "new-membership", firstName: "Verified", lastName: "Member" });
  activityCreate.mockResolvedValue({});
}
test.each(["single", "bulk"])("%s recovered approval uses one atomic identity-and-membership transaction", async (mode) => {
  consentedRequest();
  const response = mode === "single"
    ? await request(app).post("/members/approvals/request-id/approve").send({})
    : await request(app).post("/members/approvals/bulk").send({ action: "approve", ids: ["request-id"] });
  expect(response.status).toBe(200);
  expect(rpc).toHaveBeenCalledTimes(1);
  expect(rpc).toHaveBeenCalledWith("approve_recovered_signup_review", {
    p_tenant: "greenlane-id", p_request: "request-id", p_actor: "director-id"
  });
  if (mode === "bulk") expect(response.body.decided).toBe(1);
  expect(userFind).toHaveBeenCalledWith("greenlane-id", { _id: "new-user" });
  expect(profileFind).toHaveBeenCalledWith("greenlane-id", { _id: "new-profile" });
  expectNoApprovalWrites(); expect(sendDecision).toHaveBeenCalledTimes(1);
});
test("a concurrent denial reported by the atomic approval sends no acceptance", async () => {
  consentedRequest(); rpc.mockResolvedValue({ data: { ok: false, code: "ACCESS_REQUEST_CHANGED" } });
  const response = await request(app).post("/members/approvals/request-id/approve").send({});
  expect(response.status).toBe(409); expect(sendDecision).not.toHaveBeenCalled(); expectNoApprovalWrites();
});
test("denial cannot overwrite an approval that won the row lock", async () => {
  requestClaim.mockResolvedValue(null);
  const response = await request(app).post("/members/approvals/request-id/deny").send({ reason: "Synthetic" });
  expect(response.status).toBe(409);
  expect(requestClaim).toHaveBeenCalledWith("request-id", { tenantId: "greenlane-id", status: "pending" }, expect.objectContaining({ status: "denied" }));
  expect(sendDecision).not.toHaveBeenCalled();
});
