import crypto from "node:crypto";
import { AiGenerationModel } from "../db/models/index.js";
import { generateObjectId } from "../utils/objectId.js";

export const AI_PRICING_VERSION = "openai-public-2026-07-15";

// USD per one million text tokens. Keep this allowlist intentionally narrow:
// an unpriced configured model must fail closed so tenant spend is never
// silently unmetered.
export const AI_MODEL_PRICING = Object.freeze({
  "gpt-5.6-luna": Object.freeze({ input: 1, cachedInput: 0.1, output: 6 }),
  "gpt-5.6-terra": Object.freeze({ input: 2.5, cachedInput: 0.25, output: 15 }),
  "gpt-5.6-sol": Object.freeze({ input: 5, cachedInput: 0.5, output: 30 })
});

function nonNegativeInt(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

export function hashAiContent(value = "") {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

export function normalizeProviderUsage(response = {}) {
  const inputTokens = nonNegativeInt(response?.usage?.input_tokens);
  const cachedInputTokens = Math.min(
    inputTokens,
    nonNegativeInt(response?.usage?.input_tokens_details?.cached_tokens)
  );
  const outputTokens = nonNegativeInt(response?.usage?.output_tokens);
  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    totalTokens: nonNegativeInt(
      response?.usage?.total_tokens || inputTokens + outputTokens
    )
  };
}

export function estimateAiCostMicrousd({
  model,
  inputTokens = 0,
  cachedInputTokens = 0,
  outputTokens = 0
} = {}) {
  const pricing = AI_MODEL_PRICING[String(model || "").trim()];
  if (!pricing) return null;
  const input = nonNegativeInt(inputTokens);
  const cached = Math.min(input, nonNegativeInt(cachedInputTokens));
  const uncached = Math.max(0, input - cached);
  const output = nonNegativeInt(outputTokens);

  // USD/MTok converts directly to micro-USD/token.
  return Math.max(0, Math.round(
    uncached * pricing.input +
      cached * pricing.cachedInput +
      output * pricing.output
  ));
}

export function microusdToUsd(value = 0) {
  return nonNegativeInt(value) / 1_000_000;
}

export function isAiModelPriced(model = "") {
  return Boolean(AI_MODEL_PRICING[String(model || "").trim()]);
}

function monthStart() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function getTenantAiUsage({
  tenantId,
  featureKey = null,
  monthlyBudgetUsd = 0
} = {}) {
  const summary = await AiGenerationModel.usageSummary({
    tenantId,
    featureKey,
    since: monthStart()
  });
  const budgetMicrousd = Math.max(0, Math.round(Number(monthlyBudgetUsd || 0) * 1_000_000));
  return {
    ...summary,
    periodStartedAt: monthStart().toISOString(),
    estimatedCostUsd: microusdToUsd(summary.estimatedCostMicrousd),
    budgetMicrousd,
    budgetUsd: microusdToUsd(budgetMicrousd),
    remainingMicrousd: budgetMicrousd > 0
      ? Math.max(0, budgetMicrousd - summary.estimatedCostMicrousd)
      : null,
    remainingUsd: budgetMicrousd > 0
      ? microusdToUsd(Math.max(0, budgetMicrousd - summary.estimatedCostMicrousd))
      : null
  };
}

export function assertAiSpendAvailable({ usage, projectedCostMicrousd = 0, featureLabel = "AI Communications" } = {}) {
  const budget = nonNegativeInt(usage?.budgetMicrousd);
  if (budget <= 0) return;
  const used = nonNegativeInt(usage?.estimatedCostMicrousd);
  const projected = nonNegativeInt(projectedCostMicrousd);
  if (used + projected < budget) return;
  const safeFeatureLabel = String(featureLabel || "AI").trim().slice(0, 80) || "AI";
  const error = new Error(`This camp has reached its monthly ${safeFeatureLabel} budget.`);
  error.code = "AI_MONTHLY_BUDGET_REACHED";
  error.statusCode = 429;
  error.details = {
    budgetUsd: microusdToUsd(budget),
    estimatedCostUsd: microusdToUsd(used)
  };
  throw error;
}

export async function beginAiGeneration({
  tenantId,
  actorUserId,
  featureKey,
  provider,
  model,
  promptVersion,
  requestContent,
  resourceType = "",
  metadata = {}
}) {
  if (!isAiModelPriced(model)) {
    const error = new Error("The configured AI model does not have an approved cost schedule.");
    error.code = "AI_PRICING_UNAVAILABLE";
    error.statusCode = 503;
    throw error;
  }
  const id = generateObjectId();
  const content = String(requestContent || "");
  return AiGenerationModel.create({
    id,
    tenantId,
    actorUserId: actorUserId || null,
    featureKey,
    resourceType,
    resourceId: id,
    status: "started",
    provider,
    model,
    promptVersion,
    requestHash: hashAiContent(content),
    requestBytes: Buffer.byteLength(content, "utf8"),
    estimatedCostMicrousd: null,
    pricingVersion: AI_PRICING_VERSION,
    metadata: metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? metadata
      : {}
  });
}

export async function completeAiGeneration({ generationId, response, responseContent, model: configuredModel = "" }) {
  const usage = normalizeProviderUsage(response);
  const model = String(response?.model || configuredModel || "").trim();
  const estimatedCostMicrousd = estimateAiCostMicrousd({ model, ...usage });
  if (estimatedCostMicrousd === null) {
    const error = new Error("The provider returned an unpriced model identifier.");
    error.code = "AI_PRICING_UNAVAILABLE";
    error.statusCode = 503;
    throw error;
  }
  const content = String(responseContent || "");
  return AiGenerationModel.update(generationId, {
    status: "succeeded",
    model,
    responseHash: hashAiContent(content),
    responseBytes: Buffer.byteLength(content, "utf8"),
    ...usage,
    estimatedCostMicrousd,
    pricingVersion: AI_PRICING_VERSION,
    providerRequestId: String(response?._request_id || response?.id || "").trim(),
    completedAt: new Date().toISOString()
  });
}

export async function failAiGeneration({ generationId, error }) {
  if (!generationId) return null;
  return AiGenerationModel.update(generationId, {
    status: "failed",
    errorCode: String(error?.code || "AI_PROVIDER_ERROR").trim().slice(0, 120),
    completedAt: new Date().toISOString()
  });
}
