import bcrypt from "bcryptjs";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { ProfileModel, UserModel, ImportReportModel } from "../src/db/models/index.js";
import { runTenantCsvImport } from "../src/services/csvImport.js";

const mapping = { First: "firstName", Last: "lastName", Email: "email" };
const rows = Array.from({ length: 600 }, (_, index) => `Person${index},Synthetic,person${index}@example.test`);
function csv(records) { return Buffer.from(["First,Last,Email", ...records].join("\n")); }
function readFixture(profiles = [], users = []) {
  jest.spyOn(ProfileModel, "findAllBatched").mockImplementation(async function* (tenantId) {
    expect(tenantId).toBe("synthetic-camp");
    for (let offset = 0; offset < profiles.length; offset += 1000) yield profiles.slice(offset, offset + 1000);
  });
  jest.spyOn(UserModel, "findAllBatched").mockImplementation(async function* (tenantId) {
    expect(tenantId).toBe("synthetic-camp");
    for (let offset = 0; offset < users.length; offset += 1000) yield users.slice(offset, offset + 1000);
  });
  for (const model of [ProfileModel, UserModel, ImportReportModel]) {
    for (const method of ["create", "update", "delete"]) {
      jest.spyOn(model, method).mockImplementation(() => { throw new Error("Dry run attempted a write"); });
    }
  }
}
const preview = (records) => runTenantCsvImport({ tenantId: "synthetic-camp", userId: "synthetic-director", csvBuffer: csv(records), mapping, options: { dryRun: true } });
afterEach(() => jest.restoreAllMocks());

describe("600-person questionnaire rehearsal without a database", () => {
  test("counts all 600 new people with no writes", async () => {
    readFixture();
    const hashing = jest.spyOn(bcrypt, "hash");
    const result = await preview(rows);
    expect(hashing).not.toHaveBeenCalled();
    expect(result).toMatchObject({ rowsRead: 600, createdCount: 600, updatedCount: 0, skippedDuplicates: 0, errorCount: 0 });
    expect(result.dispositions).toHaveLength(600);
    expect(result.reportId).toBe("");
  });

  test("retains the 600 unique responses while reporting duplicates and invalid addresses", async () => {
    readFixture();
    const result = await preview([...rows, ...rows.slice(0, 5), "Invalid,Synthetic,not-an-email"]);
    expect(result).toMatchObject({ rowsRead: 606, createdCount: 600, skippedDuplicates: 5, errorCount: 1 });
    expect(result.dispositions.filter((row) => row.reason === "repeated_in_file")).toHaveLength(5);
  });

  test("recognises existing people past the first 1000 tenant accounts", async () => {
    const users = Array.from({ length: 1200 }, (_, index) => ({ _id: `u${index}`, email: `person${index}@example.test` }));
    const profiles = users.map((user, index) => ({ _id: `p${index}`, userId: user._id, firstName: `Person${index}`, lastName: "Synthetic", emails: [user.email] }));
    readFixture(profiles, users);
    const result = await preview(Array.from({ length: 600 }, (_, index) => `Person${index + 600},Synthetic,person${index + 600}@example.test`));
    expect(result).toMatchObject({ rowsRead: 600, createdCount: 0, updatedCount: 0, skippedDuplicates: 600, errorCount: 0 });
  });

  test("commits 600 people with one discarded-secret password hash and complete row counts", async () => {
    readFixture();
    const hashing = jest.spyOn(bcrypt, "hash").mockResolvedValue("synthetic-bcrypt-hash");
    let userNumber = 0;
    let profileNumber = 0;
    UserModel.create.mockImplementation(async (data) => ({ ...data, _id: `u${++userNumber}` }));
    ProfileModel.create.mockImplementation(async (data) => ({ ...data, _id: `p${++profileNumber}` }));
    UserModel.update.mockResolvedValue({});
    ImportReportModel.create.mockImplementation(async (data) => ({ ...data, _id: "report-synthetic" }));
    ImportReportModel.update.mockResolvedValue({});
    const result = await runTenantCsvImport({ tenantId: "synthetic-camp", userId: "synthetic-director", csvBuffer: csv(rows), mapping });
    expect(result).toMatchObject({ rowsRead: 600, createdCount: 600, updatedCount: 0, skippedDuplicates: 0, errorCount: 0 });
    expect(hashing).toHaveBeenCalledTimes(1);
    expect(Buffer.from(hashing.mock.calls[0][0], "base64url")).toHaveLength(32);
    expect(UserModel.create).toHaveBeenCalledTimes(600);
    expect(ProfileModel.create).toHaveBeenCalledTimes(600);
    expect(UserModel.update).toHaveBeenCalledTimes(600);
    for (const [data] of UserModel.create.mock.calls) {
      expect(data.passwordHash).toBe("synthetic-bcrypt-hash");
      expect(JSON.stringify(data)).not.toContain(hashing.mock.calls[0][0]);
    }
    expect(ImportReportModel.update).toHaveBeenCalledWith("report-synthetic", expect.objectContaining({
      summary: { rowsRead: 600, createdCount: 600, updatedCount: 0, skippedDuplicates: 0, errorCount: 0 }
    }));
  });

  test("rejects over 2000 responses before loading tenant accounts", async () => {
    readFixture();
    await expect(preview(Array.from({ length: 2001 }, (_, index) => `Person${index},Synthetic,person${index}@example.test`)))
      .rejects.toMatchObject({ code: "IMPORT_TOO_MANY_ROWS" });
    expect(ProfileModel.findAllBatched).not.toHaveBeenCalled();
  });
});
