import { jest } from "@jest/globals";

jest.unstable_mockModule("../src/db/models/index.js", () => ({
  UserModel: {}, ProfileModel: {}, ActivityItemModel: {}, AccessRequestModel: {}, MagicLinkTokenModel: {}, TenantModel: {}
}));
jest.unstable_mockModule("../src/middleware/tenantContext.js", () => ({ requireTenant: (_req, _res, next) => next() }));
jest.unstable_mockModule("../src/middleware/requireAuth.js", () => ({ requireAuth: (_req, _res, next) => next() }));
jest.unstable_mockModule("../src/services/signupIntent.js", () => ({ rememberSignupIntent: jest.fn() }));
jest.unstable_mockModule("../src/utils/auth.js", () => ({
  buildAuthenticatedUserPayload: (user, profile) => ({ ...user, firstName: profile?.firstName || "", avatarUrl: profile?.avatarUrl || "" }),
  comparePassword: jest.fn(), hashPassword: jest.fn(), signToken: jest.fn(), sanitizeUser: (user) => ({ ...user })
}));
jest.unstable_mockModule("../src/config/env.js", () => ({ env: { AUTH_PROVIDER: "legacy" } }));
jest.unstable_mockModule("../src/services/email.js", () => ({ sendMagicLinkEmail: jest.fn(), sendWelcomeEmail: jest.fn() }));
jest.unstable_mockModule("../src/services/analytics.js", () => ({ logTenantEvent: jest.fn() }));
jest.unstable_mockModule("../src/services/mobileNotifications.js", () => ({ notifyTenantAdmins: jest.fn() }));
jest.unstable_mockModule("../src/utils/authCookie.js", () => ({ clearAuthCookie: jest.fn(), setAuthCookie: jest.fn() }));
jest.unstable_mockModule("../src/services/invites.js", () => ({ findInviteByOpaqueToken: jest.fn(), markInviteUsed: jest.fn() }));
jest.unstable_mockModule("../src/utils/tokens.js", () => ({ hashOpaqueToken: jest.fn() }));
jest.unstable_mockModule("../src/services/billingState.js", () => ({ isTenantBillingAccessAllowed: jest.fn() }));
jest.unstable_mockModule("../src/services/accessPolicy.js", () => ({
  createTenantAccessCodeGrant: jest.fn(), isEmailAllowedByPolicy: jest.fn(), resolveTenantAccessPolicy: jest.fn(),
  verifyTenantAccessCodeGrant: jest.fn(), verifyTenantAccessCode: jest.fn()
}));
jest.unstable_mockModule("../src/utils/location.js", () => ({
  canonicalizeCityName: jest.fn(), canonicalizeCountryName: jest.fn(), composeCityState: jest.fn(), parseCityStateDetailed: jest.fn()
}));
jest.unstable_mockModule("../src/services/memberEligibility.js", () => ({
  MINIMUM_MEMBER_AGE: 14, isMemberEligibilityComplete: jest.fn(), normalizeMemberLegalAgreement: jest.fn()
}));
jest.unstable_mockModule("../src/services/memberDirectoryCache.js", () => ({ clearMemberDirectoryCaches: jest.fn() }));
jest.unstable_mockModule("../src/services/identityUsers.js", () => ({ isSuperIdentityAllowed: jest.fn(), superAllowlistConfigured: jest.fn() }));
jest.unstable_mockModule("../src/services/accountConfirmation.js", () => ({
  accountConfirmationRequired: (user) => Boolean(user?.accountConfirmationRequestId),
  accountConfirmationError: () => ({ code: "ACCOUNT_CONFIRMATION_REQUIRED", nextRoute: "/t/greenlane/account-confirmation" })
}));

const { authenticatedTenantResponse } = await import("../src/routes/tenantAuth.js");
const { confirmationRequiredSuperAuthResponse } = await import("../src/routes/superAuth.js");

const pendingUser = Object.freeze({
  _id: "member-1", tenantId: "greenlane-id", email: "recovered@greenlane.test", roles: ["user"],
  accountConfirmationRequestId: "server-only-request", passwordHash: "not-for-client"
});
const privateProfile = Object.freeze({ firstName: "Recovered", lastName: "Member", avatarUrl: "https://private.example/avatar.png" });

function expectConfirmationOnly(response, tenantId) {
  expect(response).toEqual({
    token: "credential-token",
    confirmationRequired: true,
    nextRoute: "/t/greenlane/account-confirmation",
    user: { id: "member-1", _id: "member-1", tenantId, email: "recovered@greenlane.test", roles: ["user"] }
  });
  expect(JSON.stringify(response)).not.toContain("server-only-request");
  expect(JSON.stringify(response)).not.toContain("Recovered");
  expect(JSON.stringify(response)).not.toContain("private.example");
  expect(JSON.stringify(response)).not.toContain("passwordHash");
}

test("tenant password, magic-link, and demo response helper exposes only confirmation bootstrap for a marked member", () => {
  expectConfirmationOnly(authenticatedTenantResponse({ token: "credential-token", user: pendingUser, profile: privateProfile }), "greenlane-id");
});

test("super credential response exposes only confirmation bootstrap for a marked member", () => {
  expectConfirmationOnly(confirmationRequiredSuperAuthResponse({ token: "credential-token", user: pendingUser }), "greenlane-id");
});

test("ordinary tenant credential response remains normal but never exposes the server-only marker", () => {
  const response = authenticatedTenantResponse({
    token: "credential-token", user: { ...pendingUser, accountConfirmationRequestId: null }, profile: privateProfile
  });
  expect(response.confirmationRequired).toBeUndefined();
  expect(response.user.firstName).toBe("Recovered");
  expect(response.profile).toBe(privateProfile);
  expect(response.user.accountConfirmationRequestId).toBeUndefined();
});
