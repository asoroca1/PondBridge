import { createModel } from "./_factory.js";

const COLUMNS = {
  id: "id",
  tenantId: "tenant_id",
  userId: "user_id",
  email: "email",
  token: "token",
  expiresAt: "expires_at",
  usedAt: "used_at",
  createdAt: "created_at",
  updatedAt: "updated_at"
};

export const MagicLinkTokenModel = createModel("magic_link_tokens", COLUMNS);
