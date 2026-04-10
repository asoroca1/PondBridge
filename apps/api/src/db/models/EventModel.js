import { createModel } from "./_factory.js";

const COLUMNS = {
  id: "id",
  tenantId: "tenant_id",
  slug: "slug",
  status: "status",
  title: "title",
  summary: "summary",
  bodyHtml: "body_html",
  coverImageUrl: "cover_image_url",
  startsAt: "starts_at",
  endsAt: "ends_at",
  timezone: "timezone",
  locationName: "location_name",
  locationAddress: "location_address",
  rsvpDeadlineAt: "rsvp_deadline_at",
  publishedAt: "published_at",
  createdByUserId: "created_by_user_id",
  updatedByUserId: "updated_by_user_id",
  createdAt: "created_at",
  updatedAt: "updated_at"
};

export const EventModel = createModel("events", COLUMNS);
