import { jest } from "@jest/globals";
import {
  clerkAccountDeletionDecision,
  deleteClerkAccountForTenantUser
} from "../src/services/clerkAccountDeletion.js";

describe("Clerk account deletion policy", () => {
  test("deletes Clerk when the target is the final network membership", () => {
    expect(clerkAccountDeletionDecision({
      targetUserId: "user-a",
      memberships: [{ _id: "user-a", tenantId: "camp-a" }]
    })).toEqual({
      shouldDelete: true,
      reason: "last_network_membership"
    });
  });

  test("preserves Clerk when another network membership remains", () => {
    expect(clerkAccountDeletionDecision({
      targetUserId: "user-a",
      memberships: [
        { _id: "user-a", tenantId: "camp-a" },
        { _id: "user-b", tenantId: "camp-b" }
      ]
    })).toEqual({
      shouldDelete: false,
      reason: "remaining_network_memberships"
    });
  });

  test("preserves Clerk for a privileged global account", () => {
    expect(clerkAccountDeletionDecision({
      targetUserId: "user-a",
      memberships: [{ _id: "user-a", tenantId: "camp-a" }],
      globalUser: { roles: ["support_admin"] }
    })).toEqual({
      shouldDelete: false,
      reason: "privileged_global_account"
    });
  });

  test("deletes the Clerk user when the target is the only membership", async () => {
    const deleteClerkUser = jest.fn().mockResolvedValue({ status: "deleted" });
    const result = await deleteClerkAccountForTenantUser({
      clerkUserId: "clerk-user-a",
      targetUserId: "user-a",
      userModel: {
        findMembershipsByClerkUserId: jest.fn().mockResolvedValue([
          { _id: "user-a", tenantId: "camp-a" }
        ]),
        findGlobalByClerkUserId: jest.fn().mockResolvedValue(null)
      },
      deleteClerkUser
    });

    expect(deleteClerkUser).toHaveBeenCalledWith("clerk-user-a");
    expect(result).toEqual({ status: "deleted" });
  });

  test("does not call Clerk while another network membership remains", async () => {
    const deleteClerkUser = jest.fn();
    const result = await deleteClerkAccountForTenantUser({
      clerkUserId: "clerk-user-a",
      targetUserId: "user-a",
      userModel: {
        findMembershipsByClerkUserId: jest.fn().mockResolvedValue([
          { _id: "user-a", tenantId: "camp-a" },
          { _id: "user-b", tenantId: "camp-b" }
        ]),
        findGlobalByClerkUserId: jest.fn().mockResolvedValue(null)
      },
      deleteClerkUser
    });

    expect(deleteClerkUser).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: "skipped",
      reason: "remaining_network_memberships"
    });
  });
});
