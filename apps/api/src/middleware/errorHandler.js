export function notFoundHandler(req, res) {
  res.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: `Route not found: ${req.method} ${req.originalUrl}`
    }
  });
}

export function errorHandler(err, req, res, _next) {
  const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
  if (isProd) {
    console.error("[api:error]", {
      code: err?.code || "INTERNAL_ERROR",
      status: err?.statusCode || err?.status || 500,
      path: req.originalUrl,
      method: req.method,
      message: String(err?.message || "Unexpected server error")
    });
  } else {
    console.error(err);
  }

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

  res.status(status).json({
    error: {
      code,
      message,
      details: isProd ? null : err.details || null,
      path: req.originalUrl
    }
  });
}
