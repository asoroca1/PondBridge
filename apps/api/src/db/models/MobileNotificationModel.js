import { createModel } from "./_factory.js";

const COLUMNS = {
  id: "id",
  tenantId: "tenant_id",
  userId: "user_id",
  batchId: "batch_id",
  createdByUserId: "created_by_user_id",
  kind: "kind",
  category: "category",
  title: "title",
  body: "body",
  deepLink: "deep_link",
  data: "data",
  delivery: "delivery",
  readAt: "read_at",
  archivedAt: "archived_at",
  openedAt: "opened_at",
  createdAt: "created_at",
  updatedAt: "updated_at"
};

export const MobileNotificationModel = createModel("mobile_notifications", COLUMNS);
