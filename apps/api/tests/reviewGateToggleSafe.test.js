import { jest } from "@jest/globals";
import express from "express";
import request from "supertest";

let tenant;
let membership;
let pending;
let invite;
const email = "member@example.test";
const verifyIdentityEmail = jest.fn();
const createMembership = jest.fn();
const approveRequest = jest.fn();
const profileWrite = jest.fn();
const findRequest = jest.fn();
const createRequest = jest.fn();
const findMembership = jest.fn();
const profile = { _id: "profile-a", tenantId: "camp-a", status: "active", socials: {} };

jest.unstable_mockModule("../src/services/clerkIdentity.js", () => ({ isClerkIdentityEmailVerified: verifyIdentityEmail }));
jest.unstable_mockModule("../src/middleware/tenantAccess.js", () => ({
  requireTenantIdentityScope: [(req, _res, next) => {
    req.tenant = tenant; req.identity = { provider: "clerk", clerkUserId: "clerk-local", email }; next();
  }]
}));
jest.unstable_mockModule("../src/db/models/index.js", () => ({
  UserModel: {}, TenantModel: {}, InviteModel: {
    find: jest.fn(async (tenantId, filter) => {
      if (
        invite &&
        invite.tenantId === tenantId &&
        invite.email === filter?.email &&
        !invite.usedAt
      ) {
        return [invite];
      }
      return [];
    })
  },
  ProfileModel: { updateScoped: profileWrite },
  TenantAdminAuditLogModel: { create: jest.fn(async () => ({})) },
  AccessRequestModel: {
    findOne: findRequest, create: createRequest, updateScoped: approveRequest,
    update: jest.fn(async (_id, patch) => { pending = { ...pending, ...patch }; return pending; })
  }
}));
jest.unstable_mockModule("../src/services/identityUsers.js", () => ({
  findTenantUserForIdentity: findMembership, createTenantMembershipFromIdentity: createMembership
}));
jest.unstable_mockModule("../src/services/profileCompletion.js", () => ({
  ensureProfileForUser: jest.fn(async () => profile), isProfileComplete: () => true, profileCompletionPercent: () => 100
}));
jest.unstable_mockModule("../src/services/invites.js", () => ({
  createInviteRecord: jest.fn(), findInviteByOpaqueTokenAnyState: jest.fn(),
  findInviteByOpaqueToken: jest.fn(), markInviteUsed: jest.fn()
}));
jest.unstable_mockModule("../src/services/onboarding.js", () => ({ resolveSettings: () => ({ requireProfileCompletion: false }) }));
jest.unstable_mockModule("../src/services/superCampProfile.js", () => ({ readCampProfile: jest.fn() }));
jest.unstable_mockModule("../src/services/analytics.js", () => ({ logTenantEvent: jest.fn(async () => {}) }));
jest.unstable_mockModule("../src/services/mobileNotifications.js", () => ({ notifyTenantAdmins: jest.fn(async () => {}) }));
const { default: accessRoutes } = await import("../src/routes/access.js");
const app = express(); app.use(express.json()); app.use(accessRoutes);
const body = { firstName: "Test", lastName: "Member", legalAgreementAccepted: true, ageEligibilityConfirmed: true };

beforeEach(() => {
  jest.clearAllMocks();
  verifyIdentityEmail.mockResolvedValue(true);
  tenant = { _id: "camp-a", slug: "camp-a", status: "active", onboardingStatus: "live", billingStatus: "active",
    settings: { signupMode: "open", requireSignupApproval: false } };
  membership = null; pending = null; invite = null;
  findMembership.mockImplementation(async () => membership);
  findRequest.mockImplementation(async (tenantId, filter) => pending?.tenantId === tenantId && pending.email === filter.email && pending.status === "pending" ? pending : null);
  createMembership.mockImplementation(async () => {
    membership = { _id: "member-a", email, tenantId: tenant._id, roles: ["user"], status: "active" }; return membership;
  });
  createRequest.mockImplementation(async (row) => { pending = { _id: "request-a", ...row }; return pending; });
  approveRequest.mockImplementation(async (_tenantId, _id, patch) => { pending = { ...pending, ...patch }; return pending; });
  profileWrite.mockImplementation(async (_tenantId, _id, patch) => ({ ...profile, ...patch }));
});

test("gate-off decision ignores a stale pending request for a new member", async () => {
  pending = { _id: "request-a", tenantId: tenant._id, email, status: "pending" };
  const response = await request(app).get("/decision");
  expect(response.status).toBe(200); expect(response.body.decision.action).toBe("join_network");
});

test("gate-on new member stays queued, and gate-off join resolves only their own pending request", async () => {
  tenant.settings.requireSignupApproval = true;
  const queued = await request(app).post("/join").send(body);
  expect(queued.status).toBe(202); expect(queued.body.pendingApproval).toBe(true);
  expect(queued.body.decision.state).toBe("access_pending");
  expect(createMembership).not.toHaveBeenCalled();
  tenant.settings.requireSignupApproval = false;
  const joined = await request(app).post("/join").send(body);
  expect(joined.status).toBe(201); expect(joined.body.member.status).toBe("active");
  expect(approveRequest).toHaveBeenCalledWith(tenant._id, "request-a", expect.objectContaining({ status: "approved", approvedUserId: "member-a" }));
});

test("a verified email-addressed invite can enter the review queue without its opaque URL token", async () => {
  tenant.settings.requireSignupApproval = true;
  invite = {
    _id: "invite-a",
    tenantId: tenant._id,
    email,
    roleToAssign: "user",
    usedAt: null,
    expiresAt: new Date(Date.now() + 60_000)
  };

  const response = await request(app).post("/invite/accept").send(body);

  expect(response.status).toBe(202);
  expect(response.body.pendingApproval).toBe(true);
  expect(response.body.request.email).toBeUndefined();
  expect(createRequest).toHaveBeenCalledWith(expect.objectContaining({
    tenantId: tenant._id,
    email,
    status: "pending"
  }));
  expect(createMembership).not.toHaveBeenCalled();
});

test.each(["inactive", "removed"])("gate off cannot reactivate a %s member through direct POST /join", async (status) => {
  membership = { _id: "member-a", tenantId: tenant._id, email, status, roles: ["user"] };
  const response = await request(app).post("/join").send(body);
  expect(response.status).toBe(202); expect(response.body.pendingApproval).toBe(true);
  expect(response.body.decision.state).toBe("access_pending");
  expect(membership.status).toBe(status);
  expect(createMembership).not.toHaveBeenCalled(); expect(profileWrite).not.toHaveBeenCalled();
  expect(approveRequest).not.toHaveBeenCalled();
});

test("gate off keeps an active existing member active", async () => {
  membership = { _id: "member-a", tenantId: tenant._id, email, status: "active", roles: ["user"] };
  const response = await request(app).post("/join").send(body);
  expect(response.status).toBe(201); expect(response.body.member.status).toBe("active");
  expect(createRequest).not.toHaveBeenCalled(); expect(createMembership).not.toHaveBeenCalled();
});

test("gate-off join never approves a different camp's request for the same email", async () => {
  pending = { _id: "request-b", tenantId: "camp-b", email, status: "pending" };
  const response = await request(app).post("/join").send(body);
  expect(response.status).toBe(201); expect(pending.status).toBe("pending");
  expect(approveRequest).not.toHaveBeenCalled();
});


test.each([
  ["another email", { email: "someone@example.test" }],
  ["another tenant", { tenantId: "camp-b" }],
  ["expired", { expiresAt: new Date(0) }],
  ["already used", { usedAt: new Date() }]
])("tokenless acceptance rejects an invite that is %s", async (_label, patch) => {
  invite = { _id: "invite-a", tenantId: tenant._id, email, usedAt: null,
    expiresAt: new Date(Date.now() + 60000), ...patch };
  const response = await request(app).post("/invite/accept").send(body);
  expect(response.status).toBe(404);
  expect(createMembership).not.toHaveBeenCalled();
  expect(createRequest).not.toHaveBeenCalled();
});

test("tokenless acceptance requires verified email ownership", async () => {
  verifyIdentityEmail.mockResolvedValue(false);
  const response = await request(app).post("/invite/accept").send(body);
  expect(response.status).toBe(403);
  expect(response.body.error.code).toBe("IDENTITY_EMAIL_VERIFICATION_REQUIRED");
  expect(createMembership).not.toHaveBeenCalled();
  expect(createRequest).not.toHaveBeenCalled();
});

test("tokenless invite acceptance still requires legal and age consent", async () => {
  invite = { _id: "invite-a", tenantId: tenant._id, email, usedAt: null,
    expiresAt: new Date(Date.now() + 60000) };
  const response = await request(app).post("/invite/accept").send({});
  expect(response.status).toBe(400);
  expect(response.body.error.code).toBe("LEGAL_AGREEMENT_REQUIRED");
  expect(createMembership).not.toHaveBeenCalled();
  expect(createRequest).not.toHaveBeenCalled();
});
