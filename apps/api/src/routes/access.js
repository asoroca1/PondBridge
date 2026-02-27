import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  UserModel,
  AccessRequestModel,
  InviteModel,
  TenantAdminAuditLogModel,
  TenantModel
} from "../db/models/index.js";
import { requireTenantIdentityScope } from "../middleware/tenantAccess.js";
import { comparePassword } from "../utils/auth.js";
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
import { normalizeSignupMode, resolveSettings } from "../services/onboarding.js";
import { logTenantEvent } from "../services/analytics.js";
import { isTenantBillingAccessAllowed } from "../services/billingState.js";
import {
  canonicalizeCityName,
  canonicalizeCountryName,
  composeCityState,
  parseCityStateDetailed
} from "../utils/location.js";

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

function mergeRoles(base = [], extra = []) {
  return [...new Set([...(base || []), ...(extra || [])].map((role) => String(role || "").trim()).filter(Boolean))];
}

function rolesFromInvite(invite) {
  const role = String(invite?.roleToAssign || "user").trim();
  if (role === "tenant_admin") return ["tenant_admin", "user"];
  return ["user"];
}

function isEmail(value = "") {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function emailDomain(email = "") {
  const at = String(email || "").toLowerCase().trim().split("@");
  return at.length > 1 ? at[at.length - 1] : "";
}

function tenantJoinMode(tenant) {
  const settings = resolveSettings(tenant);
  const signupMode = normalizeSignupMode(settings.signupMode || "open");

  if (signupMode === "invite_only") return "invite_only";
  if (signupMode === "approval_queue") return "request_access";
  if (signupMode === "code") return "open_join";
  return "open_join";
}

function normalizeCamperYears(value = {}) {
  const input = value && typeof value === "object" ? value : {};
  const validYear = (year = "") => {
    const normalized = String(year || "").trim();
    return /^\d{4}$/.test(normalized) ? normalized : "";
  };
  return {
    firstYear: validYear(input.firstYear),
    firstGroup: String(input.firstGroup || "").trim(),
    lastYear: validYear(input.lastYear),
    lastGroup: String(input.lastGroup || "").trim()
  };
}

function normalizeRoleList(value = []) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  const seen = new Set();
  const ordered = [];
  values.forEach((entry) => {
    const role = String(entry || "").trim();
    const key = role.toLowerCase();
    if (!role || seen.has(key)) return;
    seen.add(key);
    ordered.push(role);
  });
  return ordered;
}

function normalizeCollegeMajors(value = []) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry || "").trim());
}

function normalizeCityStateFromBody(body = {}) {
  const direct = String(body.cityState || "").trim();
  if (direct) return composeCityState(parseCityStateDetailed(direct));
  const state = String(body.state || "").trim().toUpperCase();
  const country = canonicalizeCountryName(String(body.country || "").trim());
  const city = canonicalizeCityName(String(body.city || "").trim(), { state, country });
  return composeCityState({ city, state, country });
}

function normalizeSocialsFromBody(body = {}, roleList = []) {
  const fromSocials = body.socials && typeof body.socials === "object" ? body.socials : {};
  const fromSocial = body.social && typeof body.social === "object" ? body.social : {};
  const merged = { ...fromSocials, ...fromSocial };
  const nickname = String(
    body.nickname ??
      body.campNickname ??
      merged.nickname ??
      merged.campNickname ??
      ""
  ).trim();
  const normalizedCamperYears = normalizeCamperYears(
    body.camperYears && typeof body.camperYears === "object" ? body.camperYears : merged.camperYears || {}
  );
  const normalizedRoles = normalizeRoleList(
    roleList.length ? roleList : Array.isArray(merged.roles) ? merged.roles : []
  );
  const normalizedCollegeMajors = normalizeCollegeMajors(
    Array.isArray(body.collegeMajors)
      ? body.collegeMajors
      : Array.isArray(body.education)
      ? body.education.map((row) => String(row?.major || "").trim())
      : Array.isArray(merged.collegeMajors)
      ? merged.collegeMajors
      : Array.isArray(merged.educationMajors)
      ? merged.educationMajors
      : []
  );
  return {
    ...merged,
    ...(nickname ? { nickname, campNickname: nickname } : {}),
    camperYears: normalizedCamperYears,
    roles: normalizedRoles,
    ...(normalizedCollegeMajors.length
      ? { collegeMajors: normalizedCollegeMajors, educationMajors: normalizedCollegeMajors }
      : {})
  };
}

function normalizeJobRows(rows = []) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => ({
    role: String(row?.role || "").trim(),
    company: String(row?.company || "").trim(),
    years: String(row?.years || "").trim()
  }));
}

function profilePayloadFromBody(body = {}, identity = {}) {
  const email = normalizeEmail(identity.email || body.email || "");
  const education = Array.isArray(body.education) ? body.education : [];
  const roles = normalizeRoleList(Array.isArray(body.roles) ? body.roles : [body.roleAtCamp]);
  const phones = Array.isArray(body.phones)
    ? body.phones.map((entry) => String(entry || "").trim()).filter(Boolean)
    : body.phone
    ? [String(body.phone).trim()]
    : [];
  return {
    firstName: String(body.firstName || "").trim(),
    lastName: String(body.lastName || "").trim(),
    emails: email ? [email] : [],
    phones,
    cityState: normalizeCityStateFromBody(body),
    roleAtCamp: String(roles[0] || "").trim(),
    highSchool: String(body.highSchool || "").trim(),
    colleges: Array.isArray(body.colleges)
      ? body.colleges
      : education.map((row) => String(row?.college || "").trim()).filter(Boolean),
    collegeYears: Array.isArray(body.collegeYears)
      ? body.collegeYears
      : education.map((row) => String(row?.year || "").trim()).filter(Boolean),
    currentJobs: normalizeJobRows(body.currentJobs),
    pastJobs: normalizeJobRows(body.pastJobs),
    industry: String(body.industry || "").trim(),
    socials: normalizeSocialsFromBody(body, roles),
    bio: String(body.bio || "").trim(),
    avatarUrl: String(body.uploads?.photoUrl || body.avatarUrl || body.photoUrl || "").trim()
  };
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

async function buildAccessDecision({ tenant, identity, inviteToken = "" }) {
  const tenantId = String(tenant._id);
  const email = normalizeEmail(identity.email || "");
  const settings = resolveSettings(tenant);
  const signupMode = normalizeSignupMode(settings.signupMode || "open");
  const joinMode = tenantJoinMode(tenant);
  const billingAccess = isTenantBillingAccessAllowed(tenant);

  const membership = await findTenantUserForIdentity(tenantId, identity);
  const pendingRequest = await findPendingRequest(tenantId, email);
  const inviteFromToken = inviteToken ? await findInviteByOpaqueToken(tenantId, inviteToken) : null;
  const inviteByEmail = inviteFromToken || (email ? await findInviteForEmail(tenantId, email) : null);
  const invite = inviteByEmail && new Date(inviteByEmail.expiresAt) > new Date() ? inviteByEmail : null;

  const base = decisionRouteBase(tenant.slug);
  const loginRoute = `${base}/login`;
  const onboardingRoute = `${base}/edit-profile`;
  const directorSetupRoute = `${base}/director-create-account?setup=1`;
  const homeRoute = `${base}/home`;
  const pendingRoute = `${base}/request-access`;

  if (membership && membership.status !== "active") {
    return {
      state: "revoked",
      action: "contact_director",
      nextRoute: loginRoute,
      membership: {
        id: String(membership._id),
        status: membership.status,
        roles: membership.roles || []
      }
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

  if (pendingRequest) {
    return {
      state: "pending_approval",
      action: "wait_for_approval",
      nextRoute: pendingRoute,
      request: {
        id: String(pendingRequest._id),
        requestedAt: pendingRequest.requestedAt
      }
    };
  }

  if (invite) {
    return {
      state: "invited",
      action: "accept_invite",
      nextRoute: `${base}/create-account`,
      invite: {
        id: String(invite._id),
        roleToAssign: invite.roleToAssign,
        emailLocked: Boolean(invite.email),
        expiresAt: invite.expiresAt
      }
    };
  }

  if (joinMode === "open_join") {
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
      signupMode
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
    inviteToken
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

  const settings = resolveSettings(req.tenant);
  const signupMode = normalizeSignupMode(settings.signupMode || "open");
  if (signupMode === "invite_only") {
    return res.status(403).json({
      error: { code: "INVITE_REQUIRED", message: "This network is invite-only." }
    });
  }
  if (signupMode === "approval_queue") {
    return res.status(403).json({
      error: { code: "APPROVAL_REQUIRED", message: "This network requires approval before joining." }
    });
  }

  if (signupMode === "code") {
    const accessCode = String(req.body?.accessCode || "").trim();
    const codeHash = String(req.tenant?.settings?.accessCodeHash || "").trim();
    const legacyCode = String(req.tenant?.accessSettings?.accessCode || "").trim();
    const codeMatched =
      (codeHash ? await comparePassword(accessCode, codeHash) : false) ||
      (legacyCode ? accessCode === legacyCode : false);
    if (!codeMatched) {
      return res.status(403).json({
        error: { code: "ACCESS_CODE_INVALID", message: "A valid access code is required." }
      });
    }
  }

  const allowedDomains = (settings.allowedEmailDomains || [])
    .map((domain) => String(domain || "").trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
  if (allowedDomains.length > 0 && !allowedDomains.includes(emailDomain(email))) {
    return res.status(403).json({
      error: { code: "EMAIL_DOMAIN_NOT_ALLOWED", message: "Your email domain is not allowed for this network." }
    });
  }

  let member = await findTenantUserForIdentity(req.tenant._id, identity);
  if (!member) {
    member = await createTenantMembershipFromIdentity({
      tenantId: req.tenant._id,
      identity,
      tenantSlug: req.tenant.slug,
      roles: ["user"],
      status: "active"
    });
  } else if (member.status !== "active") {
    member = await createTenantMembershipFromIdentity({
      tenantId: req.tenant._id,
      identity,
      tenantSlug: req.tenant.slug,
      roles: member.roles || ["user"],
      status: "active"
    });
  }

  const profile = await ensureProfileForUser({
    tenantId: req.tenant._id,
    user: member,
    identity
  });

  await logTenantEvent({
    tenantId: req.tenant._id,
    userId: member._id,
    eventType: "signup_created",
    metadata: { method: "clerk_open_join" }
  }).catch(() => {});

  await writeTenantAudit(req.tenant._id, member._id, "membership_created", {
    source: "open_join",
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

  const existingPending = await findPendingRequest(req.tenant._id, email);
  const profilePayload = profilePayloadFromBody(req.body || {}, identity);
  const selfReportedRole = String(
    profilePayload.roleAtCamp ||
      (Array.isArray(req.body?.roles) ? req.body.roles[0] : req.body?.roleAtCamp) ||
      ""
  ).trim();
  let requestRow = existingPending;
  if (existingPending) {
    requestRow = await AccessRequestModel.update(existingPending._id, {
      firstName: profilePayload.firstName,
      lastName: profilePayload.lastName,
      selfReportedRole,
      requestMessage: String(req.body?.requestMessage || "").trim(),
      profilePayload,
      status: "pending",
      requestedAt: new Date(),
      reviewedAt: null,
      reviewedByUserId: null,
      denialReason: ""
    });
  } else {
    try {
      requestRow = await AccessRequestModel.create({
        tenantId: req.tenant._id,
        email,
        firstName: profilePayload.firstName,
        lastName: profilePayload.lastName,
        passwordHash: "clerk_managed",
        selfReportedRole,
        requestMessage: String(req.body?.requestMessage || "").trim(),
        profilePayload,
        status: "pending",
        requestedAt: new Date()
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const pending = await findPendingRequest(req.tenant._id, email);
      if (!pending) throw error;
      requestRow = pending;
    }
  }

  await writeTenantAudit(req.tenant._id, null, "access_request_submitted", {
    email,
    requestId: String(requestRow._id)
  }).catch(() => {});

  const decision = await buildAccessDecision({
    tenant: req.tenant,
    identity
  });

  return res.status(existingPending ? 200 : 201).json({
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
  const token = String(req.body?.inviteToken || req.body?.token || "").trim();
  if (!token) {
    return res.status(400).json({
      error: { code: "INVITE_TOKEN_REQUIRED", message: "Invite token is required." }
    });
  }

  let invite = await findInviteByOpaqueToken(req.tenant._id, token);
  if (!invite) {
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

  const identityEmail = normalizeEmail(identity.email || "");
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

  let member = await findTenantUserForIdentity(req.tenant._id, identity);
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

  await ensureProfileForUser({
    tenantId: req.tenant._id,
    user: member,
    identity
  });

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

export default router;
