import { logTenantEvent } from "./analytics.js";
import { logLine } from "./logger.js";

export async function logTenantSecurityEvent({
  req,
  tenantId = "",
  code = "",
  message = "",
  details = {}
} = {}) {
  const safeTenantId = String(tenantId || "").trim();
  const requestId = String(req?.requestId || "").trim();
  const payload = {
    requestId,
    path: String(req?.originalUrl || req?.url || ""),
    method: String(req?.method || ""),
    authProvider: String(req?.identity?.provider || ""),
    userId: String(req?.user?.id || req?.user?._id || ""),
    tokenTenantId: String(details?.tokenTenantId || ""),
    resolvedTenantId: String(details?.resolvedTenantId || ""),
    claimedTenantId: String(details?.claimedTenantId || ""),
    source: String(details?.source || "")
  };

  logLine("warn", "security.tenant_scope_denied", {
    code,
    message,
    requestId,
    tenantId: safeTenantId,
    actorUserId: payload.userId,
    method: payload.method,
    route: payload.path,
    tokenTenantId: payload.tokenTenantId,
    resolvedTenantId: payload.resolvedTenantId
  });

  if (!safeTenantId) return;

  await logTenantEvent({
    tenantId: safeTenantId,
    userId: payload.userId || null,
    eventType: "security_tenant_scope_denied",
    metadata: {
      code,
      message,
      ...payload
    }
  }).catch(() => {});
}
