import { createModel } from "./_factory.js";

const COLUMNS = {
  id: "id",
  tenantId: "tenant_id",
  userId: "user_id",
  platform: "platform",
  token: "token",
  appId: "app_id",
  environment: "environment",
  permissionState: "permission_state",
  isActive: "is_active",
  lastSeenAt: "last_seen_at",
  lastRegisteredAt: "last_registered_at",
  lastDeliveredAt: "last_delivered_at",
  lastError: "last_error",
  createdAt: "created_at",
  updatedAt: "updated_at"
};

export const MobileNotificationDeviceModel = createModel("mobile_notification_devices", COLUMNS);
