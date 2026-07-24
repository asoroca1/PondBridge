import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireFeature as requireRolloutFeature, isFeatureEnabled } from "../middleware/featureFlag.js";
import { requireTenantRoleScope } from "../middleware/tenantAccess.js";
import { analyzeEmailDraft } from "../services/emailCompliance.js";
import {
  DIRECTOR_EMAIL_AGENT_FLAG,
  getDirectorEmailAgentProviderStatus,
  getDirectorEmailAgentUsage,
  runDirectorEmailAgent
} from "../services/directorEmailAgent.js";

const router = Router({ mergeParams: true });
const emailAgentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 16,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => [
    "director-email-agent",
    String(req.tenant?._id || req.params?.slug || ""),
    String(req.user?.id || ""),
    String(req.ip || "")
  ].join(":"),
  message: {
    error: {
      code: "RATE_LIMITED",
      message: "Too many Communications Agent requests. Please wait before trying again."
    }
  }
});

router.use(...requireTenantRoleScope("tenant_admin"));

router.get("/capabilities", async (req, res, next) => {
  try {
    const provider = getDirectorEmailAgentProviderStatus();
    const featureEnabled = await isFeatureEnabled(DIRECTOR_EMAIL_AGENT_FLAG, req.tenant);
    let usage = null;
    let usageLedgerAvailable = false;
    try {
      usage = await getDirectorEmailAgentUsage(String(req.tenant?._id || ""));
      usageLedgerAvailable = true;
    } catch {
      usage = null;
    }
    return res.json({
      available: featureEnabled && provider.configured && usageLedgerAvailable,
      featureEnabled,
      providerConfigured: provider.providerConfigured,
      pricingConfigured: provider.pricingConfigured,
      usageLedgerAvailable,
      provider: provider.provider,
      model: provider.model,
      mode: "draft_only",
      approvalRequired: true,
      dataUse: "Your brief and current draft are processed by OpenAI. PondBridge stores hashes, token usage, estimated cost, and provider metadata—not the raw prompt or generated copy—in its AI usage ledger.",
      usage,
      promptVersion: provider.promptVersion
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/quality", async (req, res) => {
  return res.json(analyzeEmailDraft({
    tenant: req.tenant,
    subject: req.body?.subject,
    preheader: req.body?.preheader,
    body: req.body?.body,
    campaignType: req.body?.campaignType,
    recipientCount: req.body?.recipientCount
  }));
});

router.get("/usage", requireRolloutFeature(DIRECTOR_EMAIL_AGENT_FLAG), async (req, res, next) => {
  try {
    const usage = await getDirectorEmailAgentUsage(String(req.tenant?._id || ""));
    return res.json({ usage });
  } catch (error) {
    return next(error);
  }
});

router.post(
  "/draft",
  emailAgentLimiter,
  requireRolloutFeature(DIRECTOR_EMAIL_AGENT_FLAG),
  async (req, res, next) => {
    const context = {
      tenant: req.tenant,
      tenantId: String(req.tenant?._id || ""),
      actorUserId: String(req.user?.id || ""),
      requestId: String(req.requestId || "")
    };
    try {
      const result = await runDirectorEmailAgent({ input: req.body || {}, context });
      return res.status(201).json(result);
    } catch (error) {
      if (
        String(error?.code || "").startsWith("EMAIL_AGENT_") ||
        String(error?.code || "").startsWith("AI_")
      ) {
        return next(error);
      }
      const providerError = new Error(
        "The Communications Agent could not create a draft. No email was sent or scheduled."
      );
      providerError.code = "EMAIL_AGENT_PROVIDER_ERROR";
      providerError.statusCode = 502;
      providerError.cause = error;
      return next(providerError);
    }
  }
);

export default router;
