import { UserModel } from "../db/models/index.js";
import { deleteClerkUserAccount } from "./clerkIdentity.js";

const PRIVILEGED_GLOBAL_ROLES = new Set(["super_admin", "support_admin", "finance_admin"]);

function userId(user = {}) {
  return String(user?._id || user?.id || "").trim();
}

export function clerkAccountDeletionDecision({
  targetUserId = "",
  memberships = [],
  globalUser = null
} = {}) {
  const normalizedTargetUserId = String(targetUserId || "").trim();
  const remainingMemberships = (Array.isArray(memberships) ? memberships : []).filter(
    (membership) => userId(membership) !== normalizedTargetUserId
  );

  if (remainingMemberships.length > 0) {
    return { shouldDelete: false, reason: "remaining_network_memberships" };
  }

  const globalRoles = new Set(
    (Array.isArray(globalUser?.roles) ? globalUser.roles : [])
      .map((role) => String(role || "").trim().toLowerCase())
      .filter(Boolean)
  );
  if ([...PRIVILEGED_GLOBAL_ROLES].some((role) => globalRoles.has(role))) {
    return { shouldDelete: false, reason: "privileged_global_account" };
  }

  return { shouldDelete: true, reason: "last_network_membership" };
}

/**
 * Deletes the external Clerk account before tenant data is erased. If Clerk
 * rejects the request, the local member remains available for a safe retry.
 */
export async function deleteClerkAccountForTenantUser({
  clerkUserId = "",
  targetUserId = "",
  userModel = UserModel,
  deleteClerkUser = deleteClerkUserAccount
} = {}) {
  const normalizedClerkUserId = String(clerkUserId || "").trim();
  if (!normalizedClerkUserId) {
    return { status: "skipped", reason: "missing_clerk_user_id" };
  }

  const [memberships, globalUser] = await Promise.all([
    userModel.findMembershipsByClerkUserId(normalizedClerkUserId),
    userModel.findGlobalByClerkUserId(normalizedClerkUserId)
  ]);
  const decision = clerkAccountDeletionDecision({
    targetUserId,
    memberships,
    globalUser
  });
  if (!decision.shouldDelete) {
    return { status: "skipped", reason: decision.reason };
  }

  return deleteClerkUser(normalizedClerkUserId);
}
