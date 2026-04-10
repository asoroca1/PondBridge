import { createModel } from "./_factory.js";

const COLUMNS = {
  id: "id",
  tenantId: "tenant_id",
  userId: "user_id",
  pushEnabled: "push_enabled",
  categories: "categories",
  createdAt: "created_at",
  updatedAt: "updated_at"
};

export const MobileNotificationPreferenceModel = createModel("mobile_notification_preferences", COLUMNS);
