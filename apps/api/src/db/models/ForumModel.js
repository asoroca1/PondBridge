import { createModel, toDoc } from "./_factory.js";
import { getSupabaseAdmin } from "../supabaseAdmin.js";

const COLUMNS = {
  id: "id",
  tenantId: "tenant_id",
  name: "name",
  createdBy: "created_by",
  creatorId: "creator_id",
  memberIds: "member_ids",
  moderators: "moderators",
  postsCount: "posts_count",
  lastActivityAt: "last_activity_at",
  createdAt: "created_at",
  updatedAt: "updated_at"
};

const base = createModel("forums", COLUMNS);

export const ForumModel = {
  ...base,

/**
 * These helpers read-modify-write a JSON column, so they take the tenant
 * explicitly rather than trusting the caller to have scoped the read first.
 * A collection mutation reached with another camp's id now finds nothing
 * instead of quietly editing that camp's row.
 */

  async findByMember(tenantId, userId, opts = {}) {
    let query = getSupabaseAdmin()
      .from("forums")
      .select("*")
      .eq("tenant_id", tenantId)
      .contains("member_ids", [userId])
      .order("last_activity_at", { ascending: false });

    if (opts.limit) query = query.limit(opts.limit);

    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map((r) => toDoc(r, COLUMNS));
  },

  async addMember(tenantId, id, userId) {
    const doc = await base.findByIdScoped(tenantId, id);
    if (!doc) return null;
    const memberIds = doc.memberIds || [];
    if (!memberIds.includes(userId)) memberIds.push(userId);
    return base.updateScoped(tenantId, id, { memberIds });
  },

  async removeMember(tenantId, id, userId) {
    const doc = await base.findByIdScoped(tenantId, id);
    if (!doc) return null;
    const memberIds = (doc.memberIds || []).filter((m) => m !== userId);
    return base.updateScoped(tenantId, id, { memberIds });
  }
};
