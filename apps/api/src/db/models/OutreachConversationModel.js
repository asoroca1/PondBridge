import { createModel } from "./_factory.js";

const COLUMNS = {
  id: "id",
  operatorUserId: "operator_user_id",
  title: "title",
  archivedAt: "archived_at",
  createdAt: "created_at",
  updatedAt: "updated_at",
};

export const OutreachConversationModel = createModel("outreach_conversations", COLUMNS);
