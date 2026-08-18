import { createModel } from "./_factory.js";

const COLUMNS = {
  id: "id",
  tenantId: "tenant_id",
  eventId: "event_id",
  profileId: "profile_id",
  userId: "user_id",
  status: "status",
  registrationRole: "registration_role",
  respondedAt: "responded_at",
  createdAt: "created_at",
  updatedAt: "updated_at"
};

export const EventRsvpModel = createModel("event_rsvps", COLUMNS);
