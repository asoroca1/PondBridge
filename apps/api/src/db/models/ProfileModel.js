import { createModel, toDoc } from "./_factory.js";
import { getSupabaseAdmin } from "../supabaseAdmin.js";

const COLUMNS = {
  id: "id",
  tenantId: "tenant_id",
  userId: "user_id",
  firstName: "first_name",
  lastName: "last_name",
  emails: "emails",
  phones: "phones",
  cityState: "city_state",
  roleAtCamp: "role_at_camp",
  highSchool: "high_school",
  colleges: "colleges",
  collegeYears: "college_years",
  currentJobs: "current_jobs",
  pastJobs: "past_jobs",
  industry: "industry",
  socials: "socials",
  avatarUrl: "avatar_url",
  bio: "bio",
  status: "status",
  flaggedReason: "flagged_reason",
  createdAt: "created_at",
  updatedAt: "updated_at"
};

const base = createModel("profiles", COLUMNS);

export const ProfileModel = {
  ...base,
  COLUMNS,

  async search(tenantId, query, opts = {}) {
    const { data, error } = await getSupabaseAdmin().rpc("search_profiles", {
      p_tenant_id: tenantId,
      p_query: query || "",
      p_role_at_camp: opts.roleAtCamp || null,
      p_industry: opts.industry || null,
      p_city_state: opts.cityState || null,
      p_limit: opts.limit || 30
    });
    if (error) throw error;
    return (data || []).map((r) => toDoc(r, COLUMNS));
  },

  async findByUserId(tenantId, userId) {
    const { data, error } = await getSupabaseAdmin()
      .from("profiles")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    return toDoc(data, COLUMNS);
  }
};
