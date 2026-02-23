import { createModel } from "./_factory.js";

const COLUMNS = {
  id: "id",
  tenantId: "tenant_id",
  conversationId: "conversation_id",
  senderId: "sender_id",
  kind: "kind",
  text: "text",
  media: "media",
  clientMessageId: "client_message_id",
  createdAt: "created_at",
  editedAt: "edited_at",
  deletedAt: "deleted_at"
};

export const MessageModel = createModel("messages", COLUMNS);
