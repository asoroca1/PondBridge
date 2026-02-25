import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { readAuthTokenFromCookie } from "../utils/authCookie.js";
import { getTenantContext } from "./tenantContext.js";
import { TenantModel, UserModel } from "../db/models/index.js";
import { resolveClerkIdentityFromRequest } from "../services/clerkIdentity.js";
import {
  applySuperConsoleRolePolicy,
  ensureGlobalSuperAdmin,
  findSingleTenantMembershipForIdentity,
  findTenantUserForIdentity
} from "../services/identityUsers.js";

function authUsesLegacy() {
  return ["legacy", "hybrid"].includes(env.AUTH_PROVIDER);
}

function authUsesClerk() {
  return ["clerk", "hybrid"].includes(env.AUTH_PROVIDER);
}

function canonicalizeAppRoles(roles = []) {
  const roleSet = new Set(
    (Array.isArray(roles) ? roles : [roles])
      .map((role) => String(role || "").trim().toLowerCase())
      .filter(Boolean)
  );
  if (roleSet.has("admin")) roleSet.add("tenant_admin");
  if ((roleSet.has("admin") || roleSet.has("tenant_admin")) && !roleSet.has("user")) {
    roleSet.add("user");
  }
  return [...roleSet];
}

function sameRoleSet(a = [], b = []) {
  const left = new Set((a || []).map((role) => String(role || "").trim().toLowerCase()).filter(Boolean));
  const right = new Set((b || []).map((role) => String(role || "").trim().toLowerCase()).filter(Boolean));
  if (left.size !== right.size) return false;
  for (const role of left) {
    if (!right.has(role)) return false;
  }
  return true;
}

async function resolveTenantIdForAuth(req) {
  // Resolve tenant from trusted request routing/host context first.
  const context = getTenantContext(req);
  if (context.slug) {
    const tenant = await TenantModel.findBySlug(context.slug);
    return tenant ? String(tenant._id) : "";
  }
  if (context.host) {
    const tenant = await TenantModel.findByDomain(context.host);
    if (tenant) return String(tenant._id);
  }

  // Header fallback is only used on routes that do not encode tenant in the URL/host.
  const fromSlugHeader = String(req.headers["x-tenant-slug"] || "").trim();
  if (fromSlugHeader) {
    const tenant = await TenantModel.findBySlug(fromSlugHeader);
    if (tenant) return String(tenant._id);
  }

  // Keep x-tenant-id as a constrained compatibility fallback only when the
  // tenant exists; do not trust arbitrary client IDs.
  const fromHeader = String(req.headers["x-tenant-id"] || "").trim();
  if (fromHeader) {
    const tenant = await TenantModel.findById(fromHeader);
    if (tenant) return String(tenant._id);
  }

  return "";
}

function applyLegacyUser(req, payload, token, source) {
  req.identity = {
    provider: "legacy",
    token,
    userId: payload.sub,
    tenantId: payload.tenantId || null,
    email: payload.email || ""
  };
  req.user = {
    id: payload.sub,
    _id: payload.sub,
    tenantId: payload.tenantId || null,
    roles: canonicalizeAppRoles(payload.roles || []),
    email: payload.email
  };
  req.token = token;
  req.authSource = source;
}

function applyAppUser(req, appUser, identity, source) {
  req.identity = identity;
  req.user = {
    id: String(appUser._id),
    _id: String(appUser._id),
    tenantId: appUser.tenantId ? String(appUser.tenantId) : null,
    roles: canonicalizeAppRoles(appUser.roles || []),
    email: appUser.email
  };
  req.token = identity?.token || "";
  req.authSource = source;
}

export async function requireIdentity(req, res, next) {
  const header = req.headers.authorization || "";
  const bearerToken = header.startsWith("Bearer ") ? header.slice(7) : "";
  const cookieToken = readAuthTokenFromCookie(req);
  const token = bearerToken || cookieToken;

  if (token && authUsesLegacy()) {
    try {
      const payload = jwt.verify(token, env.JWT_SECRET);
      applyLegacyUser(req, payload, token, bearerToken ? "bearer" : "cookie");
      return next();
    } catch {
      // Try Clerk next in hybrid mode.
    }
  }

  if (authUsesClerk()) {
    try {
      const identity = await resolveClerkIdentityFromRequest(req);
      if (identity) {
        req.identity = identity;
        req.token = identity.token;
        req.authSource = bearerToken ? "bearer" : "cookie";
        return next();
      }
    } catch {
      // Fall through to AUTH_INVALID below.
    }
  }

  if (!token) {
    return res.status(401).json({ error: { code: "AUTH_REQUIRED", message: "Missing auth token" } });
  }
  return res.status(401).json({
    error: { code: "AUTH_INVALID", message: "Invalid or expired token" }
  });
}

export async function requireAuth(req, res, next) {
  return requireIdentity(req, res, async () => {
    if (req.user) {
      const canonicalRoles = canonicalizeAppRoles(req.user.roles || []);
      req.user.roles = applySuperConsoleRolePolicy(canonicalRoles, req.identity || {}, req.user.email || "");
      return next();
    }

    const identity = req.identity || {};
    const tenantId = await resolveTenantIdForAuth(req);
    const superUser = await ensureGlobalSuperAdmin(identity);

    let appUser = null;
    if (tenantId) {
      appUser = await findTenantUserForIdentity(tenantId, identity);
    } else {
      appUser = await findSingleTenantMembershipForIdentity(identity);
    }

    if (!appUser && superUser) {
      appUser = superUser;
    }

    if (!appUser) {
      return res.status(401).json({
        error: { code: "AUTH_MEMBERSHIP_REQUIRED", message: "No application membership found for this identity." }
      });
    }

    const canonicalRoles = canonicalizeAppRoles(appUser.roles || []);
    const sanitizedRoles = applySuperConsoleRolePolicy(canonicalRoles, identity, appUser.email || "");
    if (!sameRoleSet(appUser.roles || [], sanitizedRoles)) {
      if (appUser?._id) {
        appUser = await UserModel.update(appUser._id, { roles: sanitizedRoles });
      } else {
        appUser.roles = sanitizedRoles;
      }
    }
    appUser.roles = sanitizedRoles;

    if (appUser.status !== "active" && !(appUser.roles || []).includes("super_admin")) {
      return res.status(403).json({
        error: { code: "USER_INACTIVE", message: "Your account is inactive." }
      });
    }

    applyAppUser(req, appUser, identity, req.authSource || "bearer");
    return next();
  });
}
