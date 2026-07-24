import { createModel } from "./_factory.js";

const COLUMNS = {
  id: "id",
  tenantId: "tenant_id",
  reporterUserId: "reporter_user_id",
  targetType: "target_type",
  targetId: "target_id",
  targetAuthorUserId: "target_author_user_id",
  reason: "reason",
  details: "details",
  status: "status",
  resolutionNote: "resolution_note",
  reviewedByUserId: "reviewed_by_user_id",
  reviewedAt: "reviewed_at",
  createdAt: "created_at",
  updatedAt: "updated_at"
};

export const ContentReportModel = createModel("content_reports", COLUMNS);
