import { jest } from "@jest/globals";

jest.setTimeout(30000);

let accessPolicy;
let hashPassword;

beforeAll(async () => {
  process.env.JWT_SECRET = "access-policy-test-secret";
  process.env.BCRYPT_ROUNDS = "4";
  accessPolicy = await import("../src/services/accessPolicy.js");
  ({ hashPassword } = await import("../src/utils/auth.js"));
});

describe("tenant access policy", () => {
  test("control tenants without an explicit policy remain open", () => {
    const policy = accessPolicy.resolveTenantAccessPolicy({
      _id: "control-tenant",
      settings: {}
    });

    expect(policy.signupMode).toBe("open");
    expect(policy.joinMode).toBe("open_join");
    expect(accessPolicy.isEmailAllowedByPolicy(policy, "member@anywhere.test")).toBe(true);
  });

  test("target tenant policy preserves invite mode, domains, and profile requirement", () => {
    const policy = accessPolicy.resolveTenantAccessPolicy({
      _id: "target-tenant",
      settings: {
        signupMode: "invite_only",
        allowedEmailDomains: ["@camp.org", "CAMP.ORG", "alumni.camp.org"],
        requireProfileCompletion: true
      }
    });

    expect(policy.signupMode).toBe("invite_only");
    expect(policy.joinMode).toBe("invite_only");
    expect(policy.allowedEmailDomains).toEqual(["camp.org", "alumni.camp.org"]);
    expect(policy.requireProfileCompletion).toBe(true);
    expect(accessPolicy.isEmailAllowedByPolicy(policy, "member@camp.org")).toBe(true);
    expect(accessPolicy.isEmailAllowedByPolicy(policy, "member@other.org")).toBe(false);
  });

  test("code verification and short-lived grants are tenant scoped", async () => {
    const accessCodeHash = await hashPassword("CampCode42");
    const targetTenant = {
      _id: "target-tenant",
      settings: { signupMode: "code", accessCodeHash }
    };
    const controlTenant = {
      _id: "control-tenant",
      settings: { signupMode: "code", accessCodeHash }
    };

    await expect(accessPolicy.verifyTenantAccessCode(targetTenant, "wrong-code")).resolves.toBe(false);
    await expect(accessPolicy.verifyTenantAccessCode(targetTenant, "CampCode42")).resolves.toBe(true);

    const grant = accessPolicy.createTenantAccessCodeGrant(targetTenant);
    expect(accessPolicy.verifyTenantAccessCodeGrant(targetTenant, grant)).toBe(true);
    expect(accessPolicy.verifyTenantAccessCodeGrant(controlTenant, grant)).toBe(false);
  });
});
