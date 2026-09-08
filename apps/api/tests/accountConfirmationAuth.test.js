import { jest } from "@jest/globals";
import jwt from "jsonwebtoken";
const env = { AUTH_PROVIDER: "legacy", JWT_SECRET: "synthetic-confirmation-test-key", HYBRID_ALLOW_LEGACY_TOKENS: true };
let selectedTenant = "greenlane-id";
let member;
const findUser = jest.fn(async () => member);
const resolveIdentity = jest.fn();
jest.unstable_mockModule("../src/config/env.js", () => ({ env }));
jest.unstable_mockModule("../src/db/models/index.js", () => ({ UserModel: { findById: findUser, update: jest.fn(), findMembershipsByClerkUserId: async () => [] } }));
jest.unstable_mockModule("../src/services/clerkIdentity.js", () => ({ resolveClerkIdentityFromRequest: resolveIdentity }));
jest.unstable_mockModule("../src/services/analytics.js", () => ({ trackClerkSessionSignIn: jest.fn() }));
jest.unstable_mockModule("../src/services/identityUsers.js", () => ({
 applySuperConsoleRolePolicy: (roles) => roles, ensureGlobalSuperAdmin: async () => null,
 findSingleTenantMembershipForIdentity: findUser, findTenantUserFromMembershipIdentity: findUser, findTenantUserForIdentity: findUser
}));
jest.unstable_mockModule("../src/services/featureRollouts.js", () => ({ evaluateFeatureRollout: async () => ({ enabled: false }), MULTI_CAMP_IDENTITY_FLAG: "identity" }));
jest.unstable_mockModule("../src/utils/tenantResolution.js", () => ({ resolveTenantFromRequest: async () => ({ tenantId: selectedTenant }) }));
const { requireAuth } = await import("../src/middleware/requireAuth.js");
const { accountConfirmationRequired } = await import("../src/services/accountConfirmation.js");

beforeEach(() => {
 member = { _id: "member", tenantId: "greenlane-id", roles: ["user"], status: "active", email: "member@synthetic.invalid", accountConfirmationRequestId: "request" };
 selectedTenant = "greenlane-id"; env.AUTH_PROVIDER = "legacy"; resolveIdentity.mockResolvedValue(null);
});
async function attempt(path) {
 const token = jwt.sign({ sub: "member", tenantId: "greenlane-id", email: member.email, accountConfirmationRequestId: null }, env.JWT_SECRET);
 const req = { headers: { authorization: `Bearer ${token}` }, originalUrl: path };
 const res = { status: jest.fn().mockReturnThis(), json: jest.fn() }; const next = jest.fn();
 await requireAuth(req,res,next); return { req,res,next };
}
test.each(["/api/t/greenlane/profiles", "/api/t/greenlane/photos", "/api/auth/session"])("stored gate blocks legacy protected path %s despite signed token omission", async (path) => {
 if (path === "/api/auth/session") selectedTenant = null;
 const { req,res,next } = await attempt(path);
 expect(res.status).toHaveBeenCalledWith(403); expect(res.json).toHaveBeenCalledWith({ error: expect.objectContaining({ code: "ACCOUNT_CONFIRMATION_REQUIRED" }) });
 expect(next).not.toHaveBeenCalled(); expect(req.user).toBeUndefined();
});
test("Clerk global and tenant resolution cannot bypass the stored gate", async () => {
 env.AUTH_PROVIDER = "clerk"; resolveIdentity.mockResolvedValue({ provider: "clerk", clerkUserId: "user_verified", email: member.email });
 for (const tenant of ["greenlane-id", null]) { selectedTenant=tenant; const { next,res }=await attempt("/api/auth/session"); expect(next).not.toHaveBeenCalled(); expect(res.status).toHaveBeenCalledWith(403); }
});
test("real completion clears the server gate and ordinary accounts pass unchanged", async () => {
 member.accountConfirmationRequestId = null;
 const { next,req } = await attempt("/api/t/greenlane/profiles"); expect(next).toHaveBeenCalledTimes(1); expect(req.user.id).toBe("member");
 expect(accountConfirmationRequired({ status: "active" })).toBe(false);
});

test("a separately authorized other-camp membership keeps its normal access", async () => {
 selectedTenant="cedar-id";member={...member,tenantId:"cedar-id",accountConfirmationRequestId:null};
 env.AUTH_PROVIDER="clerk";resolveIdentity.mockResolvedValue({provider:"clerk",clerkUserId:"user_verified",email:member.email});
 const {next}=await attempt("/api/t/cedar/profiles");expect(next).toHaveBeenCalledTimes(1);
});
