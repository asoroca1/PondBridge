import crypto from "node:crypto";

export function attachRequestContext(req, res, next) {
  const fromHeader = String(req.headers["x-request-id"] || "").trim();
  const requestId = fromHeader || crypto.randomUUID();
  req.requestId = requestId;
  req.requestStartedAt = Date.now();
  res.setHeader("X-Request-Id", requestId);
  return next();
}
