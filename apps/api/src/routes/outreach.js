import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireRole } from "../middleware/requireRole.js";
import {
  OutreachAccountModel,
  OutreachContactModel,
  OutreachConversationModel,
  OutreachInteractionModel,
  OutreachMessageModel,
  PlatformAdminAuditLogModel,
} from "../db/models/index.js";
import {
  OUTREACH_DIRECTIONS,
  OUTREACH_INTERACTION_TYPES,
  OUTREACH_STAGES,
  buildOutreachContext,
  getConversationHistory,
  getOutreachAgentStatus,
  interactionCountsAsContact,
  normalizeOutreachAccountInput,
  normalizeOutreachContactInput,
  normalizeOutreachInteractionInput,
  normalizeOutreachMessage,
  outreachAccountDetail,
  runOutreachAgent,
} from "../services/outreach.js";

const router = Router();
const chatLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) =>
    ["outreach-agent", String(req.user?.id || req.user?._id || ""), String(req.ip || "")].join(":"),
  message: {
    error: {
      code: "RATE_LIMITED",
      message: "Too many outreach-agent requests. Please wait and try again.",
    },
  },
});

// Outreach contains company-confidential pipeline and business-contact data.
// V1 is intentionally restricted to the unscoped super-admin identity.
router.use(requireAuth, requireRole("super_admin"), (req, res, next) => {
  if (String(req.user?.tenantId || "").trim()) {
    return res.status(403).json({
      error: {
        code: "ROLE_FORBIDDEN",
        message: "Outreach requires a global super admin session.",
      },
    });
  }
  return next();
});

function actorId(req) {
  return String(req.user?._id || req.user?.id || "").trim();
}

function notFound(message = "Outreach record not found.") {
  const error = new Error(message);
  error.code = "OUTREACH_NOT_FOUND";
  error.statusCode = 404;
  return error;
}

async function requireAccount(id) {
  const account = await OutreachAccountModel.findById(String(id || ""));
  if (!account) throw notFound("Outreach camp not found.");
  return account;
}

async function audit(req, event, metadata = {}) {
  await PlatformAdminAuditLogModel.create({
    actorUserId: actorId(req) || null,
    event,
    metadata: { ...metadata, requestId: String(req.requestId || "") },
  });
}

function normalizeQuery(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .slice(0, 160);
}

router.get("/capabilities", (_req, res) => {
  return res.json({
    ...getOutreachAgentStatus(),
    stages: OUTREACH_STAGES,
    interactionTypes: OUTREACH_INTERACTION_TYPES,
    directions: OUTREACH_DIRECTIONS,
    dataUse:
      "Pipeline records, contacts, interactions, and this operator's chat history are stored in PondBridge. When AI is enabled, relevant outreach context is processed by OpenAI with provider storage disabled.",
    approvalBoundary:
      "The chat may update internal pipeline records when explicitly instructed. It has no external send operation.",
  });
});

router.get("/pipeline", async (req, res, next) => {
  try {
    const stage = normalizeQuery(req.query.stage);
    if (stage && stage !== "all" && !OUTREACH_STAGES.includes(stage)) {
      return res.status(400).json({
        error: { code: "OUTREACH_INVALID_STAGE", message: "Choose a valid outreach stage." },
      });
    }
    const filter = stage && stage !== "all" ? { stage } : {};
    const query = normalizeQuery(req.query.q);
    let accounts = await OutreachAccountModel.find(filter, { sort: { updatedAt: -1 }, limit: 250 });
    if (query) {
      accounts = accounts.filter((account) =>
        [
          account.name,
          account.location,
          account.ownerLabel,
          account.nextAction,
          account.source,
        ].some((value) =>
          String(value || "")
            .toLowerCase()
            .includes(query)
        )
      );
    }
    const counts = Object.fromEntries(OUTREACH_STAGES.map((key) => [key, 0]));
    for (const account of await OutreachAccountModel.find({}, { select: ["stage"] })) {
      if (Object.hasOwn(counts, account.stage)) counts[account.stage] += 1;
    }
    return res.json({
      accounts,
      counts,
      stages: OUTREACH_STAGES,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/accounts", async (req, res, next) => {
  try {
    const input = normalizeOutreachAccountInput(req.body || {});
    const actorUserId = actorId(req) || null;
    const account = await OutreachAccountModel.create({
      ...input,
      createdByUserId: actorUserId,
      updatedByUserId: actorUserId,
    });
    await audit(req, "outreach_account_created", { accountId: account._id, stage: account.stage });
    return res.status(201).json(await outreachAccountDetail(account));
  } catch (error) {
    return next(error);
  }
});

router.get("/accounts/:accountId", async (req, res, next) => {
  try {
    return res.json(await outreachAccountDetail(await requireAccount(req.params.accountId)));
  } catch (error) {
    return next(error);
  }
});

router.patch("/accounts/:accountId", async (req, res, next) => {
  try {
    const existing = await requireAccount(req.params.accountId);
    const patch = normalizeOutreachAccountInput(req.body || {}, { partial: true });
    if (!Object.keys(patch).length) {
      return res.status(400).json({
        error: { code: "OUTREACH_PATCH_REQUIRED", message: "Add at least one field to update." },
      });
    }
    const updated = await OutreachAccountModel.update(existing._id, {
      ...patch,
      updatedByUserId: actorId(req) || null,
    });
    if (patch.stage && patch.stage !== existing.stage) {
      await OutreachInteractionModel.create({
        accountId: existing._id,
        interactionType: "status_change",
        direction: "internal",
        occurredAt: new Date().toISOString(),
        summary: `Stage changed from ${existing.stage} to ${patch.stage}.`,
        outcome: patch.lostReason || "",
        createdByUserId: actorId(req) || null,
      });
    }
    await audit(req, "outreach_account_updated", {
      accountId: existing._id,
      changedFields: Object.keys(patch).sort(),
      previousStage: existing.stage,
      stage: updated.stage,
    });
    return res.json(await outreachAccountDetail(updated));
  } catch (error) {
    return next(error);
  }
});

router.post("/accounts/:accountId/contacts", async (req, res, next) => {
  try {
    const account = await requireAccount(req.params.accountId);
    const input = normalizeOutreachContactInput(req.body || {});
    if (input.isPrimary) {
      await OutreachContactModel.updateMany(
        { accountId: account._id, isPrimary: true },
        { isPrimary: false }
      );
    }
    const contact = await OutreachContactModel.create({
      ...input,
      accountId: account._id,
      createdByUserId: actorId(req) || null,
    });
    await audit(req, "outreach_contact_created", {
      accountId: account._id,
      contactId: contact._id,
    });
    return res.status(201).json(contact);
  } catch (error) {
    return next(error);
  }
});

router.patch("/contacts/:contactId", async (req, res, next) => {
  try {
    const existing = await OutreachContactModel.findById(req.params.contactId);
    if (!existing) throw notFound("Outreach contact not found.");
    const patch = normalizeOutreachContactInput(req.body || {}, { partial: true });
    if (patch.isPrimary) {
      await OutreachContactModel.updateMany(
        { accountId: existing.accountId, isPrimary: true },
        { isPrimary: false }
      );
    }
    const updated = await OutreachContactModel.update(existing._id, patch);
    await audit(req, "outreach_contact_updated", {
      accountId: existing.accountId,
      contactId: existing._id,
      changedFields: Object.keys(patch).sort(),
    });
    return res.json(updated);
  } catch (error) {
    return next(error);
  }
});

router.post("/accounts/:accountId/interactions", async (req, res, next) => {
  try {
    const account = await requireAccount(req.params.accountId);
    const input = normalizeOutreachInteractionInput(req.body || {});
    if (input.contactId) {
      const contact = await OutreachContactModel.findById(input.contactId);
      if (!contact || contact.accountId !== account._id) {
        const error = new Error("The selected contact does not belong to this camp.");
        error.code = "OUTREACH_CONTACT_SCOPE_DENIED";
        error.statusCode = 400;
        throw error;
      }
    }
    const interaction = await OutreachInteractionModel.create({
      ...input,
      accountId: account._id,
      createdByUserId: actorId(req) || null,
    });
    const accountPatch = { updatedByUserId: actorId(req) || null };
    if (
      interactionCountsAsContact(input) &&
      (!account.lastContactAt || new Date(input.occurredAt) > new Date(account.lastContactAt))
    ) {
      accountPatch.lastContactAt = input.occurredAt;
    }
    if (input.followUpAt) accountPatch.nextActionDueAt = input.followUpAt;
    await OutreachAccountModel.update(account._id, accountPatch);
    await audit(req, "outreach_interaction_logged", {
      accountId: account._id,
      interactionId: interaction._id,
      interactionType: interaction.interactionType,
      direction: interaction.direction,
    });
    return res.status(201).json(interaction);
  } catch (error) {
    return next(error);
  }
});

async function resolveConversation(req, requestedId = "") {
  const operatorUserId = actorId(req);
  if (requestedId) {
    const existing = await OutreachConversationModel.findById(requestedId);
    if (!existing || existing.operatorUserId !== operatorUserId)
      throw notFound("Outreach conversation not found.");
    return existing;
  }
  const [latest] = await OutreachConversationModel.find(
    { operatorUserId, archivedAt: null },
    { sort: { updatedAt: -1 }, limit: 1 }
  );
  if (latest) return latest;
  return OutreachConversationModel.create({ operatorUserId, title: "Fall launch outreach" });
}

router.get("/conversation", async (req, res, next) => {
  try {
    const conversation = await resolveConversation(req, String(req.query.conversationId || ""));
    const messages = await getConversationHistory(conversation._id);
    return res.json({ conversation, messages });
  } catch (error) {
    return next(error);
  }
});

router.post("/chat", chatLimiter, async (req, res, next) => {
  try {
    const message = normalizeOutreachMessage(req.body?.message);
    const conversation = await resolveConversation(req, String(req.body?.conversationId || ""));
    const selectedAccountId = String(req.body?.accountId || "").trim();
    const selectedAccount = selectedAccountId ? await requireAccount(selectedAccountId) : null;
    const history = await getConversationHistory(conversation._id);
    const userMessage = await OutreachMessageModel.create({
      conversationId: conversation._id,
      role: "user",
      content: message,
      sources: [],
      metadata: {},
    });
    const accounts = await buildOutreachContext();
    const agentMessage = selectedAccount
      ? `${message}\n\nSelected outreach record: ${selectedAccount.name} (id ${selectedAccount._id}).`
      : message;
    const result = await runOutreachAgent({
      message: agentMessage,
      history,
      accounts,
      context: {
        actorUserId: actorId(req),
        audit: (event, metadata) =>
          audit(req, event, { conversationId: conversation._id, ...metadata }),
      },
    });
    const assistantMessage = await OutreachMessageModel.create({
      conversationId: conversation._id,
      role: "assistant",
      content: result.answer,
      sources: result.sources,
      metadata: {
        mode: result.mode,
        approvalRequired: true,
        actions: (result.actions || []).map((action) => ({
          tool: action.tool,
          accountId: action.result?.accountId || action.result?.id || null,
        })),
      },
    });
    await OutreachConversationModel.update(conversation._id, {
      updatedAt: new Date().toISOString(),
    });
    await audit(req, "outreach_agent_answered", {
      conversationId: conversation._id,
      mode: result.mode,
      accountCount: accounts.length,
      sourceCount: result.sources.length,
      mutationCount: result.actions?.length || 0,
    });
    return res.json({
      conversation,
      userMessage,
      assistantMessage,
      actions: result.actions || [],
      approvalRequired: true,
      sent: false,
    });
  } catch (error) {
    if (String(error?.code || "").startsWith("OUTREACH_")) return next(error);
    const providerError = new Error(
      "Outreach Agent could not complete the request. No message was sent."
    );
    providerError.code = "OUTREACH_PROVIDER_ERROR";
    providerError.statusCode = 502;
    return next(providerError);
  }
});

export default router;
