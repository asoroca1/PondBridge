import {
  evaluateFeatureRolloutRecord,
  normalizeFeatureRolloutInput
} from "../src/services/featureRollouts.js";

describe("durable feature rollout policy", () => {
  const target = { _id: "tenant-target", slug: "target" };
  const control = { _id: "tenant-control", slug: "control" };

  test("fails closed without a record or while the kill switch is active", () => {
    expect(evaluateFeatureRolloutRecord(null, target)).toMatchObject({ enabled: false, reason: "not_configured" });
    expect(evaluateFeatureRolloutRecord({ state: "enabled", killSwitch: true, revision: 2 }, target))
      .toMatchObject({ enabled: false, reason: "kill_switch", revision: 2 });
  });

  test("targets pilot camps by stable tenant ID and leaves controls unchanged", () => {
    const record = {
      state: "pilot",
      killSwitch: false,
      tenantIds: ["tenant-target"],
      excludedTenantIds: [],
      revision: 3
    };
    expect(evaluateFeatureRolloutRecord(record, target)).toMatchObject({ enabled: true, reason: "pilot_target" });
    expect(evaluateFeatureRolloutRecord(record, control)).toMatchObject({ enabled: false, reason: "outside_pilot" });
  });

  test("supports a global rollout with explicit control-camp exclusions", () => {
    const record = {
      state: "enabled",
      killSwitch: false,
      tenantIds: [],
      excludedTenantIds: ["tenant-control"],
      revision: 4
    };
    expect(evaluateFeatureRolloutRecord(record, target).enabled).toBe(true);
    expect(evaluateFeatureRolloutRecord(record, control)).toMatchObject({ enabled: false, reason: "control_tenant" });
  });

  test("requires a target cohort for pilot state and removes duplicate IDs", () => {
    expect(() => normalizeFeatureRolloutInput({ state: "pilot", tenantIds: [] }))
      .toThrow(/requires at least one/i);
    expect(normalizeFeatureRolloutInput({
      state: "pilot",
      killSwitch: false,
      tenantIds: ["tenant-target", "tenant-target"],
      excludedTenantIds: ["tenant-control", "tenant-target"]
    })).toMatchObject({
      tenantIds: ["tenant-target"],
      excludedTenantIds: ["tenant-control"]
    });
  });
});
