import { createModel } from "./_factory.js";
import { getSupabaseAdmin } from "../supabaseAdmin.js";

const COLUMNS = {
  id: "id",
  tenantId: "tenant_id",
  userId: "user_id",
  eventType: "event_type",
  metadata: "metadata",
  createdAt: "created_at",
  updatedAt: "updated_at"
};

const base = createModel("analytics_events", COLUMNS);

export const AnalyticsEventModel = {
  ...base,

  async topSearchTerms(tenantId, since, limit = 25) {
    const { data, error } = await getSupabaseAdmin().rpc("top_search_terms", {
      p_tenant_id: tenantId,
      p_since: since instanceof Date ? since.toISOString() : since,
      p_limit: limit
    });
    if (error) throw error;
    return data || [];
  },

  async distinctActiveUserIds(tenantId, eventTypes, since) {
    const { data, error } = await getSupabaseAdmin().rpc("distinct_active_user_ids", {
      p_tenant_id: tenantId,
      p_event_types: eventTypes,
      p_since: since instanceof Date ? since.toISOString() : since
    });
    if (error) throw error;
    return data || [];
  },

  async hasEventWithSession(tenantId, eventType, sessionId) {
    if (!tenantId || !eventType || !sessionId) return false;
    const { data, error } = await getSupabaseAdmin()
      .from("analytics_events")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("event_type", String(eventType))
      .contains("metadata", { sessionId: String(sessionId) })
      .limit(1);
    if (error) throw error;
    return Boolean((data || []).length);
  }
};
