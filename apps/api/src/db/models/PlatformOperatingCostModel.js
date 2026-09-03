import { createModel } from "./_factory.js";

const COLUMNS = {
  id: "id",
  name: "name",
  vendor: "vendor",
  category: "category",
  amountCents: "amount_cents",
  currency: "currency",
  billingCycle: "billing_cycle",
  status: "status",
  startedOn: "started_on",
  renewsOn: "renews_on",
  url: "url",
  notes: "notes",
  createdByUserId: "created_by_user_id",
  updatedByUserId: "updated_by_user_id",
  createdAt: "created_at",
  updatedAt: "updated_at"
};

export const PlatformOperatingCostModel = createModel("platform_operating_costs", COLUMNS);
