import { Router } from "express";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import {
  UserModel,
  ProfileModel,
  ActivityItemModel,
  AccessRequestModel,
  MagicLinkTokenModel,
  TenantModel
} from "../db/models/index.js";
import { requireTenant } from "../middleware/tenantContext.js";
import { rememberSignupIntent } from "../services/signupIntent.js";
import { buildAuthenticatedUserPayload, comparePassword, hashPassword, signToken } from "../utils/auth.js";
import { env } from "../config/env.js";
import { sendMagicLinkEmail, sendWelcomeEmail } from "../services/email.js";
import { logTenantEvent } from "../services/analytics.js";
import { notifyTenantAdmins } from "../services/mobileNotifications.js";
import { clearAuthCookie, setAuthCookie } from "../utils/authCookie.js";
import { findInviteByOpaqueToken, markInviteUsed } from "../services/invites.js";
import { hashOpaqueToken } from "../utils/tokens.js";
import { isTenantBillingAccessAllowed } from "../services/billingState.js";
import {
  createTenantAccessCodeGrant,
  isEmailAllowedByPolicy,
  resolveTenantAccessPolicy,
  verifyTenantAccessCodeGrant,
  verifyTenantAccessCode
} from "../services/accessPolicy.js";
import {
  canonicalizeCityName,
  canonicalizeCountryName,
  composeCityState,
  parseCityStateDetailed
} from "../utils/location.js";
import {
  MINIMUM_MEMBER_AGE,
  isMemberEligibilityComplete,
  normalizeMemberLegalAgreement as normalizeLegalAgreementFromBody
} from "../services/memberEligibility.js";

const router = Router({ mergeParams: true });
function authLimiterKey(req, { includeEmail = false } = {}) {
  const tenantSlug = String(req.params?.slug || req.tenant?.slug || "").trim().toLowerCase();
  const ip = String(req.ip || "").trim();
  const email = includeEmail ? String(req.body?.email || "").trim().toLowerCase() : "";
  return ["tenant-auth", tenantSlug, ip, email].join(":");
}

const magicLinkRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 6,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => authLimiterKey(req, { includeEmail: true })
});
const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 25,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => authLimiterKey(req, { includeEmail: true })
});
const accessCodeVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => authLimiterKey(req)
});
const signupIntentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => authLimiterKey(req, { includeEmail: true })
});
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => authLimiterKey(req, { includeEmail: true })
});
const inviteVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => authLimiterKey(req)
});
const magicLinkConsumeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => authLimiterKey(req)
});
const demoAccessLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => authLimiterKey(req)
});

function generateToken(length = 24) {
  return crypto.randomBytes(length).toString("base64url");
}

function rolesFromInvite(invite) {
  const role = String(invite?.roleToAssign || "user");
  if (role === "tenant_admin") {
    return ["tenant_admin", "user"];
  }
  return ["user"];
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

function resolveDemoAccessSettings(tenant = null) {
  const settings = tenant?.settings && typeof tenant.settings === "object" ? tenant.settings : {};
  const demoAccess = settings.demoAccess && typeof settings.demoAccess === "object" ? settings.demoAccess : {};
  const codeHash = String(demoAccess.codeHash || "").trim();
  return {
    enabled: Boolean(demoAccess.enabled && codeHash),
    codeHash,
    directorUserId: String(demoAccess.directorUserId || "").trim(),
    directorEmail: String(demoAccess.directorEmail || "").trim().toLowerCase()
  };
}

function isDemoAccessOnlyTenant(tenant = null) {
  return resolveDemoAccessSettings(tenant).enabled;
}

function demoAccessOnlyErrorPayload() {
  return {
    error: {
      code: "DEMO_ACCESS_ONLY",
      message: "This demo network only supports access-code sign in."
    }
  };
}

function profileFromBody(body) {
  const education = Array.isArray(body.education) ? body.education : [];
  const roles = normalizeRoleList(Array.isArray(body.roles) ? body.roles : [body.roleAtCamp]);
  const normalizedSocials = normalizeSocialsFromBody(body, roles);
  const legalAgreement = normalizeLegalAgreementFromBody(body);
  const phones = Array.isArray(body.phones)
    ? body.phones.map((entry) => String(entry || "").trim()).filter(Boolean)
    : body.phone
    ? [String(body.phone).trim()]
    : [];
  const socials = legalAgreement.accepted
    ? {
        ...normalizedSocials,
        legalAgreement: {
          accepted: true,
          acceptedAt: legalAgreement.acceptedAt,
          termsVersion: legalAgreement.termsVersion,
          privacyVersion: legalAgreement.privacyVersion,
          ageEligibilityConfirmed: legalAgreement.ageEligibilityConfirmed,
          minimumAge: legalAgreement.minimumAge,
          agePolicyVersion: legalAgreement.agePolicyVersion
        }
      }
    : normalizedSocials;
  return {
    firstName: String(body.firstName || "").trim(),
    lastName: String(body.lastName || "").trim(),
    emails: [String(body.email || "").trim().toLowerCase()].filter(Boolean),
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
    socials,
    bio: String(body.bio || "").trim(),
    avatarUrl: String(body.uploads?.photoUrl || body.avatarUrl || body.photoUrl || "").trim()
  };
}

// Records which camp an address is signing up for so the Clerk email.created
// webhook can brand the verification email. Clerk's payload carries no tenant,
// and the address is the only value both sides share.
router.post("/signup-intent", signupIntentLimiter, requireTenant, async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const audience = String(req.body?.audience || "member").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return res.status(400).json({
      error: { code: "EMAIL_REQUIRED", message: "A valid email address is required." }
    });
  }
  rememberSignupIntent({ email, tenantSlug: req.tenant?.slug, audience });
  return res.json({ ok: true });
});

router.post("/access-code/verify", accessCodeVerifyLimiter, requireTenant, async (req, res) => {
  const policy = resolveTenantAccessPolicy(req.tenant);
  if (policy.entryMode !== "code") {
    return res.status(409).json({
      error: {
        code: "ACCESS_CODE_NOT_REQUIRED",
        message: "This network does not currently require a join code."
      }
    });
  }

  const matched = await verifyTenantAccessCode(req.tenant, req.body?.accessCode || req.body?.code);
  if (!matched) {
    return res.status(403).json({
      error: {
        code: "ACCESS_CODE_INVALID",
        message: "That join code is not valid."
      }
    });
  }

  return res.json({
    ok: true,
    accessGrant: createTenantAccessCodeGrant(req.tenant),
    expiresInSeconds: 600
  });
});

router.post("/register", registerLimiter, requireTenant, async (req, res) => {
  if (isDemoAccessOnlyTenant(req.tenant)) {
    return res.status(403).json(demoAccessOnlyErrorPayload());
  }

  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const firstName = String(req.body.firstName || "").trim();
  const lastName = String(req.body.lastName || "").trim();
  const campName = String(req.body.campName || "").trim();
  const inviteToken = String(req.body.inviteToken || "").trim();
  const directorSignup = Boolean(req.body.directorSignup);
  const legalAgreement = normalizeLegalAgreementFromBody(req.body);

  if (!email || !password || password.length < 8 || !firstName || !lastName) {
    return res.status(400).json({
      error: {
        code: "INVALID_INPUT",
        message: "First name, last name, email, and password (min 8 chars) are required"
      }
    });
  }

  if (req.tenant.status !== "active") {
    return res.status(403).json({
      error: {
        code: "TENANT_INACTIVE",
        message: "This tenant is inactive"
      }
    });
  }

  const policy = resolveTenantAccessPolicy(req.tenant);
  const signupMode = policy.entryMode;
  let matchingInvite = null;
  if (inviteToken) {
    const inviteByToken = await findInviteByOpaqueToken(req.tenant._id, inviteToken);

    const inviteEmail = String(inviteByToken?.email || "").trim().toLowerCase();
    const inviteAllowsEmail = !inviteEmail || inviteEmail === email;

    if (inviteByToken && inviteAllowsEmail) {
      matchingInvite = inviteByToken;
    }
  }

  const prelaunchDirectorInvite = matchingInvite?.roleToAssign === "tenant_admin";
  const existingDirector = await UserModel.findOne(req.tenant._id, { roles: { $contains: ["tenant_admin"] } });
  const canBootstrapDirector =
    directorSignup && req.tenant.onboardingStatus !== "live" && !prelaunchDirectorInvite && !existingDirector;
  const bypassAccessControls = prelaunchDirectorInvite || canBootstrapDirector;
  const billingAccess = isTenantBillingAccessAllowed(req.tenant);

  if (req.tenant.onboardingStatus !== "live" && !bypassAccessControls) {
    return res.status(403).json({
      error: {
        code: "TENANT_NOT_LIVE",
        message: "This network is not live yet. Contact your camp director."
      }
    });
  }
  if (req.tenant.onboardingStatus === "live" && !bypassAccessControls && !billingAccess.allowed) {
    return res.status(403).json({
      error: {
        code: "BILLING_RESTRICTED",
        message: "This network is temporarily unavailable due to billing status."
      }
    });
  }

  if (!bypassAccessControls && !matchingInvite && !isEmailAllowedByPolicy(policy, email)) {
    return res.status(403).json({
      error: {
        code: "EMAIL_DOMAIN_NOT_ALLOWED",
        message: "This email domain is not allowed to join directly. Contact your camp director."
      }
    });
  }

  if (!bypassAccessControls && signupMode === "invite_only") {
    if (!matchingInvite) {
      return res.status(403).json({
        error: {
          code: "INVITE_REQUIRED",
          message: "A valid invite token is required for this tenant."
        }
      });
    }
  }

  if (!bypassAccessControls && signupMode === "code") {
    if (!matchingInvite) {
      const codeMatched =
        verifyTenantAccessCodeGrant(req.tenant, req.body.accessGrant) ||
        (await verifyTenantAccessCode(req.tenant, req.body.accessCode));
      if (!codeMatched) {
        return res.status(403).json({
          error: {
            code: "ACCESS_CODE_INVALID",
            message: "Access code is required for signup"
          }
        });
      }
    }
  }

  if (!isMemberEligibilityComplete(legalAgreement)) {
    return res.status(400).json({
      error: {
        code: "LEGAL_AGREEMENT_REQUIRED",
        message: `You must confirm that you are at least ${MINIMUM_MEMBER_AGE} and agree to Terms and Privacy before creating an account.`
      }
    });
  }

  const existing = await UserModel.findOne(req.tenant._id, { email });
  if (existing) {
    return res.status(409).json({
      error: {
        code: "EMAIL_EXISTS",
        message: "An account already exists for that email in this camp"
      }
    });
  }

  const needsReview =
    !bypassAccessControls &&
    (policy.requireApproval || (signupMode === "approval_queue" && !matchingInvite));
  if (needsReview) {
    const profilePayload = profileFromBody(req.body);
    const selfReportedRole = String(
      profilePayload.roleAtCamp ||
        (Array.isArray(req.body.roles) ? req.body.roles[0] : req.body.roleAtCamp) ||
        ""
    ).trim();
    const passwordHash = await hashPassword(password);
    const existingRequest = await AccessRequestModel.findOne(req.tenant._id, {
      email,
      status: { $in: ["pending", "denied"] }
    });

    if (existingRequest) {
      await AccessRequestModel.updateScoped(req.tenant._id, existingRequest._id, {
        firstName,
        lastName,
        passwordHash,
        selfReportedRole,
        requestMessage: String(req.body.requestMessage || "").trim(),
        profilePayload,
        status: "pending",
        requestedAt: new Date(),
        reviewedAt: null,
        reviewedByUserId: null,
        denialReason: ""
      });
    } else {
      await AccessRequestModel.create({
        tenantId: req.tenant._id,
        email,
        firstName,
        lastName,
        passwordHash,
        selfReportedRole,
        requestMessage: String(req.body.requestMessage || "").trim(),
        profilePayload,
        status: "pending",
        requestedAt: new Date()
      });
    }

    await notifyTenantAdmins({
      tenant: req.tenant,
      kind: "approval_request_submitted",
      title: "New approval request",
      body: `${firstName || "A member"} ${lastName || ""}`.trim()
        ? `${`${firstName || "A member"} ${lastName || ""}`.trim()} requested access to ${req.tenant.name || "your camp"}.`
        : `A new member requested access to ${req.tenant.name || "your camp"}.`,
      deepLink: "/admin/members",
      data: {
        email,
        requestType: "signup_approval"
      }
    }).catch(() => {});

    return res.status(403).json({
      error: {
        code: "APPROVAL_REQUIRED",
        message: "Your request was submitted. A director will review and approve your access."
      },
      requestSubmitted: true
    });
  }

  const passwordHash = await hashPassword(password);
  const signupRoles = canBootstrapDirector ? ["tenant_admin", "user"] : rolesFromInvite(matchingInvite);

  const user = await UserModel.create({
    tenantId: req.tenant._id,
    email,
    passwordHash,
    roles: signupRoles
  });

  const profile = await ProfileModel.create({
    tenantId: req.tenant._id,
    userId: user._id,
    ...profileFromBody(req.body)
  });

  await UserModel.updateScoped(req.tenant._id, user._id, { profileId: profile._id });
  user.profileId = profile._id;

  const actorName = [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim() || "Someone";
  await ActivityItemModel.create({
    tenantId: req.tenant._id,
    actorUserId: user._id,
    actor: { id: String(user._id), name: actorName },
    type: "user.join",
    target: {
      href: `/profile/${profile._id}`,
      label: "profile"
    },
    ts: new Date()
  }).catch(() => {});

  await notifyTenantAdmins({
    tenant: req.tenant,
    createdByUserId: user._id,
    kind: "member_joined",
    title: "New member joined",
    body: `${actorName} joined ${req.tenant.name || "your camp network"}.`,
    deepLink: "/admin/members",
    data: {
      profileId: String(profile._id || ""),
      userId: String(user._id || "")
    }
  }).catch(() => {});

  if (matchingInvite) {
    await markInviteUsed(matchingInvite, user._id);
  }

  let tenant = req.tenant;
  if (prelaunchDirectorInvite || canBootstrapDirector) {
    const tenantUpdate = {};
    if (!String(req.tenant.name || "").trim() && campName) {
      tenantUpdate.name = campName;
    }
    if (req.tenant.onboardingStatus !== "live") {
      tenantUpdate.onboardingStatus = "in_progress";
    }

    if (Object.keys(tenantUpdate).length > 0) {
      tenant = await TenantModel.update(req.tenant._id, tenantUpdate);
    }
  }

  const token = signToken(user);
  setAuthCookie(res, token);

  await logTenantEvent({
    tenantId: req.tenant._id,
    userId: user._id,
    eventType: "signup_created",
    metadata: {
      method: prelaunchDirectorInvite ? "invite" : canBootstrapDirector ? "director_bootstrap" : signupMode
    }
  }).catch(() => {});

  await sendWelcomeEmail({
    tenant: req.tenant,
    firstName,
    email
  }).catch((error) => {
    console.warn("[email] welcome email failed", {
      tenantId: String(req.tenant._id || ""),
      email,
      message: String(error?.message || "")
    });
  });

  return res.status(201).json({
    token,
    user: buildAuthenticatedUserPayload(user, profile),
    profile,
    tenant: tenant
      ? {
          id: String(tenant._id),
          slug: tenant.slug,
          name: tenant.name,
          onboardingStatus: tenant.onboardingStatus
        }
      : null
  });
});

router.post("/invite/verify", inviteVerifyLimiter, requireTenant, async (req, res) => {
  const inviteToken = String(req.body.inviteToken || "").trim();
  if (!inviteToken) {
    return res.status(400).json({
      error: {
        code: "INVITE_TOKEN_REQUIRED",
        message: "Invite token is required."
      }
    });
  }

  const invite = await findInviteByOpaqueToken(req.tenant._id, inviteToken);
  if (!invite) {
    return res.status(404).json({
      error: {
        code: "INVITE_INVALID",
        message: "Invite token is invalid or expired."
      }
    });
  }

  return res.json({
    valid: true,
    invite: {
      email: invite.email,
      roleToAssign: invite.roleToAssign,
      expiresAt: invite.expiresAt
    }
  });
});

router.post("/login", loginLimiter, requireTenant, async (req, res) => {
  if (isDemoAccessOnlyTenant(req.tenant)) {
    return res.status(403).json(demoAccessOnlyErrorPayload());
  }

  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  if (!email || !password) {
    return res.status(400).json({
      error: {
        code: "INVALID_INPUT",
        message: "Email and password are required"
      }
    });
  }

  const user = await UserModel.findOne(req.tenant._id, { email });
  if (!user) {
    return res.status(401).json({
      error: { code: "AUTH_FAILED", message: "Invalid credentials" }
    });
  }

  const matches = await comparePassword(password, user.passwordHash);
  if (!matches) {
    return res.status(401).json({
      error: { code: "AUTH_FAILED", message: "Invalid credentials" }
    });
  }

  if (user.status !== "active") {
    return res.status(403).json({
      error: { code: "USER_INACTIVE", message: "Your account is inactive" }
    });
  }

  const isAdminUser = (user.roles || []).includes("tenant_admin") || (user.roles || []).includes("super_admin");
  const billingAccess = isTenantBillingAccessAllowed(req.tenant);
  if (req.tenant.onboardingStatus !== "live" && !isAdminUser) {
    return res.status(403).json({
      error: {
        code: "TENANT_NOT_LIVE",
        message: "This network is still being set up."
      }
    });
  }
  if (req.tenant.onboardingStatus === "live" && !billingAccess.allowed && !isAdminUser) {
    return res.status(403).json({
      error: {
        code: "BILLING_RESTRICTED",
        message: "This network is temporarily unavailable due to billing status."
      }
    });
  }

  await UserModel.updateScoped(req.tenant._id, user._id, { lastLoginAt: new Date() });
  user.lastLoginAt = new Date();

  const token = signToken(user);
  setAuthCookie(res, token);
  const profile = user.profileId
    ? await ProfileModel.findOne(req.tenant._id, { _id: user.profileId })
    : null;

  await logTenantEvent({
    tenantId: req.tenant._id,
    userId: user._id,
    eventType: "auth_login_password",
    metadata: { method: "password" }
  }).catch(() => {});

  return res.json({ token, user: buildAuthenticatedUserPayload(user, profile), profile });
});

router.post("/demo-access", demoAccessLimiter, requireTenant, async (req, res) => {
  const code = String(req.body.code || req.body.accessCode || "").trim().toUpperCase();
  if (!code) {
    return res.status(400).json({
      error: {
        code: "DEMO_ACCESS_CODE_REQUIRED",
        message: "Access code is required."
      }
    });
  }

  if (req.tenant.status !== "active") {
    return res.status(403).json({
      error: {
        code: "TENANT_INACTIVE",
        message: "This network is inactive."
      }
    });
  }

  const demoAccess = resolveDemoAccessSettings(req.tenant);
  if (!demoAccess.enabled || !demoAccess.codeHash) {
    return res.status(403).json({
      error: {
        code: "DEMO_ACCESS_DISABLED",
        message: "Demo access is not configured for this network."
      }
    });
  }

  const matched = await comparePassword(code, demoAccess.codeHash).catch(() => false);
  if (!matched) {
    return res.status(401).json({
      error: {
        code: "AUTH_FAILED",
        message: "Invalid access code."
      }
    });
  }

  let user = null;
  if (demoAccess.directorUserId) {
    user = await UserModel.findOne(req.tenant._id, { _id: demoAccess.directorUserId });
  }
  if (!user && demoAccess.directorEmail) {
    user = await UserModel.findOne(req.tenant._id, { email: demoAccess.directorEmail });
  }
  if (!user) {
    user = await UserModel.findOne(req.tenant._id, { roles: { $contains: ["tenant_admin"] } });
  }
  if (!user) {
    return res.status(404).json({
      error: {
        code: "DEMO_DIRECTOR_NOT_FOUND",
        message: "Demo director account is not configured."
      }
    });
  }
  if (user.status !== "active") {
    return res.status(403).json({
      error: {
        code: "USER_INACTIVE",
        message: "This account is inactive."
      }
    });
  }

  const nextLastLoginAt = new Date();
  await UserModel.updateScoped(req.tenant._id, user._id, { lastLoginAt: nextLastLoginAt });
  user.lastLoginAt = nextLastLoginAt;

  const token = signToken(user);
  setAuthCookie(res, token);
  const profile = user.profileId
    ? await ProfileModel.findOne(req.tenant._id, { _id: user.profileId })
    : null;

  await logTenantEvent({
    tenantId: req.tenant._id,
    userId: user._id,
    eventType: "auth_login_demo_code",
    metadata: { method: "demo_code" }
  }).catch(() => {});

  return res.json({ token, user: buildAuthenticatedUserPayload(user, profile), profile });
});

router.post("/magic-link/request", magicLinkRequestLimiter, requireTenant, async (req, res) => {
  if (isDemoAccessOnlyTenant(req.tenant)) {
    return res.status(403).json(demoAccessOnlyErrorPayload());
  }

  const email = String(req.body.email || "").trim().toLowerCase();
  if (!email) {
    return res.status(400).json({
      error: {
        code: "EMAIL_REQUIRED",
        message: "Email is required."
      }
    });
  }

  const user = await UserModel.findOne(req.tenant._id, { email });
  if (!user || user.status !== "active") {
    return res.json({
      ok: true,
      message: "If the account exists, a sign-in link has been sent."
    });
  }

  const isAdminUser = (user.roles || []).includes("tenant_admin") || (user.roles || []).includes("super_admin");
  const billingAccess = isTenantBillingAccessAllowed(req.tenant);
  if (req.tenant.onboardingStatus !== "live" && !isAdminUser) {
    return res.status(403).json({
      error: {
        code: "TENANT_NOT_LIVE",
        message: "This network is still being set up."
      }
    });
  }
  if (req.tenant.onboardingStatus === "live" && !billingAccess.allowed && !isAdminUser) {
    return res.status(403).json({
      error: {
        code: "BILLING_RESTRICTED",
        message: "This network is temporarily unavailable due to billing status."
      }
    });
  }

  const token = generateToken(24);
  const expiresAt = new Date(
    Date.now() + Math.max(5, env.MAGIC_LINK_EXPIRES_MINUTES) * 60 * 1000
  );

  await MagicLinkTokenModel.create({
    tenantId: req.tenant._id,
    userId: user._id,
    email,
    token: hashOpaqueToken(token),
    expiresAt,
    usedAt: null
  });

  await sendMagicLinkEmail({
    tenant: req.tenant,
    email,
    token,
    expiresAt
  });

  return res.json({
    ok: true,
    message: "If the account exists, a sign-in link has been sent."
  });
});

router.post("/magic-link/consume", magicLinkConsumeLimiter, requireTenant, async (req, res) => {
  if (isDemoAccessOnlyTenant(req.tenant)) {
    return res.status(403).json(demoAccessOnlyErrorPayload());
  }

  const token = String(req.body.token || "").trim();
  if (!token) {
    return res.status(400).json({
      error: {
        code: "TOKEN_REQUIRED",
        message: "Magic-link token is required."
      }
    });
  }

  const tokenHash = hashOpaqueToken(token);
  let magicLink = await MagicLinkTokenModel.findOne(req.tenant._id, {
    token: tokenHash,
    usedAt: null
  });
  let matchedLegacyPlaintextToken = false;
  if (!magicLink) {
    magicLink = await MagicLinkTokenModel.findOne(req.tenant._id, {
      token,
      usedAt: null
    });
    matchedLegacyPlaintextToken = Boolean(magicLink);
  }

  if (!magicLink) {
    const usedMagicLink =
      (await MagicLinkTokenModel.findOne(req.tenant._id, { token: tokenHash })) ||
      (await MagicLinkTokenModel.findOne(req.tenant._id, { token }));
    if (usedMagicLink?.usedAt) {
      return res.status(409).json({
        error: {
          code: "MAGIC_LINK_ALREADY_USED",
          message: "Magic link has already been used."
        }
      });
    }
    return res.status(400).json({
      error: {
        code: "MAGIC_LINK_INVALID",
        message: "Magic link is invalid or expired."
      }
    });
  }

  if (matchedLegacyPlaintextToken) {
    await MagicLinkTokenModel.updateScoped(req.tenant._id, magicLink._id, { token: tokenHash }).catch(() => {});
  }

  if (new Date(magicLink.expiresAt) <= new Date()) {
    return res.status(400).json({
      error: {
        code: "MAGIC_LINK_INVALID",
        message: "Magic link is invalid or expired."
      }
    });
  }

  const user = await UserModel.findOne(req.tenant._id, { _id: magicLink.userId });
  if (!user || user.status !== "active") {
    return res.status(403).json({
      error: {
        code: "USER_INACTIVE",
        message: "Your account is inactive."
      }
    });
  }

  const isAdminUser = (user.roles || []).includes("tenant_admin") || (user.roles || []).includes("super_admin");
  const billingAccess = isTenantBillingAccessAllowed(req.tenant);
  if (req.tenant.onboardingStatus !== "live" && !isAdminUser) {
    return res.status(403).json({
      error: {
        code: "TENANT_NOT_LIVE",
        message: "This network is still being set up."
      }
    });
  }
  if (req.tenant.onboardingStatus === "live" && !billingAccess.allowed && !isAdminUser) {
    return res.status(403).json({
      error: {
        code: "BILLING_RESTRICTED",
        message: "This network is temporarily unavailable due to billing status."
      }
    });
  }

  const consumedMagicLink = await MagicLinkTokenModel.consumeIfUnused(req.tenant._id, magicLink._id, {
    usedAt: new Date()
  });
  if (!consumedMagicLink) {
    return res.status(409).json({
      error: {
        code: "MAGIC_LINK_ALREADY_USED",
        message: "Magic link has already been used."
      }
    });
  }

  await UserModel.updateScoped(req.tenant._id, user._id, { lastLoginAt: new Date() });
  user.lastLoginAt = new Date();

  const authToken = signToken(user);
  setAuthCookie(res, authToken);
  const profile = user.profileId
    ? await ProfileModel.findOne(req.tenant._id, { _id: user.profileId })
    : null;

  await logTenantEvent({
    tenantId: req.tenant._id,
    userId: user._id,
    eventType: "auth_login_magic_link",
    metadata: { method: "magic_link" }
  }).catch(() => {});

  return res.json({
    token: authToken,
    user: buildAuthenticatedUserPayload(user, profile),
    profile
  });
});

router.post("/logout", requireTenant, async (_req, res) => {
  clearAuthCookie(res);
  return res.json({ ok: true });
});

export default router;
