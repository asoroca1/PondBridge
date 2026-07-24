import { DEFAULT_TENANT_MODULES, TENANT_MODULE_CATALOG, resolveTenantModules } from "@pondbridge/shared";
import { getReadinessChecklist } from "../src/services/onboarding.js";
import {
  buildCommunityModuleInventory,
  buildPlanCapabilityInventory
} from "../src/services/tenantFeatureInventory.js";

function tenant(overrides = {}) {
  return {
    _id: "507f1f77bcf86cd799439011",
    slug: "pine",
    billingPlan: "legacy",
    planTier: "base",
    modules: { ...DEFAULT_TENANT_MODULES },
    content: {
      campType: "coed",
      networkDisplayName: "Pine Camp Community",
      welcomeHeadline: "Welcome",
      welcomeBody: "Reconnect with camp friends.",
      merchShopUrl: ""
    },
    settings: { signupMode: "open" },
    directorLegalAgreement: { accepted: true },
    billingStatus: "active",
    billingLifecycleStatus: "active",
    onboardingFeeStatus: "paid",
    ...overrides
  };
}

describe("tenant feature inventory", () => {
  test("keeps the shared schema and onboarding catalog aligned", () => {
    expect(TENANT_MODULE_CATALOG.map((item) => item.key)).toEqual(Object.keys(DEFAULT_TENANT_MODULES));
    expect(Object.keys(DEFAULT_TENANT_MODULES)).toEqual(expect.arrayContaining(["directory", "events", "chat"]));
    expect(Object.keys(DEFAULT_TENANT_MODULES)).toHaveLength(10);
  });

  test("resolves directory dependencies without changing unrelated legacy defaults", () => {
    const modules = resolveTenantModules({ directory: false, chat: false });

    expect(modules).toMatchObject({
      directory: false,
      search: false,
      relatedProfiles: false,
      chat: false,
      events: true,
      photoStream: true
    });
  });

  test("reports plan locks and incomplete selected module setup truthfully", () => {
    const items = buildCommunityModuleInventory(tenant());
    const byKey = new Map(items.map((item) => [item.key, item]));

    expect(byKey.get("events")).toMatchObject({ status: "active", enabled: true });
    expect(byKey.get("familyTrees")).toMatchObject({ status: "locked", enabled: false });
    expect(byKey.get("merchShop")).toMatchObject({ status: "setup_required", setupRequired: true });
  });

  test("uses the configured camp storefront as the merch preview target", () => {
    const items = buildCommunityModuleInventory(
      tenant({ content: { ...tenant().content, merchShopUrl: "https://shop.example.org" } })
    );

    expect(items.find((item) => item.key === "merchShop")).toMatchObject({
      status: "active",
      externalHref: "https://shop.example.org"
    });
  });

  test("shows premium custom domains as available and then connected", () => {
    const premium = tenant({ billingPlan: "institutional", planTier: "premium" });
    const pending = buildPlanCapabilityInventory(premium).find((item) => item.key === "custom_domain");
    const active = buildPlanCapabilityInventory({ ...premium, customDomain: "community.example.org" })
      .find((item) => item.key === "custom_domain");

    expect(pending).toMatchObject({ status: "active", statusLabel: "Available", available: true });
    expect(active).toMatchObject({ status: "active", statusLabel: "Connected", available: true });
  });

  test("blocks launch when a selected merch shop has no destination", () => {
    const missing = getReadinessChecklist(tenant()).checks.find((item) => item.id === "module_setup");
    const ready = getReadinessChecklist(
      tenant({ content: { ...tenant().content, merchShopUrl: "https://shop.example.org" } })
    ).checks.find((item) => item.id === "module_setup");

    expect(missing?.ok).toBe(false);
    expect(ready?.ok).toBe(true);
  });
});
