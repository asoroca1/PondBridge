import { jest } from "@jest/globals";

/**
 * Every surface that reports "how many members" must report the same number, and that
 * number must be the tenant's real size.
 *
 * The bug this locks down shipped to production: PostgREST returns at most 1,000 rows
 * for a query with no limit and says nothing about it, so any surface that derived a
 * total from `rows.length` reported 1,000 for a 3,003-member camp — member browse, the
 * home tile, the alumni map, the director's People list, and the audience for an email.
 * Every one of those numbers looked plausible.
 *
 * The fake below reproduces the ceiling exactly: `find()` without a limit returns the
 * first PAGE_CAP rows, `findAllBatched()` walks the whole table, and `count()` knows the
 * truth. So a caller that goes back to `find().length` fails here with 1,000, which is
 * precisely how it failed in production.
 */

const PAGE_CAP = 1000;
const TENANT_SIZE = 3003;
const TENANT_ID = "tenant_cedar";

function makeRows(size) {
  return Array.from({ length: size }, (_, index) => {
    const base = {
      _id: `p${index + 1}`,
      id: `p${index + 1}`,
      tenantId: TENANT_ID,
      userId: `u${index + 1}`,
      status: "active",
      firstName: "Member",
      lastName: String(index + 1),
      emails: [`member${index + 1}@example.test`]
    };
    // Everyone inside the first page has a bare profile; everyone past it has a full
    // one. An average taken over the first page alone is therefore a different number,
    // which is what lets the assertion below tell a truncated read from a complete one.
    if (index < PAGE_CAP) return base;
    return {
      ...base,
      phones: ["555-0100"],
      cityState: "Boston, MA",
      roleAtCamp: "Counselor",
      highSchool: "Newton North",
      colleges: ["Tufts"],
      currentJobs: [{ title: "Engineer" }]
    };
  });
}

function cappedModel(rows) {
  return {
    // What PostgREST actually does: an unlimited read stops at the ceiling, silently.
    async find(_tenantId, _filter = {}, options = {}) {
      const limit = options.limit || PAGE_CAP;
      const offset = options.offset || 0;
      return rows.slice(offset, offset + Math.min(limit, PAGE_CAP));
    },
    async *findAllBatched(_tenantId, _filter = {}, options = {}) {
      const size = Math.min(options.batchSize || 500, PAGE_CAP);
      for (let i = 0; i < rows.length; i += size) yield rows.slice(i, i + size);
    },
    async count() {
      return rows.length;
    },
    // Aggregates the analytics snapshot also asks for; empty is fine, they are not what
    // this test is about.
    async distinctActiveUserIds() {
      return [];
    },
    async topSearchTerms() {
      return [];
    },
    async hasEventWithSession() {
      return false;
    },
    async create(doc) {
      return doc;
    },
    async findOne() {
      return null;
    },
    async acrossTenants() {
      return [];
    },
    async insertMany(docs = []) {
      return docs;
    },
    async update(id, patch) {
      return { _id: id, ...patch };
    },
    async updateMany() {
      return [];
    }
  };
}

const profileRows = makeRows(TENANT_SIZE);
const userRows = makeRows(TENANT_SIZE);

jest.unstable_mockModule("../src/db/models/index.js", () => ({
  ProfileModel: cappedModel(profileRows),
  UserModel: cappedModel(userRows),
  AnalyticsEventModel: cappedModel([]),
  MobileNotificationDeviceModel: cappedModel([]),
  MobileNotificationPreferenceModel: cappedModel([]),
  MobileNotificationModel: cappedModel([]),
  MobileNotificationScheduleModel: cappedModel([]),
  MobileNotificationTemplateModel: cappedModel([]),
  TenantModel: cappedModel([])
}));

const { countActiveAlumni } = await import("../src/services/alumniTotals.js");
const { getTenantAnalyticsSnapshot } = await import("../src/services/analytics.js");
const { resolveAudienceUserIds } = await import("../src/services/mobileNotifications.js");

describe("the ceiling this test exists for", () => {
  test("an unlimited find() really does stop at the cap, so these assertions mean something", async () => {
    const { ProfileModel } = await import("../src/db/models/index.js");
    const page = await ProfileModel.find(TENANT_ID, {});

    expect(page).toHaveLength(PAGE_CAP);
    expect(page.length).toBeLessThan(TENANT_SIZE);
    // The shape of the original bug: plausible, wrong, and silent.
    expect(page.length).not.toBe(await ProfileModel.count(TENANT_ID));
  });
});

describe("member totals agree with the database", () => {
  test("countActiveAlumni reports the tenant, not the first page", async () => {
    await expect(countActiveAlumni(TENANT_ID)).resolves.toBe(TENANT_SIZE);
  });

  test("analytics averages completion over every profile, not the first page", async () => {
    // profileCount comes from count() and was never the bug. The average was: it was
    // taken over whatever the read returned, so a truncated read reported the first
    // page's average as the network's.
    const bare = 3; // firstName, lastName, emails
    const full = 9;
    const percent = (filled) => Math.round((filled / 9) * 100);
    const wholeTenant = Math.round(
      (PAGE_CAP * percent(bare) + (TENANT_SIZE - PAGE_CAP) * percent(full)) / TENANT_SIZE
    );
    const firstPageOnly = percent(bare);
    expect(wholeTenant).not.toBe(firstPageOnly);

    const snapshot = await getTenantAnalyticsSnapshot({ tenantId: TENANT_ID });

    expect(snapshot.profileCompletion.averagePercent).toBe(wholeTenant);
    expect(snapshot.profileCompletion.averagePercent).not.toBe(firstPageOnly);
    expect(snapshot.profileCompletion.profileCount).toBe(TENANT_SIZE);
    expect(snapshot.totals.profiles).toBe(TENANT_SIZE);
  });

  test("a push to all active members reaches all of them", async () => {
    const recipients = await resolveAudienceUserIds(TENANT_ID, "all_active_members");

    expect(recipients).toHaveLength(TENANT_SIZE);
  });

  test("no surface quietly settles for the first page", async () => {
    const snapshot = await getTenantAnalyticsSnapshot({ tenantId: TENANT_ID });
    const reported = [
      await countActiveAlumni(TENANT_ID),
      snapshot.totals.profiles,
      snapshot.profileCompletion.profileCount,
      (await resolveAudienceUserIds(TENANT_ID, "all_active_members")).length
    ];


    expect(new Set(reported)).toEqual(new Set([TENANT_SIZE]));
    expect(reported).not.toContain(PAGE_CAP);
  });
});
