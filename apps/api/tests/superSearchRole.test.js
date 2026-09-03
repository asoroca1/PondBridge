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

  // Support lands on the camp's own profile when the record carries an id; the
  // filtered list stays the fallback for lookups that only selected a slug.
  test("support search opens the camp profile when the record carries an id", () => {
    expect(
      buildSuperSearchTenantItem(
        { _id: "tenant-42", name: "Camp Pine", slug: "pine", customDomain: "alumni.pine.org" },
        "support_admin"
      )
    ).toMatchObject({ href: "/super/tenants/tenant-42" });
  });

  test("finance search still cannot reach a camp profile", () => {
    expect(
      buildSuperSearchTenantItem(
        { _id: "tenant-42", name: "Camp Pine", slug: "pine" },
        "finance_admin"
      )
    ).toMatchObject({ href: "/super/billing/tenants?search=pine" });
  });
});
