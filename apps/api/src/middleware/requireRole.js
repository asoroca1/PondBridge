export function requireRole(...roles) {
  return function requireRoleMiddleware(req, res, next) {
    if (!req.user) {
      return res.status(401).json({
        error: { code: "AUTH_REQUIRED", message: "Authentication required" }
      });
    }

    const roleSet = new Set(req.user.roles || []);

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
