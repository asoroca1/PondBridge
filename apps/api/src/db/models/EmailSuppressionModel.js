import { createModel, toDoc } from "./_factory.js";
import { getSupabaseAdmin } from "../supabaseAdmin.js";

const COLUMNS = {
  id: "id",
  email: "email",
  status: "status",
  reason: "reason",
  sourceEventType: "source_event_type",
  firstSeenAt: "first_seen_at",
  lastSeenAt: "last_seen_at",
  lastEmailId: "last_email_id",
  lastBroadcastId: "last_broadcast_id",
  tenantId: "tenant_id",
  tenantSlug: "tenant_slug",
  metadata: "metadata",
  createdAt: "created_at",
  updatedAt: "updated_at"
};

const base = createModel("email_suppressions", COLUMNS);

function normalizeEmail(value = "") {
  return String(value || "").trim().toLowerCase();
}

export const EmailSuppressionModel = {
  ...base,
  COLUMNS,

  async upsertActive({
    email,
    reason = "",
    sourceEventType = "",
    tenantId = null,
    tenantSlug = "",
    metadata = {},
    lastEmailId = "",
    lastBroadcastId = "",
    seenAt = new Date()
  }) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) return null;

    const now = new Date(seenAt).toISOString();
    const { data: existing, error: existingError } = await getSupabaseAdmin()
      .from("email_suppressions")
      .select("*")
      .eq("email", normalizedEmail)
      .limit(1)
      .maybeSingle();
    if (existingError) throw existingError;

    if (!existing) {
      const { data, error } = await getSupabaseAdmin()
        .from("email_suppressions")
        .insert({
          email: normalizedEmail,
          status: "active",
          reason: String(reason || "").trim(),
          source_event_type: String(sourceEventType || "").trim(),
          first_seen_at: now,
          last_seen_at: now,
          last_email_id: String(lastEmailId || "").trim(),
          last_broadcast_id: String(lastBroadcastId || "").trim(),
          tenant_id: tenantId ? String(tenantId) : null,
          tenant_slug: String(tenantSlug || "").trim(),
          metadata: metadata && typeof metadata === "object" ? metadata : {}
        })
        .select("*")
        .single();
      if (error) throw error;
      return toDoc(data, COLUMNS);
    }

    const mergedMetadata =
      existing?.metadata && typeof existing.metadata === "object"
        ? {
            ...existing.metadata,
            ...(metadata && typeof metadata === "object" ? metadata : {})
          }
        : metadata && typeof metadata === "object"
        ? metadata
        : {};

    const { data, error } = await getSupabaseAdmin()
      .from("email_suppressions")
      .update({
        status: "active",
        reason: String(reason || existing.reason || "").trim(),
        source_event_type: String(sourceEventType || existing.source_event_type || "").trim(),
        last_seen_at: now,
        last_email_id: String(lastEmailId || existing.last_email_id || "").trim(),
        last_broadcast_id: String(lastBroadcastId || existing.last_broadcast_id || "").trim(),
        tenant_id: tenantId ? String(tenantId) : existing.tenant_id || null,
        tenant_slug: String(tenantSlug || existing.tenant_slug || "").trim(),
        metadata: mergedMetadata
      })
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw error;
    return toDoc(data, COLUMNS);
  },

  async findActiveByEmails(emails = []) {
    const unique = [...new Set((Array.isArray(emails) ? emails : [])
      .map((value) => normalizeEmail(value))
      .filter(Boolean))];
    if (unique.length === 0) return [];

    const { data, error } = await getSupabaseAdmin()
      .from("email_suppressions")
      .select("*")
      .eq("status", "active")
      .in("email", unique);
    if (error) throw error;
    return (data || []).map((row) => toDoc(row, COLUMNS));
  },

  async isSuppressed(email = "") {
    const normalized = normalizeEmail(email);
    if (!normalized) return false;
    const { data, error } = await getSupabaseAdmin()
      .from("email_suppressions")
      .select("id")
      .eq("email", normalized)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return Boolean(data?.id);
  }
};

