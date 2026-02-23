import { createModel } from "./_factory.js";
import { getSupabaseAdmin } from "../supabaseAdmin.js";

const COLUMNS = {
  id: "id",
  tenantId: "tenant_id",
  name: "name",
  createdByUserId: "created_by_user_id",
  members: "members",
  createdAt: "created_at",
  updatedAt: "updated_at"
};

const base = createModel("family_trees", COLUMNS);

export const RELATIONSHIP_TYPES = [
  "parent", "child", "sibling", "spouse",
  "cousin", "grandparent", "grandchild", "other"
];

export const FamilyTreeModel = {
  ...base,

  async findByIdWithProfiles(tenantId, treeId) {
    const tree = await base.findOne(tenantId, { _id: treeId });
    if (!tree) return null;

    const profileIds = (tree.members || []).map((m) => m.profileId).filter(Boolean);
    if (profileIds.length === 0) return tree;

    const { data, error } = await getSupabaseAdmin()
      .from("profiles")
      .select("id, first_name, last_name, avatar_url")
      .in("id", profileIds);
    if (error) throw error;

    const profileMap = new Map(
      (data || []).map((r) => [
        r.id,
        { _id: r.id, id: r.id, firstName: r.first_name, lastName: r.last_name, avatarUrl: r.avatar_url }
      ])
    );

    tree.members = (tree.members || []).map((m) => ({
      ...m,
      profileId: profileMap.get(m.profileId) || m.profileId
    }));

    return tree;
  }
};
