import { UserModel } from "../db/models/index.js";
import { env } from "../config/env.js";

const SUPER_CONSOLE_ROLES = new Set(["super_admin", "support_admin", "finance_admin"]);

function normalizeEmail(value = "") {
  return String(value || "").trim().toLowerCase();
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

export async function findSingleTenantMembershipForIdentity(identity = {}) {
  const clerkUserId = String(identity.clerkUserId || "").trim();
  const email = normalizeEmail(identity.email || "");

  let memberships = clerkUserId ? await UserModel.findMembershipsByClerkUserId(clerkUserId) : [];
  if (memberships.length === 0 && email) {
    memberships = await UserModel.findMembershipsByEmail(email);
  }

  const active = memberships.filter((item) => item.status === "active");
  if (active.length === 1) return active[0];
  if (active.length > 1) return null;
  if (memberships.length === 1) return memberships[0];
  return null;
}

export async function createTenantMembershipFromIdentity({
  tenantId,
  identity,
  roles = ["user"],
  status = "active"
}) {
  const email = normalizeEmail(identity?.email || "");
  const clerkUserId = String(identity?.clerkUserId || "").trim();
  const existing = await findTenantUserForIdentity(tenantId, identity);
  if (existing) {
    const nextRoles = mergeRoleSet(existing.roles || [], roles || []);
    const patch = {};
    if ((existing.roles || []).length !== nextRoles.length) patch.roles = nextRoles;
    if (status && existing.status !== status) patch.status = status;
    if (Object.keys(patch).length === 0) return existing;
    return UserModel.update(existing._id, patch);
  }

  return UserModel.create({
    tenantId,
    clerkUserId: clerkUserId || null,
    email: email || `${clerkUserId}@clerk.local`,
    passwordHash: "clerk_managed",
    roles: mergeRoleSet([], roles),
    status
  });
}
