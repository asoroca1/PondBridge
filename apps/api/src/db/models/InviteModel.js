import { createModel } from "./_factory.js";

const COLUMNS = {
  id: "id",
  tenantId: "tenant_id",
  email: "email",
  token: "token",
  expiresAt: "expires_at",
  usedAt: "used_at",
  roleToAssign: "role_to_assign",
  createdByUserId: "created_by_user_id",
  usedByUserId: "used_by_user_id",
  createdAt: "created_at",
  updatedAt: "updated_at"
};

export const InviteModel = createModel("invites", COLUMNS);
