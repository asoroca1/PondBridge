import {
  buildSuperCopilotCampSearchItem,
  buildSuperCopilotTools,
  isReadOnlySuperCopilotTool,
  primarySuperRole
} from "../src/services/superCopilot.js";

describe("super operations agent role contract", () => {
  test("gives finance admins only billing-safe tools", () => {
    const tools = buildSuperCopilotTools("finance_admin");
    const names = tools.map((tool) => tool.name);

    expect(names).toEqual(["search_camps", "explain_super_screen", "get_camp_billing"]);
    expect(names).not.toContain("get_platform_pulse");
    expect(names).not.toContain("get_camp_health");
    expect(tools.find((tool) => tool.name === "search_camps").parameters.properties.status.enum)
      .toEqual(["any", "past_due"]);
    expect(tools.find((tool) => tool.name === "explain_super_screen").parameters.properties.screen.enum)
      .not.toContain("settings");
  });

  test("gives support and super admins the same read-only investigation tools", () => {
    const support = buildSuperCopilotTools("support_admin");
    const superAdmin = buildSuperCopilotTools("super_admin");

    expect(support.map((tool) => tool.name)).toEqual(superAdmin.map((tool) => tool.name));
    for (const tool of support) {
      expect(tool.strict).toBe(true);
      expect(tool.parameters.additionalProperties).toBe(false);
      expect(isReadOnlySuperCopilotTool(tool.name, "support_admin")).toBe(true);
      expect(tool.name).not.toMatch(/create|update|delete|retry|send|provision|reset|execute|approve/);
    }
  });

  test("blocks tools outside a role and resolves the strongest role", () => {
    expect(isReadOnlySuperCopilotTool("get_camp_health", "finance_admin")).toBe(false);
    expect(isReadOnlySuperCopilotTool("hard_delete_camp", "super_admin")).toBe(false);
    expect(primarySuperRole(["finance_admin", "super_admin"])).toBe("super_admin");
  });

  test("keeps finance camp search results limited to billing state", () => {
    const item = buildSuperCopilotCampSearchItem(
      {
        name: "Camp Pine",
        slug: "pine",
        status: "inactive",
        onboardingStatus: "live",
        planTier: "premium",
        billingStatus: "past_due"
      },
      "finance_admin"
    );

    expect(item.href).toBe("/super/billing/tenants?search=pine");
    expect(item.billingStatus).toBe("past_due");
    expect(item).not.toHaveProperty("status");
    expect(item).not.toHaveProperty("onboardingStatus");
  });
});
