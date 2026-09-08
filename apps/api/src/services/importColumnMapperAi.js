import { OpenAI } from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { env } from "../config/env.js";
import {
  assertAiSpendAvailable,
  beginAiGeneration,
  completeAiGeneration,
  estimateAiCostMicrousd,
  failAiGeneration,
  getTenantAiUsage,
  isAiModelPriced,
  microusdToUsd
} from "./aiUsage.js";
import {
  buildMapperInstructions,
  buildMapperRequest,
  collectColumnSamples,
  mergeAiProposals,
  proposeMappingFromHeaders,
  __testables
} from "./importColumnMapper.js";

const { AiMappingSchema } = __testables;

export const IMPORT_MAPPING_FEATURE_KEY = "questionnaire_import_mapping";
export const IMPORT_MAPPING_PROMPT_VERSION = "questionnaire-import-mapping-v1.0";

let openAIClient = null;

/** Shared with the value cleaner so both tiers use one client and one timeout. */
export function getSharedOpenAIClient() {
  if (!env.OPENAI_API_KEY) return null;
  if (!openAIClient) {
    openAIClient = new OpenAI({
      apiKey: env.OPENAI_API_KEY,
      timeout: env.OPENAI_PROFILE_IMPORT_TIMEOUT_MS,
      maxRetries: 1
    });
  }
  return openAIClient;
}

export function getMapperProviderStatus() {
  const pricingConfigured = isAiModelPriced(env.OPENAI_PROFILE_IMPORT_MODEL);
  return {
    configured: Boolean(env.OPENAI_API_KEY) && pricingConfigured,
    providerConfigured: Boolean(env.OPENAI_API_KEY),
    pricingConfigured,
    provider: "OpenAI",
    model: env.OPENAI_PROFILE_IMPORT_MODEL,
    promptVersion: IMPORT_MAPPING_PROMPT_VERSION,
    monthlyBudgetUsd: env.PROFILE_IMPORT_MONTHLY_BUDGET_USD
  };
}

function projectedRequestCost(requestContent = "") {
  return estimateAiCostMicrousd({
    model: env.OPENAI_PROFILE_IMPORT_MODEL,
    inputTokens: Math.ceil(Buffer.byteLength(requestContent, "utf8") / 3),
    outputTokens: env.OPENAI_PROFILE_IMPORT_MAX_OUTPUT_TOKENS
  });
}

function safetyIdentifier({ tenantId = "", actorUserId = "" } = {}) {
  return `pondbridge:${String(tenantId || "")}:${String(actorUserId || "")}`;
}

async function askModelToMapColumns({ tenantId, actorUserId, unmappedHeaders, samples }) {
  const client = getSharedOpenAIClient();
  const provider = getMapperProviderStatus();
  if (!client || !provider.configured) {
    const error = new Error("AI column mapping is not configured.");
    error.code = provider.providerConfigured ? "AI_PRICING_UNAVAILABLE" : "IMPORT_MAPPING_NOT_CONFIGURED";
    error.statusCode = 503;
    throw error;
  }

  const requestContent = JSON.stringify(buildMapperRequest(unmappedHeaders, samples));
  const usage = await getTenantAiUsage({
    tenantId,
    featureKey: IMPORT_MAPPING_FEATURE_KEY,
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
    featureKey: IMPORT_MAPPING_FEATURE_KEY,
    provider: "openai",
    model: env.OPENAI_PROFILE_IMPORT_MODEL,
    promptVersion: IMPORT_MAPPING_PROMPT_VERSION,
    requestContent,
    resourceType: "questionnaire_columns",
    metadata: { columnCount: unmappedHeaders.length }
  });

  try {
    const response = await client.responses.parse({
      model: env.OPENAI_PROFILE_IMPORT_MODEL,
      instructions: buildMapperInstructions(),
      input: [{ role: "user", content: requestContent }],
      text: { format: zodTextFormat(AiMappingSchema, "pondbridge_import_column_mapping") },
      max_output_tokens: env.OPENAI_PROFILE_IMPORT_MAX_OUTPUT_TOKENS,
      safety_identifier: safetyIdentifier({ tenantId, actorUserId }),
      store: false
    });

    const parsed = AiMappingSchema.safeParse(response?.output_parsed);
    if (!parsed.success) {
      const error = new Error("The column mapper returned an unusable answer.");
      error.code = "IMPORT_MAPPING_SCHEMA_INVALID";
      error.statusCode = 502;
      throw error;
    }

    const completed = await completeAiGeneration({
      generationId: generation._id,
      response,
      responseContent: JSON.stringify(parsed.data),
      model: env.OPENAI_PROFILE_IMPORT_MODEL
    });

    return {
      columns: parsed.data.columns,
      usage: {
        inputTokens: completed.inputTokens,
        outputTokens: completed.outputTokens,
        estimatedCostUsd: microusdToUsd(completed.estimatedCostMicrousd)
      }
    };
  } catch (error) {
    await failAiGeneration({ generationId: generation?._id, error }).catch(() => {});
    throw error;
  }
}

/**
 * Proposes a mapping for a questionnaire's columns.
 *
 * The dictionary always runs. The model runs only on what the dictionary did not
 * recognise, and only if it is configured, affordable and asked for — and if any
 * of that fails, the dictionary's answer stands and the director maps the rest by
 * hand. An import is never blocked because the model was unavailable, which is
 * why every failure here is caught and reported rather than thrown.
 */
export async function proposeImportMapping({
  tenantId,
  actorUserId,
  headers = [],
  rows = [],
  useAi = true
}) {
  const samples = collectColumnSamples(rows, headers);
  const baseProposals = proposeMappingFromHeaders(headers);
  const unmappedHeaders = baseProposals.filter((proposal) => !proposal.field).map((proposal) => proposal.column);

  const status = getMapperProviderStatus();
  if (!useAi || !unmappedHeaders.length || !status.configured) {
    return {
      proposals: baseProposals,
      samples: Object.fromEntries(samples),
      ai: {
        used: false,
        reason: !useAi
          ? "not_requested"
          : !unmappedHeaders.length
            ? "nothing_left_to_map"
            : status.providerConfigured
              ? "pricing_unavailable"
              : "not_configured"
      }
    };
  }

  try {
    const result = await askModelToMapColumns({ tenantId, actorUserId, unmappedHeaders, samples });
    return {
      proposals: mergeAiProposals(baseProposals, result.columns),
      samples: Object.fromEntries(samples),
      ai: { used: true, ...result.usage }
    };
  } catch (error) {
    // Degrade, never fail. A director with a dictionary-only mapping can still
    // finish the import; one staring at an error cannot.
    return {
      proposals: baseProposals,
      samples: Object.fromEntries(samples),
      ai: {
        used: false,
        reason: error?.code === "AI_MONTHLY_BUDGET_REACHED" ? "budget_reached" : "unavailable",
        message: String(error?.message || "")
      }
    };
  }
}
