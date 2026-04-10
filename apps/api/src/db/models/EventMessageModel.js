import { createModel } from "./_factory.js";

const COLUMNS = {
  id: "id",
  tenantId: "tenant_id",
  eventId: "event_id",
  kind: "kind",
  subject: "subject",
  bodyHtml: "body_html",
  recipientProfileIds: "recipient_profile_ids",
  recipientCount: "recipient_count",
  deliveryStats: "delivery_stats",
  sentAt: "sent_at",
  createdByUserId: "created_by_user_id",
  createdAt: "created_at",
  updatedAt: "updated_at"
};

export const EventMessageModel = createModel("event_messages", COLUMNS);
