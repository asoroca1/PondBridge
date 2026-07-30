import crypto from "crypto";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireFeature as requireRolloutFeature, isFeatureEnabled } from "../middleware/featureFlag.js";
import { requireTenantRoleScope } from "../middleware/tenantAccess.js";
import { logTenantEvent } from "../services/analytics.js";
import { normalizeCopilotTelemetry } from "../services/copilotTelemetry.js";
import {
  DIRECTOR_COPILOT_FLAG,
  getDirectorCopilotProviderStatus,
  normalizeCopilotQuestion,
  runDirectorCopilot
} from "../services/directorCopilot.js";

const router = Router({ mergeParams: true });
const copilotLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 24,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => [
    "director-copilot",
    String(req.tenant?._id || req.params?.slug || ""),
    String(req.user?.id || ""),
    String(req.ip || "")
  ].join(":"),
  message: {
    error: {
      code: "RATE_LIMITED",
      message: "Too many copilot requests. Please wait before trying again."
    }
  }
});
const telemetryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 180,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ["director-copilot-telemetry", String(req.tenant?._id || ""), String(req.user?.id || "")].join(":"),
  message: { error: { code: "RATE_LIMITED", message: "Too many workspace events." } }
});

router.use(...requireTenantRoleScope("tenant_admin"));

router.get("/capabilities", async (req, res, next) => {
  try {
    const provider = getDirectorCopilotProviderStatus();
    const featureEnabled = await isFeatureEnabled(DIRECTOR_COPILOT_FLAG, req.tenant);
    return res.json({
      available: featureEnabled && provider.configured,
      featureEnabled,
      providerConfigured: provider.configured,
      provider: "OpenAI",
      mode: "read_only",
      dataUse: "Requests and minimum aggregate camp context are processed by OpenAI. PondBridge audit records contain hashes and usage metadata, not raw prompts or answers.",
      tools: [
        "launch_readiness",
        "director_action_queue",
        "community_overview",
        "admin_screen_guidance"
      ],
      promptVersion: provider.promptVersion,
      toolContractVersion: provider.toolContractVersion
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/events", telemetryLimiter, async (req, res, next) => {
  const normalized = normalizeCopilotTelemetry({
    surface: "director",
    eventType: req.body?.eventType,
    mode: req.body?.mode,
    target: req.body?.target
  });
  if (!normalized) {
    return res.status(400).json({
      error: { code: "INVALID_COPILOT_EVENT", message: "Unsupported workspace event." }
    });
  }
  try {
    await logTenantEvent({
      tenantId: String(req.tenant?._id || ""),
      userId: String(req.user?.id || "") || null,
      eventType: normalized.eventType,
      metadata: normalized.metadata
    });
    return res.status(204).end();
  } catch (error) {
    return next(error);
  }
});

router.use(requireRolloutFeature(DIRECTOR_COPILOT_FLAG));

router.post("/ask", copilotLimiter, async (req, res, next) => {
  const question = normalizeCopilotQuestion(req.body?.question || "");
  if (!question) {
    return res.status(400).json({
      error: {
        code: "COPILOT_QUESTION_REQUIRED",
        message: "Ask a question or describe the draft you need."
      }
    });
  }

  const context = {
    tenant: req.tenant,
    tenantId: String(req.tenant?._id || ""),
    actorUserId: String(req.user?.id || ""),
    roles: Array.isArray(req.user?.roles) ? req.user.roles : [],
    requestId: String(req.requestId || ""),
    conversationId: crypto.randomUUID(),
    runId: crypto.randomUUID()
  };

  try {
    const result = await runDirectorCopilot({ question, context });
    return res.json(result);
  } catch (error) {
    if (String(error?.code || "").startsWith("COPILOT_")) return next(error);
    const providerError = new Error(
      "Director Copilot could not complete this request. No PondBridge action was taken."
    );
    providerError.code = "COPILOT_PROVIDER_ERROR";
    providerError.statusCode = 502;
    return next(providerError);
  }
});

export default router;
