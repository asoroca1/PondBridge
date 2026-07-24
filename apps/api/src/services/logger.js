function safeString(value = "") {
  return String(value || "").trim();
}

const SENSITIVE_QUERY_PARAM = /(?:token|code|secret|key|password|signature|credential)/i;

export function redactRouteUrl(value = "") {
  const raw = safeString(value);
  if (!raw || !raw.includes("?")) return raw;
  try {
    const parsed = new URL(raw, "http://pondbridge.local");
    for (const key of [...parsed.searchParams.keys()]) {
      if (!SENSITIVE_QUERY_PARAM.test(key)) continue;
      parsed.searchParams.set(key, "[REDACTED]");
    }
    const query = parsed.searchParams.toString();
    return `${parsed.pathname}${query ? `?${query}` : ""}`;
  } catch {
    return raw.replace(
      /([?&][^=&]*(?:token|code|secret|key|password|signature|credential)[^=]*)=[^&]*/gi,
      "$1=[REDACTED]"
    );
  }
}

function toJsonLine(payload = {}) {
  try {
    return JSON.stringify(payload);
  } catch {
    return JSON.stringify({
      ts: new Date().toISOString(),
      level: "error",
      event: "logger.serialization_failed",
      message: "Unable to serialize log payload"
    });
  }
}

export function logLine(level = "info", event = "app.log", fields = {}) {
  const payload = {
    ts: new Date().toISOString(),
    level: safeString(level || "info").toLowerCase(),
    event: safeString(event || "app.log"),
    ...fields
  };
  const line = toJsonLine(payload);
  if (payload.level === "error") {
    console.error(line);
    return;
  }
  if (payload.level === "warn" || payload.level === "warning") {
    console.warn(line);
    return;
  }
  console.log(line);
}

export function logRequestSummary(req, {
  status = 0,
  durationMs = 0,
  errorCode = ""
} = {}) {
  logLine("info", "http.request.completed", {
    requestId: safeString(req?.requestId),
    tenantId: safeString(req?.tenant?._id || req?.tenantContext?.tenantId || req?.user?.tenantId || ""),
    actorUserId: safeString(req?.user?.id || req?.user?._id || ""),
    method: safeString(req?.method),
    route: redactRouteUrl(req?.originalUrl || req?.url || ""),
    status: Number(status || 0),
    durationMs: Number(durationMs || 0),
    errorCode: safeString(errorCode)
  });
}
