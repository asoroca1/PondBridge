import { createModel } from "./_factory.js";
import { getSupabaseAdmin } from "../supabaseAdmin.js";

const COLUMNS = {
  id: "id",
  tenantId: "tenant_id",
  actorUserId: "actor_user_id",
  featureKey: "feature_key",
  resourceType: "resource_type",
  resourceId: "resource_id",
  status: "status",
  provider: "provider",
  model: "model",
  promptVersion: "prompt_version",
  requestHash: "request_hash",
  requestBytes: "request_bytes",
  responseHash: "response_hash",
  responseBytes: "response_bytes",
  inputTokens: "input_tokens",
  cachedInputTokens: "cached_input_tokens",
  outputTokens: "output_tokens",
  totalTokens: "total_tokens",
  estimatedCostMicrousd: "estimated_cost_microusd",
  pricingVersion: "pricing_version",
  providerRequestId: "provider_request_id",
  errorCode: "error_code",
  metadata: "metadata",
  completedAt: "completed_at",
  createdAt: "created_at",
  updatedAt: "updated_at"
};

const base = createModel("ai_generations", COLUMNS);

function numeric(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export const AiGenerationModel = {
  ...base,
  COLUMNS,

  async usageSummary({ tenantId, featureKey = null, since = null }) {
    const { data, error } = await getSupabaseAdmin().rpc("ai_usage_summary", {
      p_tenant_id: String(tenantId || "").trim(),
      p_feature_key: featureKey ? String(featureKey).trim() : null,
      p_since: since ? new Date(since).toISOString() : new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] || {} : data || {};
    return {
      generationCount: numeric(row.generation_count),
      inputTokens: numeric(row.input_tokens),
      cachedInputTokens: numeric(row.cached_input_tokens),
      outputTokens: numeric(row.output_tokens),
      totalTokens: numeric(row.total_tokens),
      estimatedCostMicrousd: numeric(row.estimated_cost_microusd)
    };
  }
};
