import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { readAuthTokenFromCookie } from "../utils/authCookie.js";
import { UserModel } from "../db/models/index.js";
import { resolveClerkIdentityFromRequest } from "../services/clerkIdentity.js";
import {
  applySuperConsoleRolePolicy,
  ensureGlobalSuperAdmin,
  findSingleTenantMembershipForIdentity,
  findTenantUserForIdentity
} from "../services/identityUsers.js";
import { resolveTenantFromRequest } from "../utils/tenantResolution.js";

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
  const resolved = await resolveTenantFromRequest(req, { allowHeaderSlug: true });
  return String(resolved?.tenantId || "");
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
    const tenantId = await resolveTenantIdForAuth(req);

    if (req.user) {
      const canonicalRoles = canonicalizeAppRoles(req.user.roles || []);
      req.user.roles = applySuperConsoleRolePolicy(canonicalRoles, req.identity || {}, req.user.email || "");
      if (
        tenantId &&
        !req.user.roles.includes("super_admin") &&
        req.user.tenantId &&
        String(req.user.tenantId) !== String(tenantId)
      ) {
        return res.status(403).json({
          error: {
            code: "TENANT_SCOPE_DENIED",
            message: "Identity is scoped to a different tenant."
          }
        });
      }
      return next();
    }

    const identity = req.identity || {};
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

    if (!appUser && tenantId) {
      const otherMembership = await findSingleTenantMembershipForIdentity(identity);
      if (
        otherMembership?.tenantId &&
        String(otherMembership.tenantId) !== String(tenantId) &&
        !(otherMembership.roles || []).includes("super_admin")
      ) {
        return res.status(403).json({
          error: {
            code: "TENANT_SCOPE_DENIED",
            message: "Identity is scoped to a different tenant."
          }
        });
      }
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
