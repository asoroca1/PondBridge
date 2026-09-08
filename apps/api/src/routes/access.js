import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  UserModel,
  ProfileModel,
  AccessRequestModel,
  InviteModel,
  TenantAdminAuditLogModel,
  TenantModel
} from "../db/models/index.js";
import { requireTenantIdentityScope } from "../middleware/tenantAccess.js";
import {
  createInviteRecord,
  findInviteByOpaqueTokenAnyState,
  findInviteByOpaqueToken,
  markInviteUsed
} from "../services/invites.js";
import {
  createTenantMembershipFromIdentity,
  findTenantUserForIdentity
} from "../services/identityUsers.js";
import {
  ensureProfileForUser,
  isProfileComplete,
  profileCompletionPercent
} from "../services/profileCompletion.js";
import { isUnclaimedProfile } from "../services/memberVisibility.js";
import { claimSummaryFromProfile } from "../services/profileClaim.js";
import { profilePayloadFromBody } from "../services/profilePayload.js";
import { resolveSettings } from "../services/onboarding.js";
import { readCampProfile } from "../services/superCampProfile.js";
import { logTenantEvent } from "../services/analytics.js";
import { isTenantBillingAccessAllowed } from "../services/billingState.js";
import { notifyTenantAdmins } from "../services/mobileNotifications.js";
import {
  isEmailAllowedByPolicy,
  resolveTenantAccessPolicy,
  verifyTenantAccessCodeGrant,
  verifyTenantAccessCode
} from "../services/accessPolicy.js";
import {
  AGE_POLICY_VERSION,
  DEFAULT_MEMBER_PRIVACY_VERSION,
  DEFAULT_MEMBER_TERMS_VERSION,
  MINIMUM_MEMBER_AGE,
  isMemberEligibilityComplete,
  normalizeMemberLegalAgreement as normalizeLegalAgreement
} from "../services/memberEligibility.js";

const router = Router({ mergeParams: true });

function accessLimiterKey(req, { includeIdentity = false } = {}) {
  const tenantSlug = String(req.params?.slug || req.tenant?.slug || "").trim().toLowerCase();
  const ip = String(req.ip || "").trim();
  const identityRef = includeIdentity
    ? String(req.user?.id || req.identity?.userId || req.identity?.clerkUserId || req.identity?.email || "")
        .trim()
        .toLowerCase()
    : "";
  return ["access", tenantSlug, ip, identityRef].join(":");
}

const accessDecisionLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => accessLimiterKey(req),
  message: {
    error: {
      code: "RATE_LIMITED",
      message: "Too many access checks. Please wait and try again."
    }
  }
});

const accessMutationLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => accessLimiterKey(req, { includeIdentity: true }),
  message: {
    error: {
      code: "RATE_LIMITED",
      message: "Too many access attempts. Please wait and try again."
    }
  }
});

const inviteCreateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => accessLimiterKey(req, { includeIdentity: true }),
  message: {
    error: {
      code: "RATE_LIMITED",
      message: "Too many invite creations. Please wait before sending more invites."
    }
  }
});

function normalizeEmail(value = "") {
  return String(value || "").trim().toLowerCase();
}

function roleSet(roles = []) {
  return new Set((roles || []).map((role) => String(role || "").trim()).filter(Boolean));
}

function isGlobalSuperAdmin(req) {
  const roles = roleSet(req.user?.roles || []);
  const userTenantId = String(req.user?.tenantId || "").trim();
  return roles.has("super_admin") && !userTenantId;
}

function mergeRoles(base = [], extra = []) {
  return [...new Set([...(base || []), ...(extra || [])].map((role) => String(role || "").trim()).filter(Boolean))];
}

function rolesFromInvite(invite) {
  const role = String(invite?.roleToAssign || "user").trim();
  if (role === "tenant_admin") return ["tenant_admin", "user"];
  return ["user"];
}

/**
 * An admin invitation is the director staffing their own team. Sending it
 * through the member review queue would be circular, so it always lands
 * directly.
 */
function isDirectorInvite(invite) {
  return roleSet(rolesFromInvite(invite)).has("tenant_admin");
}

function isEmail(value = "") {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

async function persistProfileLegalAgreement(profile, legalAgreement = null) {
  if (!profile?._id || !legalAgreement?.accepted) return profile;

  const currentSocials = profile?.socials && typeof profile.socials === "object" ? profile.socials : {};
  const existingAgreement =
    currentSocials?.legalAgreement && typeof currentSocials.legalAgreement === "object"
      ? currentSocials.legalAgreement
      : {};
  const nextAgreement = {
    accepted: true,
    acceptedAt: legalAgreement.acceptedAt || existingAgreement.acceptedAt || new Date().toISOString(),
    termsVersion: legalAgreement.termsVersion || existingAgreement.termsVersion || DEFAULT_MEMBER_TERMS_VERSION,
    privacyVersion: legalAgreement.privacyVersion || existingAgreement.privacyVersion || DEFAULT_MEMBER_PRIVACY_VERSION,
    ageEligibilityConfirmed: Boolean(legalAgreement.ageEligibilityConfirmed),
    minimumAge: MINIMUM_MEMBER_AGE,
    agePolicyVersion: AGE_POLICY_VERSION
  };

  const needsPatch =
    !existingAgreement.accepted ||
    String(existingAgreement.acceptedAt || "") !== String(nextAgreement.acceptedAt || "") ||
    String(existingAgreement.termsVersion || "") !== String(nextAgreement.termsVersion || "") ||
    String(existingAgreement.privacyVersion || "") !== String(nextAgreement.privacyVersion || "") ||
    Boolean(existingAgreement.ageEligibilityConfirmed) !== nextAgreement.ageEligibilityConfirmed ||
    Number(existingAgreement.minimumAge || 0) !== MINIMUM_MEMBER_AGE ||
    String(existingAgreement.agePolicyVersion || "") !== AGE_POLICY_VERSION;
  if (!needsPatch) return profile;

  return ProfileModel.updateScoped(profile.tenantId, profile._id, {
    socials: {
      ...currentSocials,
      legalAgreement: nextAgreement
    }
  });
}

function decisionRouteBase(slug = "") {
  const safeSlug = String(slug || "").trim();
  return safeSlug ? `/t/${safeSlug}` : "";
}

function isUniqueConstraintError(error) {
  return String(error?.code || "").trim() === "23505";
}

async function findPendingRequest(tenantId, email = "") {
  if (!tenantId || !email) return null;
  return AccessRequestModel.findOne(tenantId, {
    email,
    status: "pending"
  });
}

async function markPendingRequestApprovedByAutoJoin({ tenantId, email, userId }) {
  const pendingRequest = await findPendingRequest(tenantId, email);
  if (!pendingRequest) return null;

  return AccessRequestModel.updateScoped(tenantId, pendingRequest._id, {
    status: "approved",
    reviewedAt: new Date(),
    reviewedByUserId: null,
    approvedUserId: userId,
    denialReason: ""
  });
}

async function findInviteForEmail(tenantId, email = "") {
  if (!tenantId || !email) return null;
  const candidates = await InviteModel.find(
    tenantId,
    {
      email,
      usedAt: null
    },
    { sort: { expiresAt: -1 }, limit: 10 }
  );
  return candidates.find((item) => new Date(item.expiresAt) > new Date()) || null;
}

async function buildAccessDecision({ tenant, identity, inviteToken = "", callerUser = null }) {
  const tenantId = String(tenant._id);
  const email = normalizeEmail(identity.email || "");

  // Block global super admins from joining camp networks. They should manage
  // camps from the super console, not create user/profile records inside them.
  const callerRoles = roleSet(callerUser?.roles || []);
  const callerTenantId = String(callerUser?.tenantId || "").trim();
  if (callerRoles.has("super_admin") && !callerTenantId) {
    return {
      state: "super_admin_blocked",
      action: "use_super_console",
      nextRoute: "/super/tenants"
    };
  }

  const settings = resolveSettings(tenant);
  const policy = resolveTenantAccessPolicy(tenant);
  const signupMode = policy.signupMode;
  const joinMode = policy.joinMode;
  const billingAccess = isTenantBillingAccessAllowed(tenant);

  const membership = await findTenantUserForIdentity(tenantId, identity);
  const inviteFromToken = inviteToken ? await findInviteByOpaqueToken(tenantId, inviteToken) : null;
  const inviteByEmail = inviteFromToken || (email ? await findInviteForEmail(tenantId, email) : null);
  const invite = inviteByEmail && new Date(inviteByEmail.expiresAt) > new Date() ? inviteByEmail : null;

  const base = decisionRouteBase(tenant.slug);
  const loginRoute = `${base}/login`;
  const onboardingRoute = `${base}/edit-profile`;
  const directorSetupRoute = `${base}/director-create-account?setup=1`;
  const homeRoute = `${base}/home`;
  const pendingRoute = `${base}/request-access`;
  const claimRoute = `${base}/claim-profile`;

  if (membership && membership.status !== "active") {
    const membershipSummary = {
      id: String(membership._id),
      status: membership.status,
      roles: membership.roles || []
    };

    // Removing someone must not burn their email address forever. They can ask
    // to come back, and because they were removed once a person decides rather
    // than the network letting them straight back in.
    const alreadyAsked = email ? await findPendingRequest(tenantId, email) : null;
    if (alreadyAsked) {
      return {
        state: "access_pending",
        action: "wait_for_approval",
        nextRoute: pendingRoute,
        joinMode,
        signupMode,
        membership: membershipSummary,
        request: {
          id: String(alreadyAsked._id),
          status: alreadyAsked.status,
          requestedAt: alreadyAsked.requestedAt
        }
      };
    }

    // An invitation-only network with no invitation has nothing to review, so
    // there the removal still stands.
    const canReapply = Boolean(invite) || policy.entryMode !== "invite_only";
    if (canReapply && isEmailAllowedByPolicy(policy, email)) {
      return {
        state: "not_member",
        action: "request_access",
        nextRoute: pendingRoute,
        joinMode,
        signupMode,
        membership: membershipSummary,
        reason: "membership_inactive"
      };
    }

    return {
      state: "revoked",
      action: "contact_director",
      nextRoute: loginRoute,
      membership: membershipSummary
    };
  }

  if (membership) {
    const profile = await ensureProfileForUser({ tenantId, user: membership, identity });
    const completion = profileCompletionPercent(profile || {});
    const needsOnboarding = !isProfileComplete(profile || {}, settings.requireProfileCompletion ? 100 : 1);
    const isDirector = roleSet(membership.roles).has("tenant_admin");
    if (!billingAccess.allowed && !isDirector) {
      return {
        state: "billing_restricted",
        action: "contact_director",
        nextRoute: loginRoute,
        membership: {
          id: String(membership._id),
          status: membership.status,
          roles: membership.roles || []
        },
        billing: {
          reason: billingAccess.reason,
          inGrace: billingAccess.inGrace
        }
      };
    }
    // An import can create a membership before the person it describes has ever
    // seen the site. Dropping them straight into a profile full of information
    // they never entered is the thing to avoid, so this outranks every ordinary
    // member route — but not the billing gate above it, which stops everyone.
    if (isUnclaimedProfile(profile)) {
      return {
        state: "profile_ready_to_claim",
        action: "confirm_identity",
        nextRoute: claimRoute,
        membership: {
          id: String(membership._id),
          status: membership.status,
          roles: membership.roles || []
        },
        profile: {
          id: String(profile?._id || ""),
          completionPercent: completion,
          createdAt: profile?.createdAt || null
        },
        claimSummary: claimSummaryFromProfile(profile)
      };
    }

    const nextRoute =
      isDirector && tenant.onboardingStatus !== "live"
        ? directorSetupRoute
        : needsOnboarding
        ? onboardingRoute
        : homeRoute;

    return {
      state: "active_member",
      action: needsOnboarding ? "complete_profile" : "go_home",
      nextRoute,
      membership: {
        id: String(membership._id),
        status: membership.status,
        roles: membership.roles || []
      },
      profile: {
        id: String(profile?._id || ""),
        completionPercent: completion,
        isComplete: !needsOnboarding
      }
    };
  }

  const pendingRequest = email ? await findPendingRequest(tenantId, email) : null;

  // Normally an invitation is the fastest way in and outranks anything else.
  // Under the review gate an invited person still waits in the queue, so once
  // they have submitted, "waiting on the director" is the truthful answer —
  // otherwise they would be sent to accept the same invitation forever.
  if (invite && !(policy.requireApproval && pendingRequest)) {
    return {
      state: "invited",
      action: "accept_invite",
      nextRoute: `${base}/create-account`,
      reviewRequired: policy.requireApproval,
      invite: {
        id: String(invite._id),
        roleToAssign: invite.roleToAssign,
        emailLocked: Boolean(invite.email),
        expiresAt: invite.expiresAt
      }
    };
  }

  if (pendingRequest && policy.requireApproval) {
    return {
      state: "access_pending",
      action: "wait_for_approval",
      nextRoute: pendingRoute,
      joinMode,
      signupMode,
      request: {
        id: String(pendingRequest._id),
        status: pendingRequest.status,
        requestedAt: pendingRequest.requestedAt
      }
    };
  }

  if (!isEmailAllowedByPolicy(policy, email)) {
    return {
      state: "not_member",
      action: "request_access",
      nextRoute: pendingRoute,
      joinMode,
      signupMode,
      reason: "email_domain_not_allowed"
    };
  }

  // Invite-only is checked first: under that mode there is nothing to request,
  // so the gate has no one to gate until an invitation exists.
  if (policy.entryMode === "invite_only") {
    return {
      state: "not_member",
      action: "invite_required",
      nextRoute: loginRoute,
      joinMode,
      signupMode,
      reason: "invite_required"
    };
  }

  if (policy.requireApproval) {
    return {
      state: "not_member",
      action: "request_access",
      nextRoute: pendingRoute,
      joinMode,
      signupMode,
      requiresAccessCode: policy.entryMode === "code",
      reason: "approval_required"
    };
  }

  if (policy.entryMode === "open" || policy.entryMode === "code") {
    if (!billingAccess.allowed) {
      return {
        state: "billing_restricted",
        action: "contact_director",
        nextRoute: loginRoute,
        joinMode,
        signupMode,
        billing: {
          reason: billingAccess.reason,
          inGrace: billingAccess.inGrace
        }
      };
    }
    return {
      state: "not_member",
      action: "join_network",
      nextRoute: `${base}/create-account`,
      joinMode,
      signupMode,
      requiresAccessCode: policy.entryMode === "code"
    };
  }

  return {
    state: "not_member",
    action: "request_access",
    nextRoute: pendingRoute,
    joinMode,
    signupMode
  };
}

/**
 * Parks a signup in the director's review queue instead of granting access.
 *
 * Every way into a gated network funnels through here — an open signup, a code
 * signup, and an accepted invitation all produce the same pending row, so the
 * director reviews one queue rather than three. Re-submitting refreshes the
 * existing row rather than stacking duplicates.
 */
async function submitAccessRequest({ tenant, identity, body = {}, invite = null, source = "request" }) {
  const tenantId = tenant._id;
  const email = normalizeEmail(identity.email || "");
  const profilePayload = profilePayloadFromBody(body, identity);

  // The agreement the person just signed has to survive the wait, or approving
  // them would silently produce a member who never accepted the terms.
  const legalAgreement = normalizeLegalAgreement(body);
  if (legalAgreement?.accepted) {
    profilePayload.socials = {
      ...(profilePayload.socials || {}),
      legalAgreement: {
        accepted: true,
        acceptedAt: legalAgreement.acceptedAt || new Date().toISOString(),
        termsVersion: legalAgreement.termsVersion || DEFAULT_MEMBER_TERMS_VERSION,
        privacyVersion: legalAgreement.privacyVersion || DEFAULT_MEMBER_PRIVACY_VERSION,
        ageEligibilityConfirmed: Boolean(legalAgreement.ageEligibilityConfirmed),
        minimumAge: MINIMUM_MEMBER_AGE,
        agePolicyVersion: AGE_POLICY_VERSION
      }
    };
  }

  const selfReportedRole = String(
    profilePayload.roleAtCamp ||
      (Array.isArray(body?.roles) ? body.roles[0] : body?.roleAtCamp) ||
      ""
  ).trim();
  const fields = {
    firstName: profilePayload.firstName,
    lastName: profilePayload.lastName,
    selfReportedRole,
    requestMessage: String(body?.requestMessage || "").trim(),
    profilePayload,
    status: "pending"
  };

  const existingPending = await findPendingRequest(tenantId, email);
  let requestRow = existingPending;
  if (existingPending) {
    requestRow = await AccessRequestModel.update(existingPending._id, {
      ...fields,
      requestedAt: new Date(),
      reviewedAt: null,
      reviewedByUserId: null,
      denialReason: ""
    });
  } else {
    try {
      requestRow = await AccessRequestModel.create({
        tenantId,
        email,
        passwordHash: "clerk_managed",
        requestedAt: new Date(),
        ...fields
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const pending = await findPendingRequest(tenantId, email);
      if (!pending) throw error;
      requestRow = pending;
    }
  }

  await writeTenantAudit(tenantId, null, "access_request_submitted", {
    email,
    source,
    inviteId: invite ? String(invite._id) : "",
    requestId: String(requestRow._id)
  }).catch(() => {});

  const displayName = `${profilePayload.firstName || ""} ${profilePayload.lastName || ""}`.trim();
  await notifyTenantAdmins({
    tenant,
    kind: "approval_request_submitted",
    title: "New approval request",
    body: displayName
      ? `${displayName} requested access to ${tenant.name || "your camp"}.`
      : `A new member requested access to ${tenant.name || "your camp"}.`,
    deepLink: "/admin/members",
    data: {
      email,
      requestId: String(requestRow._id || "")
    }
  }).catch(() => {});

  return { requestRow, isNew: !existingPending };
}

async function writeTenantAudit(tenantId, actorUserId, event, metadata = {}) {
  await TenantAdminAuditLogModel.create({
    tenantId,
    actorUserId: actorUserId || null,
    event,
    metadata
  });
}

router.use(...requireTenantIdentityScope);

router.get("/decision", accessDecisionLimiter, async (req, res) => {
  const inviteToken = String(req.query.inviteToken || req.query.token || "").trim();
  const decision = await buildAccessDecision({
    tenant: req.tenant,
    identity: req.identity || {},
    inviteToken,
    callerUser: req.user || null
  });
  return res.json({
    tenant: {
      id: String(req.tenant._id),
      slug: req.tenant.slug,
      status: req.tenant.status,
      onboardingStatus: req.tenant.onboardingStatus
    },
    decision
  });
});

router.post("/director-bootstrap", accessMutationLimiter, async (req, res) => {
  if (req.tenant.status !== "active") {
    return res.status(403).json({
      error: {
        code: "TENANT_INACTIVE",
        message: "This network is inactive."
      }
    });
  }

  if (req.tenant.onboardingStatus === "live") {
    return res.status(403).json({
      error: {
        code: "DIRECTOR_BOOTSTRAP_DISABLED",
        message: "Director bootstrap is only available before launch."
      }
    });
  }

  const tenantId = String(req.tenant._id);
  const identity = req.identity || {};
  const identityEmail = normalizeEmail(identity.email || "");
  const requestRoleSet = roleSet(req.user?.roles || []);
  const requestTenantId = String(req.user?.tenantId || "").trim();

  if (requestRoleSet.has("super_admin") && requestTenantId !== tenantId) {
    return res.status(409).json({
      error: {
        code: "SUPER_ADMIN_SESSION_REQUIRES_SIGN_OUT",
        message:
          "You are signed in with a global super admin session. Sign out first, then create or sign in with the camp director account."
      }
    });
  }

  // Bootstrap runs before any membership exists, so the only thing standing
  // between a pre-launch camp and whoever guesses its slug is this check. When
  // the camp was provisioned with a director's address, that address is the
  // claim: nobody else gets to be first. Camps created without one still fall
  // back to first-come, which is what the operator asked for by omitting it.
  const expectedDirectorEmail = normalizeEmail(readCampProfile(req.tenant).directorEmail || "");
  if (expectedDirectorEmail && identityEmail !== expectedDirectorEmail) {
    return res.status(403).json({
      error: {
        code: "DIRECTOR_BOOTSTRAP_EMAIL_MISMATCH",
        message: "This camp's director account is reserved for the address it was set up with."
      }
    });
  }

  const existingDirector = await UserModel.findOne(tenantId, {
    roles: { $contains: ["tenant_admin"] },
    status: "active"
  });

  if (existingDirector) {
    const sameDirectorByClerkId =
      String(existingDirector.clerkUserId || "").trim() &&
      String(existingDirector.clerkUserId || "").trim() === String(identity.clerkUserId || "").trim();
    const sameDirectorByEmail = identityEmail && normalizeEmail(existingDirector.email || "") === identityEmail;

    if (!sameDirectorByClerkId && !sameDirectorByEmail) {
      return res.status(409).json({
        error: {
          code: "DIRECTOR_ALREADY_CLAIMED",
          message: "A director account already exists for this camp."
        }
      });
    }
  }

  const member = await createTenantMembershipFromIdentity({
    tenantId,
    identity,
    tenantSlug: req.tenant.slug,
    roles: ["tenant_admin", "user"],
    status: "active"
  });

  await ensureProfileForUser({
    tenantId,
    user: member,
    identity
  });

  if (req.tenant.onboardingStatus !== "in_progress") {
    await TenantModel.update(req.tenant._id, { onboardingStatus: "in_progress" });
  }

  await writeTenantAudit(tenantId, String(member._id), "director_bootstrap_claimed", {
    clerkUserId: String(identity.clerkUserId || "").trim() || null,
    email: identityEmail || null
  });

  await logTenantEvent({
    tenantId,
    userId: member._id,
    eventType: "director_bootstrap_claimed",
    metadata: {
      source: "clerk_director_create_account"
    }
  }).catch(() => {});

  return res.json({
    ok: true,
    membership: {
      id: String(member._id),
      roles: member.roles || [],
      status: member.status
    },
    nextRoute: `${decisionRouteBase(req.tenant.slug)}/director-create-account?setup=1`
  });
});

router.post("/join", accessMutationLimiter, async (req, res) => {
  if (isGlobalSuperAdmin(req)) {
    return res.status(409).json({
      error: {
        code: "SUPER_ADMIN_BLOCKED",
        message: "Super admin accounts cannot join camp networks. Sign out and use a separate account."
      }
    });
  }

  const billingAccess = isTenantBillingAccessAllowed(req.tenant);

  if (req.tenant.status !== "active" || req.tenant.onboardingStatus !== "live") {
    return res.status(403).json({
      error: {
        code: "TENANT_NOT_LIVE",
        message: "This network is not open for joining yet."
      }
    });
  }
  if (!billingAccess.allowed) {
    return res.status(403).json({
      error: {
        code: "BILLING_RESTRICTED",
        message: "This network is temporarily unavailable due to billing status."
      }
    });
  }

  const identity = req.identity || {};
  const email = normalizeEmail(identity.email || "");
  if (!email || !isEmail(email)) {
    return res.status(400).json({
      error: { code: "IDENTITY_EMAIL_REQUIRED", message: "A verified email is required to join this network." }
    });
  }
  const policy = resolveTenantAccessPolicy(req.tenant);
  if (!isEmailAllowedByPolicy(policy, email)) {
    return res.status(403).json({
      error: {
        code: "EMAIL_DOMAIN_NOT_ALLOWED",
        message: "This email domain is not allowed to join directly. Request director approval instead."
      }
    });
  }
  if (policy.entryMode === "invite_only") {
    return res.status(403).json({
      error: {
        code: "INVITE_REQUIRED",
        message: "A valid invite is required to join this network."
      }
    });
  }
  if (policy.entryMode === "code") {
    const codeMatched =
      verifyTenantAccessCodeGrant(req.tenant, req.body?.accessGrant) ||
      (await verifyTenantAccessCode(req.tenant, req.body?.accessCode));
    if (!codeMatched) {
      return res.status(403).json({
        error: {
          code: "ACCESS_CODE_INVALID",
          message: "A valid join code is required to join this network."
        }
      });
    }
  }
  const legalAgreement = normalizeLegalAgreement(req.body || {});
  if (!isMemberEligibilityComplete(legalAgreement)) {
    return res.status(400).json({
      error: {
        code: "LEGAL_AGREEMENT_REQUIRED",
        message: `You must confirm that you are at least ${MINIMUM_MEMBER_AGE} and agree to Terms and Privacy before creating an account.`
      }
    });
  }

  // Everything the signup form collected is captured either way; the gate only
  // changes whether it becomes a member now or a row the director decides on.
  let member = await findTenantUserForIdentity(req.tenant._id, identity);
  // Turning off review permits new members; it never reverses a director's
  // removal. Returning members still need explicit human approval.
  if (policy.requireApproval || (member && member.status !== "active")) {
    if (!member || member.status !== "active") {
      const { requestRow, isNew } = await submitAccessRequest({
        tenant: req.tenant,
        identity,
        body: req.body || {},
        source: policy.entryMode === "code" ? "code_signup" : "open_signup"
      });
      const decision = await buildAccessDecision({ tenant: req.tenant, identity });
      return res.status(isNew ? 202 : 200).json({
        ok: true,
        pendingApproval: true,
        request: {
          id: String(requestRow._id),
          status: requestRow.status,
          requestedAt: requestRow.requestedAt
        },
        decision
      });
    }
  }

  if (!member) {
    member = await createTenantMembershipFromIdentity({
      tenantId: req.tenant._id,
      identity,
      tenantSlug: req.tenant.slug,
      roles: ["user"],
      status: "active"
    });
  }

  const profileRecord = await ensureProfileForUser({
    tenantId: req.tenant._id,
    user: member,
    identity
  });
  const profile = await persistProfileLegalAgreement(profileRecord, legalAgreement);

  // A request can have been submitted while the gate was on and then be
  // completed after the director turns it off. The join itself is the
  // authoritative approval in that case, so remove the stale queue item.
  await markPendingRequestApprovedByAutoJoin({
    tenantId: req.tenant._id,
    email,
    userId: member._id
  });

  await logTenantEvent({
    tenantId: req.tenant._id,
    userId: member._id,
    eventType: "signup_created",
    metadata: { method: policy.entryMode === "code" ? "clerk_code_join" : "clerk_open_join" }
  }).catch(() => {});

  await writeTenantAudit(req.tenant._id, member._id, "membership_created", {
    source: policy.entryMode === "code" ? "code_join" : "open_join",
    email
  }).catch(() => {});

  const decision = await buildAccessDecision({
    tenant: req.tenant,
    identity
  });

  return res.status(201).json({
    ok: true,
    member: {
      id: String(member._id),
      email: member.email,
      roles: member.roles || [],
      status: member.status
    },
    profile: {
      id: String(profile?._id || "")
    },
    decision
  });
});

router.post("/request-access", accessMutationLimiter, async (req, res) => {
  if (isGlobalSuperAdmin(req)) {
    return res.status(409).json({
      error: {
        code: "SUPER_ADMIN_BLOCKED",
        message: "Super admin accounts cannot request access to camp networks."
      }
    });
  }

  const billingAccess = isTenantBillingAccessAllowed(req.tenant);
  if (!billingAccess.allowed) {
    return res.status(403).json({
      error: {
        code: "BILLING_RESTRICTED",
        message: "This network is temporarily unavailable due to billing status."
      }
    });
  }

  const identity = req.identity || {};
  const email = normalizeEmail(identity.email || "");
  if (!email || !isEmail(email)) {
    return res.status(400).json({
      error: { code: "IDENTITY_EMAIL_REQUIRED", message: "A verified email is required to request access." }
    });
  }

  const existingMembership = await findTenantUserForIdentity(req.tenant._id, identity);
  if (existingMembership && existingMembership.status === "active") {
    const decision = await buildAccessDecision({
      tenant: req.tenant,
      identity
    });
    return res.json({
      ok: true,
      existingMembership: true,
      decision
    });
  }

  const { requestRow, isNew } = await submitAccessRequest({
    tenant: req.tenant,
    identity,
    body: req.body || {},
    source: "request_access"
  });

  const decision = await buildAccessDecision({
    tenant: req.tenant,
    identity
  });

  return res.status(isNew ? 201 : 200).json({
    ok: true,
    request: {
      id: String(requestRow._id),
      status: requestRow.status,
      requestedAt: requestRow.requestedAt
    },
    decision
  });
});

router.post("/invite/accept", accessMutationLimiter, async (req, res) => {
  if (isGlobalSuperAdmin(req)) {
    return res.status(409).json({
      error: {
        code: "SUPER_ADMIN_BLOCKED",
        message: "Super admin accounts cannot accept invites to camp networks."
      }
    });
  }

  const billingAccess = isTenantBillingAccessAllowed(req.tenant);
  if (!billingAccess.allowed) {
    return res.status(403).json({
      error: {
        code: "BILLING_RESTRICTED",
        message: "This network is temporarily unavailable due to billing status."
      }
    });
  }

  const identity = req.identity || {};
  const identityEmail = normalizeEmail(identity.email || "");
  const token = String(req.body?.inviteToken || req.body?.token || "").trim();

  // A person can begin account creation from the camp's normal signup page
  // rather than from their invitation URL. The decision endpoint deliberately
  // recognizes a live, email-addressed invite in that case. Complete the same
  // invite here after Clerk has verified the address, instead of leaving the
  // signed-in person without a membership or a review request just because
  // their callback has no opaque token in its URL.
  let invite = token
    ? await findInviteByOpaqueToken(req.tenant._id, token)
    : await findInviteForEmail(req.tenant._id, identityEmail);
  if (!invite && token) {
    const usedInvite = await findInviteByOpaqueTokenAnyState(req.tenant._id, token);
    if (usedInvite?.usedAt) {
      const existingMember = await findTenantUserForIdentity(req.tenant._id, identity);
      if (existingMember && String(usedInvite.usedByUserId || "") === String(existingMember._id || "")) {
        const decision = await buildAccessDecision({
          tenant: req.tenant,
          identity
        });
        return res.json({
          ok: true,
          idempotent: true,
          member: {
            id: String(existingMember._id),
            email: existingMember.email,
            roles: existingMember.roles || [],
            status: existingMember.status
          },
          decision
        });
      }
      return res.status(409).json({
        error: { code: "INVITE_ALREADY_USED", message: "This invite has already been used." }
      });
    }
  }

  if (!invite) {
    return res.status(404).json({
      error: { code: "INVITE_INVALID", message: "Invite token is invalid or expired." }
    });
  }

  const inviteEmail = normalizeEmail(invite.email || "");
  const inviteAllowsEmail = !inviteEmail || inviteEmail === identityEmail;
  if (!inviteAllowsEmail) {
    return res.status(403).json({
      error: {
        code: "INVITE_EMAIL_MISMATCH",
        message: "This invite is locked to a different email address."
      }
    });
  }
  const legalAgreement = normalizeLegalAgreement(req.body || {});
  if (!isMemberEligibilityComplete(legalAgreement)) {
    return res.status(400).json({
      error: {
        code: "LEGAL_AGREEMENT_REQUIRED",
        message: `You must confirm that you are at least ${MINIMUM_MEMBER_AGE} and agree to Terms and Privacy before creating an account.`
      }
    });
  }

  // An invitation says the director wanted to reach this person. With the review
  // gate on it does not by itself say they are in — so the invite is left
  // unused and the signup joins the queue. Nothing is spent if they are denied,
  // and returning to the link shows "waiting" rather than "already used".
  const policy = resolveTenantAccessPolicy(req.tenant);
  const existingMember = await findTenantUserForIdentity(req.tenant._id, identity);
  if (policy.requireApproval && !isDirectorInvite(invite) && (!existingMember || existingMember.status !== "active")) {
    const { requestRow, isNew } = await submitAccessRequest({
      tenant: req.tenant,
      identity,
      body: req.body || {},
      invite,
      source: "invite_accept"
    });
    const decision = await buildAccessDecision({ tenant: req.tenant, identity });
    return res.status(isNew ? 202 : 200).json({
      ok: true,
      pendingApproval: true,
      request: {
        id: String(requestRow._id),
        status: requestRow.status,
        requestedAt: requestRow.requestedAt
      },
      decision
    });
  }

  let member = existingMember;
  if (!member) {
    member = await createTenantMembershipFromIdentity({
      tenantId: req.tenant._id,
      identity,
      tenantSlug: req.tenant.slug,
      roles: rolesFromInvite(invite),
      status: "active"
    });
  } else {
    const patch = {};
    const nextRoles = mergeRoles(member.roles || [], rolesFromInvite(invite));
    if (nextRoles.length !== (member.roles || []).length) patch.roles = nextRoles;
    if (member.status !== "active") patch.status = "active";
    if (Object.keys(patch).length > 0) {
      const updated = await createTenantMembershipFromIdentity({
        tenantId: req.tenant._id,
        identity,
        tenantSlug: req.tenant.slug,
        roles: nextRoles,
        status: patch.status || member.status
      });
      member = updated;
    }
  }

  const profileRecord = await ensureProfileForUser({
    tenantId: req.tenant._id,
    user: member,
    identity
  });
  await persistProfileLegalAgreement(profileRecord, legalAgreement);

  await markInviteUsed(invite, member._id);

  await writeTenantAudit(req.tenant._id, member._id, "invite_accepted", {
    inviteId: String(invite._id),
    roleToAssign: invite.roleToAssign
  }).catch(() => {});

  const decision = await buildAccessDecision({
    tenant: req.tenant,
    identity
  });

  return res.json({
    ok: true,
    member: {
      id: String(member._id),
      email: member.email,
      roles: member.roles || [],
      status: member.status
    },
    decision
  });
});

router.post("/invite/create", accessMutationLimiter, inviteCreateLimiter, async (req, res) => {
  const requester = await findTenantUserForIdentity(req.tenant._id, req.identity || {});
  const roleSetLocal = roleSet(requester?.roles || []);
  if (!roleSetLocal.has("tenant_admin") && !roleSetLocal.has("super_admin")) {
    return res.status(403).json({
      error: { code: "ROLE_FORBIDDEN", message: "Only directors can create invites." }
    });
  }

  const email = normalizeEmail(req.body?.email || "");
  const roleToAssign = String(req.body?.roleToAssign || "user").trim();
  if (!isEmail(email)) {
    return res.status(400).json({
      error: { code: "INVALID_EMAIL", message: "Provide a valid invite email." }
    });
  }
  if (!["user", "tenant_admin"].includes(roleToAssign)) {
    return res.status(400).json({
      error: { code: "INVALID_ROLE", message: "roleToAssign must be user or tenant_admin." }
    });
  }

  const expiresInDays = Number(req.body?.expiresInDays || 7) || 7;
  const { invite, token } = await createInviteRecord({
    tenantId: req.tenant._id,
    email,
    roleToAssign,
    createdByUserId: requester?._id || null,
    expiresInDays
  });

  await writeTenantAudit(req.tenant._id, requester?._id || null, "invite_created", {
    inviteId: String(invite._id),
    email,
    roleToAssign
  }).catch(() => {});

  return res.status(201).json({
    ok: true,
    invite: {
      id: String(invite._id),
      email: invite.email,
      roleToAssign: invite.roleToAssign,
      expiresAt: invite.expiresAt
    },
    token
  });
});

/**
 * Finds the caller's own unclaimed profile, or explains why there isn't one.
 * Both claim endpoints act only on the signed-in person's own row — the profile
 * id is never taken from the request body, so there is nothing to tamper with.
 */
async function loadOwnUnclaimedProfile(req) {
  const identity = req.identity || {};
  const member = await findTenantUserForIdentity(req.tenant._id, identity);
  if (!member || member.status !== "active") {
    return { error: { status: 404, code: "NO_PROFILE_TO_CLAIM", message: "There is no profile waiting to be claimed for this account." } };
  }

  // Claiming must never recreate a profile that an undo removed concurrently.
  const profile = await ProfileModel.findOne(req.tenant._id, { userId: member._id });
  if (!profile) {
    return { error: { status: 404, code: "NO_PROFILE_TO_CLAIM", message: "There is no profile waiting to be claimed for this account." } };
  }
  if (!isUnclaimedProfile(profile)) {
    // Already claimed, by an earlier visit or a second tab. Say so plainly rather
    // than treating a repeat confirmation as an error the person has to solve.
    return { error: { status: 409, code: "PROFILE_ALREADY_CLAIMED", message: "This profile has already been claimed." } };
  }

  return { member, profile };
}

router.post("/claim/confirm", accessMutationLimiter, async (req, res, next) => {
  try {
    const { member, profile, error } = await loadOwnUnclaimedProfile(req);
    if (error) return res.status(error.status).json({ error: { code: error.code, message: error.message } });

    // This is the one write that makes an imported profile visible to anyone.
    // Creating a password does not do it, and neither does opening the email —
    // only the person saying the information is theirs.
    const claimed = await ProfileModel.claimOne(profile._id, {
      tenantId: req.tenant._id, userId: member._id, status: "pending"
    }, { status: "active", flaggedReason: "" });
    if (!claimed) {
      return res.status(409).json({ error: {
        code: "PROFILE_CLAIM_CHANGED",
        message: "This profile was already claimed or removed. Refresh to continue."
      } });
    }

    await logTenantEvent({
      tenantId: req.tenant._id,
      userId: member._id,
      eventType: "profile_claimed",
      metadata: { profileId: String(profile._id) }
    }).catch(() => {});

    await writeTenantAudit(req.tenant._id, member._id, "imported_profile_claimed", {
      profileId: String(profile._id)
    }).catch(() => {});

    return res.status(200).json({
      ok: true,
      profile: {
        id: String(claimed?._id || profile._id),
        status: claimed?.status || "active"
      },
      nextRoute: `${decisionRouteBase(req.tenant.slug)}/edit-profile`
    });
  } catch (err) {
    return next(err);
  }
});

router.post("/claim/decline", accessMutationLimiter, async (req, res, next) => {
  try {
    const { member, profile, error } = await loadOwnUnclaimedProfile(req);
    if (error) return res.status(error.status).json({ error: { code: error.code, message: error.message } });

    // The camp put this address on the wrong person. The profile stays pending,
    // so it stays invisible, and a director has to sort out who the row belongs
    // to — releasing the email automatically would risk handing one alum's
    // history to another.
    const socials = profile.socials && typeof profile.socials === "object" ? profile.socials : {};
    const importedFrom = socials.importedFrom && typeof socials.importedFrom === "object"
      ? socials.importedFrom
      : null;
    const declined = await ProfileModel.claimOne(profile._id, {
      tenantId: req.tenant._id, userId: member._id, status: "pending"
    }, {
      flaggedReason: "Claim declined: the person who signed in with this address says the profile is not theirs.",
      // Recorded beside the import so the claim action can stop offering to email
      // somebody who has already said this is not them.
      ...(importedFrom
        ? { socials: { ...socials, importedFrom: { ...importedFrom, claimDeclinedAt: new Date().toISOString() } } }
        : {})
    });

    if (!declined) {
      return res.status(409).json({ error: {
        code: "PROFILE_CLAIM_CHANGED",
        message: "This profile was already claimed or removed. Refresh to continue."
      } });
    }

    await logTenantEvent({
      tenantId: req.tenant._id,
      userId: member._id,
      eventType: "profile_claim_declined",
      metadata: { profileId: String(profile._id) }
    }).catch(() => {});

    await writeTenantAudit(req.tenant._id, member._id, "imported_profile_claim_declined", {
      profileId: String(profile._id),
      email: normalizeEmail(req.identity?.email || member.email || "")
    }).catch(() => {});

    // Deliberately no push here: notifyTenantAdmins keys off a registered
    // notification kind, and adding one directors cannot switch off is worse
    // than the audit trail. The people list surfaces declined rows.

    return res.status(200).json({ ok: true, declined: true });
  } catch (err) {
    return next(err);
  }
});

export default router;
