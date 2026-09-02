import { createModel } from "./_factory.js";

const COLUMNS = {
  id: "id",
  accountId: "account_id",
  firstName: "first_name",
  lastName: "last_name",
  title: "title",
  email: "email",
  phone: "phone",
  linkedinUrl: "linkedin_url",
  isPrimary: "is_primary",
  notes: "notes",
  createdByUserId: "created_by_user_id",
  createdAt: "created_at",
  updatedAt: "updated_at",
};

export const OutreachContactModel = createModel("outreach_contacts", COLUMNS);
