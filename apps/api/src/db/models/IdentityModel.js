import { createModel } from "./_factory.js";

const COLUMNS = {
  id: "id",
  clerkUserId: "clerk_user_id",
  primaryEmail: "primary_email",
  verifiedEmails: "verified_emails",
  status: "status",
  platformRoles: "platform_roles",
  metadata: "metadata",
  createdAt: "created_at",
  updatedAt: "updated_at"
};

export const IdentityModel = createModel("identities", COLUMNS);
