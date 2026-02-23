import {
  isSuperIdentityAllowed,
  superAllowlistConfigured
} from "../services/identityUsers.js";

const SUPER_CONSOLE_ROLES = new Set(["super_admin", "support_admin", "finance_admin"]);

export function requireRole(...roles) {
  return function requireRoleMiddleware(req, res, next) {
    if (!req.user) {
      return res.status(401).json({
        error: { code: "AUTH_REQUIRED", message: "Authentication required" }
      });
    }

    const roleSet = new Set(req.user.roles || []);
    const hasSuperConsoleRole = [...roleSet].some((role) => SUPER_CONSOLE_ROLES.has(role));
    const allowlistSet = superAllowlistConfigured();
    const superIdentityAllowed = isSuperIdentityAllowed(req.identity || {}, req.user.email || "");

    if (allowlistSet && hasSuperConsoleRole && !superIdentityAllowed) {
      return res.status(403).json({
        error: {
          code: "ROLE_FORBIDDEN",
          message: "Super admin access is restricted to the configured allowlist."
        }
      });
    }

    if (roleSet.has("super_admin")) return next();

    const hasAny = roles.some((role) => roleSet.has(role));
    if (!hasAny) {
      return res.status(403).json({
        error: {
          code: "ROLE_FORBIDDEN",
          message: `Required role: ${roles.join(" or ")}`
        }
      });
    }

    return next();
  };
}
