import { createModel, toDoc } from "./_factory.js";
import { getSupabaseAdmin } from "../supabaseAdmin.js";

const COLUMNS = {
  id: "id",
  svixId: "svix_id",
  eventType: "event_type",
  emailId: "email_id",
  broadcastId: "broadcast_id",
  recipientEmail: "recipient_email",
  tenantId: "tenant_id",
  tenantSlug: "tenant_slug",
  occurredAt: "occurred_at",
  payload: "payload",
  createdAt: "created_at",
  updatedAt: "updated_at"
};

const base = createModel("resend_webhook_events", COLUMNS);

function normalizeEmail(value = "") {
  return String(value || "").trim().toLowerCase();
}

export const ResendWebhookEventModel = {
  ...base,
  COLUMNS,

  async insertUnique({
    svixId,
    eventType,
    emailId = "",
    broadcastId = "",
    recipientEmail = "",
    tenantId = null,
    tenantSlug = "",
    occurredAt = null,
    payload = {}
  }) {
    const row = {
      svix_id: String(svixId || "").trim(),
      event_type: String(eventType || "").trim(),
      email_id: String(emailId || "").trim(),
      broadcast_id: String(broadcastId || "").trim(),
      recipient_email: normalizeEmail(recipientEmail),
      tenant_id: tenantId ? String(tenantId) : null,
      tenant_slug: String(tenantSlug || "").trim(),
      occurred_at: occurredAt ? new Date(occurredAt).toISOString() : null,
      payload: payload && typeof payload === "object" ? payload : {}
    };

    const { data, error } = await getSupabaseAdmin()
      .from("resend_webhook_events")
      .upsert(row, {
        onConflict: "svix_id,recipient_email",
        ignoreDuplicates: true
      })
      .select("*")
      .maybeSingle();

    if (error) throw error;
    return toDoc(data, COLUMNS);
  }
};

