import { createModel } from "./_factory.js";

const COLUMNS = {
  id: "id",
  tenantId: "tenant_id",
  name: "name",
  category: "category",
  title: "title",
  body: "body",
  deepLink: "deep_link",
  audience: "audience",
  userIds: "user_ids",
  createdByUserId: "created_by_user_id",
  createdAt: "created_at",
  updatedAt: "updated_at"
};

export const MobileNotificationTemplateModel = createModel("mobile_notification_templates", COLUMNS);
