import { createModel } from "./_factory.js";

const COLUMNS = {
  id: "id",
  tenantId: "tenant_id",
  eventId: "event_id",
  profileId: "profile_id",
  userId: "user_id",
  sortOrder: "sort_order",
  rsvpCreated: "rsvp_created",
  addedByUserId: "added_by_user_id",
  createdAt: "created_at",
  updatedAt: "updated_at"
};

export const EventPresenterModel = createModel("event_presenters", COLUMNS);
