import { createModel, toDoc } from "./_factory.js";
import { getSupabaseAdmin } from "../supabaseAdmin.js";

const COLUMNS = {
  id: "id",
  tenantId: "tenant_id",
  userId: "user_id",
  email: "email",
  token: "token",
  expiresAt: "expires_at",
  usedAt: "used_at",
  createdAt: "created_at",
  updatedAt: "updated_at"
};

const base = createModel("magic_link_tokens", COLUMNS);

export const MagicLinkTokenModel = {
  ...base,
  COLUMNS,

  async consumeIfUnused(tenantId, tokenId, { usedAt = new Date() } = {}) {
    const { data, error } = await getSupabaseAdmin()
      .from("magic_link_tokens")
      .update({
        used_at: new Date(usedAt).toISOString()
      })
      .eq("tenant_id", String(tenantId || ""))
      .eq("id", String(tokenId || ""))
      .is("used_at", null)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    return toDoc(data, COLUMNS);
  }
};
