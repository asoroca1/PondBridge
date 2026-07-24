import { createModel, toDoc } from "./_factory.js";
import { getSupabaseAdmin } from "../supabaseAdmin.js";

const COLUMNS = {
  id: "id",
  tenantId: "tenant_id",
  email: "email",
  topicKey: "topic_key",
  status: "status",
  source: "source",
  unsubscribedAt: "unsubscribed_at",
  resubscribedAt: "resubscribed_at",
  metadata: "metadata",
  createdAt: "created_at",
  updatedAt: "updated_at"
};

const base = createModel("email_preferences", COLUMNS);

function normalizeEmail(value = "") {
  return String(value || "").trim().toLowerCase();
}

function normalizeTopicKey(value = "community_updates") {
  const normalized = String(value || "community_updates").trim().toLowerCase();
  return /^[a-z][a-z0-9_]{2,80}$/.test(normalized) ? normalized : "community_updates";
}

async function findPreference({ tenantId, email, topicKey }) {
  const { data, error } = await getSupabaseAdmin()
    .from("email_preferences")
    .select("*")
    .eq("tenant_id", String(tenantId || "").trim())
    .eq("email", normalizeEmail(email))
    .eq("topic_key", normalizeTopicKey(topicKey))
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? toDoc(data, COLUMNS) : null;
}

export const EmailPreferenceModel = {
  ...base,
  COLUMNS,

  async findForRecipient({ tenantId, email, topicKey = "community_updates" }) {
    return findPreference({ tenantId, email, topicKey });
  },

  async findUnsubscribedByEmails(tenantId, emails = [], topicKey = "community_updates") {
    const normalizedEmails = [...new Set((Array.isArray(emails) ? emails : [])
      .map(normalizeEmail)
      .filter(Boolean))];
    if (!tenantId || normalizedEmails.length === 0) return [];
    const { data, error } = await getSupabaseAdmin()
      .from("email_preferences")
      .select("*")
      .eq("tenant_id", String(tenantId).trim())
      .eq("topic_key", normalizeTopicKey(topicKey))
      .eq("status", "unsubscribed")
      .in("email", normalizedEmails);
    if (error) throw error;
    return (data || []).map((row) => toDoc(row, COLUMNS));
  },

  async setStatus({
    tenantId,
    email,
    topicKey = "community_updates",
    status = "unsubscribed",
    source = "recipient",
    metadata = {}
  }) {
    const normalizedTenantId = String(tenantId || "").trim();
    const normalizedEmail = normalizeEmail(email);
    const normalizedTopic = normalizeTopicKey(topicKey);
    const normalizedStatus = status === "subscribed" ? "subscribed" : "unsubscribed";
    if (!normalizedTenantId || !normalizedEmail) {
      const error = new Error("Tenant and recipient email are required.");
      error.code = "EMAIL_PREFERENCE_INPUT_INVALID";
      error.statusCode = 400;
      throw error;
    }
    const existing = await findPreference({
      tenantId: normalizedTenantId,
      email: normalizedEmail,
      topicKey: normalizedTopic
    });
    const now = new Date().toISOString();
    const row = {
      tenant_id: normalizedTenantId,
      email: normalizedEmail,
      topic_key: normalizedTopic,
      status: normalizedStatus,
      source: String(source || "recipient").trim().slice(0, 80) || "recipient",
      unsubscribed_at: normalizedStatus === "unsubscribed" ? now : existing?.unsubscribedAt || null,
      resubscribed_at: normalizedStatus === "subscribed" ? now : existing?.resubscribedAt || null,
      metadata: metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {}
    };
    let query = existing
      ? getSupabaseAdmin().from("email_preferences").update(row).eq("id", existing._id)
      : getSupabaseAdmin().from("email_preferences").insert(row);
    let result = await query.select("*").single();
    if (result.error?.code === "23505") {
      const raced = await findPreference({
        tenantId: normalizedTenantId,
        email: normalizedEmail,
        topicKey: normalizedTopic
      });
      if (raced) {
        result = await getSupabaseAdmin()
          .from("email_preferences")
          .update(row)
          .eq("id", raced._id)
          .select("*")
          .single();
      }
    }
    if (result.error) throw result.error;
    return toDoc(result.data, COLUMNS);
  }
};
