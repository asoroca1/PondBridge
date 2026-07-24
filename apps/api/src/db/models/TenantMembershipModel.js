import { createModel } from "./_factory.js";

const COLUMNS = {
  id: "id",
  tenantId: "tenant_id",
  identityId: "identity_id",
  legacyUserId: "legacy_user_id",
  roles: "roles",
  status: "status",
  joinMethod: "join_method",
  createdAt: "created_at",
  updatedAt: "updated_at"
};

export const TenantMembershipModel = createModel("tenant_memberships", COLUMNS);
