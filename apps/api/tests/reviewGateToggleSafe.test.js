import { jest } from "@jest/globals";
import express from "express";
import request from "supertest";
import { patchExpressAsyncErrors } from "../src/utils/patchExpressAsyncErrors.js";
patchExpressAsyncErrors();

let tenant;
let membership;
let pending;
let invite;
const email = "member@example.test";
const verifyIdentityEmail = jest.fn();
const rpc = jest.fn();
const createMembership = jest.fn();
const approveRequest = jest.fn();
const profileWrite = jest.fn();
const findRequest = jest.fn();
const createRequest = jest.fn();
const findMembership = jest.fn();
const profile = { _id: "profile-a", tenantId: "camp-a", status: "active", socials: {} };

jest.unstable_mockModule("../src/services/clerkIdentity.js", () => ({ isClerkIdentityEmailVerified: verifyIdentityEmail }));
jest.unstable_mockModule("../src/db/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => ({ rpc }) }));
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
    claimOne: jest.fn(async (_id, guard, patch) => {
      if (pending?.tenantId !== guard.tenantId || pending?.status !== guard.status) return null;
      pending = { ...pending, ...patch }; return pending;
    }),
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
app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ error: { code: error.code } }));
const body = { firstName: "Test", lastName: "Member", legalAgreementAccepted: true, ageEligibilityConfirmed: true };

beforeEach(() => {
  jest.clearAllMocks();
  verifyIdentityEmail.mockResolvedValue(true);
  tenant = { _id: "camp-a", slug: "camp-a", status: "active", onboardingStatus: "live", billingStatus: "active",
    settings: { signupMode: "open", requireSignupApproval: false } };
  membership = null; pending = null; invite = null;
  findMembership.mockImplementation(async () => membership);
  findRequest.mockImplementation(async (tenantId, filter) => {
    if (pending?.tenantId !== tenantId) return null;
    if (filter?._id) return pending._id === filter._id ? pending : null;
    if (filter?.recoveredClerkUserId) return pending.recoveredClerkUserId === filter.recoveredClerkUserId ? pending : null;
    return pending.email === filter.email && pending.status === "pending" ? pending : null;
  });
  createMembership.mockImplementation(async () => {
    membership = { _id: "member-a", email, tenantId: tenant._id, roles: ["user"], status: "active" }; return membership;
  });
  createRequest.mockImplementation(async (row) => { pending = { _id: "request-a", ...row }; return pending; });
  approveRequest.mockImplementation(async (_tenantId, _id, patch) => { pending = { ...pending, ...patch }; return pending; });
  profileWrite.mockImplementation(async (_tenantId, _id, patch) => ({ ...profile, ...patch }));
  rpc.mockImplementation(async (name, args) => {
    if (name !== "submit_recovered_signup_consent") throw new Error(`Unexpected RPC ${name}`);
    pending = { ...pending, firstName: args.p_first_name, lastName: args.p_last_name,
      selfReportedRole: args.p_self_reported_role, requestMessage: args.p_request_message,
      profilePayload: args.p_profile_payload };
    if (!pending.directorApprovedAt) {
      return { data: { ok: true, requestId: pending._id, activated: false, pendingApproval: true }, error: null };
    }
    pending = { ...pending, status: "approved", approvedUserId: "member-a" };
    membership = { _id: "member-a", tenantId: tenant._id, email, status: "active", roles: ["user"] };
    return { data: { ok: true, requestId: pending._id, userId: "member-a", activated: true, pendingApproval: false }, error: null };
  });
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

function recoveredPending() {
  tenant.settings.requireSignupApproval = true;
  pending = { _id: "request-a", tenantId: tenant._id, email, status: "pending", recoveredClerkUserId: "clerk-local", firstName: "Real", lastName: "Name",
    profilePayload: { socials: { signupRecovery: { clerkUserId: "clerk-local", source: "periodic_scan", requiresConsent: true } } } };
}

test("recovered pending decision exposes consent and real POST preserves provenance", async () => {
  recoveredPending();
  const before = await request(app).get("/decision");
  expect(before.body.decision.request.requiresConsent).toBe(true);
  const completed = await request(app).post("/request-access").send(body);
  expect(completed.status).toBe(200);
  expect(completed.body.decision.request.requiresConsent).toBe(false);
  expect(pending.profilePayload.socials.signupRecovery).toMatchObject({ clerkUserId: "clerk-local", source: "periodic_scan", requiresConsent: false });
  expect(pending.profilePayload.socials.legalAgreement).toMatchObject({ accepted: true, ageEligibilityConfirmed: true });
  expect(createMembership).not.toHaveBeenCalled();
});

test("preapproved recovered consent activates atomically and returns explicit active state", async () => {
  recoveredPending();
  pending.directorApprovedAt = new Date("2026-09-08T21:00:00Z");
  pending.directorApprovedByUserId = "director-a";
  const completed = await request(app).post("/request-access").send(body);
  expect(completed.status).toBe(200);
  expect(completed.body.pendingApproval).toBe(false);
  expect(completed.body.decision.state).toBe("active_member");
  expect(rpc).toHaveBeenCalledWith("submit_recovered_signup_consent", expect.objectContaining({
    p_tenant: "camp-a", p_request: "request-a", p_clerk_user_id: "clerk-local", p_verified_email: email
  }));
  expect(pending.status).toBe("approved");
  expect(createMembership).not.toHaveBeenCalled();
});

test("recovered request cannot confirm consent with an unverified identity", async () => {
  recoveredPending(); verifyIdentityEmail.mockResolvedValue(false);
  const response = await request(app).post("/request-access").send(body);
  expect(response.status).toBe(403);
  expect(pending.profilePayload.socials.signupRecovery.requiresConsent).toBe(true);
});

test("recovered request cannot invent missing legal agreement", async () => {
  recoveredPending();
  const response = await request(app).post("/request-access").send({});
  expect(response.status).toBe(400);
  expect(pending.profilePayload.socials.legalAgreement).toBeUndefined();
});

test.each(["socials", "social"])("ordinary request strips forged recovery identity from %s", async (alias) => {
  tenant.settings.requireSignupApproval = true;
  const response = await request(app).post("/request-access").send({ ...body,
    [alias]: { signupRecovery: { clerkUserId: "user_victim", source: "operator_repair", requiresConsent: false } }
  });
  expect(response.status).toBe(201);
  expect(createRequest).toHaveBeenCalled();
  expect(createRequest.mock.calls[0][0].profilePayload.socials.signupRecovery).toBeUndefined();
  expect(createRequest.mock.calls[0][0].recoveredClerkUserId).toBeUndefined();
});

test("consent-only recovery callback retains verified signup names and profile details", async () => {
  recoveredPending(); pending.profilePayload = { ...pending.profilePayload, firstName: "Real", lastName: "Name", cityState: "Synthetic City", phones: ["synthetic-phone"] };
  const response = await request(app).post("/request-access").send({ legalAgreement: { accepted: true, ageEligibilityConfirmed: true } });
  expect(response.status).toBe(200);
  expect(pending).toMatchObject({ firstName: "Real", lastName: "Name", profilePayload: { firstName: "Real", lastName: "Name", cityState: "Synthetic City", phones: ["synthetic-phone"] } });
  expect(pending.profilePayload.socials.legalAgreement.accepted).toBe(true);
});
