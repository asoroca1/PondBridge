import { createModel } from "./_factory.js";

const COLUMNS = {
  id: "id",
  tenantId: "tenant_id",
  email: "email",
  firstName: "first_name",
  lastName: "last_name",
  source: "source",
  contactStatus: "contact_status",
  tags: "tags",
  campYears: "camp_years",
  notes: "notes",
  lastInvitedAt: "last_invited_at",
  inviteCount: "invite_count",
  createdByUserId: "created_by_user_id",
  createdAt: "created_at",
  updatedAt: "updated_at"
};

export const AlumniContactModel = createModel("alumni_contacts", COLUMNS);
