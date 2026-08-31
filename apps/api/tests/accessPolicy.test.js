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

describe("signup review gate", () => {
  test("a network with no gate lets an approved entry mode through", () => {
    const policy = accessPolicy.resolveTenantAccessPolicy({
      _id: "open-tenant",
      settings: { signupMode: "open" }
    });

    expect(policy.entryMode).toBe("open");
    expect(policy.requireApproval).toBe(false);
    expect(policy.joinMode).toBe("open_join");
  });

  test("invitation-only and the review gate combine instead of competing", () => {
    const policy = accessPolicy.resolveTenantAccessPolicy({
      _id: "gated-invite-tenant",
      settings: { signupMode: "invite_only", requireSignupApproval: true }
    });

    // The invitation still governs who reaches the form...
    expect(policy.entryMode).toBe("invite_only");
    // ...and the director still decides who actually gets in.
    expect(policy.requireApproval).toBe(true);
    expect(policy.joinMode).toBe("approval_required");
  });

  test("the gate layers onto a join code without disabling it", async () => {
    const accessCodeHash = await hashPassword("reunion-2026");
    const policy = accessPolicy.resolveTenantAccessPolicy({
      _id: "gated-code-tenant",
      settings: { signupMode: "code", accessCodeHash, requireSignupApproval: true }
    });

    expect(policy.entryMode).toBe("code");
    expect(policy.requireApproval).toBe(true);
    await expect(
      accessPolicy.verifyTenantAccessCode({ _id: "gated-code-tenant", settings: { signupMode: "code", accessCodeHash } }, "reunion-2026")
    ).resolves.toBe(true);
  });

  test("networks saved before the gate existed keep behaving identically", () => {
    const policy = accessPolicy.resolveTenantAccessPolicy({
      _id: "legacy-tenant",
      settings: { signupMode: "approval_queue" }
    });

    // The old single setting meant open entry plus a director decision, and
    // that is exactly what it still means.
    expect(policy.entryMode).toBe("open");
    expect(policy.requireApproval).toBe(true);
    expect(policy.joinMode).toBe("approval_required");
  });

  test("an allowed-domain restriction still applies underneath the gate", () => {
    const policy = accessPolicy.resolveTenantAccessPolicy({
      _id: "gated-domain-tenant",
      settings: {
        signupMode: "open",
        requireSignupApproval: true,
        allowedEmailDomains: ["camp.org"]
      }
    });

    expect(policy.requireApproval).toBe(true);
    expect(accessPolicy.isEmailAllowedByPolicy(policy, "alum@camp.org")).toBe(true);
    expect(accessPolicy.isEmailAllowedByPolicy(policy, "stranger@elsewhere.test")).toBe(false);
  });
});
