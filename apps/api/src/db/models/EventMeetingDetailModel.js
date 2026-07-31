import { createModel } from "./_factory.js";

const COLUMNS = {
  id: "id",
  tenantId: "tenant_id",
  eventId: "event_id",
  meetingUrl: "meeting_url",
  accessPolicy: "access_policy",
  createdAt: "created_at",
  updatedAt: "updated_at"
};

export const EventMeetingDetailModel = createModel("event_meeting_details", COLUMNS);
