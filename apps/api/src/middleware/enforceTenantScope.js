import { env } from "../config/env.js";
import { findTenantMembershipsForIdentity } from "../services/identityUsers.js";
import { extractTenantScopeFromIdentity } from "../services/clerkIdentity.js";
import { logTenantSecurityEvent } from "../services/securityEvents.js";
import {
  evaluateFeatureRollout,
  MULTI_CAMP_IDENTITY_FLAG
} from "../services/featureRollouts.js";

function hasRole(user = {}, role = "") {
  return Array.isArray(user?.roles) && user.roles.includes(role);
}

async function deny(req, res, code, message, details = {}) {
  await logTenantSecurityEvent({
    req,
    tenantId: req?.tenant?._id || "",
    code,
    message,
    details
  });
  return res.status(403).json({
    error: {
      code,
      message,
      requestId: String(req?.requestId || "")
    }
  });
}

export async function enforceTenantScope(req, res, next) {
  const resolvedTenantId = String(req?.tenant?._id || "").trim();
  if (!resolvedTenantId) {
    return res.status(500).json({
      error: {
        code: "TENANT_CONTEXT_REQUIRED",
        message: "Tenant context must be resolved before enforcing tenant scope.",
        requestId: String(req?.requestId || "")
      }
    });
  }

  if (hasRole(req.user, "super_admin")) {
    return next();
  }

  const identityRollout = await evaluateFeatureRollout(
    MULTI_CAMP_IDENTITY_FLAG,
    req.tenant
  );

  const scope = extractTenantScopeFromIdentity(req.identity || {});
  const claimedTenantId = String(scope?.tenantId || "").trim();
  const source =
    claimedTenantId
      ? "token_claim"
      : req.user
      ? "app_user"
      : "identity_membership";

  if (!identityRollout.enabled && claimedTenantId && claimedTenantId !== resolvedTenantId) {
    return deny(req, res, "TENANT_SCOPE_DENIED", "Token tenant scope does not match request tenant.", {
      tokenTenantId: claimedTenantId,
      claimedTenantId,
      resolvedTenantId,
      source
    });
  }

  if (req.user) {
    const userTenantId = String(req.user.tenantId || "").trim();
    if (!userTenantId || userTenantId !== resolvedTenantId) {
      return deny(req, res, "TENANT_SCOPE_DENIED", "User membership does not match request tenant.", {
        tokenTenantId: claimedTenantId,
        claimedTenantId,
        resolvedTenantId,
        source: "app_user",
        userTenantId
      });
    }

    if (
      !identityRollout.enabled &&
      env.CLERK_REQUIRE_TENANT_CLAIM &&
      String(req.identity?.provider || "").trim().toLowerCase() === "clerk" &&
      !claimedTenantId
    ) {
      return deny(req, res, "TENANT_CLAIM_REQUIRED", "Tenant-scoped Clerk token claim is required.", {
        tokenTenantId: "",
        claimedTenantId: "",
        resolvedTenantId,
        source: "claim_required"
      });
    }

    return next();
  }

  const memberships = await findTenantMembershipsForIdentity(req.identity || {}, { activeOnly: true });
  const scopedMemberships = memberships.filter((membership) => String(membership?.tenantId || "").trim());
  if (scopedMemberships.length > 1) {
    return deny(req, res, "TENANT_SCOPE_DENIED", "Identity is bound to multiple active tenants.", {
      tokenTenantId: claimedTenantId,
      claimedTenantId,
      resolvedTenantId,
      source: "identity_membership"
    });
  }

  if (scopedMemberships.length === 1) {
    const identityTenantId = String(scopedMemberships[0]?.tenantId || "").trim();
    if (identityTenantId !== resolvedTenantId) {
      return deny(req, res, "TENANT_SCOPE_DENIED", "Identity tenant scope does not match this network.", {
        tokenTenantId: claimedTenantId,
        claimedTenantId,
        resolvedTenantId,
        source: "identity_membership",
        identityTenantId
      });
    }
  }

  if (
    !identityRollout.enabled &&
    env.CLERK_REQUIRE_TENANT_CLAIM &&
    String(req.identity?.provider || "").trim().toLowerCase() === "clerk" &&
    scopedMemberships.length === 1 &&
    !claimedTenantId
  ) {
    return deny(req, res, "TENANT_CLAIM_REQUIRED", "Tenant-scoped Clerk token claim is required.", {
      tokenTenantId: "",
      claimedTenantId: "",
      resolvedTenantId,
      source: "claim_required"
    });
  }

  return next();
}
