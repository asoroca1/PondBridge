import { createClerkClient } from "@clerk/backend";
import { env } from "../src/config/env.js";
import { UserModel } from "../src/db/models/index.js";
import { getSupabaseAdmin } from "../src/db/supabaseAdmin.js";

const SUPER_CONSOLE_ROLES = new Set(["super_admin", "support_admin", "finance_admin"]);
const TENANT_MEMBERSHIP_BLOCKERS = {
  conversations: "participant_ids",
  messages: "sender_id",
  forum_posts: "author_id",
  photos: "owner_id",
  family_trees: "created_by_user_id"
};

function parseArgs(argv = []) {
  const args = { apply: false, targetEmail: "", removeTenantSlug: "" };
  for (const entry of argv) {
    if (entry === "--apply") {
      args.apply = true;
      continue;
    }
    if (entry.startsWith("--target-email=")) {
      args.targetEmail = entry.slice("--target-email=".length).trim().toLowerCase();
      continue;
    }
    if (entry.startsWith("--remove-tenant-slug=")) {
      args.removeTenantSlug = entry.slice("--remove-tenant-slug=".length).trim().toLowerCase();
    }
  }
  return args;
}

function removeSuperConsoleRoles(roles = []) {
  return (roles || []).filter((role) => !SUPER_CONSOLE_ROLES.has(String(role || "").trim()));
}

function uniqueById(items = []) {
  const seen = new Set();
  const unique = [];
  for (const item of items || []) {
    const id = String(item?._id || item?.id || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    unique.push(item);
  }
  return unique;
}

async function findClerkUserByEmail(email) {
  const clerk = createClerkClient({ secretKey: env.CLERK_SECRET_KEY });
  const result = await clerk.users.getUserList({ emailAddress: [email] });
  if (Number(result?.totalCount || 0) !== 1 || !result?.data?.[0]) {
    throw new Error(`Expected exactly one Clerk user for ${email}, found ${Number(result?.totalCount || 0)}.`);
  }
  return result.data[0];
}

async function loadGlobalSuperRows() {
  return UserModel.find({
    tenantId: null,
    roles: { $contains: ["super_admin"] }
  });
}

async function loadTargetCandidates(targetEmail, clerkUserId) {
  const [byEmail, byClerkUserId] = await Promise.all([
    UserModel.find({ tenantId: null, email: targetEmail }),
    UserModel.find({ tenantId: null, clerkUserId })
  ]);
  return uniqueById([...byEmail, ...byClerkUserId]);
}

async function loadTenantMembershipByEmail(email, tenantSlug) {
  const sb = getSupabaseAdmin();
  const { data: tenant, error: tenantError } = await sb
    .from("tenants")
    .select("id,slug,name")
    .eq("slug", tenantSlug)
    .maybeSingle();
  if (tenantError) throw tenantError;
  if (!tenant) return null;

  const { data: users, error: userError } = await sb
    .from("users")
    .select("id,email,tenant_id,roles,status,clerk_user_id,profile_id")
    .eq("tenant_id", tenant.id)
    .eq("email", email)
    .limit(1);
  if (userError) throw userError;
  return {
    tenant,
    user: users?.[0] || null
  };
}

async function loadMembershipDependencies({ tenantId, userId, profileId, email }) {
  const sb = getSupabaseAdmin();
  const blockers = {};
  for (const [table, column] of Object.entries(TENANT_MEMBERSHIP_BLOCKERS)) {
    let query = sb.from(table).select("id,tenant_id", { count: "exact" }).eq("tenant_id", tenantId);
    query =
      table === "conversations"
        ? query.contains(column, [userId])
        : query.eq(column, userId);
    const { count, error } = await query;
    if (error) throw error;
    blockers[table] = Number(count || 0);
  }

  const [profileResult, activityResult, analyticsResult, inviteResult, accessResult] = await Promise.all([
    sb.from("profiles").select("id", { count: "exact" }).eq("tenant_id", tenantId).or(`id.eq.${profileId},user_id.eq.${userId}`),
    sb.from("activity_items").select("id", { count: "exact" }).eq("tenant_id", tenantId).eq("actor_user_id", userId),
    sb.from("analytics_events").select("id", { count: "exact" }).eq("tenant_id", tenantId).eq("user_id", userId),
    sb.from("invites").select("id", { count: "exact" }).eq("tenant_id", tenantId).eq("email", email),
    sb.from("access_requests").select("id", { count: "exact" }).eq("tenant_id", tenantId).eq("email", email)
  ]);

  if (profileResult.error) throw profileResult.error;
  if (activityResult.error) throw activityResult.error;
  if (analyticsResult.error) throw analyticsResult.error;
  if (inviteResult.error) throw inviteResult.error;
  if (accessResult.error) throw accessResult.error;

  return {
    blockers,
    deletable: {
      profiles: Number(profileResult.count || 0),
      activity_items: Number(activityResult.count || 0),
      analytics_events: Number(analyticsResult.count || 0),
      invites: Number(inviteResult.count || 0),
      access_requests: Number(accessResult.count || 0),
      users: 1
    }
  };
}

async function deleteTenantMembership({ tenantId, userId, profileId, email }) {
  const sb = getSupabaseAdmin();
  const deletes = [];
  if (profileId) {
    deletes.push(
      sb.from("profiles").delete().eq("tenant_id", tenantId).or(`id.eq.${profileId},user_id.eq.${userId}`)
    );
  } else {
    deletes.push(sb.from("profiles").delete().eq("tenant_id", tenantId).eq("user_id", userId));
  }
  deletes.push(sb.from("activity_items").delete().eq("tenant_id", tenantId).eq("actor_user_id", userId));
  deletes.push(sb.from("analytics_events").delete().eq("tenant_id", tenantId).eq("user_id", userId));
  deletes.push(sb.from("invites").delete().eq("tenant_id", tenantId).eq("email", email));
  deletes.push(sb.from("access_requests").delete().eq("tenant_id", tenantId).eq("email", email));
  deletes.push(sb.from("users").delete().eq("tenant_id", tenantId).eq("id", userId));

  for (const operation of deletes) {
    const { error } = await operation;
    if (error) throw error;
  }
}

function summarizeRows(rows = []) {
  return (rows || []).map((row) => ({
    id: row._id,
    email: row.email,
    tenantId: row.tenantId,
    roles: row.roles || [],
    status: row.status,
    clerkUserId: row.clerkUserId || ""
  }));
}

async function main() {
  const { apply, targetEmail, removeTenantSlug } = parseArgs(process.argv.slice(2));
  if (!targetEmail) {
    throw new Error("Missing --target-email=<email>.");
  }

  const clerkUser = await findClerkUserByEmail(targetEmail);
  const clerkUserId = String(clerkUser.id || "").trim();
  const existingSuperRows = await loadGlobalSuperRows();
  const targetCandidates = await loadTargetCandidates(targetEmail, clerkUserId);
  const membershipSelection = removeTenantSlug
    ? await loadTenantMembershipByEmail(targetEmail, removeTenantSlug)
    : null;
  const membershipDependencies =
    membershipSelection?.tenant && membershipSelection?.user
      ? await loadMembershipDependencies({
          tenantId: membershipSelection.tenant.id,
          userId: membershipSelection.user.id,
          profileId: membershipSelection.user.profile_id || "",
          email: targetEmail
        })
      : null;

  const primaryTarget = targetCandidates[0] || null;
  const duplicateTargets = targetCandidates.slice(1);
  const targetPatch = {
    email: targetEmail,
    clerkUserId,
    status: "active",
    roles: ["super_admin"]
  };

  const plan = {
    targetEmail,
    apply,
    clerkUser: {
      id: clerkUserId,
      emails: (clerkUser.emailAddresses || []).map((entry) => entry.emailAddress)
    },
    before: {
      globalSuperRows: summarizeRows(existingSuperRows),
      targetCandidates: summarizeRows(targetCandidates),
      tenantMembershipToRemove: membershipSelection
        ? {
            tenant: membershipSelection.tenant,
            user: membershipSelection.user,
            dependencies: membershipDependencies
          }
        : null
    },
    actions: {
      createTargetGlobalUser: !primaryTarget,
      updateTargetGlobalUser: Boolean(
        primaryTarget &&
          (
            primaryTarget.email !== targetPatch.email ||
            primaryTarget.clerkUserId !== targetPatch.clerkUserId ||
            primaryTarget.status !== targetPatch.status ||
            JSON.stringify(primaryTarget.roles || []) !== JSON.stringify(targetPatch.roles)
          )
      ),
      deleteDuplicateTargetRows: summarizeRows(duplicateTargets),
      sanitizeOtherGlobalSuperRows: summarizeRows(
        existingSuperRows.filter((row) => String(row._id) !== String(primaryTarget?._id || ""))
      )
    }
  };

  if (membershipDependencies) {
    const blockers = Object.entries(membershipDependencies.blockers).filter(([, count]) => count > 0);
    if (blockers.length > 0) {
      throw new Error(
        `Refusing to remove ${removeTenantSlug} membership because authored content exists: ${blockers
          .map(([key, count]) => `${key}=${count}`)
          .join(", ")}`
      );
    }
  }

  if (!apply) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  let targetRow = primaryTarget;
  if (!targetRow) {
    targetRow = await UserModel.create({
      tenantId: null,
      clerkUserId,
      email: targetEmail,
      passwordHash: "clerk_managed",
      roles: ["super_admin"],
      status: "active"
    });
  } else {
    targetRow = await UserModel.update(targetRow._id, targetPatch);
  }

  for (const duplicate of duplicateTargets) {
    await UserModel.delete(duplicate._id);
  }

  const sanitizedRows = [];
  for (const row of existingSuperRows) {
    if (String(row._id) === String(targetRow._id)) continue;
    const nextRoles = removeSuperConsoleRoles(row.roles || []);
    const patch = {};
    if (JSON.stringify(nextRoles) !== JSON.stringify(row.roles || [])) patch.roles = nextRoles;
    if (Object.keys(patch).length === 0) continue;
    sanitizedRows.push(await UserModel.update(row._id, patch));
  }

  if (membershipSelection?.tenant && membershipSelection?.user) {
    await deleteTenantMembership({
      tenantId: membershipSelection.tenant.id,
      userId: membershipSelection.user.id,
      profileId: membershipSelection.user.profile_id || "",
      email: targetEmail
    });
  }

  const finalSuperRows = await loadGlobalSuperRows();
  const report = {
    targetEmail,
    clerkUserId,
    targetGlobalUser: summarizeRows([targetRow])[0] || null,
    sanitizedRows: summarizeRows(sanitizedRows),
    removedTenantMembership: membershipSelection?.tenant
      ? {
          tenant: membershipSelection.tenant,
          userId: membershipSelection.user?.id || null
        }
      : null,
    remainingGlobalSuperRows: summarizeRows(finalSuperRows)
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error("[switchSuperAdminIdentity] failed", error);
  process.exit(1);
});
