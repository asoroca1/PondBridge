import { describe, expect, it } from "vitest";
import {
  BILLING_PLAN_PRESENTATION,
  KNOWN_BILLING_PLAN_CODES,
  billingPlanLabel,
  buildBillingPlanOptions,
  normalizeBillingPlanCode,
  resolveTenantBillingPlanCode
} from "./billingPlanCatalog.js";

// Mirrors GET /api/tenants/me/billing -> catalog.plans.
const SERVER_CATALOG = [
  {
    code: "flagship",
    label: "Flagship",
    description: "PondBridge Flagship plan ($1,200/year, everything included)",
    annualAmount: 1200,
    onboardingFeeAmount: 0
  },
  {
    code: "test",
    label: "Internal Test",
    description: "Internal production validation plan ($10/year)",
    annualAmount: 10,
    onboardingFeeAmount: 0
  }
];

describe("billing plan codes", () => {
  // Regression: the wizard used to validate against a Flagship-only list, so
  // "test" was treated as unknown and rewritten to "flagship". The director
  // picked the $10 plan and Stripe opened a $1,200 Flagship checkout.
  it("keeps the internal test plan instead of coercing it to flagship", () => {
    expect(normalizeBillingPlanCode("test")).toBe("test");
  });

  it("knows every plan code the API can return", () => {
    for (const plan of SERVER_CATALOG) {
      expect(KNOWN_BILLING_PLAN_CODES).toContain(plan.code);
      expect(normalizeBillingPlanCode(plan.code)).toBe(plan.code);
    }
  });

  it("normalizes casing and whitespace", () => {
    expect(normalizeBillingPlanCode("  TEST ")).toBe("test");
    expect(normalizeBillingPlanCode("Flagship")).toBe("flagship");
  });

  it("falls back to flagship only for genuinely unknown codes", () => {
    expect(normalizeBillingPlanCode("")).toBe("flagship");
    expect(normalizeBillingPlanCode(null)).toBe("flagship");
    expect(normalizeBillingPlanCode("enterprise")).toBe("flagship");
  });
});

describe("resolveTenantBillingPlanCode", () => {
  // Regression: a tenant already stored on the test plan read back as flagship,
  // so checkout re-billed them on the wrong plan.
  it("reads a stored test plan off the tenant", () => {
    expect(resolveTenantBillingPlanCode({ billingPlan: "test" })).toBe("test");
    expect(resolveTenantBillingPlanCode({ billing: { billingPlan: "test" } })).toBe("test");
  });

  it("reads a stored flagship plan off the tenant", () => {
    expect(resolveTenantBillingPlanCode({ billingPlan: "flagship" })).toBe("flagship");
  });

  it("returns the supplied fallback when the tenant has no usable plan", () => {
    expect(resolveTenantBillingPlanCode(null, "test")).toBe("test");
    expect(resolveTenantBillingPlanCode({}, "flagship")).toBe("flagship");
    expect(resolveTenantBillingPlanCode({ billingPlan: "legacy" }, "flagship")).toBe("flagship");
  });
});

describe("buildBillingPlanOptions", () => {
  it("offers every plan the server catalog returns", () => {
    const options = buildBillingPlanOptions(SERVER_CATALOG);
    expect(options.map((item) => item.code)).toEqual(["flagship", "test"]);
  });

  it("takes prices from the server rather than local copy", () => {
    const options = buildBillingPlanOptions(SERVER_CATALOG);
    const testPlan = options.find((item) => item.code === "test");
    expect(testPlan.annualAmount).toBe(10);
    expect(testPlan.onboardingFeeAmount).toBe(0);

    const repriced = buildBillingPlanOptions([{ ...SERVER_CATALOG[0], annualAmount: 1500 }]);
    expect(repriced[0].annualAmount).toBe(1500);
  });

  it("drops plans the server does not offer this camp", () => {
    const options = buildBillingPlanOptions([SERVER_CATALOG[0]]);
    expect(options.map((item) => item.code)).toEqual(["flagship"]);
  });

  it("ignores plan codes the UI has no copy for", () => {
    const options = buildBillingPlanOptions([...SERVER_CATALOG, { code: "mystery" }]);
    expect(options.map((item) => item.code)).toEqual(["flagship", "test"]);
  });

  it("falls back to flagship when the catalog is empty or unreachable", () => {
    expect(buildBillingPlanOptions([]).map((item) => item.code)).toEqual(["flagship"]);
    expect(buildBillingPlanOptions(null).map((item) => item.code)).toEqual(["flagship"]);
    expect(buildBillingPlanOptions(undefined).map((item) => item.code)).toEqual(["flagship"]);
  });

  it("keeps local copy when the server omits label and description", () => {
    const options = buildBillingPlanOptions([{ code: "test", annualAmount: 10 }]);
    const local = BILLING_PLAN_PRESENTATION.find((item) => item.code === "test");
    expect(options[0].title).toBe(local.title);
    expect(options[0].summary).toBe(local.summary);
  });
});

describe("billingPlanLabel", () => {
  it("names the test plan distinctly from flagship", () => {
    expect(billingPlanLabel("test")).not.toBe(billingPlanLabel("flagship"));
    expect(billingPlanLabel("test")).toContain("Test");
  });

  it("prefers the server label when catalog options are supplied", () => {
    const options = buildBillingPlanOptions(SERVER_CATALOG);
    expect(billingPlanLabel("test", options)).toBe("Internal Test Plan");
  });
});
