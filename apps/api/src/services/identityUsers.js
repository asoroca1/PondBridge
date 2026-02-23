import { UserModel } from "../db/models/index.js";
import { env } from "../config/env.js";

const SUPER_CONSOLE_ROLES = new Set(["super_admin", "support_admin", "finance_admin"]);

function normalizeEmail(value = "") {
  return String(value || "").trim().toLowerCase();
}

function mergeRoleSet(existing = [], required = []) {
  return [...new Set([...(existing || []), ...(required || [])].map((role) => String(role || "").trim()).filter(Boolean))];
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

export async function ensureGlobalSuperAdmin(identity = {}) {
  const clerkUserId = String(identity.clerkUserId || "").trim();
  const email = normalizeEmail(identity.email || "");
  const allowlisted = isSuperAllowlisted(identity);
  const allowlistSet = superAllowlistConfigured();

  if (!clerkUserId && !email) return null;

  let existing = clerkUserId ? await UserModel.findGlobalByClerkUserId(clerkUserId) : null;
  if (!existing && email) {
    existing = await UserModel.findOne({ tenantId: null, email });
  }

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
