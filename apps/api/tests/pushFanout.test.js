import { jest } from "@jest/globals";

/**
 * Push delivery used to walk devices one at a time: await the provider, then
 * await a database write, then move to the next device. A member with a phone
 * and a tablet paid for two full round trips, and a camp-wide broadcast paid
 * for that on every recipient.
 *
 * These tests hold three properties: the provider calls overlap, the fan-out
 * stays bounded, and the per-device bookkeeping collapses into set-based
 * writes without losing any device's outcome.
 */

const pushCalls = [];
const deviceWrites = { single: [], many: [] };
let inFlight = 0;
let peakInFlight = 0;
let releaseAll = null;

function gatedSend(outcomeFor) {
  return async ({ token }) => {
    pushCalls.push(token);
    inFlight += 1;
    peakInFlight = Math.max(peakInFlight, inFlight);
    await new Promise((resolve) => {
      const tick = () => (releaseAll ? resolve() : setTimeout(tick, 1));
      tick();
    });
    inFlight -= 1;
    return outcomeFor(token);
  };
}

let outcomeFor = () => ({ ok: true, status: "delivered", permanent: false });

jest.unstable_mockModule("../src/services/fcmHttpV1.js", () => ({
  hasFcmHttpV1Configuration: () => true,
  sendFcmHttpV1Message: gatedSend((token) => outcomeFor(token))
}));

const notificationRows = new Map();

jest.unstable_mockModule("../src/db/models/index.js", () => ({
  MobileNotificationDeviceModel: {
    find: async () => [],
    update: async (id, patch) => {
      deviceWrites.single.push({ id, patch });
      return { _id: id, ...patch };
    },
    updateMany: async (tenantId, filter, patch) => {
      deviceWrites.many.push({ tenantId, ids: filter?._id?.$in || [], patch });
      return [];
    }
  },
  MobileNotificationModel: {
    update: async (id, patch) => {
      notificationRows.set(id, { ...(notificationRows.get(id) || {}), ...patch });
      return notificationRows.get(id);
    }
  },
  MobileNotificationPreferenceModel: {},
  MobileNotificationScheduleModel: {},
  ProfileModel: {},
  TenantModel: {},
  UserModel: {}
}));

const { PUSH_FANOUT_CONCURRENCY, __testables } = await import(
  "../src/services/mobileNotifications.js"
);

function reset() {
  pushCalls.length = 0;
  deviceWrites.single.length = 0;
  deviceWrites.many.length = 0;
  inFlight = 0;
  peakInFlight = 0;
  releaseAll = null;
  notificationRows.clear();
  outcomeFor = () => ({ ok: true, status: "delivered", permanent: false });
}

function devices(count, overrides = {}) {
  return Array.from({ length: count }, (_, i) => ({
    _id: `device-${i}`,
    platform: "android",
    token: `token-${i}`,
    isActive: true,
    lastDeliveredAt: null,
    ...overrides
  }));
}

beforeEach(reset);

describe("push fan-out", () => {
  it("keeps a bounded number of provider calls in flight", async () => {
    const pending = __testables.deliverNotificationToUser({
      notification: {
        _id: "n1",
        tenantId: "tenant-1",
        title: "Reunion",
        body: "Saturday",
        category: "announcements",
        kind: "custom_admin"
      },
      devices: devices(20),
      tenantPrefs: { mobileEnabled: true, pushEnabled: true, inboxEnabled: true, soundEnabled: true },
      userPrefs: { pushEnabled: true, categories: { announcements: true } }
    });

    // Let the runners saturate before anything is allowed to finish.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(peakInFlight).toBe(PUSH_FANOUT_CONCURRENCY);
    expect(peakInFlight).toBeLessThan(20);

    releaseAll = true;
    await pending;
    expect(pushCalls).toHaveLength(20);
  });

  it("collapses identical outcomes into one set-based write", async () => {
    releaseAll = true;
    await __testables.deliverNotificationToUser({
      notification: { _id: "n1", tenantId: "tenant-1", title: "t", body: "b", category: "announcements" },
      devices: devices(12),
      tenantPrefs: { mobileEnabled: true, pushEnabled: true, inboxEnabled: true, soundEnabled: true },
      userPrefs: { pushEnabled: true, categories: { announcements: true } }
    });

    expect(deviceWrites.many).toHaveLength(1);
    expect(deviceWrites.many[0].ids).toHaveLength(12);
    expect(deviceWrites.many[0].tenantId).toBe("tenant-1");
    expect(deviceWrites.single).toHaveLength(0);
  });

  it("keeps a permanently failed device's own outcome when others succeed", async () => {
    releaseAll = true;
    outcomeFor = (token) =>
      token === "token-3"
        ? { ok: false, status: "failed", error: "BadDeviceToken", permanent: true }
        : { ok: true, status: "delivered", permanent: false };

    await __testables.deliverNotificationToUser({
      notification: { _id: "n1", tenantId: "tenant-1", title: "t", body: "b", category: "announcements" },
      devices: devices(6),
      tenantPrefs: { mobileEnabled: true, pushEnabled: true, inboxEnabled: true, soundEnabled: true },
      userPrefs: { pushEnabled: true, categories: { announcements: true } }
    });

    const written = [
      ...deviceWrites.many.flatMap(({ ids, patch }) => ids.map((id) => ({ id, patch }))),
      ...deviceWrites.single.map(({ id, patch }) => ({ id, patch }))
    ];
    expect(written).toHaveLength(6);

    const failed = written.find((w) => w.id === "device-3");
    expect(failed.patch.isActive).toBe(false);
    expect(failed.patch.lastError).toBe("BadDeviceToken");

    const succeeded = written.find((w) => w.id === "device-0");
    expect(succeeded.patch.isActive).toBe(true);
    expect(succeeded.patch.lastError).toBe("");
  });

  it("reports delivered when any device succeeds, whatever the ordering", async () => {
    releaseAll = true;
    outcomeFor = (token) =>
      token === "token-0"
        ? { ok: false, status: "failed", error: "boom", permanent: false }
        : { ok: true, status: "delivered", permanent: false };

    await __testables.deliverNotificationToUser({
      notification: { _id: "n1", tenantId: "tenant-1", title: "t", body: "b", category: "announcements" },
      devices: devices(3),
      tenantPrefs: { mobileEnabled: true, pushEnabled: true, inboxEnabled: true, soundEnabled: true },
      userPrefs: { pushEnabled: true, categories: { announcements: true } }
    });

    const { delivery } = notificationRows.get("n1");
    expect(delivery.pushStatus).toBe("delivered");
    expect(delivery.devicesDelivered).toBe(2);
    expect(delivery.devicesAttempted).toBe(3);
  });
});
