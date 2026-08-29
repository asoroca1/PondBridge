import { createModel } from "./_factory.js";

const COLUMNS = {
  id: "id",
  tenantId: "tenant_id",
  causeId: "cause_id",
  authorUserId: "author_user_id",
  title: "title",
  body: "body",
  milestoneType: "milestone_type",
  publishedAt: "published_at",
  createdAt: "created_at",
  updatedAt: "updated_at"
};

export const GivingCauseUpdateModel = createModel("giving_cause_updates", COLUMNS);
