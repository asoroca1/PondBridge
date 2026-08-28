import { Router } from "express";
import { requireTenantRoleScope } from "../middleware/tenantAccess.js";
import {
  GivingCauseModel,
  GivingDonationModel,
  TenantAdminAuditLogModel
} from "../db/models/index.js";
import {
  buildGivingSummary,
  createGivingError,
  normalizeGivingWritePayload,
  serializeAdminDonation,
  serializeGivingCause
} from "../services/giving.js";
import { sanitizeText } from "../utils/sanitize.js";

const router = Router({ mergeParams: true });
router.use(...requireTenantRoleScope("tenant_admin"));

function toId(value = "") {
  return String(value || "").trim();
}

async function loadCause(tenantId, causeId) {
  const cause = await GivingCauseModel.findOne(tenantId, { _id: toId(causeId) });
  if (!cause) throw createGivingError("Cause not found.", "GIVING_CAUSE_NOT_FOUND", 404);
  return cause;
}

async function audit(req, event, metadata = {}) {
  try {
    await TenantAdminAuditLogModel.create({
      tenantId: req.tenant._id,
      actorUserId: req.user.id,
      event,
      metadata
    });
  } catch {
    // A temporary audit-log issue must not block an otherwise valid review action.
  }
}

function causeResponse(cause, req) {
  return serializeGivingCause(cause, { viewerUserId: req.user.id, admin: true });
}

router.get("/", async (req, res) => {
  const causes = await GivingCauseModel.find(
    req.tenant._id,
    {},
    { sort: { createdAt: -1 }, limit: 300 }
  );
  const donations = await GivingDonationModel.find(
    req.tenant._id,
    {},
    { sort: { completedAt: -1 }, limit: 500 }
  );
  const causeById = new Map(causes.map((cause) => [toId(cause._id || cause.id), cause]));
  const publicCauses = causes.filter((cause) => ["active", "completed"].includes(cause.status));

  return res.json({
    items: causes.map((cause) => causeResponse(cause, req)),
    donations: donations.map((donation) => serializeAdminDonation(
      donation,
      causeById.get(toId(donation.causeId)) || null
    )),
    summary: {
      ...buildGivingSummary(publicCauses),
      pendingCount: causes.filter((cause) => ["pending", "changes_requested"].includes(cause.status)).length,
      completedDonationCount: donations.filter((donation) => donation.status === "succeeded").length
    }
  });
});

router.patch("/:causeId", async (req, res) => {
  const cause = await loadCause(req.tenant._id, req.params.causeId);
  const source = req.body || {};
  const payload = normalizeGivingWritePayload(source, { partial: true, allowGeneralFund: true });

  const startDate = Object.prototype.hasOwnProperty.call(payload, "startDate") ? payload.startDate : cause.startDate;
  const endDate = Object.prototype.hasOwnProperty.call(payload, "endDate") ? payload.endDate : cause.endDate;
  if (startDate && endDate && endDate < startDate) {
    throw createGivingError("The end date must be after the start date.", "GIVING_TIMELINE_INVALID");
  }

  const updated = await GivingCauseModel.update(cause._id || cause.id, payload);
  await audit(req, "giving.cause.updated", { causeId: toId(updated._id || updated.id) });
  return res.json({ ok: true, item: causeResponse(updated, req) });
});

router.post("/:causeId/:action", async (req, res) => {
  const cause = await loadCause(req.tenant._id, req.params.causeId);
  const action = String(req.params.action || "").trim();
  const now = new Date();
  const reviewNote = sanitizeText(String(req.body?.reviewNote || "").trim()).slice(0, 1000);
  let patch;

  if (action === "approve") {
    patch = {
      status: "active",
      approvedByUserId: req.user.id,
      approvedAt: now,
      reviewNote: "",
      fundraisingOpen: true,
      startDate: cause.startDate || now.toISOString().slice(0, 10)
    };
  } else if (action === "request-edit") {
    if (!reviewNote) throw createGivingError("Add a note explaining the requested edit.", "GIVING_REVIEW_NOTE_REQUIRED");
    patch = { status: "changes_requested", reviewNote };
  } else if (action === "reject") {
    if (!reviewNote) throw createGivingError("Add a short reason for rejecting this cause.", "GIVING_REVIEW_NOTE_REQUIRED");
    patch = { status: "rejected", reviewNote, fundraisingOpen: false };
  } else if (action === "archive") {
    patch = { status: "archived", fundraisingOpen: false };
  } else if (action === "complete") {
    patch = { status: "completed", fundraisingOpen: false };
  } else if (action === "reopen") {
    patch = { status: "active", fundraisingOpen: true };
  } else if (action === "feature") {
    patch = { featured: !cause.featured };
  } else if (action === "fundraising") {
    patch = { fundraisingOpen: !cause.fundraisingOpen };
  } else {
    throw createGivingError("Unknown giving action.", "GIVING_ACTION_INVALID", 404);
  }

  const updated = await GivingCauseModel.update(cause._id || cause.id, patch);
  await audit(req, `giving.cause.${action}`, {
    causeId: toId(updated._id || updated.id),
    reviewNote: reviewNote || undefined
  });
  return res.json({ ok: true, item: causeResponse(updated, req) });
});

export default router;
