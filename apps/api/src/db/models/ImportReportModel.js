import { createModel } from "./_factory.js";

const COLUMNS = {
  id: "id",
  tenantId: "tenant_id",
  createdByUserId: "created_by_user_id",
  fileName: "file_name",
  options: "options",
  summary: "summary",
  rowErrors: "row_errors",
  failureCsv: "failure_csv",
  createdAt: "created_at",
  updatedAt: "updated_at"
};

export const ImportReportModel = createModel("import_reports", COLUMNS);
