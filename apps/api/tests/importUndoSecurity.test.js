import { jest } from "@jest/globals";
const tenantId = "camp-a";
const reportId = "report-a";
const profile = { _id: "profile-a", userId: "user-a", status: "pending", socials: { importedFrom: { reportId } } };
let profiles = [profile];
const deleteUnclaimedImport = jest.fn();
const userDelete = jest.fn();
const profileDelete = jest.fn();
const findReport = jest.fn();
jest.unstable_mockModule("../src/db/models/index.js", () => ({
  UserModel: { delete: userDelete },
  ProfileModel: {
    delete: profileDelete, deleteUnclaimedImport,
    findAllBatched: async function* () { yield profiles; }
  },
  ImportReportModel: { findOne: findReport, update: jest.fn(async () => ({})) }
}));
const { undoTenantImport } = await import("../src/services/csvImport.js");
beforeEach(() => { profiles = [profile]; jest.clearAllMocks(); findReport.mockResolvedValue({ _id: reportId, summary: {} }); });

test.each(["claimed", "protected"])("a stale pending snapshot cannot delete an account now marked %s", async (outcome) => {
  deleteUnclaimedImport.mockResolvedValue(outcome);
  await expect(undoTenantImport({ tenantId, reportId })).resolves.toMatchObject({ removedCount: 0, keptClaimedCount: 1 });
  expect(deleteUnclaimedImport).toHaveBeenCalledWith(tenantId, profile._id, reportId);
  expect(profileDelete).not.toHaveBeenCalled(); expect(userDelete).not.toHaveBeenCalled();
});

test("successful transaction is the only event counted as removed", async () => {
  deleteUnclaimedImport.mockResolvedValue("removed");
  await expect(undoTenantImport({ tenantId, reportId })).resolves.toMatchObject({ removedCount: 1, keptClaimedCount: 0 });
});

test("a missing migration fails closed without falling back to separate deletes", async () => {
  deleteUnclaimedImport.mockRejectedValue(new Error("RPC not deployed"));
  const result = await undoTenantImport({ tenantId, reportId });
  expect(result.removedCount).toBe(0); expect(result.failures).toHaveLength(1);
  expect(profileDelete).not.toHaveBeenCalled(); expect(userDelete).not.toHaveBeenCalled();
});

test("a guessed report from another camp never reaches a mutation", async () => {
  findReport.mockResolvedValue(null);
  await expect(undoTenantImport({ tenantId, reportId: "report-other" })).rejects.toMatchObject({ code: "IMPORT_REPORT_NOT_FOUND" });
  expect(findReport).toHaveBeenCalledWith(tenantId, { _id: "report-other" });
  expect(deleteUnclaimedImport).not.toHaveBeenCalled();
});


test("600-row undo bounds concurrency and keeps mixed failures in source order", async () => {
  profiles = Array.from({ length: 600 }, (_, index) => ({ ...profile, _id: `profile-${index}`, userId: `user-${index}` }));
  let active = 0;
  let peak = 0;
  deleteUnclaimedImport.mockImplementation(async (actualTenant, id, actualReport) => {
    expect(actualTenant).toBe(tenantId);
    expect(actualReport).toBe(reportId);
    active += 1;
    peak = Math.max(peak, active);
    const index = Number(id.slice("profile-".length));
    await new Promise((resolve) => setTimeout(resolve, index === 0 ? 10 : 0));
    active -= 1;
    if (index < 2) throw new Error("Synthetic failure");
    return index === 2 ? "protected" : "removed";
  });
  const result = await undoTenantImport({ tenantId, reportId });
  expect(peak).toBe(8);
  expect(deleteUnclaimedImport).toHaveBeenCalledTimes(600);
  expect(result).toMatchObject({ matchedCount: 600, removedCount: 597, keptClaimedCount: 1 });
  expect(result.failures.map((failure) => failure.profileId)).toEqual(["profile-0", "profile-1"]);
  expect(profileDelete).not.toHaveBeenCalled();
  expect(userDelete).not.toHaveBeenCalled();
});
