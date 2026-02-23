import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { readAuthTokenFromCookie } from "../utils/authCookie.js";

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const bearerToken = header.startsWith("Bearer ") ? header.slice(7) : "";
  const cookieToken = readAuthTokenFromCookie(req);
  const token = bearerToken || cookieToken;

  if (!token) {
    return res.status(401).json({ error: { code: "AUTH_REQUIRED", message: "Missing auth token" } });
  }

  try {
    const payload = jwt.verify(token, env.JWT_SECRET);
    req.user = {
      id: payload.sub,
      tenantId: payload.tenantId || null,
      roles: Array.isArray(payload.roles) ? payload.roles : [],
      email: payload.email
    };
    req.token = token;
    req.authSource = bearerToken ? "bearer" : "cookie";
    return next();
  } catch {
    return res.status(401).json({
      error: { code: "AUTH_INVALID", message: "Invalid or expired token" }
    });
  }
}
