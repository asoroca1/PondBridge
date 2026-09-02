import {
  ADMIN_TIER_RANK,
  isTieredAccessModuleEnabled,
  resolveTenantTierPolicy,
  resolveViewerModules,
  tierCanUseModule
} from "../src/services/memberTiers.js";
import {
  describeTierFloor,
  normalizeTierModuleFloors,
  resolveModulesForTier
} from "@pondbridge/shared";

function tenantWith({ moduleOn = true, tiers = {} } = {}) {
  return {
    _id: "tenant_1",
    modules: { tieredAccess: moduleOn },
    accessSettings: { tiers }
  };
}

const CONTEXT = {
  enabled: true,
  tierModules: { chat: 3, map: 2, familyTrees: 0 },
  untaggedRank: 4,
  bottomRank: 4
};

describe("tiered access is off until a camp turns it on", () => {
  test("the module is off for a camp that has never configured it", () => {
    expect(isTieredAccessModuleEnabled({ modules: {} })).toBe(false);
    expect(isTieredAccessModuleEnabled({})).toBe(false);
    expect(isTieredAccessModuleEnabled(null)).toBe(false);
  });

  test("every other module keeps defaulting on", () => {
    const tenant = { modules: {} };
    expect(isTieredAccessModuleEnabled(tenant)).toBe(false);
    // Sanity check that the default-off flag did not leak to its neighbours.
    expect(resolveViewerModules(tenant, { enabled: false }, null).directory).toBe(true);
    expect(resolveViewerModules(tenant, { enabled: false }, null).chat).toBe(true);
  });

  test("enforcement stays off while the module switch is off, even if tiers were configured", () => {
    const policy = resolveTenantTierPolicy(
      tenantWith({ moduleOn: false, tiers: { enabled: true, untaggedRank: 2 } })
    );
    expect(policy.moduleEnabled).toBe(false);
    expect(policy.enabled).toBe(false);
  });

  test("enforcement stays off while the camp has not flipped the second switch", () => {
    const policy = resolveTenantTierPolicy(tenantWith({ tiers: { enabled: false } }));
    expect(policy.moduleEnabled).toBe(true);
    expect(policy.enabled).toBe(false);
  });

  test("both switches on turns enforcement on", () => {
    const policy = resolveTenantTierPolicy(
      tenantWith({ tiers: { enabled: true, untaggedRank: 3, tierModules: { chat: 2 } } })
    );
    expect(policy.enabled).toBe(true);
    expect(policy.untaggedRank).toBe(3);
    expect(policy.tierModules).toEqual({ chat: 2 });
  });
});

describe("feature floors cascade upward", () => {
  test("a viewer at or above the floor keeps the module", () => {
    expect(tierCanUseModule(CONTEXT, 1, "chat")).toBe(true);
    expect(tierCanUseModule(CONTEXT, 3, "chat")).toBe(true);
  });

  test("a viewer below the floor loses it", () => {
    expect(tierCanUseModule(CONTEXT, 4, "chat")).toBe(false);
    expect(tierCanUseModule(CONTEXT, 3, "map")).toBe(false);
  });

  test("a floor of zero means nobody", () => {
    expect(tierCanUseModule(CONTEXT, 1, "familyTrees")).toBe(false);
  });

  test("a module with no floor recorded is unrestricted", () => {
    expect(tierCanUseModule(CONTEXT, 4, "photoStream")).toBe(true);
  });

  test("admins and disabled tiering bypass the floors entirely", () => {
    expect(tierCanUseModule(CONTEXT, ADMIN_TIER_RANK, "familyTrees")).toBe(true);
    expect(tierCanUseModule({ enabled: false }, 4, "chat")).toBe(true);
  });

  test("the resolved module set matches the floors", () => {
    const modules = { directory: true, chat: true, map: true, photoStream: true };
    expect(resolveModulesForTier(modules, { chat: 3, map: 2 }, 4)).toEqual({
      directory: true,
      chat: false,
      map: false,
      photoStream: true
    });
  });

  test("a module the camp already turned off stays off rather than being revived", () => {
    const modules = { chat: false };
    expect(resolveModulesForTier(modules, { chat: 4 }, 1).chat).toBe(false);
  });
});

describe("floor normalization and labels", () => {
  test("junk floors are dropped and real ones clamped", () => {
    expect(normalizeTierModuleFloors({ chat: "3", map: 99, bad: "x", "": 2 })).toEqual({
      chat: 3,
      map: 6
    });
  });

  test("floors read as plain English for the director", () => {
    expect(describeTierFloor(0, 4)).toBe("Nobody");
    expect(describeTierFloor(1, 4)).toBe("Tier 1 only");
    expect(describeTierFloor(3, 4)).toBe("Tiers 1-3");
    expect(describeTierFloor(4, 4)).toBe("Every tier");
  });
});
