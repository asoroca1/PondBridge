import { createModel } from "./_factory.js";

const COLUMNS = {
  id: "id",
  featureKey: "feature_key",
  state: "state",
  killSwitch: "kill_switch",
  tenantIds: "tenant_ids",
  excludedTenantIds: "excluded_tenant_ids",
  config: "config",
  revision: "revision",
  updatedByUserId: "updated_by_user_id",
  createdAt: "created_at",
  updatedAt: "updated_at"
};

export const FeatureRolloutModel = createModel("feature_rollouts", COLUMNS);
