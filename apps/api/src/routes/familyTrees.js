import { Router } from "express";
import { isValidObjectId } from "../utils/objectId.js";
import { requireTenantAuthScope } from "../middleware/tenantAccess.js";
import { requireFeature } from "../middleware/requireFeature.js";
import { FamilyTreeModel, RELATIONSHIP_TYPES, UserModel, ProfileModel } from "../db/models/index.js";
import { sanitizeText } from "../utils/sanitize.js";

const router = Router({ mergeParams: true });

router.use(...requireTenantAuthScope, requireFeature("familyTrees"));

function asId(value) {
  if (value && typeof value === "object") {
    return String(value.id || value._id || value.profileId || "").trim();
  }
  return String(value || "").trim();
}

function normalizeRelationshipType(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "other";
  if (RELATIONSHIP_TYPES.includes(raw)) return raw;

  if (["parent_of", "father_of", "mother_of"].includes(raw)) return "parent";
  if (["child_of", "son_of", "daughter_of"].includes(raw)) return "child";
  if (["sibling_of", "brother_of", "sister_of"].includes(raw)) return "sibling";
  if (["spouse_of", "partner_of"].includes(raw)) return "spouse";
  if (raw === "cousin_of") return "cousin";

  return "other";
}

function toClientRelationshipType(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (["parent", "grandparent"].includes(raw)) return "parent_of";
  if (["child", "grandchild"].includes(raw)) return "child_of";
  if (raw === "sibling") return "sibling_of";
  if (raw === "spouse") return "spouse_of";
  if (raw === "cousin") return "cousin_of";
  return raw || "other";
}

function dedupeRelationships(rows = []) {
  const seen = new Set();
  const unique = [];
  for (const row of rows) {
    const key = `${row.toProfileId}:${row.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }
  return unique;
}

function normalizeMembersPayload(body = {}) {
  const explicitMembers = Array.isArray(body?.members) ? body.members : [];
  if (explicitMembers.length > 0) {
    return explicitMembers
      .map((member) => {
        const profileId = asId(member?.profileId || member?.id || member?._id);
        const relationships = Array.isArray(member?.relationships) ? member.relationships : [];
        const normalizedRelationships = dedupeRelationships(
          relationships
            .map((rel) => ({
              toProfileId: asId(rel?.toProfileId || rel?.toProfileId?.id || rel?.toProfileId?._id),
              type: normalizeRelationshipType(rel?.type)
            }))
            .filter((rel) => isValidObjectId(rel.toProfileId))
        );
        return { profileId, relationships: normalizedRelationships };
      })
      .filter((member) => isValidObjectId(member.profileId));
  }

  const memberProfileIds = Array.isArray(body?.memberProfileIds)
    ? Array.from(new Set(body.memberProfileIds.map((value) => asId(value)).filter((value) => isValidObjectId(value))))
    : [];
  if (memberProfileIds.length === 0) return [];

  const relationshipBuckets = new Map(memberProfileIds.map((profileId) => [profileId, []]));
  const edges = Array.isArray(body?.edges) ? body.edges : [];

  for (const edge of edges) {
    const fromProfileId = asId(edge?.fromProfileId || edge?.from || edge?.source);
    const toProfileId = asId(edge?.toProfileId || edge?.to || edge?.target);
    if (!isValidObjectId(fromProfileId) || !isValidObjectId(toProfileId)) continue;
    if (fromProfileId === toProfileId) continue;
    if (!relationshipBuckets.has(fromProfileId) || !relationshipBuckets.has(toProfileId)) continue;

    relationshipBuckets.get(fromProfileId)?.push({
      toProfileId,
      type: normalizeRelationshipType(edge?.type)
    });
  }

  return memberProfileIds.map((profileId) => ({
    profileId,
    relationships: dedupeRelationships(relationshipBuckets.get(profileId) || [])
  }));
}

function serializeTreeForClient(tree, { reqUserId = "", currentUserProfileId = "", userRoles = [] } = {}) {
  const membersSource = Array.isArray(tree?.members) ? tree.members : [];
  const members = membersSource
    .map((member) => {
      const profileObj = member?.profileId && typeof member.profileId === "object" ? member.profileId : null;
      const profileId = asId(member?.profileId || member?.id || member?._id);
      const relationships = Array.isArray(member?.relationships) ? member.relationships : [];
      return {
        id: profileId,
        _id: profileId,
        profileId,
        firstName: String(profileObj?.firstName || profileObj?.first_name || member?.firstName || "").trim(),
        lastName: String(profileObj?.lastName || profileObj?.last_name || member?.lastName || "").trim(),
        avatarUrl: String(profileObj?.avatarUrl || profileObj?.avatar_url || member?.avatarUrl || "").trim(),
        relationships: relationships
          .map((rel) => ({
            toProfileId: asId(rel?.toProfileId),
            type: toClientRelationshipType(rel?.type)
          }))
          .filter((rel) => isValidObjectId(rel.toProfileId))
      };
    })
    .filter((member) => isValidObjectId(member.profileId));

  const edges = members.flatMap((member) =>
    (Array.isArray(member.relationships) ? member.relationships : []).map((rel) => ({
      fromProfileId: member.profileId,
      toProfileId: rel.toProfileId,
      type: rel.type
    }))
  );

  const isSuperAdmin = Array.isArray(userRoles) && userRoles.includes("super_admin");
  const isCreator = String(tree?.createdByUserId || "") === String(reqUserId || "");
  const isMember = Boolean(currentUserProfileId) && members.some((member) => member.profileId === String(currentUserProfileId));

  return {
    id: String(tree?._id || tree?.id || "").trim(),
    _id: String(tree?._id || tree?.id || "").trim(),
    name: String(tree?.name || "").trim(),
    createdBy: String(tree?.createdByUserId || "").trim(),
    createdByUserId: String(tree?.createdByUserId || "").trim(),
    members,
    edges,
    permissions: {
      canEdit: Boolean(isSuperAdmin || isCreator || isMember),
      canDelete: Boolean(isSuperAdmin || isCreator),
      isCreator,
      isMember,
      isMine: isCreator
    }
  };
}

function canEditTree(tree, userId, profileId, userRoles = []) {
  if (userRoles.includes("super_admin")) return true;
  if (String(tree.createdByUserId) === String(userId)) return true;
  return tree.members.some((member) => asId(member.profileId) === String(profileId));
}

function canDeleteTree(tree, userId, userRoles = []) {
  if (userRoles.includes("super_admin")) return true;
  return String(tree.createdByUserId) === String(userId);
}

router.get("/", async (req, res) => {
  const q = String(req.query.q || "").trim();
  const filter = {};
  if (q) {
    filter.name = { $ilike: `%${q}%` };
  }

  const trees = await FamilyTreeModel.find(req.tenant._id, filter, { sort: { name: 1 } });

  res.json({
    items: trees.map((tree) => ({
      id: String(tree._id),
      name: tree.name,
      memberCount: tree.members.length,
      createdByUserId: String(tree.createdByUserId)
    }))
  });
});

router.post("/", async (req, res) => {
  const name = sanitizeText(String(req.body.name || "").trim());
  const members = normalizeMembersPayload(req.body);

  if (!name) {
    return res.status(400).json({
      error: { code: "INVALID_INPUT", message: "Family tree name is required" }
    });
  }

  if (members.length < 2) {
    return res.status(400).json({
      error: {
        code: "INVALID_INPUT",
        message: "At least two members are required"
      }
    });
  }

  const memberProfileIds = Array.from(new Set(members.map((member) => asId(member.profileId)).filter(Boolean)));

  const foundProfiles = await ProfileModel.find(req.tenant._id, { _id: { $in: memberProfileIds } }, { select: ["id"] });

  if (foundProfiles.length !== memberProfileIds.length) {
    return res.status(400).json({
      error: {
        code: "INVALID_MEMBERS",
        message: "One or more selected profiles do not belong to this tenant"
      }
    });
  }

  const tree = await FamilyTreeModel.create({
    tenantId: req.tenant._id,
    name,
    createdByUserId: req.user.id,
    members
  });

  const hydratedTree = await FamilyTreeModel.findByIdWithProfiles(req.tenant._id, tree?._id || tree?.id);
  const currentUser = await UserModel.findOne(req.tenant._id, { _id: req.user.id });
  const serialized = serializeTreeForClient(hydratedTree || tree, {
    reqUserId: req.user.id,
    currentUserProfileId: currentUser?.profileId,
    userRoles: req.user.roles
  });

  res.status(201).json({ tree: hydratedTree || tree, ...serialized });
});

router.get("/:treeId", async (req, res) => {
  const tree = await FamilyTreeModel.findByIdWithProfiles(req.tenant._id, req.params.treeId);

  if (!tree) {
    return res.status(404).json({
      error: { code: "TREE_NOT_FOUND", message: "Family tree not found" }
    });
  }

  const currentUser = await UserModel.findOne(req.tenant._id, { _id: req.user.id });
  const serialized = serializeTreeForClient(tree, {
    reqUserId: req.user.id,
    currentUserProfileId: currentUser?.profileId,
    userRoles: req.user.roles
  });

  res.json({ tree, ...serialized });
});

router.put("/:treeId", async (req, res) => {
  const tree = await FamilyTreeModel.findOne(req.tenant._id, { _id: req.params.treeId });
  if (!tree) {
    return res.status(404).json({
      error: { code: "TREE_NOT_FOUND", message: "Family tree not found" }
    });
  }

  const currentUser = await UserModel.findOne(req.tenant._id, { _id: req.user.id });

  if (!canEditTree(tree, req.user.id, currentUser?.profileId, req.user.roles)) {
    return res.status(403).json({
      error: { code: "FORBIDDEN", message: "Only creator or members can edit this tree" }
    });
  }

  const patch = {};
  patch.name = sanitizeText(String(req.body.name || tree.name).trim());
  const requestedMembers = normalizeMembersPayload(req.body);
  if (requestedMembers.length > 0) {
    if (requestedMembers.length < 2) {
      return res.status(400).json({
        error: {
          code: "INVALID_INPUT",
          message: "At least two members are required"
        }
      });
    }

    const memberProfileIds = Array.from(
      new Set(requestedMembers.map((member) => asId(member.profileId)).filter(Boolean))
    );
    const foundProfiles = await ProfileModel.find(req.tenant._id, { _id: { $in: memberProfileIds } }, { select: ["id"] });
    if (foundProfiles.length !== memberProfileIds.length) {
      return res.status(400).json({
        error: {
          code: "INVALID_MEMBERS",
          message: "One or more selected profiles do not belong to this tenant"
        }
      });
    }
    patch.members = requestedMembers;
  }

  const updated = await FamilyTreeModel.update(tree._id, patch);
  const hydratedTree = await FamilyTreeModel.findByIdWithProfiles(req.tenant._id, updated?._id || updated?.id || tree._id);
  const serialized = serializeTreeForClient(hydratedTree || updated, {
    reqUserId: req.user.id,
    currentUserProfileId: currentUser?.profileId,
    userRoles: req.user.roles
  });

  res.json({ tree: hydratedTree || updated, ...serialized });
});

router.delete("/:treeId", async (req, res) => {
  const tree = await FamilyTreeModel.findOne(req.tenant._id, { _id: req.params.treeId });
  if (!tree) {
    return res.status(404).json({
      error: { code: "TREE_NOT_FOUND", message: "Family tree not found" }
    });
  }

  if (!canDeleteTree(tree, req.user.id, req.user.roles)) {
    return res.status(403).json({
      error: { code: "FORBIDDEN", message: "Only the creator can delete this tree" }
    });
  }

  await FamilyTreeModel.delete(tree._id);

  res.json({ ok: true, id: String(tree._id) });
});

export default router;
