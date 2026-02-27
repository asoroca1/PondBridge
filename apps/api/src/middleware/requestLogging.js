import { logRequestSummary } from "../services/logger.js";

export function attachRequestLogging(req, res, next) {
  const startedAt = Number(req.requestStartedAt || Date.now());
  let settled = false;

  const flush = () => {
    if (settled) return;
    settled = true;
    const durationMs = Math.max(0, Date.now() - startedAt);
    const status = Number(res.statusCode || 0);
    const errorCode = status >= 400 ? String(res.locals?.errorCode || "") : "";
    logRequestSummary(req, { status, durationMs, errorCode });
  };

  res.on("finish", flush);
  res.on("close", flush);
  return next();
}
