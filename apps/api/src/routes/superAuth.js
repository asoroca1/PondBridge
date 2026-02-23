import { Router } from "express";
import { TenantModel, UserModel } from "../db/models/index.js";
import { env } from "../config/env.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { comparePassword, sanitizeUser, signToken } from "../utils/auth.js";
import { clearAuthCookie, setAuthCookie } from "../utils/authCookie.js";
import { isSuperIdentityAllowed, superAllowlistConfigured } from "../services/identityUsers.js";

const router = Router();

function isLegacySuperAuthDisabled() {
  return ["clerk", "hybrid"].includes(String(env.AUTH_PROVIDER || "").toLowerCase());
}

router.post("/super/login", async (req, res) => {
  if (isLegacySuperAuthDisabled()) {
    return res.status(410).json({
      error: {
        code: "LEGACY_AUTH_DISABLED",
        message: "Super password login is disabled. Continue with Clerk authentication."
      }
    });
  }

  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  if (!email || !password) {
    return res.status(400).json({
      error: { code: "INVALID_INPUT", message: "Email and password are required" }
    });
  }

  if (
    superAllowlistConfigured() &&
    String(env.AUTH_PROVIDER || "").toLowerCase() !== "legacy" &&
    !isSuperIdentityAllowed({ email }, email)
  ) {
    return res.status(403).json({
      error: {
        code: "ROLE_FORBIDDEN",
        message: "Super admin access is restricted to the configured allowlist."
      }
    });
  }

  const user = await UserModel.findSuperAdmin(email);
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

  const token = signToken(user);
  setAuthCookie(res, token);
  return res.json({ token, user: sanitizeUser(user) });
});

router.post("/super/logout", async (_req, res) => {
  clearAuthCookie(res);
  return res.json({ ok: true });
});

router.get("/session", requireAuth, async (req, res) => {
  const tenant = req.user?.tenantId ? await TenantModel.findOne({ _id: req.user.tenantId }) : null;
  return res.json({
    ok: true,
    authProvider: req.identity?.provider || env.AUTH_PROVIDER,
    user: {
      id: req.user.id,
      _id: req.user.id,
      tenantId: req.user.tenantId || null,
      roles: req.user.roles || [],
      email: req.user.email || ""
    },
    identity: {
      provider: req.identity?.provider || env.AUTH_PROVIDER,
      clerkUserId: req.identity?.clerkUserId || null,
      email: req.identity?.email || ""
    },
    tenant: tenant
      ? {
          id: String(tenant._id),
          slug: tenant.slug,
          name: tenant.name,
          status: tenant.status,
          onboardingStatus: tenant.onboardingStatus
        }
      : null
  });
});

export default router;
