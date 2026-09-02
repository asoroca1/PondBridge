import { createModel } from "./_factory.js";

const COLUMNS = {
  id: "id",
  tenantId: "tenant_id",
  rank: "rank",
  label: "label",
  createdAt: "created_at",
  updatedAt: "updated_at"
};

export const MemberAccessTierModel = createModel("member_access_tiers", COLUMNS);
