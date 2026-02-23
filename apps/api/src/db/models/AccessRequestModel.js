import { createModel } from "./_factory.js";

const COLUMNS = {
  id: "id",
  tenantId: "tenant_id",
  email: "email",
  firstName: "first_name",
  lastName: "last_name",
  passwordHash: "password_hash",
  selfReportedRole: "self_reported_role",
  requestMessage: "request_message",
  profilePayload: "profile_payload",
  status: "status",
  requestedAt: "requested_at",
  reviewedAt: "reviewed_at",
  reviewedByUserId: "reviewed_by_user_id",
  approvedUserId: "approved_user_id",
  denialReason: "denial_reason",
  createdAt: "created_at",
  updatedAt: "updated_at"
};

export const AccessRequestModel = createModel("access_requests", COLUMNS);
