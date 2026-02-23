import Stripe from "stripe";
import { env } from "../config/env.js";
import { TenantModel } from "../db/models/index.js";

const STRIPE_STATUS_MAP = {
  trialing: "trialing",
  active: "active",
  past_due: "past_due",
  canceled: "canceled",
  unpaid: "past_due",
  incomplete: "past_due",
  incomplete_expired: "past_due",
  paused: "past_due"
};

const stripe = env.STRIPE_SECRET_KEY
  ? new Stripe(env.STRIPE_SECRET_KEY, {
      apiVersion: "2024-06-20"
    })
  : null;

export function getBillingMode() {
  if (env.BILLING_MODE === "mock") return "mock";
  if (env.BILLING_MODE === "stripe") return stripe ? "stripe" : "mock";
  return stripe ? "stripe" : "mock";
}

export function isStripeEnabled() {
  return getBillingMode() === "stripe";
}

export function getPriceIdForPlan(planTier = "base") {
  return planTier === "premium" ? env.STRIPE_PRICE_PREMIUM : env.STRIPE_PRICE_BASE;
}

export function getOnboardingPriceIdForPlan(planTier = "base") {
  return planTier === "premium"
    ? env.STRIPE_ONBOARDING_PRICE_PREMIUM
    : env.STRIPE_ONBOARDING_PRICE_BASE;
}

function mapStripeStatus(status = "") {
  return STRIPE_STATUS_MAP[String(status || "").toLowerCase()] || "past_due";
}

function defaultSuccessUrl(tenant) {
  return `${env.FRONTEND_ORIGIN}/t/${tenant.slug}/admin/billing?checkout=success`;
}

function defaultCancelUrl(tenant) {
  return `${env.FRONTEND_ORIGIN}/t/${tenant.slug}/admin/billing?checkout=cancel`;
}

async function ensureStripeCustomer(tenant) {
  if (tenant.stripeCustomerId) {
    return tenant.stripeCustomerId;
  }

  const customer = await stripe.customers.create({
    name: tenant.name,
    metadata: {
      tenantId: String(tenant._id),
      tenantSlug: tenant.slug
    }
  });

  await TenantModel.update(tenant._id, { stripeCustomerId: customer.id });

  return customer.id;
}

export async function createTenantCheckoutSession({
  tenant,
  planTier,
  onboardingFeeAmount,
  successUrl,
  cancelUrl
}) {
  const mode = getBillingMode();
  const normalizedPlan = planTier === "premium" ? "premium" : "base";
  const normalizedOnboardingFee = Number(onboardingFeeAmount || 0);

  if (mode === "mock") {
    const mockSessionId = `mock_cs_${Date.now()}_${tenant.slug}`;
    const mockCheckoutUrl = `${env.MOCK_BILLING_BASE_URL}/checkout?tenant=${encodeURIComponent(
      tenant.slug
    )}&plan=${normalizedPlan}&session=${mockSessionId}`;

    await TenantModel.update(tenant._id, {
      planTier: normalizedPlan,
      onboardingFeeAmount: normalizedOnboardingFee,
      stripePriceId: getPriceIdForPlan(normalizedPlan) || `mock_price_${normalizedPlan}`,
      billingStatus: "trialing",
      onboardingFeePaid: normalizedOnboardingFee <= 0
    });

    return {
      mode,
      sessionId: mockSessionId,
      checkoutUrl: mockCheckoutUrl,
      message:
        "Mock billing mode active. Set STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET to enable live Stripe checkout."
    };
  }

  const planPriceId = getPriceIdForPlan(normalizedPlan);
  if (!planPriceId) {
    const error = new Error(
      `Missing Stripe price for ${normalizedPlan} plan. Set STRIPE_PRICE_${
        normalizedPlan === "premium" ? "PREMIUM" : "BASE"
      }.`
    );
    error.statusCode = 400;
    error.code = "STRIPE_PRICE_MISSING";
    throw error;
  }

  const customerId = await ensureStripeCustomer(tenant);
  const lineItems = [{ price: planPriceId, quantity: 1 }];

  if (normalizedOnboardingFee > 0) {
    const onboardingPriceId = getOnboardingPriceIdForPlan(normalizedPlan);

    if (onboardingPriceId) {
      lineItems.push({ price: onboardingPriceId, quantity: 1 });
    } else {
      lineItems.push({
        price_data: {
          currency: env.STRIPE_CURRENCY,
          product_data: {
            name: `${tenant.name} onboarding fee`
          },
          unit_amount: Math.round(normalizedOnboardingFee * 100)
        },
        quantity: 1
      });
    }
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: lineItems,
    success_url: successUrl || env.STRIPE_SUCCESS_URL || defaultSuccessUrl(tenant),
    cancel_url: cancelUrl || env.STRIPE_CANCEL_URL || defaultCancelUrl(tenant),
    client_reference_id: String(tenant._id),
    allow_promotion_codes: true,
    metadata: {
      tenantId: String(tenant._id),
      planTier: normalizedPlan,
      onboardingFeeAmount: String(normalizedOnboardingFee)
    },
    subscription_data: {
      metadata: {
        tenantId: String(tenant._id),
        planTier: normalizedPlan
      }
    }
  });

  await TenantModel.update(tenant._id, {
    planTier: normalizedPlan,
    onboardingFeeAmount: normalizedOnboardingFee,
    stripeCustomerId: customerId,
    stripePriceId: planPriceId,
    billingStatus: "trialing",
    onboardingFeePaid: normalizedOnboardingFee <= 0
  });

  return {
    mode,
    sessionId: session.id,
    checkoutUrl: session.url
  };
}

function extractTenantIdFromEventPayload(eventPayload = {}) {
  return (
    eventPayload?.metadata?.tenantId ||
    eventPayload?.client_reference_id ||
    eventPayload?.subscription_details?.metadata?.tenantId ||
    ""
  );
}

async function findTenantForSubscriptionEvent(payload = {}) {
  const tenantId = extractTenantIdFromEventPayload(payload);
  if (tenantId) {
    return TenantModel.findById(tenantId);
  }

  if (payload.id) {
    const bySubId = await TenantModel.findByStripeSubscriptionId(payload.id);
    if (bySubId) return bySubId;
  }

  if (payload.customer) {
    return TenantModel.findByStripeCustomerId(payload.customer);
  }

  return null;
}

function invoiceContainsOnboardingFee(invoice, tenantPlanTier) {
  const onboardingPriceId = getOnboardingPriceIdForPlan(tenantPlanTier);
  const lines = invoice?.lines?.data || [];

  if (onboardingPriceId) {
    return lines.some((line) => line?.price?.id === onboardingPriceId);
  }

  return lines.some((line) => String(line?.description || "").toLowerCase().includes("onboarding"));
}

async function handleCheckoutSessionCompleted(session) {
  const tenantId = extractTenantIdFromEventPayload(session);
  if (!tenantId) return;

  const tenant = await TenantModel.findById(tenantId);
  if (!tenant) return;

  const update = {
    stripeCustomerId: session.customer || tenant.stripeCustomerId,
    stripeSubscriptionId: session.subscription || tenant.stripeSubscriptionId,
    billingStatus: "active"
  };

  if (Number(tenant.onboardingFeeAmount || 0) <= 0) {
    update.onboardingFeePaid = true;
  }

  if (session.subscription && stripe) {
    const subscription = await stripe.subscriptions.retrieve(session.subscription);
    update.billingStatus = mapStripeStatus(subscription.status);
    update.stripePriceId = subscription?.items?.data?.[0]?.price?.id || tenant.stripePriceId;
  }

  await TenantModel.update(tenant._id, update);
}

async function handleSubscriptionUpdate(subscription) {
  const tenant = await findTenantForSubscriptionEvent(subscription);
  if (!tenant) return;

  const update = {
    stripeCustomerId: subscription.customer || tenant.stripeCustomerId,
    stripeSubscriptionId: subscription.id || tenant.stripeSubscriptionId,
    stripePriceId: subscription?.items?.data?.[0]?.price?.id || tenant.stripePriceId,
    billingStatus: mapStripeStatus(subscription.status)
  };

  await TenantModel.update(tenant._id, update);
}

async function handleInvoicePaid(invoice) {
  const tenant =
    (invoice.customer && (await TenantModel.findByStripeCustomerId(invoice.customer))) || null;
  if (!tenant) return;

  const update = {
    billingStatus: "active"
  };

  if (invoiceContainsOnboardingFee(invoice, tenant.planTier)) {
    update.onboardingFeePaid = true;
    update.onboardingFeeInvoiceId = invoice.id;
  }

  await TenantModel.update(tenant._id, update);
}

async function handleInvoicePaymentFailed(invoice) {
  const tenant =
    (invoice.customer && (await TenantModel.findByStripeCustomerId(invoice.customer))) || null;
  if (!tenant) return;

  await TenantModel.update(tenant._id, { billingStatus: "past_due" });
}

export async function processStripeEvent(event) {
  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutSessionCompleted(event.data.object);
      break;
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await handleSubscriptionUpdate(event.data.object);
      break;
    case "invoice.paid":
      await handleInvoicePaid(event.data.object);
      break;
    case "invoice.payment_failed":
      await handleInvoicePaymentFailed(event.data.object);
      break;
    default:
      break;
  }
}

export async function constructStripeEventFromRequest(req) {
  if (getBillingMode() === "mock") {
    const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : JSON.stringify(req.body || {});
    const body = raw ? JSON.parse(raw) : {};

    if (!body.type) {
      const error = new Error("Mock webhook payload must include event type");
      error.statusCode = 400;
      error.code = "WEBHOOK_TYPE_REQUIRED";
      throw error;
    }

    return {
      id: body.id || `mock_evt_${Date.now()}`,
      type: body.type,
      data: body.data || { object: body.object || {} }
    };
  }

  const signature = req.headers["stripe-signature"];
  if (!signature) {
    const error = new Error("Missing Stripe signature header");
    error.statusCode = 400;
    error.code = "STRIPE_SIGNATURE_MISSING";
    throw error;
  }

  if (!env.STRIPE_WEBHOOK_SECRET) {
    const error = new Error("Missing STRIPE_WEBHOOK_SECRET");
    error.statusCode = 500;
    error.code = "STRIPE_WEBHOOK_SECRET_MISSING";
    throw error;
  }

  return stripe.webhooks.constructEvent(req.body, signature, env.STRIPE_WEBHOOK_SECRET);
}

export async function createBillingPortalUrl({ tenant, returnUrl }) {
  const mode = getBillingMode();
  const fallbackUrl = `${env.MOCK_BILLING_BASE_URL}/portal?tenant=${encodeURIComponent(tenant.slug)}`;

  if (mode === "mock") {
    return {
      mode,
      url: fallbackUrl,
      message:
        "Mock billing mode active. Stripe Billing Portal will be available after STRIPE_SECRET_KEY is configured."
    };
  }

  if (!tenant.stripeCustomerId) {
    return { mode, url: "" };
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: tenant.stripeCustomerId,
    return_url:
      returnUrl || env.STRIPE_BILLING_PORTAL_RETURN_URL || `${env.FRONTEND_ORIGIN}/t/${tenant.slug}/admin/billing`
  });

  return {
    mode,
    url: session.url
  };
}
