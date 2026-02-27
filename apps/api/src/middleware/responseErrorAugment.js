export function augmentErrorResponses(req, res, next) {
  const originalJson = res.json.bind(res);

  res.json = (payload) => {
    let nextPayload = payload;
    if (
      payload &&
      typeof payload === "object" &&
      !Array.isArray(payload) &&
      payload.error &&
      typeof payload.error === "object" &&
      !Array.isArray(payload.error)
    ) {
      const requestId = String(req.requestId || "").trim();
      const errorCode = String(payload.error.code || "").trim();
      if (errorCode && !res.locals.errorCode) {
        res.locals.errorCode = errorCode;
      }
      nextPayload = {
        ...payload,
        error: {
          ...payload.error,
          requestId: String(payload.error.requestId || requestId)
        }
      };
    }

    return originalJson(nextPayload);
  };

  return next();
}
