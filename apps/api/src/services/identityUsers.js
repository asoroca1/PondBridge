import {
  IdentityModel,
  TenantMembershipModel,
  UserModel
} from "../db/models/index.js";
import { env } from "../config/env.js";
import { syncClerkTenantMetadata } from "./clerkIdentity.js";
import {
  evaluateFeatureRollout,
  MULTI_CAMP_IDENTITY_FLAG
} from "./featureRollouts.js";

const SUPER_CONSOLE_ROLES = new Set(["super_admin", "support_admin", "finance_admin"]);

function normalizeEmail(value = "") {
  return String(value || "").trim().toLowerCase();
}

function normalizeTenantId(value = "") {
  return String(value || "").trim();
}

function isMissingIdentitySchema(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "");
  return code === "42P01" || code === "PGRST205" ||
    /(identities|tenant_memberships).*(does not exist|schema cache)/i.test(message);
}

function mergeRoleSet(existing = [], required = []) {
  return [...new Set([...(existing || []), ...(required || [])].map((role) => String(role || "").trim()).filter(Boolean))];
}

function toEpoch(value) {
  const n = new Date(value || 0).getTime();
  return Number.isFinite(n) ? n : 0;
}

function uniqueById(items = []) {
  const map = new Map();
  for (const item of items || []) {
    const id = String(item?._id || item?.id || "").trim();
    if (!id || map.has(id)) continue;
    map.set(id, item);
  }
  return [...map.values()];
}

function resolvePrimaryTenantRole(roles = []) {
  const roleSet = new Set((roles || []).map((role) => String(role || "").trim().toLowerCase()).filter(Boolean));
  if (roleSet.has("super_admin")) return "super_admin";
  if (roleSet.has("tenant_admin") || roleSet.has("admin")) return "tenant_admin";
  return "user";
}

async function enforceClerkTenantMetadataSync({
  clerkUserId = "",
  tenantId = "",
  tenantSlug = "",
  role = "user"
} = {}) {
  const syncResult = await syncClerkTenantMetadata({
    clerkUserId,
    tenantId,
    tenantSlug,
    role
  });
  if (syncResult?.status !== "conflict") return syncResult;

  const error = new Error("Clerk identity is already scoped to a different tenant.");
  error.statusCode = 403;
  error.code = "TENANT_SCOPE_DENIED";
  error.details = {
    tenantId: normalizeTenantId(tenantId),
    existingTenantId: normalizeTenantId(syncResult?.existingTenantId || "")
  };
  throw error;
}

function rolesChanged(current = [], next = []) {
  const a = new Set((current || []).map((role) => String(role || "").trim()).filter(Boolean));
  const b = new Set((next || []).map((role) => String(role || "").trim()).filter(Boolean));
  if (a.size !== b.size) return true;
  for (const role of b) {
    if (!a.has(role)) return true;
  }
  return false;
}

function isSuperAllowlisted(identity = {}) {
  const email = normalizeEmail(identity.email || "");
  const clerkUserId = String(identity.clerkUserId || "").trim();
  if (email && env.CLERK_SUPER_ADMIN_EMAILS.includes(email)) return true;
  if (clerkUserId && env.CLERK_SUPER_ADMIN_USER_IDS.includes(clerkUserId)) return true;
  return false;
}

export function superAllowlistConfigured() {
  return env.CLERK_SUPER_ADMIN_EMAILS.length > 0 || env.CLERK_SUPER_ADMIN_USER_IDS.length > 0;
}

export function isSuperIdentityAllowed(identity = {}, fallbackEmail = "") {
  const merged = {
    ...identity,
    email: identity?.email || fallbackEmail || ""
  };
  return isSuperAllowlisted(merged);
}

export function applySuperConsoleRolePolicy(roles = [], identity = {}, fallbackEmail = "") {
  const normalizedRoles = (roles || []).map((role) => String(role || "").trim()).filter(Boolean);
  const hasSuperConsoleRole = normalizedRoles.some((role) => SUPER_CONSOLE_ROLES.has(role));
  if (!hasSuperConsoleRole) return normalizedRoles;
  if (!superAllowlistConfigured()) return normalizedRoles;
  if (isSuperIdentityAllowed(identity, fallbackEmail)) return normalizedRoles;
  return normalizedRoles.filter((role) => !SUPER_CONSOLE_ROLES.has(role));
}

async function globalSuperAdminCount() {
  return UserModel.count({
    tenantId: null,
    roles: { $contains: ["super_admin"] }
  });
}

async function coalesceGlobalUsers(candidates = [], identity = {}) {
  const unique = uniqueById(candidates).sort((a, b) => toEpoch(a.createdAt) - toEpoch(b.createdAt));
  if (!unique.length) return null;

  let primary = unique[0];
  const duplicates = unique.slice(1);
  if (!duplicates.length) return primary;

  const mergedRoles = mergeRoleSet([], unique.flatMap((item) => item.roles || []));
  const activeStatus = unique.some((item) => item.status === "active") ? "active" : primary.status || "active";
  const preferredEmail = normalizeEmail(identity.email || primary.email || "");
  const preferredClerkUserId = String(identity.clerkUserId || primary.clerkUserId || "").trim();

  const patch = {};
  if (preferredEmail && primary.email !== preferredEmail) patch.email = preferredEmail;
  if (preferredClerkUserId && primary.clerkUserId !== preferredClerkUserId) patch.clerkUserId = preferredClerkUserId;
  if (rolesChanged(primary.roles || [], mergedRoles)) patch.roles = mergedRoles;
  if (activeStatus && primary.status !== activeStatus) patch.status = activeStatus;

  if (Object.keys(patch).length > 0) {
    primary = await UserModel.update(primary._id, patch);
  }

  for (const duplicate of duplicates) {
    try {
      await UserModel.delete(duplicate._id);
    } catch {
      // Best-effort cleanup: do not block auth if a duplicate row cannot be deleted.
    }
  }

  return primary;
}

export async function ensureGlobalSuperAdmin(identity = {}) {
  const clerkUserId = String(identity.clerkUserId || "").trim();
  const email = normalizeEmail(identity.email || "");
  const allowlisted = isSuperAllowlisted(identity);
  const allowlistSet = superAllowlistConfigured();

  if (!clerkUserId && !email) return null;

  const [matchesByClerkUserId, matchesByEmail] = await Promise.all([
    clerkUserId ? UserModel.find({ tenantId: null, clerkUserId }) : Promise.resolve([]),
    email ? UserModel.find({ tenantId: null, email }) : Promise.resolve([])
  ]);
  let existing = await coalesceGlobalUsers([...matchesByClerkUserId, ...matchesByEmail], identity);

  const shouldBootstrap =
    allowlisted ||
    (!allowlistSet && env.CLERK_BOOTSTRAP_FIRST_SUPER_ADMIN && (await globalSuperAdminCount()) === 0);

  if (!existing && !shouldBootstrap) return null;

  if (!existing) {
    return UserModel.create({
      tenantId: null,
      clerkUserId: clerkUserId || null,
      email: email || `${clerkUserId}@clerk.local`,
      passwordHash: "clerk_managed",
      roles: ["super_admin"]
    });
  }

  if (allowlistSet && !allowlisted) {
    const sanitizedRoles = (existing.roles || []).filter((role) => !SUPER_CONSOLE_ROLES.has(role));
    const patch = {};
    if ((existing.roles || []).length !== sanitizedRoles.length) patch.roles = sanitizedRoles;
    if (!existing.clerkUserId && clerkUserId) patch.clerkUserId = clerkUserId;
    if (email && existing.email !== email) patch.email = email;
    if (Object.keys(patch).length === 0) return existing;
    return UserModel.update(existing._id, patch);
  }

  const nextRoles = mergeRoleSet(existing.roles, ["super_admin"]);
  const patch = {};
  if (!existing.clerkUserId && clerkUserId) patch.clerkUserId = clerkUserId;
  if (email && existing.email !== email) patch.email = email;
  if (nextRoles.length !== (existing.roles || []).length) patch.roles = nextRoles;
  if (Object.keys(patch).length === 0) return existing;
  return UserModel.update(existing._id, patch);
}

export async function findTenantUserForIdentity(tenantId, identity = {}) {
  if (!tenantId) return null;
  const clerkUserId = String(identity.clerkUserId || "").trim();
  const email = normalizeEmail(identity.email || "");

  let user = clerkUserId ? await UserModel.findByClerkUserId(tenantId, clerkUserId) : null;
  if (!user && email) {
    user = await UserModel.findByEmail(tenantId, email);
  }

  if (!user) return null;

  const patch = {};
  if (!user.clerkUserId && clerkUserId) patch.clerkUserId = clerkUserId;
  if (email && user.email !== email) patch.email = email;
  if (Object.keys(patch).length === 0) return user;
  return UserModel.update(user._id, patch);
}

async function findGlobalIdentity(identity = {}) {
  const clerkUserId = String(identity?.clerkUserId || "").trim();
  const email = normalizeEmail(identity?.email || "");
  const [byClerk, byEmail] = await Promise.all([
    clerkUserId ? IdentityModel.findOne({ clerkUserId }) : Promise.resolve(null),
    email ? IdentityModel.findOne({ primaryEmail: email }) : Promise.resolve(null)
  ]);
  if (byClerk && byEmail && String(byClerk._id) !== String(byEmail._id)) {
    const error = new Error("Identity references resolve to different global records.");
    error.code = "IDENTITY_COLLISION";
    error.statusCode = 409;
    throw error;
  }
  if (byEmail?.clerkUserId && clerkUserId && byEmail.clerkUserId !== clerkUserId) {
    const error = new Error("Email is already attached to a different global identity.");
    error.code = "IDENTITY_COLLISION";
    error.statusCode = 409;
    throw error;
  }
  return byClerk || byEmail || null;
}

export async function findTenantUserFromMembershipIdentity(tenantId, identity = {}) {
  const normalizedTenantId = normalizeTenantId(tenantId);
  if (!normalizedTenantId) return null;
  const globalIdentity = await findGlobalIdentity(identity);
  if (!globalIdentity || globalIdentity.status !== "active") return null;
  const membership = await TenantMembershipModel.findOne({
    tenantId: normalizedTenantId,
    identityId: globalIdentity._id,
    status: "active"
  });
  if (!membership?.legacyUserId) return null;
  const user = await UserModel.findById(membership.legacyUserId);
  return buildMembershipBackedUser({
    tenantId: normalizedTenantId,
    globalIdentity,
    membership,
    user
  });
}

export function buildMembershipBackedUser({
  tenantId,
  globalIdentity,
  membership,
  user
} = {}) {
  const normalizedTenantId = normalizeTenantId(tenantId);
  if (
    !normalizedTenantId ||
    !globalIdentity ||
    globalIdentity.status !== "active" ||
    !membership ||
    membership.status !== "active" ||
    String(membership.tenantId || "") !== normalizedTenantId ||
    String(membership.identityId || "") !== String(globalIdentity._id || globalIdentity.id || "") ||
    !user ||
    String(user._id || user.id || "") !== String(membership.legacyUserId || "") ||
    String(user.tenantId || "") !== normalizedTenantId
  ) {
    return null;
  }
  return {
    ...user,
    roles: Array.isArray(membership.roles) ? membership.roles : user.roles || [],
    status: membership.status,
    identityId: globalIdentity._id,
    tenantMembershipId: membership._id,
    authorizationSource: "tenant_membership"
  };
}

export function canDeleteUnusedIdentity({ remainingMembershipCount = 0, platformRoles = [] } = {}) {
  return Number(remainingMembershipCount || 0) === 0 &&
    (!Array.isArray(platformRoles) || platformRoles.length === 0);
}

async function ensureIdentityMembership({
  tenantId,
  identity,
  legacyUser,
  roles,
  status,
  joinMethod
}) {
  const email = normalizeEmail(identity?.email || legacyUser?.email || "");
  const clerkUserId = String(identity?.clerkUserId || legacyUser?.clerkUserId || "").trim();
  if (!email || !legacyUser?._id) {
    throw new Error("A verified email and legacy user are required for membership dual-write.");
  }

  let globalIdentity = await findGlobalIdentity({ email, clerkUserId });
  if (!globalIdentity) {
    try {
      globalIdentity = await IdentityModel.create({
        clerkUserId: clerkUserId || null,
        primaryEmail: email,
        verifiedEmails: [email],
        platformRoles: [],
        status: "active",
        metadata: { source: "membership_dual_write_v1" }
      });
    } catch (error) {
      if (String(error?.code || "") !== "23505") throw error;
      globalIdentity = await findGlobalIdentity({ email, clerkUserId });
      if (!globalIdentity) throw error;
    }
  }

  let membership = await TenantMembershipModel.findOne({
    tenantId,
    identityId: globalIdentity._id
  });
  const payload = {
    tenantId,
    identityId: globalIdentity._id,
    legacyUserId: legacyUser._id,
    roles: mergeRoleSet([], roles || legacyUser.roles || ["user"]),
    status: status === "inactive" ? "inactive" : "active",
    joinMethod: membership?.joinMethod || joinMethod
  };
  membership = membership
    ? await TenantMembershipModel.update(membership._id, payload)
    : await TenantMembershipModel.create(payload);
  return { globalIdentity, membership };
}

async function deleteIdentityWhenUnused(identityId) {
  const normalizedIdentityId = String(identityId || "").trim();
  if (!normalizedIdentityId) return false;
  const remaining = await TenantMembershipModel.count({ identityId: normalizedIdentityId });
  const identity = await IdentityModel.findById(normalizedIdentityId);
  if (!identity || !canDeleteUnusedIdentity({
    remainingMembershipCount: remaining,
    platformRoles: identity.platformRoles || []
  })) return false;
  await IdentityModel.delete(normalizedIdentityId);
  return true;
}

export async function removeTenantMembershipIdentityLink({
  tenantId,
  legacyUserId,
  tenantMembershipId
} = {}) {
  const normalizedTenantId = normalizeTenantId(tenantId);
  const normalizedLegacyUserId = String(legacyUserId || "").trim();
  const normalizedMembershipId = String(tenantMembershipId || "").trim();
  if (!normalizedTenantId || (!normalizedLegacyUserId && !normalizedMembershipId)) {
    return { membershipDeleted: 0, identityDeleted: 0, storageAvailable: true };
  }
  const rollout = await evaluateFeatureRollout(MULTI_CAMP_IDENTITY_FLAG, { _id: normalizedTenantId });
  try {
    const membership = await TenantMembershipModel.findOne(
      normalizedMembershipId
        ? { _id: normalizedMembershipId, tenantId: normalizedTenantId }
        : { tenantId: normalizedTenantId, legacyUserId: normalizedLegacyUserId }
    );
    if (!membership) {
      if (rollout.enabled) {
        const error = new Error("Membership-backed tenant is missing its identity membership record.");
        error.code = "TENANT_MEMBERSHIP_RECORD_REQUIRED";
        error.statusCode = 409;
        throw error;
      }
      return { membershipDeleted: 0, identityDeleted: 0, storageAvailable: true };
    }
    await TenantMembershipModel.delete(membership._id);
    const identityDeleted = await deleteIdentityWhenUnused(membership.identityId);
    return {
      membershipDeleted: 1,
      identityDeleted: identityDeleted ? 1 : 0,
      storageAvailable: true
    };
  } catch (error) {
    if (!rollout.enabled && isMissingIdentitySchema(error)) {
      return { membershipDeleted: 0, identityDeleted: 0, storageAvailable: false };
    }
    throw error;
  }
}

export async function removeAllTenantMembershipIdentityLinks(tenantId) {
  const normalizedTenantId = normalizeTenantId(tenantId);
  if (!normalizedTenantId) {
    return { membershipsDeleted: 0, identitiesDeleted: 0, storageAvailable: true };
  }
  const rollout = await evaluateFeatureRollout(MULTI_CAMP_IDENTITY_FLAG, { _id: normalizedTenantId });
  try {
    const memberships = [];
    const pageSize = 1000;
    for (let offset = 0; offset < 500_000; offset += pageSize) {
      const page = await TenantMembershipModel.find(
        normalizedTenantId,
        {},
        { select: ["id", "identityId"], limit: pageSize, offset }
      );
      memberships.push(...page);
      if (page.length < pageSize) break;
    }
    const identityIds = [...new Set(memberships.map((item) => String(item.identityId || "")).filter(Boolean))];
    if (memberships.length > 0) {
      await TenantMembershipModel.deleteMany(normalizedTenantId, {});
    }
    let identitiesDeleted = 0;
    for (const identityId of identityIds) {
      if (await deleteIdentityWhenUnused(identityId)) identitiesDeleted += 1;
    }
    return {
      membershipsDeleted: memberships.length,
      identitiesDeleted,
      storageAvailable: true
    };
  } catch (error) {
    if (!rollout.enabled && isMissingIdentitySchema(error)) {
      return { membershipsDeleted: 0, identitiesDeleted: 0, storageAvailable: false };
    }
    throw error;
  }
}

export async function findSingleTenantMembershipForIdentity(identity = {}) {
  const memberships = await findTenantMembershipsForIdentity(identity, { activeOnly: false });
  const active = memberships.filter((item) => item.status === "active");
  if (active.length === 1) return active[0];
  if (active.length > 1) return null;
  if (memberships.length === 1) return memberships[0];
  return null;
}

export async function findTenantMembershipsForIdentity(identity = {}, { activeOnly = false } = {}) {
  const clerkUserId = String(identity.clerkUserId || "").trim();
  const email = normalizeEmail(identity.email || "");

  let memberships = clerkUserId ? await UserModel.findMembershipsByClerkUserId(clerkUserId) : [];
  if (memberships.length === 0 && email) {
    memberships = await UserModel.findMembershipsByEmail(email);
  }
  const uniqueMemberships = uniqueById(memberships);
  if (!activeOnly) return uniqueMemberships;
  return uniqueMemberships.filter((item) => item.status === "active");
}

async function assertIdentityTenantBinding({
  tenantId,
  identity,
  allowCrossTenant = false
}) {
  const normalizedTenantId = normalizeTenantId(tenantId);
  if (!normalizedTenantId) return { memberships: [] };

  const memberships = await findTenantMembershipsForIdentity(identity, { activeOnly: true });
  const crossTenantMemberships = memberships.filter(
    (membership) =>
      membership?.tenantId && normalizeTenantId(membership.tenantId) !== normalizedTenantId
  );
  if (allowCrossTenant || crossTenantMemberships.length === 0) {
    return { memberships };
  }

  const error = new Error("Identity is already bound to a different tenant.");
  error.statusCode = 403;
  error.code = "TENANT_SCOPE_DENIED";
  error.details = {
    tenantId: normalizedTenantId,
    existingTenantId: normalizeTenantId(crossTenantMemberships[0]?.tenantId || "")
  };
  throw error;
}

export async function createTenantMembershipFromIdentity({
  tenantId,
  identity,
  roles = ["user"],
  status = "active",
  tenantSlug = "",
  allowCrossTenant = false,
  joinMethod = "open_signup"
}) {
  const rollout = await evaluateFeatureRollout(MULTI_CAMP_IDENTITY_FLAG, { _id: tenantId });
  const membershipBacked = Boolean(rollout.enabled);
  await assertIdentityTenantBinding({
    tenantId,
    identity,
    allowCrossTenant: allowCrossTenant || membershipBacked
  });
  const email = normalizeEmail(identity?.email || "");
  const clerkUserId = String(identity?.clerkUserId || "").trim();
  const existing = await findTenantUserForIdentity(tenantId, identity);
  if (existing) {
    const nextRoles = mergeRoleSet(existing.roles || [], roles || []);
    const patch = {};
    if ((existing.roles || []).length !== nextRoles.length) patch.roles = nextRoles;
    if (status && existing.status !== status) patch.status = status;
    const updated = Object.keys(patch).length === 0 ? existing : await UserModel.update(existing._id, patch);
    let dualWrite = null;
    try {
      dualWrite = await ensureIdentityMembership({
        tenantId,
        identity,
        legacyUser: updated,
        roles: updated.roles || nextRoles,
        status: updated.status || status,
        joinMethod
      });
    } catch (error) {
      if (membershipBacked || !isMissingIdentitySchema(error)) {
        if (Object.keys(patch).length > 0) {
          const rollback = {};
          if (Object.prototype.hasOwnProperty.call(patch, "roles")) rollback.roles = existing.roles || [];
          if (Object.prototype.hasOwnProperty.call(patch, "status")) rollback.status = existing.status || "active";
          await UserModel.update(updated._id, rollback).catch(() => {});
        }
        throw error;
      }
    }
    if (!membershipBacked) {
      await enforceClerkTenantMetadataSync({
        clerkUserId,
        tenantId,
        tenantSlug,
        role: resolvePrimaryTenantRole(updated.roles || nextRoles)
      });
    }
    return dualWrite?.membership
      ? { ...updated, identityId: dualWrite.globalIdentity._id, tenantMembershipId: dualWrite.membership._id }
      : updated;
  }

  const created = await UserModel.create({
    tenantId,
    clerkUserId: clerkUserId || null,
    email: email || `${clerkUserId}@clerk.local`,
    passwordHash: "clerk_managed",
    roles: mergeRoleSet([], roles),
    status
  });
  let dualWrite = null;
  try {
    dualWrite = await ensureIdentityMembership({
      tenantId,
      identity,
      legacyUser: created,
      roles: created.roles || roles,
      status: created.status || status,
      joinMethod
    });
  } catch (error) {
    if (membershipBacked || !isMissingIdentitySchema(error)) {
      await UserModel.delete(created._id).catch(() => {});
      throw error;
    }
  }
  if (!membershipBacked) {
    await enforceClerkTenantMetadataSync({
      clerkUserId,
      tenantId,
      tenantSlug,
      role: resolvePrimaryTenantRole(created.roles || roles)
    });
  }
  return dualWrite?.membership
    ? { ...created, identityId: dualWrite.globalIdentity._id, tenantMembershipId: dualWrite.membership._id }
    : created;
}
