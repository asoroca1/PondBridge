import { logLine } from "../services/logger.js";

export function notFoundHandler(req, res) {
  const requestId = String(req.requestId || "").trim();
  res.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: `Route not found: ${req.method} ${req.originalUrl}`,
      requestId
    }
  });
}

export function errorHandler(err, req, res, _next) {
  const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
  const rawCode = err?.code || "";
  const rawMessage = String(err?.message || "");
  const dnsOrSocketFailure = new Set(["ENOTFOUND", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN", "ECONNRESET"]);

  let status =
    err.statusCode ||
    err.status ||
    (err.type === "entity.too.large" ? 413 : 500);
  let code = rawCode || (status === 413 ? "PAYLOAD_TOO_LARGE" : "INTERNAL_ERROR");
  let message =
    status === 413
      ? "Upload is too large. Please use a smaller image and try again."
      : rawMessage || "Unexpected server error";

  // Supabase returns PGRST205 when tables are missing from the schema cache.
  if (rawCode === "PGRST205") {
    status = 503;
    code = "BACKEND_SCHEMA_MISSING";
    message =
      "Backend database schema is missing. Run `npm --workspace @pondbridge/api run supabase:apply-schema` and then `npm --workspace @pondbridge/api run seed`.";
  } else if (/fetch failed/i.test(rawMessage) || dnsOrSocketFailure.has(String(rawCode || "").toUpperCase())) {
    status = 503;
    code = "BACKEND_UNREACHABLE";
    message =
      "Backend database is unreachable. Verify SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and network access.";
  }

  logLine("error", "http.request.error", {
    requestId: String(req?.requestId || ""),
    tenantId: String(req?.tenant?._id || req?.tenantContext?.tenantId || req?.user?.tenantId || ""),
    actorUserId: String(req?.user?.id || req?.user?._id || ""),
    method: String(req?.method || ""),
    route: String(req?.originalUrl || req?.url || ""),
    status,
    code,
    message,
    details: isProd ? null : err?.details || null
  });

  res.locals.errorCode = code;

  res.status(status).json({
    error: {
      code,
      message,
      requestId: String(req.requestId || ""),
      details: isProd ? null : err.details || null,
      path: req.originalUrl
    }
  });
}
