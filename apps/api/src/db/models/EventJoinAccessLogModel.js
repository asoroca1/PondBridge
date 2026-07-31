import { createModel } from "./_factory.js";

const COLUMNS = {
  id: "id",
  tenantId: "tenant_id",
  eventId: "event_id",
  profileId: "profile_id",
  userId: "user_id",
  accessType: "access_type",
  accessedAt: "accessed_at"
};

export const EventJoinAccessLogModel = createModel("event_join_access_logs", COLUMNS);
