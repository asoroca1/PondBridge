import { isAllowedCorsOrigin } from "../config/cors.js";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * CSRF protection middleware.
 *
 * For mutating requests (POST, PUT, PATCH, DELETE) that rely on cookie-based
 * authentication, validates the Origin (or Referer) header against the same
 * allowed-origins logic used by the CORS middleware.
 *
 * Skips validation for:
 *  - Non-mutating methods (GET, HEAD, OPTIONS)
 *  - Webhook routes (paths starting with /api/webhooks/)
 *  - Requests that carry a Bearer token (CSRF is a cookie-only attack vector)
 */
export function csrfProtection(req, res, next) {
  // Skip non-mutating methods
  if (!MUTATING_METHODS.has(req.method)) {
    return next();
  }

  // Skip webhook endpoints (they use their own verification, e.g. Stripe signatures)
  if (req.path.startsWith("/api/webhooks/")) {
    return next();
  }

  // Skip requests authenticated via Bearer token (not vulnerable to CSRF)
  const authHeader = String(req.headers.authorization || "").trim();
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    return next();
  }

  // Determine the request origin from the Origin header, falling back to Referer
  const origin = String(req.headers.origin || "").trim();
  const referer = String(req.headers.referer || "").trim();

  let effectiveOrigin = origin;
  if (!effectiveOrigin && referer) {
    try {
      effectiveOrigin = new URL(referer).origin;
    } catch {
      effectiveOrigin = "";
    }
  }

  // If neither Origin nor Referer is present, reject the request.
  // Legitimate browser-based mutating requests always include at least one.
  if (!effectiveOrigin) {
    return res.status(403).json({ error: "Origin not allowed" });
  }

  // Validate against the same origin allowlist used for CORS
  if (!isAllowedCorsOrigin(effectiveOrigin)) {
    return res.status(403).json({ error: "Origin not allowed" });
  }

  return next();
}
