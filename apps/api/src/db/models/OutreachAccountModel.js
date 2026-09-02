import { createModel } from "./_factory.js";

const COLUMNS = {
  id: "id",
  name: "name",
  stage: "stage",
  websiteUrl: "website_url",
  location: "location",
  source: "source",
  ownerUserId: "owner_user_id",
  ownerLabel: "owner_label",
  nextAction: "next_action",
  nextActionDueAt: "next_action_due_at",
  lastContactAt: "last_contact_at",
  linkedTenantId: "linked_tenant_id",
  researchSummary: "research_summary",
  notes: "notes",
  lostReason: "lost_reason",
  createdByUserId: "created_by_user_id",
  updatedByUserId: "updated_by_user_id",
  createdAt: "created_at",
  updatedAt: "updated_at",
};

export const OutreachAccountModel = createModel("outreach_accounts", COLUMNS);
