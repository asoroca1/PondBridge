import {
  buildSuperSearchTenantItem,
  superSearchIncludesDirectors
} from "../src/services/superSearchPolicy.js";

describe("super console search role boundary", () => {
  test("finance search excludes director identities and links only to billing", () => {
    expect(superSearchIncludesDirectors("finance_admin")).toBe(false);
    expect(
      buildSuperSearchTenantItem(
        { name: "Camp Pine", slug: "pine", customDomain: "private.example.org" },
        "finance_admin"
      )
    ).toEqual({
      id: "billing_pine",
      type: "billing",
      label: "Camp Pine",
      meta: "Tenant billing record",
      href: "/super/billing/tenants?search=pine"
    });
  });

  test("support search retains tenant and director investigation behavior", () => {
    expect(superSearchIncludesDirectors("support_admin")).toBe(true);
    expect(
      buildSuperSearchTenantItem(
        { name: "Camp Pine", slug: "pine", customDomain: "alumni.pine.org" },
        "support_admin"
      )
    ).toMatchObject({
      type: "tenant",
      meta: "alumni.pine.org",
      href: "/super/tenants?search=pine"
    });
  });
});
