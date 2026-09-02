import { createModel } from "./_factory.js";

const COLUMNS = {
  id: "id",
  accountId: "account_id",
  contactId: "contact_id",
  interactionType: "interaction_type",
  direction: "direction",
  occurredAt: "occurred_at",
  summary: "summary",
  outcome: "outcome",
  followUpAt: "follow_up_at",
  externalMessageId: "external_message_id",
  createdByUserId: "created_by_user_id",
  createdAt: "created_at",
  updatedAt: "updated_at",
};

export const OutreachInteractionModel = createModel("outreach_interactions", COLUMNS);
