import { jest } from "@jest/globals";
import express from "express";
import request from "supertest";
const tenantId = "64a000000000000000000001";
const userId = "64a000000000000000000002";
const visibleId = "64a000000000000000000003";
const hiddenId = "64a000000000000000000004";
const treeId = "64a000000000000000000005";
const tree = { _id: treeId, tenantId, name: "Family", createdByUserId: userId, members: [
  { profileId: visibleId, relationships: [{ toProfileId: hiddenId, type: "sibling" }] },
  { profileId: hiddenId, relationships: [] }
] };
const hydrated = { ...tree, members: tree.members.map((m) => ({ ...m, profileId: { _id: m.profileId, firstName: m.profileId === hiddenId ? "Hidden" : "Visible" } })) };
const treeModel = { findOne: jest.fn(), findByIdWithProfiles: jest.fn(), create: jest.fn(), updateScoped: jest.fn() };
const hiddenProfiles = jest.fn();
const hiddenUsers = jest.fn();
jest.unstable_mockModule("../src/middleware/tenantAccess.js", () => ({ requireTenantAuthScope: [(req, _res, next) => {
  req.tenant = { _id: tenantId }; req.user = { id: userId, roles: ["user"] }; next();
}] }));
jest.unstable_mockModule("../src/middleware/requireFeature.js", () => ({ requireFeature: () => (_req, _res, next) => next() }));
jest.unstable_mockModule("../src/services/memberTiers.js", () => ({ hiddenProfileIdSetFor: hiddenProfiles, hiddenUserIdSetFor: hiddenUsers }));
jest.unstable_mockModule("../src/db/models/index.js", () => ({
  FamilyTreeModel: treeModel, RELATIONSHIP_TYPES: ["sibling"],
  UserModel: { findOne: jest.fn(async () => ({ profileId: visibleId })) },
  ProfileModel: { find: jest.fn(async () => [{ id: visibleId }, { id: hiddenId }]) }
}));
const { default: router } = await import("../src/routes/familyTrees.js");
const app = express(); app.use(express.json()); app.use(router);
beforeEach(() => {
  jest.clearAllMocks();
  hiddenProfiles.mockResolvedValue(new Set([hiddenId])); hiddenUsers.mockResolvedValue(new Set());
  treeModel.findOne.mockResolvedValue(tree); treeModel.findByIdWithProfiles.mockResolvedValue(hydrated);
  treeModel.create.mockResolvedValue(tree); treeModel.updateScoped.mockResolvedValue(tree);
});

test.each(["post", "put"])("%s cannot inject a known hidden member ID into a tree", async (method) => {
  const response = await request(app)[method](method === "post" ? "/" : `/${treeId}`).send({ name: "Family", memberProfileIds: [visibleId, hiddenId] });
  expect(response.status).toBe(400);
  expect(treeModel.create).not.toHaveBeenCalled(); expect(treeModel.updateScoped).not.toHaveBeenCalled();
});

test("renaming one's existing tree does not reveal members hidden since its creation", async () => {
  const response = await request(app).put(`/${treeId}`).send({ name: "Renamed" });
  expect(response.status).toBe(200);
  expect(JSON.stringify(response.body)).not.toContain(hiddenId);
  expect(JSON.stringify(response.body)).not.toContain("Hidden");
  expect(response.body.tree.members).toHaveLength(1);
});

test("GET strips hidden relationship references as well as members", async () => {
  const response = await request(app).get(`/${treeId}`);
  expect(response.status).toBe(200); expect(JSON.stringify(response.body)).not.toContain(hiddenId);
});

test("a member cannot edit a tree whose creator is hidden from their tier", async () => {
  hiddenUsers.mockResolvedValue(new Set([userId]));
  const response = await request(app).put(`/${treeId}`).send({ name: "Renamed" });
  expect(response.status).toBe(404); expect(treeModel.updateScoped).not.toHaveBeenCalled();
});

test("ordinary visible-member tree creation still succeeds", async () => {
  hiddenProfiles.mockResolvedValue(new Set());
  const response = await request(app).post("/").send({ name: "Family", memberProfileIds: [visibleId, hiddenId] });
  expect(response.status).toBe(201); expect(response.body.tree.members).toHaveLength(2);
});
