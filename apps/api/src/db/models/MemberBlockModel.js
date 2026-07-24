import { createModel } from "./_factory.js";

const COLUMNS = {
  id: "id",
  tenantId: "tenant_id",
  blockerUserId: "blocker_user_id",
  blockedUserId: "blocked_user_id",
  createdAt: "created_at",
  updatedAt: "updated_at"
};

export const MemberBlockModel = createModel("member_blocks", COLUMNS);
