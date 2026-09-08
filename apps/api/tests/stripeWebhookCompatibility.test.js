import { jest } from "@jest/globals";

const tenants = new Map();
const receipts = new Map();
const auditRows = [];
const tenantUpdate = jest.fn(async (id, patch) => {
  const current = tenants.get(String(id));
  if (!current) return null;
  const updated = {
    ...current,
    ...clone(patch),
    settings: {
      ...(current.settings || {}),
      ...(patch.settings || {}),
      billing: {
        ...(current.settings?.billing || {}),
        ...(patch.settings?.billing || {})
      }
    }
  };
  tenants.set(String(id), updated);
  return clone(updated);
});

const clone = (value) => JSON.parse(JSON.stringify(value));

function seedTenant(overrides = {}) {
  const tenant = {
    _id: "tenant_1",
    id: "tenant_1",
    name: "Compatibility Camp",
    slug: "compatibility-camp",
    status: "active",
    planTier: "premium",
    onboardingStatus: "live",
    billingStatus: "trialing",
    onboardingFeeAmount: 0,
    onboardingFeePaid: true,
    stripeCustomerId: "cus_1",
    stripeSubscriptionId: "sub_current",
    stripePriceId: "price_1U5aQJKmSeC5JnMuSjZD4smU",
    settings: {
      billing: {
        planCode: "flagship",
        lifecycleStatus: "trialing",
        onboardingFeeStatus: "waived",
        onboardingFeeWaived: true,
        processedEventIds: []
      }
    },
    ...overrides
  };
  tenants.set(String(tenant._id), clone(tenant));
  return tenant;
}

const env = {
  NODE_ENV: "test",
  STRIPE_SECRET_KEY: "",
  BILLING_MODE: "mock",
  ALLOW_MOCK_BILLING_IN_PRODUCTION: false,
  STRIPE_PRICE_FLAGSHIP_ANNUAL: "price_1U5aQJKmSeC5JnMuSjZD4smU",
  STRIPE_PRICE_TEST_ANNUAL: "price_1TJdoAKmSeC5JnMuIjxDUD4m",
  FRONTEND_ORIGIN: "http://localhost:5173"
};

jest.unstable_mockModule("../src/config/env.js", () => ({ env }));
jest.unstable_mockModule("stripe", () => ({
  default: class Stripe {}
}));
jest.unstable_mockModule("../src/utils/publicResponseCache.js", () => ({
  invalidatePublicTenantCache: jest.fn()
}));
jest.unstable_mockModule("../src/services/logger.js", () => ({
  logLine: jest.fn()
}));
jest.unstable_mockModule("../src/db/models/index.js", () => ({
  StripeWebhookEventModel: {
    recordReceipt: jest.fn(async ({ stripeEventId, eventType, payload }) => {
      const existing = receipts.get(stripeEventId);
      if (existing) {
        existing.attempts += 1;
        existing.payload = clone(payload);
        existing.eventType = eventType;
        return clone(existing);
      }
      const receipt = {
        stripeEventId,
        eventType,
        payload: clone(payload),
        processingStatus: "received",
        attempts: 1
      };
      receipts.set(stripeEventId, receipt);
      return clone(receipt);
    }),
    markProcessed: jest.fn(async (stripeEventId) => {
      const receipt = receipts.get(stripeEventId);
      if (receipt) receipt.processingStatus = "processed";
      return receipt ? clone(receipt) : null;
    }),
    markFailed: jest.fn()
  },
  TenantAdminAuditLogModel: {
    create: jest.fn(async (row) => {
      auditRows.push(clone(row));
      return row;
    })
  },
  TenantModel: {
    findById: jest.fn(async (id) => clone(tenants.get(String(id)) || null)),
    findByStripeSubscriptionId: jest.fn(async (id) => {
      for (const tenant of tenants.values()) {
        if (tenant.stripeSubscriptionId === String(id)) return clone(tenant);
      }
      return null;
    }),
    findByStripeCustomerId: jest.fn(async (id) => {
      for (const tenant of tenants.values()) {
        if (tenant.stripeCustomerId === String(id)) return clone(tenant);
      }
      return null;
    }),
    update: tenantUpdate
  }
}));

const { processStripeEvent } = await import("../src/services/billing.js");
const {
  invoiceSubscriptionDetails,
  stripeLinePriceId,
  stripeObjectId,
  stripeSubscriptionId,
  stripeSubscriptionPeriodEnd
} = await import("../src/services/stripePayload.js");

beforeEach(() => {
  tenants.clear();
  receipts.clear();
  auditRows.length = 0;
  tenantUpdate.mockClear();
  seedTenant();
});

function event(id, type, object) {
  return { id, type, data: { object } };
}

test("current invoice.parent subscription_details maps by subscription and updates the period", async () => {
  const result = await processStripeEvent(event("evt_current_invoice", "invoice.paid", {
    id: "in_current",
    object: "invoice",
    status: "paid",
    parent: {
      type: "subscription_details",
      subscription_details: {
        subscription: { id: "sub_current" },
        metadata: { planCode: "flagship" }
      }
    },
    lines: { data: [{ period: { end: 1_800_000_000 } }] }
  }));

  expect(result).toMatchObject({ processed: true, duplicate: false });
  expect(tenants.get("tenant_1")).toMatchObject({
    billingStatus: "active",
    settings: {
      billing: {
        lifecycleStatus: "active",
        lastInvoiceId: "in_current",
        lastInvoiceStatus: "paid",
        currentPeriodEnd: new Date(1_800_000_000 * 1000).toISOString()
      }
    }
  });
  expect(receipts.get("evt_current_invoice").processingStatus).toBe("processed");
});

test("current invoice metadata-only parent maps by tenantId without subscription or customer", async () => {
  const result = await processStripeEvent(event("evt_current_metadata_only", "invoice.paid", {
    id: "in_current_metadata_only",
    object: "invoice",
    status: "paid",
    parent: {
      type: "subscription_details",
      subscription_details: {
        metadata: { tenantId: "tenant_1" }
      }
    },
    lines: { data: [{ period: { end: 1_805_000_000 } }] }
  }));

  expect(result).toMatchObject({ processed: true, duplicate: false });
  expect(tenants.get("tenant_1").settings.billing).toMatchObject({
    lastInvoiceId: "in_current_metadata_only",
    currentPeriodEnd: new Date(1_805_000_000 * 1000).toISOString()
  });
});

test("legacy invoice.subscription payload still maps and records the invoice", async () => {
  const tenant = tenants.get("tenant_1");
  tenant.stripeSubscriptionId = "sub_legacy";
  tenants.set("tenant_1", tenant);

  await processStripeEvent(event("evt_legacy_invoice", "invoice.paid", {
    id: "in_legacy",
    object: "invoice",
    status: "paid",
    subscription: "sub_legacy",
    lines: { data: [{ period: { end: 1_810_000_000 } }] }
  }));

  expect(tenants.get("tenant_1").settings.billing).toMatchObject({
    lastInvoiceId: "in_legacy",
    currentPeriodEnd: new Date(1_810_000_000 * 1000).toISOString()
  });
});

test("subscription updates use an item-level current_period_end when the top-level field is absent", async () => {
  await processStripeEvent(event("evt_subscription_item_period", "customer.subscription.updated", {
    id: "sub_current",
    customer: "cus_1",
    status: "active",
    items: {
      data: [
        { price: { id: "price_1U5aQJKmSeC5JnMuSjZD4smU", recurring: { interval: "year" } }, current_period_end: 1_820_000_000 },
        { price: { id: "price_add_on", recurring: { interval: "month" } }, current_period_end: 1_830_000_000 }
      ]
    }
  }));

  expect(tenants.get("tenant_1").settings.billing.currentPeriodEnd)
    .toBe(new Date(1_820_000_000 * 1000).toISOString());
});

test("the webhook receipt makes a replay observable as a duplicate without a second tenant update", async () => {
  const payload = {
    id: "in_duplicate",
    object: "invoice",
    status: "paid",
    subscription: "sub_current",
    lines: { data: [{ period: { end: 1_840_000_000 } }] }
  };
  const updatesBeforeReplay = tenantUpdate.mock.calls.length;
  const first = await processStripeEvent(event("evt_duplicate", "invoice.paid", payload));
  const updatesAfterFirst = tenantUpdate.mock.calls.length;
  const second = await processStripeEvent(event("evt_duplicate", "invoice.paid", payload));

  expect(first).toMatchObject({ processed: true, duplicate: false });
  expect(second).toMatchObject({ processed: false, duplicate: true });
  expect(updatesAfterFirst).toBeGreaterThan(updatesBeforeReplay);
  expect(tenantUpdate).toHaveBeenCalledTimes(updatesAfterFirst);
  expect(receipts.get("evt_duplicate").processingStatus).toBe("processed");
});

test("payload helpers reject wrong discriminators and normalize expanded IDs", () => {
  expect(invoiceSubscriptionDetails({ parent: { type: "invoice_details", subscription_details: {} } })).toEqual({});
  expect(stripeObjectId({ id: "cus_expanded" })).toBe("cus_expanded");
  expect(stripeSubscriptionId({ subscription: { id: "sub_expanded" } })).toBe("sub_expanded");
  expect(stripeSubscriptionId({ subscription: "sub_string" })).toBe("sub_string");
  expect(stripeLinePriceId({ pricing: { type: "price_details", price_details: { price: { id: "price_details_1" } } } }))
    .toBe("price_details_1");
  expect(stripeLinePriceId({ pricing: { type: "wrong", price_details: { price: { id: "ignored" } } } })).toBe("");
});

test("period helper prefers the recurring item over a later non-recurring item", () => {
  expect(stripeSubscriptionPeriodEnd({
    items: {
      data: [
        { price: { recurring: { interval: "year" } }, current_period_end: 1_850_000_000 },
        { price: {}, current_period_end: 1_860_000_000 }
      ]
    }
  })).toBe(1_850_000_000);
});
