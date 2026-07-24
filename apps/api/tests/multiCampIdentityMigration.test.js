import {
  buildMultiCampIdentityBackfillPlan,
  summarizeMultiCampIdentityBackfillPlan
} from "../src/services/multiCampIdentityMigration.js";
import {
  buildMembershipBackedUser,
  canDeleteUnusedIdentity
} from "../src/services/identityUsers.js";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("multi-camp identity backfill planning", () => {
  test("merges the same Clerk identity into isolated tenant memberships", () => {
    const plan = buildMultiCampIdentityBackfillPlan([
      { _id: "u-a", tenantId: "camp-a", clerkUserId: "clerk-1", email: "Person@Example.com", roles: ["user"] },
      { _id: "u-b", tenantId: "camp-b", clerkUserId: "clerk-1", email: "person@example.com", roles: ["tenant_admin", "user"] }
    ]);
    expect(summarizeMultiCampIdentityBackfillPlan(plan)).toMatchObject({
      sourceUserCount: 2,
      identityCount: 1,
      membershipCount: 2,
      collisionCount: 0
    });
    expect(plan.identities[0].memberships.map((item) => item.tenantId).sort()).toEqual(["camp-a", "camp-b"]);
  });

  test("does not auto-merge an email attached to different Clerk identities", () => {
    const plan = buildMultiCampIdentityBackfillPlan([
      { _id: "u-a", tenantId: "camp-a", clerkUserId: "clerk-1", email: "person@example.com", roles: ["user"] },
      { _id: "u-b", tenantId: "camp-b", clerkUserId: "clerk-2", email: "person@example.com", roles: ["user"] }
    ]);
    expect(plan.identityCount).toBe(0);
    expect(plan.collisionCount).toBe(1);
    expect(plan.collisions[0]).toMatchObject({ type: "email_multiple_clerk_identities", count: 2 });
    expect(plan.collisions[0].subject).not.toContain("@");
  });

  test("keeps platform roles on identity and camp roles on membership", () => {
    const plan = buildMultiCampIdentityBackfillPlan([
      { _id: "global", tenantId: null, email: "ops@example.com", roles: ["super_admin"] },
      { _id: "member", tenantId: "camp-a", email: "ops@example.com", roles: ["tenant_admin", "user"] }
    ]);
    expect(plan.identities[0].platformRoles).toEqual(["super_admin"]);
    expect(plan.identities[0].memberships[0].roles).toEqual(["tenant_admin", "user"]);
  });

  test("standalone schema keeps cross-camp compatibility writes behind the durable rollout", async () => {
    const sql = await fs.readFile(
      path.resolve(__dirname, "../scripts/multi_camp_identity_schema.sql"),
      "utf8"
    );
    expect(sql).toContain("feature_key = 'multi_camp_identity_v1'");
    expect(sql).toContain("fr.kill_switch = false");
    expect(sql).toContain("fr.state = 'pilot'");
    expect(sql).toContain("fr.excluded_tenant_ids");
    expect(sql).toContain("CREATE TRIGGER trigger_enforce_single_tenant_membership");
    expect(sql).toContain("SET search_path = pg_catalog, public");
  });

  test("membership-backed authorization uses camp roles and rejects inactive or cross-camp links", () => {
    const identity = { _id: "identity-1", status: "active" };
    const legacyUser = {
      _id: "legacy-b",
      tenantId: "camp-b",
      roles: ["user"],
      status: "active",
      email: "person@example.com"
    };
    const membership = {
      _id: "membership-b",
      tenantId: "camp-b",
      identityId: "identity-1",
      legacyUserId: "legacy-b",
      roles: ["tenant_admin", "user"],
      status: "active"
    };

    expect(buildMembershipBackedUser({
      tenantId: "camp-b",
      globalIdentity: identity,
      membership,
      user: legacyUser
    })).toMatchObject({
      tenantId: "camp-b",
      roles: ["tenant_admin", "user"],
      tenantMembershipId: "membership-b",
      authorizationSource: "tenant_membership"
    });
    expect(buildMembershipBackedUser({
      tenantId: "camp-a",
      globalIdentity: identity,
      membership,
      user: legacyUser
    })).toBeNull();
    expect(buildMembershipBackedUser({
      tenantId: "camp-b",
      globalIdentity: identity,
      membership: { ...membership, status: "inactive" },
      user: legacyUser
    })).toBeNull();
  });

  test("one-camp deletion preserves shared and platform identities", () => {
    expect(canDeleteUnusedIdentity({ remainingMembershipCount: 1, platformRoles: [] })).toBe(false);
    expect(canDeleteUnusedIdentity({ remainingMembershipCount: 0, platformRoles: ["support_admin"] })).toBe(false);
    expect(canDeleteUnusedIdentity({ remainingMembershipCount: 0, platformRoles: [] })).toBe(true);
  });
});
