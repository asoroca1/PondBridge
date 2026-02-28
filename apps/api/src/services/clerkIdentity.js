import { createClerkClient, verifyToken } from "@clerk/backend";
import { env } from "../config/env.js";

const clerkClient = env.CLERK_SECRET_KEY
  ? createClerkClient({ secretKey: env.CLERK_SECRET_KEY })
  : null;
const clerkUserSnapshotCache = new Map();
const CLERK_USER_SNAPSHOT_TTL_MS = 5 * 60 * 1000;

function authUsesClerk() {
  return ["clerk", "hybrid"].includes(env.AUTH_PROVIDER);
}

function shouldRetryVerificationWithoutPolicy(error) {
  const message = String(error?.message || "").toLowerCase();
  const code = String(error?.code || "").toLowerCase();
  return (
    message.includes("audience") ||
    message.includes("authorized") ||
    message.includes("azp") ||
    code.includes("audience") ||
    code.includes("authorized")
  );
}

function isClerkNotFoundError(error) {
  const status = Number(error?.status || error?.statusCode || 0);
  if (status === 404) return true;
  const code = String(error?.code || "").trim().toLowerCase();
  if (code.includes("not_found")) return true;
  const clerkErrors = Array.isArray(error?.errors) ? error.errors : [];
  return clerkErrors.some((item) =>
    String(item?.code || "")
      .trim()
      .toLowerCase()
      .includes("not_found")
  );
}

function parseBearerToken(req) {
  const header = String(req.headers.authorization || "").trim();
  if (header.startsWith("Bearer ")) return header.slice(7).trim();
  return "";
}

function parseCookieToken(req, cookieName = "__session") {
  const raw = String(req.headers.cookie || "");
  if (!raw) return "";
  const parts = raw.split(";").map((part) => part.trim());
  for (const part of parts) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const key = decodeURIComponent(part.slice(0, idx).trim());
    if (key !== cookieName) continue;
    return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return "";
}

function normalizeEmail(email = "") {
  return String(email || "").trim().toLowerCase();
}

function normalizeName(value = "") {
  return String(value || "").trim();
}

function normalizeTenantValue(value = "") {
  return String(value || "").trim();
}

function normalizeSlugValue(value = "") {
  return String(value || "").trim().toLowerCase();
}

function normalizeRoleValue(value = "") {
  return String(value || "").trim().toLowerCase();
}

function firstClaimValue(values = []) {
  for (const value of values) {
    const normalized = normalizeTenantValue(value);
    if (normalized) return normalized;
  }
  return "";
}

function claimObject(value) {
  return value && typeof value === "object" ? value : {};
}

function claimRolesFromValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeRoleValue(item)).filter(Boolean);
  }
  const one = normalizeRoleValue(value);
  return one ? [one] : [];
}

export function extractTenantScopeFromClaims(claims = {}) {
  const safeClaims = claimObject(claims);
  const publicMetadata = claimObject(safeClaims.public_metadata || safeClaims.publicMetadata);
  const unsafeMetadata = claimObject(safeClaims.unsafe_metadata || safeClaims.unsafeMetadata);

  const tenantId = firstClaimValue([
    safeClaims.tenantId,
    safeClaims.tenant_id,
    safeClaims.orgId,
    safeClaims.org_id,
    publicMetadata.tenantId,
    publicMetadata.tenant_id,
    publicMetadata.orgId,
    publicMetadata.org_id,
    unsafeMetadata.tenantId,
    unsafeMetadata.tenant_id
  ]);
  const tenantSlug = normalizeSlugValue(
    firstClaimValue([
      safeClaims.tenantSlug,
      safeClaims.tenant_slug,
      publicMetadata.tenantSlug,
      publicMetadata.tenant_slug,
      unsafeMetadata.tenantSlug,
      unsafeMetadata.tenant_slug
    ])
  );
  const role = normalizeRoleValue(
    firstClaimValue([
      safeClaims.role,
      safeClaims.tenantRole,
      safeClaims.tenant_role,
      publicMetadata.role,
      publicMetadata.tenantRole,
      publicMetadata.tenant_role
    ])
  );

  const claimRoles = [
    ...claimRolesFromValue(safeClaims.roles),
    ...claimRolesFromValue(publicMetadata.roles),
    ...claimRolesFromValue(unsafeMetadata.roles)
  ];
  const roleSet = new Set(claimRoles);
  if (role) roleSet.add(role);

  return {
    tenantId: normalizeTenantValue(tenantId),
    tenantSlug,
    role,
    roles: [...roleSet]
  };
}

export function extractTenantScopeFromIdentity(identity = {}) {
  return extractTenantScopeFromClaims(identity?.claims || {});
}

function readCachedClerkUserSnapshot(clerkUserId = "") {
  const entry = clerkUserSnapshotCache.get(String(clerkUserId || "").trim());
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    clerkUserSnapshotCache.delete(String(clerkUserId || "").trim());
    return null;
  }
  return entry.data || null;
}

async function resolveClerkUserSnapshot(clerkUserId = "") {
  if (!clerkClient || !clerkUserId) return null;
  const cacheHit = readCachedClerkUserSnapshot(clerkUserId);
  if (cacheHit) return cacheHit;

  const user = await clerkClient.users.getUser(clerkUserId);
  const primaryEmailId = String(user?.primaryEmailAddressId || "");
  const emailObj = (user?.emailAddresses || []).find((item) => String(item?.id || "") === primaryEmailId);
  const fallback = user?.emailAddresses?.[0]?.emailAddress || "";
  const snapshot = {
    email: normalizeEmail(emailObj?.emailAddress || fallback),
    firstName: normalizeName(user?.firstName || ""),
    lastName: normalizeName(user?.lastName || "")
  };
  clerkUserSnapshotCache.set(String(clerkUserId || "").trim(), {
    expiresAt: Date.now() + CLERK_USER_SNAPSHOT_TTL_MS,
    data: snapshot
  });
  return snapshot;
}

export async function resolveClerkIdentityFromRequest(req) {
  if (!authUsesClerk()) return null;
  const token = parseBearerToken(req) || parseCookieToken(req);
  if (!token) return null;

  const verifyOptions = {
    secretKey: env.CLERK_SECRET_KEY
  };
  if (env.CLERK_JWT_AUDIENCE) verifyOptions.audience = env.CLERK_JWT_AUDIENCE;
  if (env.CLERK_AUTHORIZED_PARTIES.length > 0) {
    verifyOptions.authorizedParties = env.CLERK_AUTHORIZED_PARTIES;
  }

  let claims;
  try {
    claims = await verifyToken(token, verifyOptions);
  } catch (error) {
    const strictPoliciesEnabled =
      Boolean(env.CLERK_JWT_AUDIENCE) || env.CLERK_AUTHORIZED_PARTIES.length > 0;
    if (!strictPoliciesEnabled || !shouldRetryVerificationWithoutPolicy(error)) {
      throw error;
    }

    // Fallback for production incidents caused by stale audience/authorized-party config.
    // Signature validation still uses the Clerk secret for this instance.
    try {
      console.warn("[auth] Clerk strict token policy rejected request, retrying with signature-only verification", {
        requestId: String(req?.requestId || ""),
        path: String(req?.originalUrl || req?.url || ""),
        origin: String(req?.headers?.origin || "")
      });
    } catch {
      // no-op
    }
    claims = await verifyToken(token, { secretKey: env.CLERK_SECRET_KEY });
  }
  const clerkUserId = String(claims?.sub || "").trim();
  if (!clerkUserId) return null;

  const claimFirstName = normalizeName(
    claims?.first_name || claims?.given_name || claims?.firstName || ""
  );
  const claimLastName = normalizeName(
    claims?.last_name || claims?.family_name || claims?.lastName || ""
  );
  const candidateEmail =
    claims?.email ||
    claims?.email_address ||
    claims?.primary_email_address ||
    claims?.primaryEmailAddress ||
    "";
  let email = candidateEmail ? normalizeEmail(candidateEmail) : "";
  let firstName = claimFirstName;
  let lastName = claimLastName;

  if (!email || !firstName || !lastName) {
    const snapshot = await resolveClerkUserSnapshot(clerkUserId);
    if (!email) email = normalizeEmail(snapshot?.email || "");
    if (!firstName) firstName = normalizeName(snapshot?.firstName || "");
    if (!lastName) lastName = normalizeName(snapshot?.lastName || "");
  }

  const normalizedEmail = normalizeEmail(email);

  return {
    provider: "clerk",
    token,
    clerkUserId,
    email: normalizedEmail,
    firstName,
    lastName,
    claims
  };
}

export function isClerkManagementConfigured() {
  return Boolean(clerkClient);
}

export async function syncClerkTenantMetadata({
  clerkUserId = "",
  tenantId = "",
  tenantSlug = "",
  role = "user",
  allowTenantOverwrite = false
} = {}) {
  const normalizedClerkUserId = String(clerkUserId || "").trim();
  const normalizedTenantId = normalizeTenantValue(tenantId);
  if (!normalizedClerkUserId || !normalizedTenantId) {
    return { status: "skipped", reason: "missing_identity_scope" };
  }
  if (!clerkClient) {
    return { status: "skipped", reason: "clerk_not_configured" };
  }

  const user = await clerkClient.users.getUser(normalizedClerkUserId);
  const currentPublicMetadata = claimObject(user?.publicMetadata);
  const existingTenantId = firstClaimValue([
    currentPublicMetadata.tenantId,
    currentPublicMetadata.tenant_id,
    currentPublicMetadata.orgId,
    currentPublicMetadata.org_id
  ]);

  if (existingTenantId && existingTenantId !== normalizedTenantId && !allowTenantOverwrite) {
    return {
      status: "conflict",
      reason: "tenant_scope_mismatch",
      existingTenantId
    };
  }

  const normalizedRole = normalizeRoleValue(role || "user") || "user";
  const nextPublicMetadata = {
    ...currentPublicMetadata,
    tenantId: normalizedTenantId,
    tenantSlug: normalizeSlugValue(tenantSlug || currentPublicMetadata.tenantSlug || ""),
    role: normalizedRole,
    roles: Array.from(
      new Set([
        ...claimRolesFromValue(currentPublicMetadata.roles),
        normalizedRole
      ])
    )
  };

  await clerkClient.users.updateUserMetadata(normalizedClerkUserId, {
    publicMetadata: nextPublicMetadata
  });
  clerkUserSnapshotCache.delete(normalizedClerkUserId);

  return {
    status: "updated",
    tenantId: normalizedTenantId,
    tenantSlug: nextPublicMetadata.tenantSlug,
    role: normalizedRole
  };
}

export async function deleteClerkUserAccount(clerkUserId = "") {
  const normalized = String(clerkUserId || "").trim();
  if (!normalized) {
    return { status: "skipped", reason: "missing_clerk_user_id" };
  }
  if (!clerkClient) {
    return { status: "skipped", reason: "clerk_not_configured" };
  }

  try {
    await clerkClient.users.deleteUser(normalized);
    clerkUserSnapshotCache.delete(normalized);
    return { status: "deleted" };
  } catch (error) {
    if (isClerkNotFoundError(error)) {
      clerkUserSnapshotCache.delete(normalized);
      return { status: "not_found" };
    }
    throw error;
  }
}
