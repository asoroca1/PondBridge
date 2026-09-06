import {
  applyTenantKindFilter,
  isDemoTenant,
  normalizeTenantKindFilter,
  summarizeTenantKinds,
  tenantKind
} from "../src/services/superTenantKind.js";

// The real production book after the 2026-09-06 dashboard cleanup: two clients
// and seven sales demos. Matoaka keeps its normal public slug, so its explicit
// demo-access setting is the authoritative signal.
const TENANTS = [
  { slug: "cedar", name: "Camp Cedar", status: "active" },
  { slug: "greenlane", name: "Camp Green Lane", status: "active" },
  {
    slug: "matoaka",
    name: "Camp Matoaka",
    status: "active",
    settings: { demoAccess: { enabled: true } }
  },
  { slug: "waldemar-demo", name: "Camp Waldemar", status: "active" },
  { slug: "towanda-demo", name: "Camp Towanda", status: "active" },
  { slug: "caribou-demo", name: "Camp Caribou", status: "active" },
  { slug: "vega-demo", name: "Camp Vega", status: "active" },
  { slug: "tapawingo-demo", name: "Camp Tapawingo", status: "active" },
  { slug: "winadu-demo", name: "Camp Winadu", status: "active" }
];

describe("client and demo camps", () => {
  test("splits the real book into two clients and seven demos", () => {
    expect(summarizeTenantKinds(TENANTS)).toEqual({ clients: 2, demos: 7, total: 9 });
  });

  test("a paying camp is never mistaken for a demo", () => {
    expect(isDemoTenant({ slug: "cedar", name: "Camp Cedar" })).toBe(false);
    expect(tenantKind({ slug: "cedar", name: "Camp Cedar" })).toBe("client");
  });

  test("recognises demos by explicit access, slug, sandbox status and test domain", () => {
    expect(isDemoTenant({ slug: "matoaka", settings: { demoAccess: { enabled: true } } })).toBe(true);
    expect(isDemoTenant({ slug: "waldemar-demo" })).toBe(true);
    expect(isDemoTenant({ slug: "test29" })).toBe(true);
    expect(isDemoTenant({ slug: "pine", status: "sandbox" })).toBe(true);
    expect(isDemoTenant({ slug: "pine", customDomain: "pine.pondbridge.test" })).toBe(true);
    expect(isDemoTenant({ slug: "pine", name: "Camp Pine QA" })).toBe(true);
  });

  // "demo" must match as a word, or a camp legitimately named e.g. Demorest
  // would be filed as a sales demo and vanish from the client list.
  test("does not treat a camp whose name merely contains the letters as a demo", () => {
    expect(isDemoTenant({ slug: "demorest", name: "Camp Demorest" })).toBe(false);
    expect(isDemoTenant({ slug: "westest", name: "Camp Westest" })).toBe(false);
  });

  test("the console defaults to clients, and every other value is explicit", () => {
    expect(normalizeTenantKindFilter(undefined)).toBe("client");
    expect(normalizeTenantKindFilter("")).toBe("client");
    expect(normalizeTenantKindFilter("nonsense")).toBe("client");
    expect(normalizeTenantKindFilter("demo")).toBe("demo");
    expect(normalizeTenantKindFilter("all")).toBe("all");
  });

  test("filtering keeps only the kind asked for", () => {
    expect(applyTenantKindFilter(TENANTS, "client").map((t) => t.slug)).toEqual([
      "cedar",
      "greenlane"
    ]);
    expect(applyTenantKindFilter(TENANTS, "demo")).toHaveLength(7);
    expect(applyTenantKindFilter(TENANTS, "all")).toHaveLength(9);
  });
});
