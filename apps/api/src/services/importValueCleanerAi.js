import { zodTextFormat } from "openai/helpers/zod";
import { env } from "../config/env.js";
import {
  assertAiSpendAvailable,
  beginAiGeneration,
  completeAiGeneration,
  estimateAiCostMicrousd,
  failAiGeneration,
  getTenantAiUsage,
  microusdToUsd
} from "./aiUsage.js";
import { getMapperProviderStatus, getSharedOpenAIClient } from "./importColumnMapperAi.js";
import {
  CleanupSchema,
  applyCleanupResults,
  buildCleanupInstructions,
  buildCleanupRequest,
  collectUnparseableCells
} from "./importValueCleaner.js";

export const IMPORT_CLEANUP_FEATURE_KEY = "questionnaire_import_cleanup";
export const IMPORT_CLEANUP_PROMPT_VERSION = "questionnaire-import-cleanup-v1.0";

/** Batched so one questionnaire is a handful of requests rather than hundreds. */
export const CLEANUP_BATCH_SIZE = 25;
/**
 * A ceiling on how much of one import can go to the model. A file that trips this
 * has something wrong with its mapping, and a director should look at it rather
 * than pay to have thousands of cells rewritten.
 */
export const MAX_CLEANUP_CELLS = 400;

function projectedRequestCost(requestContent = "") {
  return estimateAiCostMicrousd({
    model: env.OPENAI_PROFILE_IMPORT_MODEL,
    inputTokens: Math.ceil(Buffer.byteLength(requestContent, "utf8") / 3),
    outputTokens: env.OPENAI_PROFILE_IMPORT_MAX_OUTPUT_TOKENS
  });
}

async function cleanOneBatch({ tenantId, actorUserId, cells }) {
  const client = getSharedOpenAIClient();
  const requestContent = JSON.stringify(buildCleanupRequest(cells));

  const usage = await getTenantAiUsage({
    tenantId,
    featureKey: IMPORT_CLEANUP_FEATURE_KEY,
    monthlyBudgetUsd: env.PROFILE_IMPORT_MONTHLY_BUDGET_USD
  });
  assertAiSpendAvailable({
    usage,
    projectedCostMicrousd: projectedRequestCost(requestContent),
    featureLabel: "Questionnaire Import"
  });

  const generation = await beginAiGeneration({
    tenantId,
    actorUserId,
    featureKey: IMPORT_CLEANUP_FEATURE_KEY,
    provider: "openai",
    model: env.OPENAI_PROFILE_IMPORT_MODEL,
    promptVersion: IMPORT_CLEANUP_PROMPT_VERSION,
    requestContent,
    resourceType: "questionnaire_values",
    metadata: { cellCount: cells.length }
  });

  try {
    const response = await client.responses.parse({
      model: env.OPENAI_PROFILE_IMPORT_MODEL,
      instructions: buildCleanupInstructions(),
      input: [{ role: "user", content: requestContent }],
      text: { format: zodTextFormat(CleanupSchema, "pondbridge_import_value_cleanup") },
      max_output_tokens: env.OPENAI_PROFILE_IMPORT_MAX_OUTPUT_TOKENS,
      safety_identifier: `pondbridge:${tenantId}:${actorUserId}`,
      store: false
    });

    const parsed = CleanupSchema.safeParse(response?.output_parsed);
    if (!parsed.success) {
      const error = new Error("The value cleaner returned an unusable answer.");
      error.code = "IMPORT_CLEANUP_SCHEMA_INVALID";
      error.statusCode = 502;
      throw error;
    }

    const completed = await completeAiGeneration({
      generationId: generation._id,
      response,
      responseContent: JSON.stringify(parsed.data),
      model: env.OPENAI_PROFILE_IMPORT_MODEL
    });

    return { values: parsed.data.values, costMicrousd: completed.estimatedCostMicrousd };
  } catch (error) {
    await failAiGeneration({ generationId: generation?._id, error }).catch(() => {});
    throw error;
  }
}

/**
 * Rewrites the answers the parsers could not read, and reports every change so a
 * director sees before → after in the dry run before any of it is written.
 *
 * Degrades the same way the column mapper does: if the model is unconfigured,
 * unaffordable or unreachable, the unreadable cells simply stay empty — which is
 * what would have happened without this step — and the import carries on.
 */
export async function cleanImportValues({
  tenantId,
  actorUserId,
  rows = [],
  mapping = {},
  enabled = true
}) {
  const cells = collectUnparseableCells(rows, mapping);
  const status = getMapperProviderStatus();

  if (!enabled || !cells.length || !status.configured) {
    return {
      cleaned: new Map(),
      preview: [],
      ai: {
        used: false,
        candidateCells: cells.length,
        reason: !enabled
          ? "not_requested"
          : !cells.length
            ? "nothing_to_clean"
            : status.providerConfigured
              ? "pricing_unavailable"
              : "not_configured"
      }
    };
  }

  if (cells.length > MAX_CLEANUP_CELLS) {
    return {
      cleaned: new Map(),
      preview: [],
      ai: {
        used: false,
        candidateCells: cells.length,
        reason: "too_many_unreadable_cells",
        message: `${cells.length} answers could not be read. Check the column mapping before running cleanup.`
      }
    };
  }

  const cleaned = new Map();
  const preview = [];
  let costMicrousd = 0;
  let batchesRun = 0;

  for (let index = 0; index < cells.length; index += CLEANUP_BATCH_SIZE) {
    const batch = cells.slice(index, index + CLEANUP_BATCH_SIZE);
    try {
      const result = await cleanOneBatch({ tenantId, actorUserId, cells: batch });
      const applied = applyCleanupResults(batch, result.values);
      for (const [key, value] of applied.cleaned) cleaned.set(key, value);
      preview.push(...applied.preview);
      costMicrousd += result.costMicrousd || 0;
      batchesRun += 1;
    } catch (error) {
      // Stop at the first failure rather than retrying the rest: a budget ceiling
      // or an outage will not resolve mid-import, and whatever earlier batches
      // produced is still good.
      return {
        cleaned,
        preview,
        ai: {
          used: batchesRun > 0,
          candidateCells: cells.length,
          batchesRun,
          estimatedCostUsd: microusdToUsd(costMicrousd),
          reason: error?.code === "AI_MONTHLY_BUDGET_REACHED" ? "budget_reached" : "unavailable",
          message: String(error?.message || "")
        }
      };
    }
  }

  return {
    cleaned,
    preview,
    ai: {
      used: true,
      candidateCells: cells.length,
      batchesRun,
      rewrittenCells: preview.length,
      estimatedCostUsd: microusdToUsd(costMicrousd)
    }
  };
}
