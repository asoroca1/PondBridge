import crypto from "node:crypto";

const PLATFORM_ROLES = new Set(["super_admin", "support_admin", "finance_admin"]);

function normalizeEmail(value = "") {
  return String(value || "").trim().toLowerCase();
}

function stableFingerprint(value = "") {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 12);
}

export function buildMultiCampIdentityBackfillPlan(users = []) {
  const source = Array.isArray(users) ? users : [];
  const emailClerkIds = new Map();
  for (const user of source) {
    const email = normalizeEmail(user?.email);
    const clerkUserId = String(user?.clerkUserId || "").trim();
    if (!email || !clerkUserId) continue;
    const ids = emailClerkIds.get(email) || new Set();
    ids.add(clerkUserId);
    emailClerkIds.set(email, ids);
  }

  const collisionEmails = new Set(
    [...emailClerkIds.entries()]
      .filter(([, ids]) => ids.size > 1)
      .map(([email]) => email)
  );
  const groups = new Map();
  const collisions = [];

  for (const email of collisionEmails) {
    collisions.push({
      type: "email_multiple_clerk_identities",
      subject: stableFingerprint(email),
      count: emailClerkIds.get(email)?.size || 0
    });
  }

  for (const user of source) {
    const email = normalizeEmail(user?.email);
    const clerkUserId = String(user?.clerkUserId || "").trim();
    const legacyUserId = String(user?._id || user?.id || "").trim();
    const tenantId = String(user?.tenantId || "").trim();
    if (!email || !legacyUserId || collisionEmails.has(email)) continue;
    const knownClerkIds = emailClerkIds.get(email) || new Set();
    const resolvedClerkUserId = clerkUserId || (knownClerkIds.size === 1 ? [...knownClerkIds][0] : "");
    const key = resolvedClerkUserId ? `clerk:${resolvedClerkUserId}` : `email:${email}`;
    const group = groups.get(key) || {
      key,
      primaryEmail: email,
      emailFingerprint: stableFingerprint(email),
      clerkUserId: resolvedClerkUserId,
      verifiedEmails: new Set(),
      platformRoles: new Set(),
      memberships: [],
      legacyUserIds: []
    };
    group.verifiedEmails.add(email);
    group.legacyUserIds.push(legacyUserId);
    const roles = Array.isArray(user?.roles) ? user.roles : [];
    if (!tenantId) {
      roles.filter((role) => PLATFORM_ROLES.has(role)).forEach((role) => group.platformRoles.add(role));
    } else {
      group.memberships.push({
        tenantId,
        legacyUserId,
        roles: [...new Set(roles.map((role) => String(role || "").trim()).filter(Boolean))],
        status: String(user?.status || "active") === "inactive" ? "inactive" : "active",
        joinMethod: "legacy_backfill"
      });
    }
    groups.set(key, group);
  }

  const identities = [];
  for (const group of groups.values()) {
    const membershipTenants = new Set();
    let duplicateTenant = false;
    for (const membership of group.memberships) {
      if (membershipTenants.has(membership.tenantId)) duplicateTenant = true;
      membershipTenants.add(membership.tenantId);
    }
    if (duplicateTenant) {
      collisions.push({
        type: "identity_duplicate_tenant_membership",
        subject: group.emailFingerprint,
        count: group.memberships.length
      });
      continue;
    }
    identities.push({
      primaryEmail: group.primaryEmail,
      emailFingerprint: group.emailFingerprint,
      clerkUserId: group.clerkUserId,
      verifiedEmails: [...group.verifiedEmails],
      platformRoles: [...group.platformRoles],
      memberships: group.memberships,
      legacyUserIds: group.legacyUserIds
    });
  }

  return {
    sourceUserCount: source.length,
    identityCount: identities.length,
    membershipCount: identities.reduce((sum, identity) => sum + identity.memberships.length, 0),
    collisionCount: collisions.length,
    identities,
    collisions
  };
}

export function summarizeMultiCampIdentityBackfillPlan(plan = {}) {
  return {
    sourceUserCount: Number(plan.sourceUserCount || 0),
    identityCount: Number(plan.identityCount || 0),
    membershipCount: Number(plan.membershipCount || 0),
    collisionCount: Number(plan.collisionCount || 0),
    collisions: Array.isArray(plan.collisions) ? plan.collisions : []
  };
}
