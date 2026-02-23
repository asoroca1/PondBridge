import { Router } from "express";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import {
  UserModel,
  ProfileModel,
  InviteModel,
  AccessRequestModel,
  MagicLinkTokenModel,
  TenantModel
} from "../db/models/index.js";
import { requireTenant } from "../middleware/tenantContext.js";
import { comparePassword, hashPassword, sanitizeUser, signToken } from "../utils/auth.js";
import { env } from "../config/env.js";
import { sendMagicLinkEmail } from "../services/email.js";
import { logTenantEvent } from "../services/analytics.js";
import { clearAuthCookie, setAuthCookie } from "../utils/authCookie.js";
import { normalizeSignupMode } from "../services/onboarding.js";

const router = Router({ mergeParams: true });
const magicLinkRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 6,
  standardHeaders: true,
  legacyHeaders: false
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

function resolveSignupMode(tenant) {
  return normalizeSignupMode(tenant?.settings?.signupMode || tenant?.accessSettings?.signupMode || "open");
}

function emailDomain(email = "") {
  const at = String(email || "").toLowerCase().trim().split("@");
  return at.length > 1 ? at[at.length - 1] : "";
}

function profileFromBody(body) {
  return {
    firstName: String(body.firstName || "").trim(),
    lastName: String(body.lastName || "").trim(),
    emails: [String(body.email || "").trim().toLowerCase()].filter(Boolean),
    phones: body.phone ? [String(body.phone).trim()] : [],
    cityState: String(body.cityState || "").trim(),
    roleAtCamp: String(body.roleAtCamp || "").trim(),
    highSchool: String(body.highSchool || "").trim(),
    colleges: Array.isArray(body.colleges) ? body.colleges : [],
    collegeYears: Array.isArray(body.collegeYears) ? body.collegeYears : [],
    currentJobs: Array.isArray(body.currentJobs) ? body.currentJobs : [],
    pastJobs: Array.isArray(body.pastJobs) ? body.pastJobs : [],
    industry: String(body.industry || "").trim(),
    socials: body.socials || {},
    bio: String(body.bio || "").trim(),
    avatarUrl: String(body.avatarUrl || "").trim()
  };
}

router.post("/register", requireTenant, async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const firstName = String(req.body.firstName || "").trim();
  const lastName = String(req.body.lastName || "").trim();
  const campName = String(req.body.campName || "").trim();
  const inviteToken = String(req.body.inviteToken || "").trim();
  const directorSignup = Boolean(req.body.directorSignup);

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

  const signupMode = resolveSignupMode(req.tenant);
  let matchingInvite = null;
  if (inviteToken) {
    const inviteByToken = await InviteModel.findOne(req.tenant._id, {
      token: inviteToken,
      usedAt: null
    });

    const inviteEmail = String(inviteByToken?.email || "").trim().toLowerCase();
    const inviteAllowsEmail =
      inviteByToken?.roleToAssign === "tenant_admin" || !inviteEmail || inviteEmail === email;

    if (inviteByToken && inviteAllowsEmail) {
      matchingInvite = inviteByToken;
    }
  }

  if (matchingInvite && new Date(matchingInvite.expiresAt) <= new Date()) {
    matchingInvite = null;
  }

  const prelaunchDirectorInvite = matchingInvite?.roleToAssign === "tenant_admin";
  const existingDirector = await UserModel.findOne(req.tenant._id, { roles: { $contains: ["tenant_admin"] } });
  const canBootstrapDirector =
    directorSignup && req.tenant.onboardingStatus !== "live" && !prelaunchDirectorInvite && !existingDirector;
  const bypassAccessControls = prelaunchDirectorInvite || canBootstrapDirector;

  if (req.tenant.onboardingStatus !== "live" && !bypassAccessControls) {
    return res.status(403).json({
      error: {
        code: "TENANT_NOT_LIVE",
        message: "This network is not live yet. Contact your camp director."
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
      const sentCode = String(req.body.accessCode || "").trim();
      const codeHash = String(req.tenant?.settings?.accessCodeHash || "").trim();
      const legacyCode = String(req.tenant?.accessSettings?.accessCode || "").trim();
      const codeMatched =
        (codeHash ? await comparePassword(sentCode, codeHash) : false) ||
        (legacyCode ? sentCode === legacyCode : false);
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

  const allowedDomains = Array.isArray(req.tenant?.settings?.allowedEmailDomains)
    ? req.tenant.settings.allowedEmailDomains
        .map((domain) => String(domain || "").toLowerCase().trim().replace(/^@/, ""))
        .filter(Boolean)
    : [];
  if (!bypassAccessControls && allowedDomains.length > 0 && !matchingInvite) {
    const domain = emailDomain(email);
    if (!allowedDomains.includes(domain)) {
      return res.status(403).json({
        error: {
          code: "EMAIL_DOMAIN_NOT_ALLOWED",
          message: "Your email domain is not allowed for this camp."
        }
      });
    }
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

  if (!bypassAccessControls && signupMode === "approval_queue" && !matchingInvite) {
    const profilePayload = profileFromBody(req.body);
    const passwordHash = await hashPassword(password);
    const existingRequest = await AccessRequestModel.findOne(req.tenant._id, {
      email,
      status: { $in: ["pending", "denied"] }
    });

    if (existingRequest) {
      await AccessRequestModel.update(existingRequest._id, {
        firstName,
        lastName,
        passwordHash,
        selfReportedRole: String(req.body.roleAtCamp || "").trim(),
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
        selfReportedRole: String(req.body.roleAtCamp || "").trim(),
        requestMessage: String(req.body.requestMessage || "").trim(),
        profilePayload,
        status: "pending",
        requestedAt: new Date()
      });
    }

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

  await UserModel.update(user._id, { profileId: profile._id });
  user.profileId = profile._id;

  if (matchingInvite) {
    const existingInvite = await InviteModel.findOne(req.tenant._id, {
      _id: matchingInvite._id,
      usedAt: null
    });
    if (existingInvite) {
      await InviteModel.update(existingInvite._id, {
        usedAt: new Date(),
        usedByUserId: user._id
      });
    }
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

  return res.status(201).json({
    token,
    user: sanitizeUser(user),
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

router.post("/invite/verify", requireTenant, async (req, res) => {
  const inviteToken = String(req.body.inviteToken || "").trim();
  if (!inviteToken) {
    return res.status(400).json({
      error: {
        code: "INVITE_TOKEN_REQUIRED",
        message: "Invite token is required."
      }
    });
  }

  const invite = await InviteModel.findOne(req.tenant._id, { token: inviteToken, usedAt: null });
  if (!invite || new Date(invite.expiresAt) <= new Date()) {
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

router.post("/login", requireTenant, async (req, res) => {
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
  if (req.tenant.onboardingStatus !== "live" && !isAdminUser) {
    return res.status(403).json({
      error: {
        code: "TENANT_NOT_LIVE",
        message: "This network is still being set up."
      }
    });
  }

  await UserModel.update(user._id, { lastLoginAt: new Date() });
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

  return res.json({ token, user: sanitizeUser(user), profile });
});

router.post("/magic-link/request", magicLinkRequestLimiter, requireTenant, async (req, res) => {
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
  if (req.tenant.onboardingStatus !== "live" && !isAdminUser) {
    return res.status(403).json({
      error: {
        code: "TENANT_NOT_LIVE",
        message: "This network is still being set up."
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
    token,
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

router.post("/magic-link/consume", requireTenant, async (req, res) => {
  const token = String(req.body.token || "").trim();
  if (!token) {
    return res.status(400).json({
      error: {
        code: "TOKEN_REQUIRED",
        message: "Magic-link token is required."
      }
    });
  }

  const magicLink = await MagicLinkTokenModel.findOne(req.tenant._id, {
    token,
    usedAt: null
  });

  if (!magicLink || new Date(magicLink.expiresAt) <= new Date()) {
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

  const existingMagicLink = await MagicLinkTokenModel.findOne(req.tenant._id, {
    _id: magicLink._id,
    usedAt: null
  });
  if (existingMagicLink) {
    await MagicLinkTokenModel.update(existingMagicLink._id, { usedAt: new Date() });
  }

  await UserModel.update(user._id, { lastLoginAt: new Date() });
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
    user: sanitizeUser(user),
    profile
  });
});

router.post("/logout", requireTenant, async (_req, res) => {
  clearAuthCookie(res);
  return res.json({ ok: true });
});

router.post("/forgot-password", requireTenant, async (_req, res) => {
  return res.json({
    ok: true,
    message: "If the account exists, password reset instructions have been sent."
  });
});

router.post("/reset-password", requireTenant, async (_req, res) => {
  return res.json({
    ok: true,
    message: "Password reset is not enabled in local demo mode."
  });
});

export default router;
