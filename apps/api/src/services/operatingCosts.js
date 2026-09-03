/**
 * Operational finances: the vendor and service costs of running PondBridge.
 *
 * Amounts are stored in cents. A cost's billing cycle is whatever the vendor
 * actually charges on, and every comparison is done against a normalized
 * monthly run rate so a $300/year domain bill and a $25/month database bill
 * can sit in the same total. One-time costs are deliberately excluded from
 * the run rate — they are not a recurring obligation — and reported on their
 * own line instead.
 */

export const COST_CATEGORIES = [
  { value: "infrastructure", label: "Infrastructure" },
  { value: "email", label: "Email" },
  { value: "ai", label: "AI" },
  { value: "payments", label: "Payments" },
  { value: "domains", label: "Domains & DNS" },
  { value: "software", label: "Software" },
  { value: "people", label: "People & contractors" },
  { value: "other", label: "Other" }
];

export const COST_BILLING_CYCLES = [
  { value: "monthly", label: "Monthly", months: 1 },
  { value: "quarterly", label: "Quarterly", months: 3 },
  { value: "annual", label: "Annual", months: 12 },
  { value: "one_time", label: "One time", months: 0 }
];

export const COST_STATUSES = [
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "canceled", label: "Canceled" }
];

const CATEGORY_VALUES = new Set(COST_CATEGORIES.map((entry) => entry.value));
const STATUS_VALUES = new Set(COST_STATUSES.map((entry) => entry.value));
const CYCLE_MONTHS = new Map(COST_BILLING_CYCLES.map((entry) => [entry.value, entry.months]));

export class OperatingCostInputError extends Error {
  constructor(message, field = "") {
    super(message);
    this.name = "OperatingCostInputError";
    this.field = field;
  }
}

function trimmed(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

/**
 * Accepts what a person types: "25", "$25", "$1,200.50", 25, "25.00".
 * Rejects anything that is not a plain non-negative amount, rather than
 * silently storing a 0 for a typo.
 */
export function parseAmountToCents(value) {
  if (value === null || value === undefined || value === "") {
    throw new OperatingCostInputError("Enter an amount.", "amount");
  }
  const raw = String(value).trim().replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
    throw new OperatingCostInputError("Amount must be a number like 25 or 1200.50.", "amount");
  }
  const cents = Math.round(Number(raw) * 100);
  if (!Number.isFinite(cents) || cents < 0 || cents > 2_000_000_000) {
    throw new OperatingCostInputError("Amount is out of range.", "amount");
  }
  return cents;
}

function normalizeDate(value, field) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new OperatingCostInputError("Dates must be in YYYY-MM-DD form.", field);
  }
  if (Number.isNaN(Date.parse(`${raw}T00:00:00Z`))) {
    throw new OperatingCostInputError("That date is not a real calendar date.", field);
  }
  return raw;
}

function normalizeUrl(value) {
  const raw = trimmed(value, 500);
  if (!raw) return "";
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(withScheme);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new OperatingCostInputError("Link must be an http(s) URL.", "url");
    }
    return parsed.toString().slice(0, 500);
  } catch (error) {
    if (error instanceof OperatingCostInputError) throw error;
    throw new OperatingCostInputError("Link must be a valid URL.", "url");
  }
}

/**
 * `partial` builds a patch for an update: only keys actually present in the
 * body are normalized, so a PATCH that renames a cost does not reset its
 * amount to a default.
 */
export function normalizeOperatingCostInput(body = {}, { partial = false } = {}) {
  const input = body && typeof body === "object" ? body : {};
  const has = (key) => Object.prototype.hasOwnProperty.call(input, key);
  const out = {};

  if (!partial || has("name")) {
    const name = trimmed(input.name, 120);
    if (!name) throw new OperatingCostInputError("Give the service a name.", "name");
    out.name = name;
  }

  if (!partial || has("vendor")) out.vendor = trimmed(input.vendor, 120);

  if (!partial || has("category")) {
    const category = trimmed(input.category, 40).toLowerCase() || "other";
    if (!CATEGORY_VALUES.has(category)) {
      throw new OperatingCostInputError("Pick a category from the list.", "category");
    }
    out.category = category;
  }

  if (!partial || has("amount") || has("amountCents")) {
    out.amountCents = has("amountCents") && !has("amount")
      ? parseAmountToCents(Number(input.amountCents) / 100)
      : parseAmountToCents(input.amount);
  }

  if (!partial || has("currency")) {
    const currency = trimmed(input.currency, 3).toUpperCase() || "USD";
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new OperatingCostInputError("Currency must be a 3-letter code like USD.", "currency");
    }
    out.currency = currency;
  }

  if (!partial || has("billingCycle")) {
    const cycle = trimmed(input.billingCycle, 20).toLowerCase() || "monthly";
    if (!CYCLE_MONTHS.has(cycle)) {
      throw new OperatingCostInputError("Pick a billing cycle from the list.", "billingCycle");
    }
    out.billingCycle = cycle;
  }

  if (!partial || has("status")) {
    const status = trimmed(input.status, 20).toLowerCase() || "active";
    if (!STATUS_VALUES.has(status)) {
      throw new OperatingCostInputError("Pick a status from the list.", "status");
    }
    out.status = status;
  }

  if (!partial || has("startedOn")) out.startedOn = normalizeDate(input.startedOn, "startedOn");
  if (!partial || has("renewsOn")) out.renewsOn = normalizeDate(input.renewsOn, "renewsOn");
  if (!partial || has("url")) out.url = normalizeUrl(input.url);
  if (!partial || has("notes")) out.notes = trimmed(input.notes, 2000);

  return out;
}

/** Monthly run rate for one cost, in cents. One-time costs contribute nothing. */
export function monthlyRunRateCents(cost = {}) {
  if (cost.status !== "active") return 0;
  const months = CYCLE_MONTHS.get(cost.billingCycle) ?? 0;
  if (!months) return 0;
  return Math.round(Number(cost.amountCents || 0) / months);
}

export function serializeOperatingCost(row = {}) {
  return {
    id: String(row._id || row.id || ""),
    name: row.name || "",
    vendor: row.vendor || "",
    category: row.category || "other",
    amountCents: Number(row.amountCents || 0),
    currency: row.currency || "USD",
    billingCycle: row.billingCycle || "monthly",
    status: row.status || "active",
    startedOn: row.startedOn || null,
    renewsOn: row.renewsOn || null,
    url: row.url || "",
    notes: row.notes || "",
    monthlyRunRateCents: monthlyRunRateCents(row),
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null
  };
}

/**
 * Totals are grouped by currency because adding USD to EUR without an FX rate
 * would produce a confident, wrong number. The UI shows one block per currency.
 */
export function summarizeOperatingCosts(costs = []) {
  const byCurrency = new Map();
  let activeCount = 0;

  for (const cost of costs) {
    if (cost.status !== "active") continue;
    activeCount += 1;

    const currency = cost.currency || "USD";
    if (!byCurrency.has(currency)) {
      byCurrency.set(currency, {
        currency,
        monthlyCents: 0,
        annualCents: 0,
        oneTimeCents: 0,
        categoryTotals: new Map()
      });
    }
    const bucket = byCurrency.get(currency);

    if (cost.billingCycle === "one_time") {
      bucket.oneTimeCents += Number(cost.amountCents || 0);
      continue;
    }

    const monthly = monthlyRunRateCents(cost);
    const category = cost.category || "other";
    bucket.monthlyCents += monthly;
    bucket.annualCents += monthly * 12;
    bucket.categoryTotals.set(category, (bucket.categoryTotals.get(category) || 0) + monthly);
  }

  const currencies = [...byCurrency.values()].sort((a, b) => b.monthlyCents - a.monthlyCents);
  const primary = currencies.find((entry) => entry.currency === "USD") || currencies[0] || null;
  const categoryTotals = primary?.categoryTotals || new Map();

  return {
    activeCount,
    totalCount: costs.length,
    primaryCurrency: primary?.currency || "USD",
    monthlyCents: primary?.monthlyCents || 0,
    annualCents: primary?.annualCents || 0,
    oneTimeCents: primary?.oneTimeCents || 0,
    currencies: currencies.map(({ categoryTotals: _ignored, ...entry }) => entry),
    byCategory: COST_CATEGORIES.map((entry) => ({
      category: entry.value,
      label: entry.label,
      monthlyCents: categoryTotals.get(entry.value) || 0
    })).filter((entry) => entry.monthlyCents > 0)
  };
}
