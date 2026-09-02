import { createModel } from "./_factory.js";

const COLUMNS = {
  id: "id",
  conversationId: "conversation_id",
  role: "role",
  content: "content",
  sources: "sources",
  metadata: "metadata",
  createdAt: "created_at",
  updatedAt: "updated_at",
};

export const OutreachMessageModel = createModel("outreach_messages", COLUMNS);
