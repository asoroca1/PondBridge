import request from "supertest";
import { jest } from "@jest/globals";

jest.setTimeout(120000);

let app;
let connectToDatabase;
let clearAllDocuments;
let hashPassword;
let Tenant;
let User;
let StripeWebhookEventModel;
let stripeWebhookLedgerAvailable = false;
let slugCounter = 0;

function nextSlug(baseSlug = "tenant") {
  slugCounter += 1;
  return `${String(baseSlug || "tenant").trim()}-${slugCounter}`;
}

async function detectStripeWebhookLedger() {
  try {
    await StripeWebhookEventModel.findByStripeEventId("__ledger_probe__");
    return true;
  } catch (error) {
    const code = String(error?.code || "").trim().toUpperCase();
    const message = String(error?.message || "").toLowerCase();
    if (code === "PGRST205" || message.includes("stripe_webhook_events")) {
      return false;
    }
    throw error;
  }
}

async function createTenant({
  slug,
  name = "",
  onboardingStatus = "live",
  billingStatus = "trialing",
  stripeCustomerId = "",
  onboardingFeeAmount = 0,
  onboardingFeePaid = false,
  settings = {}
}) {
  const effectiveSlug = nextSlug(slug);
  return Tenant.create({
    name: name || `Camp ${effectiveSlug}`,
    slug: effectiveSlug,
    status: "active",
    planTier: "base",
    onboardingStatus,
    onboardingStep: onboardingStatus === "live" ? "review_launch" : "name_branding",
    billingStatus,
    stripeCustomerId,
    onboardingFeeAmount,
    onboardingFeePaid,
    settings
  });
}

async function createTenantAdmin(tenantId, email, password = "AdminPass123!") {
  const passwordHash = await hashPassword(password);
  await User.create({
    tenantId,
    email,
    passwordHash,
    roles: ["tenant_admin", "user"],
    status: "active"
  });
}

async function loginTenant(slug, email, password = "AdminPass123!") {
  const response = await request(app)
    .post(`/api/t/${slug}/auth/login`)
    .send({ email, password });
  expect(response.status).toBe(200);
  return response.body.token;
}

async function createSuperAdmin(email = "super@example.com", password = "SuperPass123!") {
  const passwordHash = await hashPassword(password);
  await User.create({
    tenantId: null,
    email,
    passwordHash,
    roles: ["super_admin", "support_admin", "finance_admin"],
    status: "active"
  });
}

async function loginSuper(email = "super@example.com", password = "SuperPass123!") {
  const response = await request(app)
    .post("/api/auth/super/login")
    .send({ email, password });
  expect(response.status).toBe(200);
  return response.body.token;
}

beforeAll(async () => {
  process.env.JWT_SECRET = "test-jwt-secret";
  process.env.JWT_EXPIRES_IN = "1h";
  process.env.BCRYPT_ROUNDS = "4";
  process.env.FRONTEND_ORIGIN = "http://localhost:5173";
  process.env.APP_BASE_DOMAIN = "pondbridge.test";
  process.env.BILLING_MODE = "mock";
  process.env.STRIPE_PRICE_FLAGSHIP_ANNUAL = "price_flagship_annual";
  process.env.STRIPE_PRICE_TEST_ANNUAL = "price_test_annual";

  ({ connectToDatabase } = await import("../src/db/connect.js"));
  ({ clearAllDocuments } = await import("../src/db/supabaseDocumentModel.js"));
  ({ hashPassword } = await import("../src/utils/auth.js"));
  ({ Tenant } = await import("../src/models/Tenant.js"));
  ({ User } = await import("../src/models/User.js"));
  ({ StripeWebhookEventModel } = await import("../src/db/models/index.js"));
  ({ default: app } = await import("../src/app.js"));

  await connectToDatabase();
  stripeWebhookLedgerAvailable = await detectStripeWebhookLedger();
});

afterEach(async () => {
  await clearAllDocuments();
});

afterAll(() => {});

describe("Stripe billing system", () => {
  test("billing catalog exposes the internal test tier only to allowlisted camps", async () => {
    const allowedTenant = await createTenant({
      slug: "billing-test-tier-allowed",
      onboardingStatus: "in_progress"
    });
    const controlTenant = await createTenant({
      slug: "billing-test-tier-control",
      onboardingStatus: "in_progress"
    });
    await createTenantAdmin(allowedTenant._id, "director@test-tier-allowed.test");
    await createTenantAdmin(controlTenant._id, "director@test-tier-control.test");

    const allowedToken = await loginTenant(allowedTenant.slug, "director@test-tier-allowed.test");
    const controlToken = await loginTenant(controlTenant.slug, "director@test-tier-control.test");

    const [allowedResponse, controlResponse] = await Promise.all([
      request(app).get("/api/tenants/me/billing").set("Authorization", `Bearer ${allowedToken}`),
      request(app).get("/api/tenants/me/billing").set("Authorization", `Bearer ${controlToken}`)
    ]);

    expect(allowedResponse.status).toBe(200);
    expect(controlResponse.status).toBe(200);
    expect(
      allowedResponse.body.catalog.plans.some((plan) => plan.code === "test" && plan.annualAmount === 10)
    ).toBe(true);
    expect(controlResponse.body.catalog.plans.some((plan) => plan.code === "test")).toBe(false);
  });

  test("tenant admin can start internal test checkout when the camp is allowlisted", async () => {
    const tenant = await createTenant({
      slug: "billing-test-tier-allowed",
      onboardingStatus: "in_progress"
    });
    await createTenantAdmin(tenant._id, "director@test-tier-checkout.test");
    const token = await loginTenant(tenant.slug, "director@test-tier-checkout.test");

    const response = await request(app)
      .post("/api/tenants/me/billing/checkout")
      .set("Authorization", `Bearer ${token}`)
      .send({ planCode: "test" });

    expect(response.status).toBe(201);
    expect(response.body.ok).toBe(true);
    expect(response.body.billing.billingPlan).toBe("test");
    expect(response.body.billing.onboardingFeeAmount).toBe(0);
    expect(response.body.billing.onboardingFeeStatus).toBe("waived");
    expect(
      response.body.catalog.plans.some((plan) => plan.code === "test" && plan.annualAmount === 10)
    ).toBe(true);

    const stored = await Tenant.findById(tenant._id);
    expect(stored.planTier).toBe("premium");
    expect(stored.settings?.billing?.planCode).toBe("test");
  });

  test("super admin can provision any camp onto the internal test tier", async () => {
    await createSuperAdmin();
    const superToken = await loginSuper();

    const response = await request(app)
      .post("/api/super/tenants")
      .set("Authorization", `Bearer ${superToken}`)
      .send({
        name: "Unlisted Internal Test Camp",
        slug: "billing-test-tier-unlisted",
        billingPlan: "test"
      });

    expect(response.status).toBe(201);
    expect(response.body.tenant?.settings?.billing?.planCode).toBe("test");
  });

  test("tenant admin checkout stores canonical flagship billing metadata", async () => {
    const tenant = await createTenant({
      slug: "billing-flagship-checkout",
      onboardingStatus: "in_progress"
    });
    await createTenantAdmin(tenant._id, "director@flagship.test");
    const token = await loginTenant(tenant.slug, "director@flagship.test");

    const response = await request(app)
      .post("/api/tenants/me/billing/checkout")
      .set("Authorization", `Bearer ${token}`)
      .send({ planCode: "flagship" });

    expect(response.status).toBe(201);
    expect(response.body.ok).toBe(true);
    expect(response.body.checkoutUrl).toContain("mock-billing");
    expect(response.body.billing.billingPlan).toBe("flagship");
    expect(response.body.billing.annualAmount).toBe(1200);
    expect(response.body.billing.onboardingFeeAmount).toBe(0);
    expect(response.body.billing.onboardingFeeStatus).toBe("waived");
    expect(response.body.billing.lifecycleStatus).toBe("checkout_started");

    const stored = await Tenant.findById(tenant._id);
    expect(stored.planTier).toBe("premium");
    expect(Number(stored.onboardingFeeAmount)).toBe(0);
    expect(stored.onboardingFeePaid).toBe(true);
    expect(stored.settings?.billing?.planCode).toBe("flagship");
    expect(stored.settings?.billing?.lifecycleStatus).toBe("checkout_started");
  });

  test("flagship is the only purchasable plan in the catalog", async () => {
    const tenant = await createTenant({
      slug: "billing-catalog-single-plan",
      onboardingStatus: "in_progress"
    });
    await createTenantAdmin(tenant._id, "director@catalog.test");
    const token = await loginTenant(tenant.slug, "director@catalog.test");

    const response = await request(app)
      .get("/api/tenants/me/billing")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.catalog.plans).toHaveLength(1);
    expect(response.body.catalog.plans[0]).toMatchObject({
      code: "flagship",
      annualAmount: 1200,
      onboardingFeeAmount: 0
    });
  });

  test("retired plan codes resolve to flagship and never add an onboarding fee", async () => {
    const tenant = await createTenant({
      slug: "billing-retired-plan-code",
      onboardingStatus: "in_progress"
    });
    await createTenantAdmin(tenant._id, "director@retired-plan.test");
    const token = await loginTenant(tenant.slug, "director@retired-plan.test");

    const response = await request(app)
      .post("/api/tenants/me/billing/checkout")
      .set("Authorization", `Bearer ${token}`)
      .send({ planCode: "institutional" });

    expect(response.status).toBe(400);
    expect(response.body.error?.code).toBe("INVALID_BILLING_PLAN");

    // Tenants already stored on a retired code still read as flagship.
    const stored = await createTenant({
      slug: "billing-retired-plan-stored",
      onboardingStatus: "live",
      billingStatus: "active",
      settings: {
        billing: {
          planCode: "institutional",
          lifecycleStatus: "active"
        }
      }
    });
    await createTenantAdmin(stored._id, "director@retired-stored.test");
    const storedToken = await loginTenant(stored.slug, "director@retired-stored.test");

    const storedResponse = await request(app)
      .get("/api/tenants/me/billing")
      .set("Authorization", `Bearer ${storedToken}`);

    expect(storedResponse.status).toBe(200);
    expect(storedResponse.body.billing.billingPlan).toBe("flagship");
    expect(storedResponse.body.billing.annualAmount).toBe(1200);
  });

  test("billing checkout rejects invalid plan codes", async () => {
    const tenant = await createTenant({
      slug: "billing-invalid-plan",
      onboardingStatus: "in_progress"
    });
    await createTenantAdmin(tenant._id, "director@invalid-plan.test");
    const token = await loginTenant(tenant.slug, "director@invalid-plan.test");

    const response = await request(app)
      .post("/api/tenants/me/billing/checkout")
      .set("Authorization", `Bearer ${token}`)
      .send({ planCode: "enterprise_plus_plus" });

    expect(response.status).toBe(400);
    expect(response.body.error?.code).toBe("INVALID_BILLING_PLAN");
  });

  test("webhook processing is idempotent for duplicate invoice.paid events", async () => {
    const tenant = await createTenant({
      slug: "billing-webhook-idempotent",
      onboardingStatus: "live",
      billingStatus: "trialing",
      stripeCustomerId: "cus_test_123",
      onboardingFeeAmount: 200,
      onboardingFeePaid: false,
      settings: {
        billing: {
          planCode: "flagship",
          lifecycleStatus: "checkout_started",
          processedEventIds: []
        }
      }
    });

    const payload = {
      id: "evt_invoice_paid_dup_1",
      type: "invoice.paid",
      data: {
        object: {
          id: "in_test_123",
          customer: "cus_test_123",
          status: "paid",
          lines: {
            data: [
              {
                price: { id: "price_onboarding_legacy_charge" },
                description: "Onboarding fee"
              }
            ]
          }
        }
      }
    };

    const first = await request(app)
      .post("/api/webhooks/stripe")
      .send(payload);
    expect(first.status).toBe(200);
    expect(first.body.processed).toBe(true);
    expect(first.body.duplicate).toBe(false);

    const second = await request(app)
      .post("/api/webhooks/stripe")
      .send(payload);
    expect(second.status).toBe(200);
    expect(second.body.processed).toBe(false);
    expect(second.body.duplicate).toBe(true);

    const stored = await Tenant.findById(tenant._id);
    expect(stored.billingStatus).toBe("active");
    expect(stored.onboardingFeePaid).toBe(true);
    expect(stored.onboardingFeeInvoiceId).toBe("in_test_123");

    if (stripeWebhookLedgerAvailable) {
      const eventLog = await StripeWebhookEventModel.findByStripeEventId("evt_invoice_paid_dup_1");
      expect(eventLog).toBeTruthy();
      expect(eventLog.processingStatus).toBe("processed");
      expect(eventLog.attempts).toBe(2);
      expect(eventLog.tenantId).toBe(String(tenant._id));
    } else {
      expect(stored.settings?.billing?.processedEventIds).toEqual(["evt_invoice_paid_dup_1"]);
    }
  });

  test("invoice.payment_failed webhook transitions tenant into past_due lifecycle", async () => {
    const tenant = await createTenant({
      slug: "billing-webhook-failure",
      onboardingStatus: "live",
      billingStatus: "active",
      stripeCustomerId: "cus_test_fail",
      settings: {
        billing: {
          planCode: "flagship",
          lifecycleStatus: "active",
          processedEventIds: []
        }
      }
    });

    const payload = {
      id: "evt_invoice_failed_1",
      type: "invoice.payment_failed",
      data: {
        object: {
          id: "in_failed_123",
          customer: "cus_test_fail",
          status: "open"
        }
      }
    };

    const response = await request(app)
      .post("/api/webhooks/stripe")
      .send(payload);
    expect(response.status).toBe(200);
    expect(response.body.processed).toBe(true);
    expect(response.body.duplicate).toBe(false);

    const stored = await Tenant.findById(tenant._id);
    expect(stored.billingStatus).toBe("past_due");
    expect(stored.settings?.billing?.lifecycleStatus).toBe("past_due");
    expect(stored.settings?.billing?.lastInvoiceId).toBe("in_failed_123");

    if (stripeWebhookLedgerAvailable) {
      const eventLog = await StripeWebhookEventModel.findByStripeEventId("evt_invoice_failed_1");
      expect(eventLog).toBeTruthy();
      expect(eventLog.processingStatus).toBe("processed");
      expect(eventLog.tenantId).toBe(String(tenant._id));
    } else {
      expect(stored.settings?.billing?.processedEventIds).toEqual(["evt_invoice_failed_1"]);
    }
  });

  test("new /api/stripe/webhook route accepts billing events", async () => {
    const tenant = await createTenant({
      slug: "billing-webhook-new-route",
      onboardingStatus: "live",
      billingStatus: "active",
      stripeCustomerId: "cus_test_new_route",
      settings: {
        billing: {
          planCode: "flagship",
          lifecycleStatus: "active",
          processedEventIds: []
        }
      }
    });

    const payload = {
      id: "evt_invoice_failed_new_route",
      type: "invoice.payment_failed",
      data: {
        object: {
          id: "in_failed_new_route",
          customer: "cus_test_new_route",
          status: "open"
        }
      }
    };

    const response = await request(app)
      .post("/api/stripe/webhook")
      .send(payload);
    expect(response.status).toBe(200);
    expect(response.body.received).toBe(true);
    expect(response.body.type).toBe("invoice.payment_failed");

    const stored = await Tenant.findById(tenant._id);
    expect(stored.billingStatus).toBe("past_due");
    expect(stored.settings?.billing?.lifecycleStatus).toBe("past_due");
  });

  test("webhook failures are recorded when Stripe payload cannot map to a tenant", async () => {
    const payload = {
      id: "evt_invoice_unknown_tenant",
      type: "invoice.paid",
      data: {
        object: {
          id: "in_unknown_001",
          customer: "cus_does_not_exist",
          status: "paid",
          lines: { data: [] }
        }
      }
    };

    const response = await request(app)
      .post("/api/webhooks/stripe")
      .send(payload);

    expect(response.status).toBe(422);
    expect(response.body.error?.code).toBe("BILLING_TENANT_NOT_FOUND");

    if (stripeWebhookLedgerAvailable) {
      const eventLog = await StripeWebhookEventModel.findByStripeEventId("evt_invoice_unknown_tenant");
      expect(eventLog).toBeTruthy();
      expect(eventLog.processingStatus).toBe("failed");
      expect(eventLog.errorCode).toBe("BILLING_TENANT_NOT_FOUND");
      expect(eventLog.errorMessage).toContain("Unable to map Stripe event");
    }
  });

  test("tenant admin cannot start checkout for another tenant", async () => {
    const tenantA = await createTenant({ slug: "billing-scope-a", onboardingStatus: "live" });
    const tenantB = await createTenant({ slug: "billing-scope-b", onboardingStatus: "live" });

    await createTenantAdmin(tenantA._id, "director@scopea.test");
    const tokenA = await loginTenant(tenantA.slug, "director@scopea.test");

    const response = await request(app)
      .post("/api/tenants/me/billing/checkout")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({
        tenantId: String(tenantB._id),
        planCode: "flagship"
      });

    expect(response.status).toBe(403);
    expect(response.body.error?.code).toBe("TENANT_SCOPE_DENIED");
  });
});
