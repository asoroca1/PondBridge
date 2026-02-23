import { createModel } from "./_factory.js";

const COLUMNS = {
  id: "id",
  tenantId: "tenant_id",
  actorUserId: "actor_user_id",
  event: "event",
  metadata: "metadata",
  createdAt: "created_at",
  updatedAt: "updated_at"
};

export const TenantAdminAuditLogModel = createModel("tenant_admin_audit_logs", COLUMNS);
