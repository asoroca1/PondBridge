import { jest } from "@jest/globals";

/**
 * Scheduled broadcasts were read and then marked `sending` in two separate
 * statements, so two API replicas polling the same table both saw the same
 * pending row and both sent it — every member got the notification twice.
 *
 * These tests run two workers against one shared fake table and assert the
 * property that matters: a logical notification is delivered once, no matter
 * how the two runs interleave.
 */

// A stand-in for the schedules table that enforces the one thing the real
// database enforces here: an UPDATE with a WHERE clause matches, or it does
// not, and only one writer can win a row.
function createScheduleTable(rows = []) {
  const store = new Map(rows.map((row) => [row._id, { ...row }]));
  return {
    store,
    acrossTenants() {
      return {
        find: async (filter, options = {}) => {
          const wanted = filter.status;
          const runAtMax = filter.runAt?.$lte;
          const attemptedMax = filter.attemptedAt?.$lte;
          return [...store.values()]
            .filter((row) => row.status === wanted)
            .filter((row) => (runAtMax ? row.runAt <= runAtMax : true))
            .filter((row) => (attemptedMax ? row.attemptedAt && row.attemptedAt <= attemptedMax : true))
            .slice(0, options.limit ?? 100)
            .map((row) => ({ ...row }));
        }
      };
    },
    claimOne: async (id, guard, patch) => {
      const row = store.get(id);
      if (!row) return null;
      for (const [key, value] of Object.entries(guard)) {
        const current = row[key];
        const matches =
          value instanceof Date && current instanceof Date
            ? current.getTime() === value.getTime()
            : current === value;
        if (!matches) return null;
      }
      Object.assign(row, patch);
      return { ...row };
    },
    update: async (id, patch) => {
      const row = store.get(id);
      if (!row) return null;
      Object.assign(row, patch);
      return { ...row };
    }
  };
}

const scheduleTable = createScheduleTable();

jest.unstable_mockModule("../src/db/models/index.js", () => ({
  MobileNotificationScheduleModel: scheduleTable,
  TenantModel: {
    findById: async (id) => ({
      _id: id,
      slug: "camp",
      notificationPrefs: { mobileEnabled: true, customBroadcasts: true }
    })
  },
  MobileNotificationDeviceModel: {},
  MobileNotificationModel: {},
  MobileNotificationPreferenceModel: {},
  ProfileModel: { find: async () => [] },
  UserModel: { find: async () => [] }
}));

const { runDueMobileNotificationSchedules, SCHEDULE_LEASE_MS } = await import(
  "../src/services/mobileNotifications.js"
);

function seed(rows) {
  scheduleTable.store.clear();
  for (const row of rows) scheduleTable.store.set(row._id, { ...row });
}

function pendingSchedule(id, runAt) {
  return {
    _id: id,
    tenantId: "tenant-1",
    status: "pending",
    runAt,
    audience: "all_members",
    userIds: [],
    category: "general",
    title: "Reunion",
    body: "Saturday",
    pushRequested: true
  };
}

describe("scheduled broadcasts are claimed, not just read", () => {
  const past = new Date("2026-09-01T00:00:00Z");
  const now = new Date("2026-09-02T00:00:00Z");

  it("delivers a due schedule exactly once when two workers race", async () => {
    seed([pendingSchedule("s1", past)]);

    // Both workers read the pending row before either has claimed it, which is
    // exactly the interleaving that produced duplicate sends.
    const [a, b] = await Promise.all([
      runDueMobileNotificationSchedules({ now }),
      runDueMobileNotificationSchedules({ now })
    ]);

    const delivered = [...a, ...b];
    expect(delivered).toHaveLength(1);
    expect(scheduleTable.store.get("s1").status).toBe("sent");
  });

  it("leaves a row alone once another worker owns it", async () => {
    seed([pendingSchedule("s1", past)]);
    scheduleTable.store.get("s1").status = "sending";
    scheduleTable.store.get("s1").attemptedAt = now;

    const results = await runDueMobileNotificationSchedules({ now });

    expect(results).toHaveLength(0);
    expect(scheduleTable.store.get("s1").status).toBe("sending");
  });

  it("hands back a job whose owner died, once the lease expires", async () => {
    seed([pendingSchedule("s1", past)]);
    const row = scheduleTable.store.get("s1");
    row.status = "sending";
    row.attemptedAt = new Date(now.getTime() - SCHEDULE_LEASE_MS - 1000);

    const results = await runDueMobileNotificationSchedules({ now });

    expect(results).toHaveLength(1);
    expect(scheduleTable.store.get("s1").status).toBe("sent");
  });

  it("does not steal a job from a worker that is merely slow", async () => {
    seed([pendingSchedule("s1", past)]);
    const row = scheduleTable.store.get("s1");
    row.status = "sending";
    row.attemptedAt = new Date(now.getTime() - 1000);

    const results = await runDueMobileNotificationSchedules({ now });

    expect(results).toHaveLength(0);
    expect(scheduleTable.store.get("s1").status).toBe("sending");
  });

  it("ignores schedules that are not due yet", async () => {
    seed([pendingSchedule("s1", new Date("2026-12-01T00:00:00Z"))]);

    const results = await runDueMobileNotificationSchedules({ now });

    expect(results).toHaveLength(0);
    expect(scheduleTable.store.get("s1").status).toBe("pending");
  });
});
