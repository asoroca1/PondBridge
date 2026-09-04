import { jest } from "@jest/globals";

/**
 * The super console lists every rollout flag at once, and the listing read
 * them one at a time — a sequential round trip per flag, growing every time
 * someone adds one. These tests hold the batching, and the cache and
 * missing-table behaviour it had to preserve.
 */

const queries = [];
let rows = [];
let failWith = null;

jest.unstable_mockModule("../src/db/models/index.js", () => ({
  FeatureRolloutModel: {
    find: async (filter) => {
      queries.push(filter);
      if (failWith) throw failWith;
      const wanted = filter?.featureKey?.$in || [];
      return rows.filter((row) => wanted.includes(row.featureKey));
    },
    findOne: async (filter) => {
      queries.push(filter);
      if (failWith) throw failWith;
      return rows.find((row) => row.featureKey === filter.featureKey) || null;
    }
  }
}));

const { listFeatureRollouts, clearFeatureRolloutCache, SUPPORTED_FEATURE_ROLLOUTS } =
  await import("../src/services/featureRollouts.js");

const FEATURE_COUNT = Object.keys(SUPPORTED_FEATURE_ROLLOUTS).length;

beforeEach(() => {
  queries.length = 0;
  rows = [];
  failWith = null;
  clearFeatureRolloutCache();
});

describe("feature rollout listing", () => {
  it("reads every flag in one query rather than one per flag", async () => {
    const { items } = await listFeatureRollouts();

    expect(queries).toHaveLength(1);
    expect(queries[0].featureKey.$in).toHaveLength(FEATURE_COUNT);
    expect(items).toHaveLength(FEATURE_COUNT);
    expect(FEATURE_COUNT).toBeGreaterThan(1);
  });

  it("reports stored state and treats absent flags as unconfigured", async () => {
    const [configuredKey] = Object.keys(SUPPORTED_FEATURE_ROLLOUTS);
    rows = [{ featureKey: configuredKey, state: "pilot", revision: 4, killSwitch: false }];

    const { items, controlAvailable } = await listFeatureRollouts();

    expect(controlAvailable).toBe(true);
    const configured = items.find((item) => item.featureKey === configuredKey);
    expect(configured).toMatchObject({ state: "pilot", revision: 4, configured: true });
    const rest = items.filter((item) => item.featureKey !== configuredKey);
    expect(rest.every((item) => item.configured === false)).toBe(true);
    expect(rest.every((item) => item.state === "disabled")).toBe(true);
  });

  it("serves a warm cache without going back to the database", async () => {
    await listFeatureRollouts();
    await listFeatureRollouts();

    expect(queries).toHaveLength(1);
  });

  it("reports control unavailable, and does not cache, when the table is missing", async () => {
    failWith = Object.assign(new Error('relation "feature_rollouts" does not exist'), {
      code: "42P01"
    });

    const first = await listFeatureRollouts();
    expect(first.controlAvailable).toBe(false);
    expect(first.items).toHaveLength(FEATURE_COUNT);

    // The migration could land at any moment, so a missing table must not be
    // remembered for the cache window.
    failWith = null;
    const second = await listFeatureRollouts();
    expect(second.controlAvailable).toBe(true);
    expect(queries).toHaveLength(2);
  });

  it("lets a real database error surface instead of reporting flags as off", async () => {
    failWith = Object.assign(new Error("connection reset"), { code: "08006" });
    await expect(listFeatureRollouts()).rejects.toThrow(/connection reset/);
  });
});
