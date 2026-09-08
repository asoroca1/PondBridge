import { jest } from "@jest/globals";
import jwt from "jsonwebtoken";

const tenantId = "64a000000000000000000001";
const otherTenantId = "64b000000000000000000001";
const userId = "64a000000000000000000002";
const env = {
  NODE_ENV: "test", AUTH_PROVIDER: "hybrid", HYBRID_ALLOW_LEGACY_TOKENS: false,
  JWT_SECRET: "local-regression-test-key", CLERK_REQUIRE_TENANT_CLAIM: false
};
const findUser = jest.fn();
const findTenant = jest.fn();
const resolveIdentity = jest.fn();
const findTenantUser = jest.fn();
const findMembershipUser = jest.fn();
const findSingleMembership = jest.fn();
const ensureSuper = jest.fn();
const rolePolicy = jest.fn((roles) => roles);
const rollout = jest.fn();
jest.unstable_mockModule("../src/config/env.js", () => ({ env }));
jest.unstable_mockModule("../src/db/models/index.js", () => ({
  TenantModel: { findOne: findTenant }, UserModel: { findById: findUser, findMembershipsByClerkUserId: async () => [] },
  MessageModel: {}, ConversationModel: {}, ForumModel: {}
}));
jest.unstable_mockModule("../src/services/clerkIdentity.js", () => ({
  resolveClerkIdentityFromRequest: resolveIdentity,
  extractTenantScopeFromIdentity: (identity) => ({ tenantId: identity.claims?.tenantId })
}));
jest.unstable_mockModule("../src/services/identityUsers.js", () => ({
  findTenantUserForIdentity: findTenantUser,
  findTenantUserFromMembershipIdentity: findMembershipUser,
  findSingleTenantMembershipForIdentity: findSingleMembership,
  ensureGlobalSuperAdmin: ensureSuper,
  applySuperConsoleRolePolicy: rolePolicy
}));
jest.unstable_mockModule("../src/services/featureRollouts.js", () => ({
  evaluateFeatureRollout: rollout, MULTI_CAMP_IDENTITY_FLAG: "multi_camp_identity"
}));
jest.unstable_mockModule("../src/services/memberSafety.js", () => ({
  assertConversationDirectContactAllowed: jest.fn()
}));
jest.unstable_mockModule("../src/services/memberTiers.js", () => ({
  assertConversationTierContactAllowedByTenantId: jest.fn(), getHiddenUserIdsByTenantId: jest.fn()
}));
jest.unstable_mockModule("../src/services/messaging.js", () => ({
  advanceReadBy: jest.fn(), clampReadAt: jest.fn(), normalizeMessageKind: jest.fn(),
  notifyConversationParticipants: jest.fn()
}));
const { authenticateSocket } = await import("../src/services/socketServer.js");
const member = { _id: userId, tenantId, roles: ["user"], status: "active", email: "member@example.test" };
const handshake = (token, tenantSlug = "camp-a") => ({ handshake: { auth: { token, tenantSlug } } });
const legacyToken = () => jwt.sign({ sub: userId, tenantId, email: member.email }, env.JWT_SECRET, { expiresIn: "5m" });

beforeEach(() => {
  jest.clearAllMocks();
  env.AUTH_PROVIDER = "hybrid";
  env.HYBRID_ALLOW_LEGACY_TOKENS = false;
  env.CLERK_REQUIRE_TENANT_CLAIM = false;
  findTenant.mockResolvedValue({ _id: tenantId, slug: "camp-a" });
  findUser.mockResolvedValue({ ...member });
  findTenantUser.mockResolvedValue({ ...member });
  findMembershipUser.mockResolvedValue({ ...member });
  findSingleMembership.mockResolvedValue({ ...member });
  ensureSuper.mockResolvedValue(null);
  resolveIdentity.mockResolvedValue(null);
  rollout.mockResolvedValue({ enabled: false });
  rolePolicy.mockImplementation((roles) => roles);
});

test("a correctly signed legacy JWT cannot bypass hybrid legacy-token disablement over realtime", async () => {
  await expect(authenticateSocket(handshake(legacyToken()))).rejects.toThrow("Invalid or expired token");
  expect(findUser).not.toHaveBeenCalled();
});

test.each(["legacy", "hybrid"])("permitted legacy sessions work in %s mode", async (provider) => {
  env.AUTH_PROVIDER = provider;
  env.HYBRID_ALLOW_LEGACY_TOKENS = true;
  await expect(authenticateSocket(handshake(legacyToken()))).resolves.toMatchObject({ user: { id: userId, tenantId } });
});

test("legacy membership cannot silently select another camp", async () => {
  env.AUTH_PROVIDER = "legacy";
  findTenant.mockResolvedValue({ _id: otherTenantId, slug: "camp-b" });
  await expect(authenticateSocket(handshake(legacyToken(), "camp-b"))).rejects.toThrow();
});

test("an explicit unknown tenant never falls back to the sole membership", async () => {
  findTenant.mockResolvedValue(null);
  await expect(authenticateSocket(handshake("clerk-token", "missing"))).rejects.toThrow("Tenant not found");
  expect(findSingleMembership).not.toHaveBeenCalled();
});

test.each([otherTenantId, ""])("Clerk tenant claims obey the HTTP scope policy: %s", async (claim) => {
  env.CLERK_REQUIRE_TENANT_CLAIM = true;
  resolveIdentity.mockResolvedValue({ provider: "clerk", clerkUserId: "user_test", claims: { tenantId: claim } });
  await expect(authenticateSocket(handshake("clerk-token"))).rejects.toThrow(/tenant|Tenant/);
});

test("membership-backed multi-camp sessions may use an identity scoped to the other camp", async () => {
  env.CLERK_REQUIRE_TENANT_CLAIM = true;
  rollout.mockResolvedValue({ enabled: true });
  resolveIdentity.mockResolvedValue({ provider: "clerk", clerkUserId: "user_test", claims: { tenantId: otherTenantId } });
  await expect(authenticateSocket(handshake("clerk-token"))).resolves.toMatchObject({ user: { tenantId } });
});

test("a Clerk identity without an application membership cannot open realtime", async () => {
  resolveIdentity.mockResolvedValue({ provider: "clerk", clerkUserId: "user_test", claims: {} });
  findTenantUser.mockResolvedValue(null);
  await expect(authenticateSocket(handshake("clerk-token"))).rejects.toThrow("Membership not found");
});

test("stale super roles cannot exempt an inactive account after allowlist removal", async () => {
  resolveIdentity.mockResolvedValue({ provider: "clerk", clerkUserId: "user_test", claims: {} });
  findTenantUser.mockResolvedValue({ ...member, status: "inactive", roles: ["super_admin"] });
  rolePolicy.mockReturnValue([]);
  await expect(authenticateSocket(handshake("clerk-token"))).rejects.toThrow("Membership is inactive");
});

test("counted cohort cannot establish a Clerk or legacy socket before confirmation", async () => {
 const gated = { ...member, accountConfirmationRequestId: "frozen-request" };
 findUser.mockResolvedValue(gated); findTenantUser.mockResolvedValue(gated); findSingleMembership.mockResolvedValue(gated);
 env.AUTH_PROVIDER="legacy"; await expect(authenticateSocket(handshake(legacyToken()))).rejects.toThrow();
 env.AUTH_PROVIDER="clerk"; resolveIdentity.mockResolvedValue({provider:"clerk",clerkUserId:"user_verified",email:member.email});
 await expect(authenticateSocket(handshake("clerk-token"))).rejects.toMatchObject({code:"ACCOUNT_CONFIRMATION_REQUIRED"});
});
