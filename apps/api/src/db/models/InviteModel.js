import { createModel, toDoc } from "./_factory.js";
import { getSupabaseAdmin } from "../supabaseAdmin.js";

const COLUMNS = {
  id: "id",
  tenantId: "tenant_id",
  email: "email",
  token: "token",
  expiresAt: "expires_at",
  usedAt: "used_at",
  roleToAssign: "role_to_assign",
  createdByUserId: "created_by_user_id",
  usedByUserId: "used_by_user_id",
  createdAt: "created_at",
  updatedAt: "updated_at"
};

const base = createModel("invites", COLUMNS);

export const InviteModel = {
  ...base,
  COLUMNS,

  async consumeIfUnused(tenantId, inviteId, { usedByUserId = null, usedAt = new Date() } = {}) {
    const { data, error } = await getSupabaseAdmin()
      .from("invites")
      .update({
        used_at: new Date(usedAt).toISOString(),
        used_by_user_id: usedByUserId || null
      })
      .eq("tenant_id", String(tenantId || ""))
      .eq("id", String(inviteId || ""))
      .is("used_at", null)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    return toDoc(data, COLUMNS);
  }
};
