import { createModel, toDoc } from "./_factory.js";
import { getSupabaseAdmin } from "../supabaseAdmin.js";

const COLUMNS = {
  id: "id",
  tenantId: "tenant_id",
  clerkUserId: "clerk_user_id",
  email: "email",
  passwordHash: "password_hash",
  roles: "roles",
  profileId: "profile_id",
  status: "status",
  lastLoginAt: "last_login_at",
  createdAt: "created_at",
  updatedAt: "updated_at"
};

const base = createModel("users", COLUMNS);

async function queryFirstUser(query) {
  const { data, error } = await query.order("created_at", { ascending: true }).limit(1);
  if (error) throw error;
  return toDoc((data || [])[0], COLUMNS);
}

export const UserModel = {
  ...base,

  async findByEmail(tenantId, email) {
    return queryFirstUser(
      getSupabaseAdmin()
      .from("users")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("email", email.toLowerCase().trim())
    );
  },

  async findSuperAdmin(email) {
    return queryFirstUser(
      getSupabaseAdmin()
      .from("users")
      .select("*")
      .eq("email", email.toLowerCase().trim())
      .overlaps("roles", ["super_admin", "support_admin", "finance_admin"])
    );
  },

  async findByClerkUserId(tenantId, clerkUserId) {
    return queryFirstUser(
      getSupabaseAdmin()
      .from("users")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("clerk_user_id", String(clerkUserId || "").trim())
    );
  },

  async findGlobalByClerkUserId(clerkUserId) {
    return queryFirstUser(
      getSupabaseAdmin()
      .from("users")
      .select("*")
      .is("tenant_id", null)
      .eq("clerk_user_id", String(clerkUserId || "").trim())
    );
  },

  async findMembershipsByClerkUserId(clerkUserId) {
    const { data, error } = await getSupabaseAdmin()
      .from("users")
      .select("*")
      .eq("clerk_user_id", String(clerkUserId || "").trim())
      .not("tenant_id", "is", null);
    if (error) throw error;
    return (data || []).map((row) => toDoc(row, COLUMNS));
  },

  async findMembershipsByEmail(email) {
    const { data, error } = await getSupabaseAdmin()
      .from("users")
      .select("*")
      .eq("email", String(email || "").trim().toLowerCase())
      .not("tenant_id", "is", null);
    if (error) throw error;
    return (data || []).map((row) => toDoc(row, COLUMNS));
  }
};
