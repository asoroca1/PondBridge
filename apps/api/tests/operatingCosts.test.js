import {
  OperatingCostInputError,
  monthlyRunRateCents,
  normalizeOperatingCostInput,
  parseAmountToCents,
  summarizeOperatingCosts
} from "../src/services/operatingCosts.js";

function cost(overrides = {}) {
  return {
    name: "Supabase",
    vendor: "Supabase",
    category: "infrastructure",
    amountCents: 2500,
    currency: "USD",
    billingCycle: "monthly",
    status: "active",
    ...overrides
  };
}

describe("parseAmountToCents", () => {
  it("accepts the shapes a person actually types", () => {
    expect(parseAmountToCents("25")).toBe(2500);
    expect(parseAmountToCents("$25.00")).toBe(2500);
    expect(parseAmountToCents("$1,200.50")).toBe(120050);
    expect(parseAmountToCents(25)).toBe(2500);
  });

  it("rejects a typo instead of storing zero", () => {
    expect(() => parseAmountToCents("twenty five")).toThrow(OperatingCostInputError);
    expect(() => parseAmountToCents("")).toThrow(OperatingCostInputError);
    expect(() => parseAmountToCents("-5")).toThrow(OperatingCostInputError);
    expect(() => parseAmountToCents("25.005")).toThrow(OperatingCostInputError);
  });
});

describe("normalizeOperatingCostInput", () => {
  it("normalizes a full create payload", () => {
    const result = normalizeOperatingCostInput({
      name: "  Supabase Pro  ",
      vendor: "Supabase",
      category: "INFRASTRUCTURE",
      amount: "$25",
      currency: "usd",
      billingCycle: "Monthly",
      status: "active",
      startedOn: "2026-01-15",
      url: "supabase.com/dashboard",
      notes: "Prod database"
    });

    expect(result).toMatchObject({
      name: "Supabase Pro",
      category: "infrastructure",
      amountCents: 2500,
      currency: "USD",
      billingCycle: "monthly",
      startedOn: "2026-01-15",
      renewsOn: null,
      url: "https://supabase.com/dashboard"
    });
  });

  it("requires a name", () => {
    expect(() => normalizeOperatingCostInput({ name: "   ", amount: "25" })).toThrow(/name/i);
  });

  it("rejects values outside the allowed lists", () => {
    expect(() => normalizeOperatingCostInput({ name: "X", amount: "1", category: "rockets" })).toThrow(
      OperatingCostInputError
    );
    expect(() => normalizeOperatingCostInput({ name: "X", amount: "1", billingCycle: "weekly" })).toThrow(
      OperatingCostInputError
    );
  });

  it("only touches the fields a partial patch names", () => {
    const patch = normalizeOperatingCostInput({ name: "Renamed" }, { partial: true });
    expect(patch).toEqual({ name: "Renamed" });
  });

  it("rejects malformed dates", () => {
    expect(() => normalizeOperatingCostInput({ startedOn: "15/01/2026" }, { partial: true })).toThrow(
      OperatingCostInputError
    );
    expect(() => normalizeOperatingCostInput({ startedOn: "2026-01-15" }, { partial: true })).not.toThrow();
  });
});

describe("monthlyRunRateCents", () => {
  it("normalizes every recurring cycle to a month", () => {
    expect(monthlyRunRateCents(cost({ amountCents: 2500, billingCycle: "monthly" }))).toBe(2500);
    expect(monthlyRunRateCents(cost({ amountCents: 30000, billingCycle: "quarterly" }))).toBe(10000);
    expect(monthlyRunRateCents(cost({ amountCents: 120000, billingCycle: "annual" }))).toBe(10000);
  });

  it("excludes one-time and non-active costs", () => {
    expect(monthlyRunRateCents(cost({ billingCycle: "one_time" }))).toBe(0);
    expect(monthlyRunRateCents(cost({ status: "canceled" }))).toBe(0);
    expect(monthlyRunRateCents(cost({ status: "paused" }))).toBe(0);
  });
});

describe("summarizeOperatingCosts", () => {
  it("rolls active recurring costs into a monthly and annual run rate", () => {
    const summary = summarizeOperatingCosts([
      cost({ amountCents: 2500, billingCycle: "monthly", category: "infrastructure" }),
      cost({ name: "Resend", amountCents: 120000, billingCycle: "annual", category: "email" }),
      cost({ name: "Logo", amountCents: 50000, billingCycle: "one_time" }),
      cost({ name: "Old tool", amountCents: 9900, status: "canceled" })
    ]);

    expect(summary.monthlyCents).toBe(12500);
    expect(summary.annualCents).toBe(150000);
    expect(summary.oneTimeCents).toBe(50000);
    expect(summary.activeCount).toBe(3);
    expect(summary.totalCount).toBe(4);
    expect(summary.byCategory).toEqual([
      { category: "infrastructure", label: "Infrastructure", monthlyCents: 2500 },
      { category: "email", label: "Email", monthlyCents: 10000 }
    ]);
  });

  it("keeps currencies apart rather than summing them", () => {
    const summary = summarizeOperatingCosts([
      cost({ amountCents: 2500, currency: "USD" }),
      cost({ name: "EU vendor", amountCents: 9000, currency: "EUR" })
    ]);

    expect(summary.primaryCurrency).toBe("USD");
    expect(summary.monthlyCents).toBe(2500);
    expect(summary.currencies).toHaveLength(2);
    expect(summary.currencies.every((entry) => !("categoryTotals" in entry))).toBe(true);
  });

  it("reports zeroes for an empty ledger", () => {
    const summary = summarizeOperatingCosts([]);
    expect(summary.monthlyCents).toBe(0);
    expect(summary.primaryCurrency).toBe("USD");
    expect(summary.byCategory).toEqual([]);
  });
});
