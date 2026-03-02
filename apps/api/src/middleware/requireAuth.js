import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { readAuthTokenFromCookie } from "../utils/authCookie.js";
import { UserModel } from "../db/models/index.js";
import { resolveClerkIdentityFromRequest } from "../services/clerkIdentity.js";
import { trackClerkSessionSignIn } from "../services/analytics.js";
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

function legacyTokenAllowed() {
  if (env.AUTH_PROVIDER === "legacy") return true;
  if (env.AUTH_PROVIDER === "hybrid") return Boolean(env.HYBRID_ALLOW_LEGACY_TOKENS);
  return false;
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
    email: payload.email || "",
    claimedRoles: canonicalizeAppRoles(payload.roles || [])
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
      // Fall through to legacy/hard-fail below.
    }
  }

  if (token && authUsesLegacy() && legacyTokenAllowed()) {
    try {
      const payload = jwt.verify(token, env.JWT_SECRET);
      applyLegacyUser(req, payload, token, bearerToken ? "bearer" : "cookie");
      return next();
    } catch {
      // Fall through to AUTH_INVALID below.
    }
  }

  if (token && authUsesLegacy() && !legacyTokenAllowed()) {
    return res.status(401).json({
      error: {
        code: "AUTH_LEGACY_TOKEN_DISABLED",
        message: "Legacy JWT tokens are disabled in hybrid mode. Continue with Clerk authentication."
      }
    });
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
    const identity = req.identity || {};

    let appUser = null;
    if (identity.provider === "legacy" && identity.userId) {
      appUser = await UserModel.findById(String(identity.userId || ""));
    }

    const shouldResolveGlobalSuper = String(identity.provider || "").toLowerCase() === "clerk";
    const superUser = shouldResolveGlobalSuper ? await ensureGlobalSuperAdmin(identity) : null;
    if (tenantId) {
      if (!appUser) {
        appUser = await findTenantUserForIdentity(tenantId, identity);
      }
    } else {
      // Global (non-tenant) requests should prefer global super-admin identity.
      if (!appUser && superUser) {
        appUser = superUser;
      }
      if (!appUser) {
        appUser = await findSingleTenantMembershipForIdentity(identity);
      }
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
      appUser = await UserModel.update(appUser._id, { roles: sanitizedRoles });
    }
    appUser.roles = sanitizedRoles;

    if (
      tenantId &&
      !appUser.roles.includes("super_admin") &&
      appUser.tenantId &&
      String(appUser.tenantId) !== String(tenantId)
    ) {
      return res.status(403).json({
        error: {
          code: "TENANT_SCOPE_DENIED",
          message: "Identity is scoped to a different tenant."
        }
      });
    }

    if (identity.provider === "legacy" && identity.tenantId) {
      const claimedTenantId = String(identity.tenantId || "").trim();
      const userTenantId = String(appUser.tenantId || "").trim();
      if (claimedTenantId && userTenantId && claimedTenantId !== userTenantId && !appUser.roles.includes("super_admin")) {
        return res.status(403).json({
          error: {
            code: "TENANT_SCOPE_DENIED",
            message: "Token tenant scope does not match membership."
          }
        });
      }
    }

    if (appUser.status !== "active" && !(appUser.roles || []).includes("super_admin")) {
      return res.status(403).json({
        error: { code: "USER_INACTIVE", message: "Your account is inactive." }
      });
    }

    applyAppUser(req, appUser, identity, req.authSource || "bearer");
    if (tenantId && identity.provider === "clerk") {
      const sessionId = String(identity?.claims?.sid || identity?.claims?.session_id || "").trim();
      if (sessionId) {
        try {
          const recorded = await trackClerkSessionSignIn({
            tenantId,
            userId: appUser._id,
            sessionId
          });
          if (recorded) {
            await UserModel.update(appUser._id, { lastLoginAt: new Date() }).catch(() => {});
          }
        } catch {
          // Do not fail auth when analytics logging fails.
        }
      }
    }
    return next();
  });
}
