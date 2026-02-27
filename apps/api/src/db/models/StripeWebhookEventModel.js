import { createModel, toDoc } from "./_factory.js";
import { getSupabaseAdmin } from "../supabaseAdmin.js";

const COLUMNS = {
  id: "id",
  stripeEventId: "stripe_event_id",
  eventType: "event_type",
  processingStatus: "processing_status",
  processedAt: "processed_at",
  failedAt: "failed_at",
  tenantId: "tenant_id",
  tenantSlug: "tenant_slug",
  stripeCustomerId: "stripe_customer_id",
  stripeSubscriptionId: "stripe_subscription_id",
  payload: "payload",
  errorCode: "error_code",
  errorMessage: "error_message",
  attempts: "attempts",
  createdAt: "created_at",
  updatedAt: "updated_at"
};

const base = createModel("stripe_webhook_events", COLUMNS);

function normalizeEventId(value = "") {
  return String(value || "").trim();
}

function normalizePayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
}

function normalizeErrorMessage(value = "") {
  return String(value || "").trim().slice(0, 500);
}

function isUniqueConstraintError(error) {
  return String(error?.code || "").trim() === "23505";
}

function receiptUpdatePayload(existing = {}, next = {}) {
  const attempts = Number(existing?.attempts || 1);
  return {
    event_type: String(next.eventType || existing.eventType || "").trim(),
    payload: normalizePayload(next.payload),
    attempts: Number.isFinite(attempts) ? attempts + 1 : 2
  };
}

function tenantContextPatch({
  tenantId = "",
  tenantSlug = "",
  stripeCustomerId = "",
  stripeSubscriptionId = ""
} = {}) {
  const patch = {};
  if (tenantId) patch.tenant_id = String(tenantId).trim();
  if (tenantSlug) patch.tenant_slug = String(tenantSlug).trim();
  if (stripeCustomerId) patch.stripe_customer_id = String(stripeCustomerId).trim();
  if (stripeSubscriptionId) patch.stripe_subscription_id = String(stripeSubscriptionId).trim();
  return patch;
}

export const StripeWebhookEventModel = {
  ...base,
  COLUMNS,

  async findByStripeEventId(stripeEventId) {
    const normalized = normalizeEventId(stripeEventId);
    if (!normalized) return null;

    const { data, error } = await getSupabaseAdmin()
      .from("stripe_webhook_events")
      .select("*")
      .eq("stripe_event_id", normalized)
      .maybeSingle();
    if (error) throw error;
    return toDoc(data, COLUMNS);
  },

  async recordReceipt({
    stripeEventId,
    eventType = "",
    payload = {},
    tenantId = "",
    tenantSlug = "",
    stripeCustomerId = "",
    stripeSubscriptionId = ""
  }) {
    const normalizedEventId = normalizeEventId(stripeEventId);
    if (!normalizedEventId) {
      const error = new Error("Stripe webhook event ID is required.");
      error.code = "STRIPE_EVENT_ID_REQUIRED";
      throw error;
    }

    const contextPatch = tenantContextPatch({
      tenantId,
      tenantSlug,
      stripeCustomerId,
      stripeSubscriptionId
    });
    const existing = await this.findByStripeEventId(normalizedEventId);
    if (existing) {
      const updatePayload = {
        ...receiptUpdatePayload(existing, {
          eventType,
          payload
        }),
        ...contextPatch
      };

      const { data, error } = await getSupabaseAdmin()
        .from("stripe_webhook_events")
        .update(updatePayload)
        .eq("stripe_event_id", normalizedEventId)
        .select("*")
        .maybeSingle();
      if (error) throw error;
      return toDoc(data, COLUMNS);
    }

    const row = {
      stripe_event_id: normalizedEventId,
      event_type: String(eventType || "").trim(),
      payload: normalizePayload(payload),
      processing_status: "received",
      attempts: 1,
      ...contextPatch
    };

    try {
      const { data, error } = await getSupabaseAdmin()
        .from("stripe_webhook_events")
        .insert(row)
        .select("*")
        .single();
      if (error) throw error;
      return toDoc(data, COLUMNS);
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;

      const raced = await this.findByStripeEventId(normalizedEventId);
      if (!raced) throw error;

      const updatePayload = {
        ...receiptUpdatePayload(raced, {
          eventType,
          payload
        }),
        ...contextPatch
      };
      const { data, error: updateError } = await getSupabaseAdmin()
        .from("stripe_webhook_events")
        .update(updatePayload)
        .eq("stripe_event_id", normalizedEventId)
        .select("*")
        .maybeSingle();
      if (updateError) throw updateError;
      return toDoc(data, COLUMNS);
    }
  },

  async markProcessed(
    stripeEventId,
    {
      tenantId = "",
      tenantSlug = "",
      stripeCustomerId = "",
      stripeSubscriptionId = ""
    } = {}
  ) {
    const normalizedEventId = normalizeEventId(stripeEventId);
    if (!normalizedEventId) return null;

    const { data, error } = await getSupabaseAdmin()
      .from("stripe_webhook_events")
      .update({
        processing_status: "processed",
        processed_at: new Date().toISOString(),
        failed_at: null,
        error_code: "",
        error_message: "",
        ...tenantContextPatch({
          tenantId,
          tenantSlug,
          stripeCustomerId,
          stripeSubscriptionId
        })
      })
      .eq("stripe_event_id", normalizedEventId)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    return toDoc(data, COLUMNS);
  },

  async markFailed(
    stripeEventId,
    errorValue,
    {
      tenantId = "",
      tenantSlug = "",
      stripeCustomerId = "",
      stripeSubscriptionId = ""
    } = {}
  ) {
    const normalizedEventId = normalizeEventId(stripeEventId);
    if (!normalizedEventId) return null;

    const { data, error } = await getSupabaseAdmin()
      .from("stripe_webhook_events")
      .update({
        processing_status: "failed",
        failed_at: new Date().toISOString(),
        error_code: String(errorValue?.code || "").trim(),
        error_message: normalizeErrorMessage(errorValue?.message || "Webhook processing failed."),
        ...tenantContextPatch({
          tenantId,
          tenantSlug,
          stripeCustomerId,
          stripeSubscriptionId
        })
      })
      .eq("stripe_event_id", normalizedEventId)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    return toDoc(data, COLUMNS);
  }
};
