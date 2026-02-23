import request from "supertest";
import { jest } from "@jest/globals";

jest.setTimeout(120000);

let app;
let connectToDatabase;
let clearAllDocuments;
let hashPassword;
let Tenant;
let User;

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
  return Tenant.create({
    name: name || `Camp ${slug}`,
    slug,
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
  process.env.STRIPE_PRICE_LEGACY_ANNUAL = "price_legacy_annual";
  process.env.STRIPE_PRICE_FOUNDERS_ANNUAL = "price_founders_annual";
  process.env.STRIPE_PRICE_INSTITUTIONAL_ANNUAL = "price_institutional_annual";
  process.env.STRIPE_PRICE_LEGACY_ONBOARDING = "price_legacy_onboarding";
  process.env.STRIPE_PRICE_INSTITUTIONAL_ONBOARDING = "price_institutional_onboarding";

  ({ connectToDatabase } = await import("../src/db/connect.js"));
  ({ clearAllDocuments } = await import("../src/db/supabaseDocumentModel.js"));
  ({ hashPassword } = await import("../src/utils/auth.js"));
  ({ Tenant } = await import("../src/models/Tenant.js"));
  ({ User } = await import("../src/models/User.js"));
  ({ default: app } = await import("../src/app.js"));

  await connectToDatabase();
});

afterEach(async () => {
  await clearAllDocuments();
});

afterAll(() => {});

describe("Stripe billing system", () => {
  test("tenant admin checkout stores canonical legacy billing metadata", async () => {
    const tenant = await createTenant({
      slug: "billing-legacy-checkout",
      onboardingStatus: "in_progress"
    });
    await createTenantAdmin(tenant._id, "director@legacy.test");
    const token = await loginTenant("billing-legacy-checkout", "director@legacy.test");

    const response = await request(app)
      .post("/api/tenants/me/billing/checkout")
      .set("Authorization", `Bearer ${token}`)
      .send({ planCode: "legacy" });

    expect(response.status).toBe(201);
    expect(response.body.ok).toBe(true);
    expect(response.body.checkoutUrl).toContain("mock-billing");
    expect(response.body.billing.billingPlan).toBe("legacy");
    expect(response.body.billing.onboardingFeeAmount).toBe(350);
    expect(response.body.billing.lifecycleStatus).toBe("checkout_started");

    const stored = await Tenant.findById(tenant._id);
    expect(stored.planTier).toBe("base");
    expect(Number(stored.onboardingFeeAmount)).toBe(350);
    expect(stored.onboardingFeePaid).toBe(false);
    expect(stored.settings?.billing?.planCode).toBe("legacy");
    expect(stored.settings?.billing?.lifecycleStatus).toBe("checkout_started");
  });

  test("tenant admin can start institutional checkout with premium feature tier mapping", async () => {
    const tenant = await createTenant({
      slug: "billing-institutional-checkout",
      onboardingStatus: "in_progress"
    });
    await createTenantAdmin(tenant._id, "director@institutional.test");
    const token = await loginTenant("billing-institutional-checkout", "director@institutional.test");

    const response = await request(app)
      .post("/api/tenants/me/billing/checkout")
      .set("Authorization", `Bearer ${token}`)
      .send({ planCode: "institutional" });

    expect(response.status).toBe(201);
    expect(response.body.ok).toBe(true);
    expect(response.body.billing.billingPlan).toBe("institutional");
    expect(response.body.billing.onboardingFeeAmount).toBe(750);

    const stored = await Tenant.findById(tenant._id);
    expect(stored.planTier).toBe("premium");
    expect(Number(stored.onboardingFeeAmount)).toBe(750);
    expect(stored.settings?.billing?.planCode).toBe("institutional");
    expect(stored.settings?.billing?.lifecycleStatus).toBe("checkout_started");
  });

  test("founders plan is capped at first 10 camps", async () => {
    await createSuperAdmin();
    const superToken = await loginSuper();

    const tenants = [];
    for (let i = 1; i <= 11; i += 1) {
      const tenant = await createTenant({
        slug: `founders-cap-${i}`,
        onboardingStatus: "in_progress"
      });
      tenants.push(tenant);
    }

    for (let i = 0; i < 10; i += 1) {
      const response = await request(app)
        .post("/api/tenants/me/billing/checkout")
        .set("Authorization", `Bearer ${superToken}`)
        .send({
          tenantId: String(tenants[i]._id),
          planCode: "founders"
        });

      expect(response.status).toBe(201);
      expect(response.body.billing.billingPlan).toBe("founders");
      expect(response.body.billing.onboardingFeeStatus).toBe("waived");
    }

    const eleventh = await request(app)
      .post("/api/tenants/me/billing/checkout")
      .set("Authorization", `Bearer ${superToken}`)
      .send({
        tenantId: String(tenants[10]._id),
        planCode: "founders"
      });

    expect(eleventh.status).toBe(409);
    expect(eleventh.body.error?.code).toBe("FOUNDERS_CAP_REACHED");
  });

  test("billing checkout rejects invalid plan codes", async () => {
    const tenant = await createTenant({
      slug: "billing-invalid-plan",
      onboardingStatus: "in_progress"
    });
    await createTenantAdmin(tenant._id, "director@invalid-plan.test");
    const token = await loginTenant("billing-invalid-plan", "director@invalid-plan.test");

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
      onboardingFeeAmount: 350,
      onboardingFeePaid: false,
      settings: {
        billing: {
          planCode: "legacy",
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
                price: { id: "price_legacy_onboarding" },
                description: "Legacy onboarding fee"
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

    const second = await request(app)
      .post("/api/webhooks/stripe")
      .send(payload);
    expect(second.status).toBe(200);

    const stored = await Tenant.findById(tenant._id);
    expect(stored.billingStatus).toBe("active");
    expect(stored.onboardingFeePaid).toBe(true);
    expect(stored.onboardingFeeInvoiceId).toBe("in_test_123");
    expect(stored.settings?.billing?.processedEventIds).toEqual(["evt_invoice_paid_dup_1"]);
  });

  test("invoice.payment_failed webhook transitions tenant into past_due lifecycle", async () => {
    const tenant = await createTenant({
      slug: "billing-webhook-failure",
      onboardingStatus: "live",
      billingStatus: "active",
      stripeCustomerId: "cus_test_fail",
      settings: {
        billing: {
          planCode: "legacy",
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

    const stored = await Tenant.findById(tenant._id);
    expect(stored.billingStatus).toBe("past_due");
    expect(stored.settings?.billing?.lifecycleStatus).toBe("past_due");
    expect(stored.settings?.billing?.lastInvoiceId).toBe("in_failed_123");
    expect(stored.settings?.billing?.processedEventIds).toEqual(["evt_invoice_failed_1"]);
  });

  test("tenant admin cannot start checkout for another tenant", async () => {
    const tenantA = await createTenant({ slug: "billing-scope-a", onboardingStatus: "live" });
    const tenantB = await createTenant({ slug: "billing-scope-b", onboardingStatus: "live" });

    await createTenantAdmin(tenantA._id, "director@scopea.test");
    const tokenA = await loginTenant("billing-scope-a", "director@scopea.test");

    const response = await request(app)
      .post("/api/tenants/me/billing/checkout")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({
        tenantId: String(tenantB._id),
        planCode: "legacy"
      });

    expect(response.status).toBe(403);
    expect(response.body.error?.code).toBe("TENANT_SCOPE_DENIED");
  });
});
