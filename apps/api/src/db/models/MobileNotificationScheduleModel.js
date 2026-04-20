import { createModel } from "./_factory.js";

const COLUMNS = {
  id: "id",
  tenantId: "tenant_id",
  runAt: "run_at",
  status: "status",
  category: "category",
  title: "title",
  body: "body",
  deepLink: "deep_link",
  audience: "audience",
  userIds: "user_ids",
  pushRequested: "push_requested",
  createdByUserId: "created_by_user_id",
  batchId: "batch_id",
  attemptedAt: "attempted_at",
  error: "error",
  createdAt: "created_at",
  updatedAt: "updated_at"
};

export const MobileNotificationScheduleModel = createModel("mobile_notification_schedules", COLUMNS);
