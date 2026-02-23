import { createModel, toDoc } from "./_factory.js";
import { getSupabaseAdmin } from "../supabaseAdmin.js";

const COLUMNS = {
  id: "id",
  tenantId: "tenant_id",
  type: "type",
  participantIds: "participant_ids",
  name: "name",
  createdBy: "created_by",
  lastMessageAt: "last_message_at",
  lastMessage: "last_message",
  members: "members",
  readBy: "read_by",
  createdAt: "created_at",
  updatedAt: "updated_at"
};

const base = createModel("conversations", COLUMNS);

export const ConversationModel = {
  ...base,

  async findByParticipant(tenantId, userId, opts = {}) {
    let query = getSupabaseAdmin()
      .from("conversations")
      .select("*")
      .eq("tenant_id", tenantId)
      .contains("participant_ids", [userId])
      .order("last_message_at", { ascending: false });

    if (opts.limit) query = query.limit(opts.limit);
    if (opts.offset) query = query.range(opts.offset, opts.offset + (opts.limit || 50) - 1);

    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map((r) => toDoc(r, COLUMNS));
  },

  async findDm(tenantId, participantIds) {
    const sorted = [...participantIds].sort();
    const { data, error } = await getSupabaseAdmin()
      .from("conversations")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("type", "dm")
      .contains("participant_ids", sorted)
      .maybeSingle();
    if (error) throw error;
    return toDoc(data, COLUMNS);
  }
};
