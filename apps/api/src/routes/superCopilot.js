import crypto from "crypto";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireRole } from "../middleware/requireRole.js";
import { PlatformAdminAuditLogModel } from "../db/models/index.js";
import { normalizeCopilotTelemetry } from "../services/copilotTelemetry.js";
import {
  getSuperCopilotStatus,
  normalizeCopilotQuestion,
  primarySuperRole,
  runSuperCopilot
} from "../services/superCopilot.js";

const router = Router();
const SUPER_CONSOLE_ROLES = ["super_admin", "support_admin", "finance_admin"];
const askLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ["super-copilot", String(req.user?.id || ""), String(req.ip || "")].join(":"),
  message: {
    error: {
      code: "RATE_LIMITED",
      message: "Too many Operations Agent requests. Please wait before trying again."
    }
  }
});
const telemetryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 180,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ["super-copilot-telemetry", String(req.user?.id || "")].join(":"),
  message: { error: { code: "RATE_LIMITED", message: "Too many workspace events." } }
});

router.use(requireAuth, requireRole(...SUPER_CONSOLE_ROLES));

router.get("/capabilities", (req, res) => {
  const status = getSuperCopilotStatus(req.user?.roles || []);
  return res.json({
    available: status.available,
    enabled: status.enabled,
    providerConfigured: status.enabled ? status.configured : false,
    provider: status.enabled ? "OpenAI" : null,
    role: status.role,
    mode: status.mode,
    tools: status.tools,
    dataUse: "Requests and minimum aggregate operational context are processed by OpenAI when enabled. PondBridge stores hashes and usage metadata, not raw conversations."
  });
});

router.post("/events", telemetryLimiter, async (req, res, next) => {
  const role = primarySuperRole(req.user?.roles || []);
  const normalized = normalizeCopilotTelemetry({
    surface: "super",
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
    await PlatformAdminAuditLogModel.create({
      actorUserId: String(req.user?.id || "") || null,
      event: normalized.eventType,
      metadata: {
        ...normalized.metadata,
        role,
        requestId: String(req.requestId || "")
      }
    });
    return res.status(204).end();
  } catch (error) {
    return next(error);
  }
});

router.post("/ask", askLimiter, async (req, res, next) => {
  const question = normalizeCopilotQuestion(req.body?.question || "");
  if (!question) {
    return res.status(400).json({
      error: { code: "SUPER_COPILOT_QUESTION_REQUIRED", message: "Ask an operations question." }
    });
  }
  const context = {
    actorUserId: String(req.user?.id || ""),
    roles: Array.isArray(req.user?.roles) ? req.user.roles : [],
    role: primarySuperRole(req.user?.roles || []),
    requestId: String(req.requestId || ""),
    conversationId: crypto.randomUUID(),
    runId: crypto.randomUUID()
  };
  try {
    const result = await runSuperCopilot({ question, context });
    return res.json(result);
  } catch (error) {
    if (String(error?.code || "").startsWith("SUPER_COPILOT_")) return next(error);
    const providerError = new Error(
      "Operations Agent could not complete this investigation. No platform action was taken."
    );
    providerError.code = "SUPER_COPILOT_PROVIDER_ERROR";
    providerError.statusCode = 502;
    return next(providerError);
  }
});

export default router;
