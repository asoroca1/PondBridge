import { Router } from "express";
import { isValidObjectId } from "../utils/objectId.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireTenant } from "../middleware/tenantContext.js";
import { requireFeature } from "../middleware/requireFeature.js";
import { FamilyTreeModel, RELATIONSHIP_TYPES, UserModel, ProfileModel } from "../db/models/index.js";

const router = Router({ mergeParams: true });

router.use(requireAuth, requireTenant, requireFeature("familyTrees"));

function asId(value) {
  return String(value || "").trim();
}

function canEditTree(tree, userId, profileId, userRoles = []) {
  if (userRoles.includes("super_admin")) return true;
  if (String(tree.createdByUserId) === String(userId)) return true;
  return tree.members.some((member) => String(member.profileId) === String(profileId));
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
  const name = String(req.body.name || "").trim();
  const members = Array.isArray(req.body.members) ? req.body.members : [];

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

  const memberProfileIds = members.map((member) => asId(member.profileId));

  const foundProfiles = await ProfileModel.find(req.tenant._id, { _id: { $in: memberProfileIds } }, { select: ["id"] });

  if (foundProfiles.length !== memberProfileIds.length) {
    return res.status(400).json({
      error: {
        code: "INVALID_MEMBERS",
        message: "One or more selected profiles do not belong to this tenant"
      }
    });
  }

  const normalizedMembers = members.map((member) => ({
    profileId: member.profileId,
    relationships: Array.isArray(member.relationships)
      ? member.relationships
          .map((rel) => ({
            toProfileId: rel.toProfileId,
            type: RELATIONSHIP_TYPES.includes(rel.type) ? rel.type : "other"
          }))
          .filter((rel) => isValidObjectId(rel.toProfileId))
      : []
  }));

  const tree = await FamilyTreeModel.create({
    tenantId: req.tenant._id,
    name,
    createdByUserId: req.user.id,
    members: normalizedMembers
  });

  res.status(201).json({ tree });
});

router.get("/:treeId", async (req, res) => {
  const tree = await FamilyTreeModel.findByIdWithProfiles(req.tenant._id, req.params.treeId);

  if (!tree) {
    return res.status(404).json({
      error: { code: "TREE_NOT_FOUND", message: "Family tree not found" }
    });
  }

  res.json({ tree });
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
  patch.name = String(req.body.name || tree.name).trim();
  if (Array.isArray(req.body.members) && req.body.members.length > 0) {
    patch.members = req.body.members.map((member) => ({
      profileId: member.profileId,
      relationships: Array.isArray(member.relationships)
        ? member.relationships.map((rel) => ({
            toProfileId: rel.toProfileId,
            type: RELATIONSHIP_TYPES.includes(rel.type) ? rel.type : "other"
          }))
        : []
    }));
  }

  const updated = await FamilyTreeModel.update(tree._id, patch);
  res.json({ tree: updated });
});

export default router;
