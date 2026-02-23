import { createModel } from "./_factory.js";

const COLUMNS = {
  id: "id",
  tenantId: "tenant_id",
  actorUserId: "actor_user_id",
  actor: "actor",
  type: "type",
  message: "message",
  target: "target",
  pinned: "pinned",
  pinnedAt: "pinned_at",
  ts: "ts",
  createdAt: "created_at",
  updatedAt: "updated_at"
};

export const ActivityItemModel = createModel("activity_items", COLUMNS);
