import { createModel } from "./_factory.js";

const COLUMNS = {
  id: "id",
  tenantId: "tenant_id",
  forumId: "forum_id",
  authorId: "author_id",
  kind: "kind",
  text: "text",
  media: "media",
  createdAt: "created_at",
  editedAt: "edited_at",
  deletedAt: "deleted_at"
};

export const ForumPostModel = createModel("forum_posts", COLUMNS);
