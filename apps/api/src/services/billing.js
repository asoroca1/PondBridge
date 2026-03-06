import Stripe from "stripe";
import { env } from "../config/env.js";
import {
  StripeWebhookEventModel,
  TenantAdminAuditLogModel,
  TenantModel
} from "../db/models/index.js";
import {
  buildTenantSettingsWithBillingPatch,
  isBillingReadyForLaunch,
  mapStripeLifecycleStatus,
  normalizeBillingPlan,
  resolveFeatureTierFromBillingPlan,
  resolveTenantBilling,
  toLegacyBillingStatusFromLifecycle
} from "./billingState.js";

const FOUNDERS_MAX_CAMPS = 5;
const ONBOARDING_FEE_UNPAID = "unpaid";
const ONBOARDING_FEE_PAID = "paid";
const ONBOARDING_FEE_WAIVED = "waived";

const stripe = env.STRIPE_SECRET_KEY
  ? new Stripe(env.STRIPE_SECRET_KEY, {
      apiVersion: "2024-06-20"
    })
  : null;

const BILLING_PLAN_CATALOG = {
  legacy: {
    code: "legacy",
    label: "Legacy",
    description: "Legacy annual plan",
    planTier: "base",
    annualAmount: 3500,
    onboardingFeeAmount: 350,
    annualPriceId: String(env.STRIPE_PRICE_LEGACY_ANNUAL || env.STRIPE_PRICE_BASE || "").trim(),
    onboardingPriceId: String(
      env.STRIPE_PRICE_LEGACY_ONBOARDING || env.STRIPE_ONBOARDING_PRICE_BASE || ""
    ).trim(),
    foundersOnly: false
  },
  founders: {
    code: "founders",
    label: "Founders",
    description: "Founders annual plan (first 5 camps)",
    planTier: "premium",
    annualAmount: 2800,
    onboardingFeeAmount: 0,
    annualPriceId: String(env.STRIPE_PRICE_FOUNDERS_ANNUAL || "").trim(),
    onboardingPriceId: "",
    foundersOnly: true
  },
  institutional: {
    code: "institutional",
    label: "Institutional",
    description: "Institutional annual plan",
    planTier: "premium",
    annualAmount: 5500,
    onboardingFeeAmount: 750,
    annualPriceId: String(env.STRIPE_PRICE_INSTITUTIONAL_ANNUAL || env.STRIPE_PRICE_PREMIUM || "").trim(),
    onboardingPriceId: String(
      env.STRIPE_PRICE_INSTITUTIONAL_ONBOARDING || env.STRIPE_ONBOARDING_PRICE_PREMIUM || ""
    ).trim(),
    foundersOnly: false
  }
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nowIso() {
  return new Date().toISOString();
}

function normalizePlanCode(value = "", fallbackTier = "base") {
  return normalizeBillingPlan(value, fallbackTier);
}

function getCatalogEntry(planCode = "legacy") {
  return BILLING_PLAN_CATALOG[normalizePlanCode(planCode)] || BILLING_PLAN_CATALOG.legacy;
}

function dedupeEventIds(values = []) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  )].slice(-250);
}

function pickTenantIdFromPayload(payload = {}) {
  return (
    String(payload?.metadata?.tenantId || "").trim() ||
    String(payload?.client_reference_id || "").trim() ||
    String(payload?.subscription_details?.metadata?.tenantId || "").trim()
  );
}

function defaultSuccessUrl(tenant) {
  return `${env.FRONTEND_ORIGIN}/t/${tenant.slug}/admin/billing?checkout=success`;
}

function defaultCancelUrl(tenant) {
  return `${env.FRONTEND_ORIGIN}/t/${tenant.slug}/admin/billing?checkout=cancel`;
}

function allowMockBilling() {
  return env.NODE_ENV !== "production" || env.ALLOW_MOCK_BILLING_IN_PRODUCTION;
}

function lifecycleTransitionAllowed(currentStatus = "", nextStatus = "", eventType = "") {
  const current = String(currentStatus || "").trim().toLowerCase();
  const next = String(nextStatus || "").trim().toLowerCase();
  const event = String(eventType || "").trim().toLowerCase();
  if (!next) return false;
  if (!current || current === next) return true;

  if (current === "canceled") {
    return (
      next === "active" ||
      next === "trialing" ||
      (next === "checkout_started" && event === "checkout.session.completed")
    );
  }

  if (
    (current === "active" || current === "trialing") &&
    (next === "checkout_started" || next === "uninitialized" || next === "incomplete")
  ) {
    return false;
  }

  if (current === "past_due" && (next === "checkout_started" || next === "uninitialized")) {
    return false;
  }

  if (current === "active" && next === "trialing") return false;
  return true;
}

function coerceLifecycleTransition(tenant, requestedStatus = "", eventType = "") {
  const currentStatus = resolveTenantBilling(tenant).lifecycleStatus;
  const nextStatus = String(requestedStatus || "").trim().toLowerCase();
  if (!nextStatus) return currentStatus;
  if (lifecycleTransitionAllowed(currentStatus, nextStatus, eventType)) return nextStatus;
  return currentStatus;
}

function coerceOnboardingFeeStatus(tenant, requestedStatus = "", { allowPaidRegression = false } = {}) {
  const currentStatus = resolveTenantBilling(tenant).onboardingFeeStatus;
  const nextStatus = String(requestedStatus || "").trim().toLowerCase();
  if (!nextStatus) return currentStatus;
  if (allowPaidRegression) return nextStatus;
  if (currentStatus === ONBOARDING_FEE_PAID && nextStatus === ONBOARDING_FEE_UNPAID) {
    return ONBOARDING_FEE_PAID;
  }
  return nextStatus;
}

function isStripeWebhookLedgerUnavailableError(error) {
  const code = String(error?.code || "").trim().toUpperCase();
  const message = String(error?.message || "").toLowerCase();
  const details = String(error?.details || "").toLowerCase();
  return (
    code === "PGRST205" ||
    code === "42P01" ||
    message.includes("schema cache") ||
    details.includes("schema cache") ||
    message.includes("stripe_webhook_events") ||
    details.includes("stripe_webhook_events") ||
    (message.includes("relation") && message.includes("does not exist"))
  );
}

function pickStripeCustomerIdFromPayload(payload = {}) {
  return String(
    payload?.customer || payload?.data?.object?.customer || payload?.metadata?.customer || ""
  )
    .trim();
}

function pickStripeSubscriptionIdFromPayload(payload = {}) {
  const explicit = String(
    payload?.subscription ||
      payload?.data?.object?.subscription ||
      payload?.metadata?.subscriptionId ||
      ""
  ).trim();
  if (explicit) return explicit;

  const maybeSubscriptionId = String(payload?.id || "").trim();
  if (maybeSubscriptionId.startsWith("sub_")) return maybeSubscriptionId;
  return "";
}

function buildWebhookTenantContext(tenant, payload = {}) {
  return {
    tenantId: String(tenant?._id || tenant?.id || "").trim() || null,
    tenantSlug: String(tenant?.slug || "").trim(),
    stripeCustomerId:
      String(tenant?.stripeCustomerId || "").trim() || pickStripeCustomerIdFromPayload(payload),
    stripeSubscriptionId:
      String(tenant?.stripeSubscriptionId || "").trim() || pickStripeSubscriptionIdFromPayload(payload)
  };
}

async function writeBillingAudit(tenantId, event, metadata = {}) {
  if (!tenantId || !event) return;
  await TenantAdminAuditLogModel.create({
    tenantId,
    actorUserId: null,
    event,
    metadata
  });
}

async function updateTenantWithBillingPatch(tenant, { tenantPatch = {}, billingPatch = {} } = {}) {
  const tenantId = String(tenant?._id || tenant?.id || "").trim();
  if (!tenantId) {
    const error = new Error("Tenant ID is required for billing update.");
    error.code = "TENANT_ID_REQUIRED";
    error.statusCode = 400;
    throw error;
  }

  const patch = {
    ...tenantPatch
  };

  if (isPlainObject(billingPatch) && Object.keys(billingPatch).length > 0) {
    patch.settings = buildTenantSettingsWithBillingPatch(tenant, billingPatch);
  }

  return TenantModel.update(tenantId, patch);
}

async function ensureStripeCustomer(tenant, billingOperator = null) {
  const tenantId = String(tenant?._id || tenant?.id || "").trim();
  if (!tenantId) {
    const error = new Error("Tenant ID is required to provision Stripe customer.");
    error.code = "TENANT_ID_REQUIRED";
    error.statusCode = 400;
    throw error;
  }

  if (tenant.stripeCustomerId) {
    return tenant.stripeCustomerId;
  }

  const contactEmail =
    String(tenant?.billingDetails?.mailingAddress?.email || "").trim().toLowerCase() ||
    String(tenant?.content?.contactEmail || "").trim().toLowerCase() ||
    String(billingOperator?.email || "").trim().toLowerCase();

  const customer = await stripe.customers.create({
    name: tenant.name,
    ...(contactEmail ? { email: contactEmail } : {}),
    metadata: {
      tenantId,
      tenantSlug: tenant.slug
    }
  });

  await TenantModel.update(tenantId, { stripeCustomerId: customer.id });
  return customer.id;
}

function getPlanCodeFromTenant(tenant) {
  const billing = resolveTenantBilling(tenant);
  return billing.billingPlan;
}

function getPlanCodeFromStripePriceId(priceId = "", tenant = null) {
  const price = String(priceId || "").trim();
  if (!price) return tenant ? getPlanCodeFromTenant(tenant) : "legacy";

  for (const entry of Object.values(BILLING_PLAN_CATALOG)) {
    if (price === entry.annualPriceId || price === entry.onboardingPriceId) {
      return entry.code;
    }
  }

  return tenant ? getPlanCodeFromTenant(tenant) : "legacy";
}

function hasOnboardingFeeLine(invoice, tenant = null) {
  const lines = invoice?.lines?.data || [];
  const planCode = tenant ? getPlanCodeFromTenant(tenant) : "legacy";
  const catalog = getCatalogEntry(planCode);
  const knownOnboardingPriceIds = new Set(
    Object.values(BILLING_PLAN_CATALOG)
      .map((entry) => String(entry.onboardingPriceId || "").trim())
      .filter(Boolean)
  );
  if (catalog.onboardingPriceId) {
    knownOnboardingPriceIds.add(catalog.onboardingPriceId);
  }

  return lines.some((line) => {
    const priceId = String(line?.price?.id || "").trim();
    if (knownOnboardingPriceIds.has(priceId)) return true;
    const description = String(line?.description || "").trim().toLowerCase();
    const metadataType = String(line?.metadata?.lineType || "").trim().toLowerCase();
    return description.includes("onboarding") || metadataType === "onboarding_fee";
  });
}

function inferCheckoutLifecycleStatus(session = {}) {
  const paymentStatus = String(session.payment_status || "").trim().toLowerCase();
  if (paymentStatus === "paid") return "active";
  if (paymentStatus === "unpaid" || paymentStatus === "no_payment_required") return "checkout_started";
  return "checkout_started";
}

async function listFoundersReservations() {
  const tenants = await TenantModel.find({}, {
    select: ["id", "slug", "settings", "planTier"]
  });

  return tenants
    .map((tenant) => ({
      tenantId: String(tenant._id),
      slug: tenant.slug,
      billing: resolveTenantBilling(tenant)
    }))
    .filter((item) => item.billing.foundersReserved || item.billing.billingPlan === "founders")
    .sort((a, b) => {
      const at = new Date(a.billing.foundersReservedAt || 0).getTime();
      const bt = new Date(b.billing.foundersReservedAt || 0).getTime();
      return at - bt;
    });
}

function nextAvailableFoundersSlot(reservations = []) {
  const used = new Set(
    reservations
      .map((entry) => Number(entry.billing.foundersSlot))
      .filter((slot) => Number.isInteger(slot) && slot >= 1 && slot <= FOUNDERS_MAX_CAMPS)
  );
  for (let slot = 1; slot <= FOUNDERS_MAX_CAMPS; slot += 1) {
    if (!used.has(slot)) return slot;
  }
  return null;
}

async function ensureFoundersReservation(tenant) {
  const billing = resolveTenantBilling(tenant);
  if (billing.foundersReserved) {
    return { tenant, slot: billing.foundersSlot || null };
  }

  const reservations = await listFoundersReservations();
  if (reservations.length >= FOUNDERS_MAX_CAMPS) {
    const error = new Error("Founders plan is no longer available.");
    error.statusCode = 409;
    error.code = "FOUNDERS_CAP_REACHED";
    throw error;
  }

  const slot = nextAvailableFoundersSlot(reservations);
  if (!slot) {
    const error = new Error("Founders plan is no longer available.");
    error.statusCode = 409;
    error.code = "FOUNDERS_CAP_REACHED";
    throw error;
  }

  const updated = await updateTenantWithBillingPatch(tenant, {
    billingPatch: {
      foundersReserved: true,
      foundersReservedAt: nowIso(),
      foundersSlot: slot,
      foundersEligible: true
    }
  });

  await writeBillingAudit(tenant._id, "founders_slot_reserved", {
    slot
  }).catch(() => {});

  return { tenant: updated, slot };
}

async function findTenantForStripePayload(payload = {}) {
  const tenantId = pickTenantIdFromPayload(payload);
  if (tenantId) {
    const byId = await TenantModel.findById(tenantId);
    if (byId) return byId;
  }

  const subscriptionId = String(payload?.subscription || payload?.id || "").trim();
  if (subscriptionId) {
    const bySub = await TenantModel.findByStripeSubscriptionId(subscriptionId);
    if (bySub) return bySub;
  }

  const customerId = String(payload?.customer || "").trim();
  if (customerId) {
    const byCustomer = await TenantModel.findByStripeCustomerId(customerId);
    if (byCustomer) return byCustomer;
  }

  return null;
}

async function appendProcessedEventId(tenant, eventId = "") {
  const id = String(eventId || "").trim();
  if (!id) return tenant;

  const billing = resolveTenantBilling(tenant);
  if (billing.processedEventIds.includes(id)) {
    return null;
  }

  const updated = await updateTenantWithBillingPatch(tenant, {
    billingPatch: {
      processedEventIds: dedupeEventIds([...billing.processedEventIds, id])
    }
  });

  return updated;
}

async function registerStripeWebhookEventReceipt(event = {}) {
  const eventId = String(event?.id || "").trim();
  const eventType = String(event?.type || "").trim();
  if (!eventId || !eventType) {
    return {
      available: true,
      duplicateProcessed: false,
      record: null
    };
  }

  try {
    const receipt = await StripeWebhookEventModel.recordReceipt({
      stripeEventId: eventId,
      eventType,
      payload: event
    });
    return {
      available: true,
      duplicateProcessed: String(receipt?.processingStatus || "").trim().toLowerCase() === "processed",
      record: receipt
    };
  } catch (error) {
    if (!isStripeWebhookLedgerUnavailableError(error)) throw error;
    return {
      available: false,
      duplicateProcessed: false,
      record: null
    };
  }
}

async function markStripeWebhookEventProcessed(event = {}, context = {}) {
  try {
    await StripeWebhookEventModel.markProcessed(String(event?.id || "").trim(), context);
  } catch (error) {
    if (!isStripeWebhookLedgerUnavailableError(error)) throw error;
  }
}

async function markStripeWebhookEventFailed(event = {}, errorValue, context = {}) {
  try {
    await StripeWebhookEventModel.markFailed(String(event?.id || "").trim(), errorValue, context);
  } catch (error) {
    if (!isStripeWebhookLedgerUnavailableError(error)) throw error;
  }
}

export function getBillingMode() {
  if (env.BILLING_MODE === "mock") return "mock";
  if (env.BILLING_MODE === "stripe") return stripe ? "stripe" : "mock";
  return stripe ? "stripe" : "mock";
}

export function isStripeEnabled() {
  return getBillingMode() === "stripe";
}

export function getPriceIdForPlan(planTier = "base") {
  return String(planTier || "").trim().toLowerCase() === "premium"
    ? BILLING_PLAN_CATALOG.institutional.annualPriceId
    : BILLING_PLAN_CATALOG.legacy.annualPriceId;
}

export function getOnboardingPriceIdForPlan(planTier = "base") {
  return String(planTier || "").trim().toLowerCase() === "premium"
    ? BILLING_PLAN_CATALOG.institutional.onboardingPriceId
    : BILLING_PLAN_CATALOG.legacy.onboardingPriceId;
}

export async function getFoundersAvailability() {
  const reservations = await listFoundersReservations();
  return {
    max: FOUNDERS_MAX_CAMPS,
    reserved: reservations.length,
    remaining: Math.max(0, FOUNDERS_MAX_CAMPS - reservations.length)
  };
}

export function getBillingCatalog() {
  return {
    plans: Object.values(BILLING_PLAN_CATALOG).map((entry) => ({
      code: entry.code,
      label: entry.label,
      description: entry.description,
      planTier: entry.planTier,
      annualAmount: entry.annualAmount,
      onboardingFeeAmount: entry.onboardingFeeAmount,
      foundersOnly: entry.foundersOnly,
      hasAnnualPriceId: Boolean(entry.annualPriceId),
      hasOnboardingPriceId: entry.onboardingFeeAmount > 0 ? Boolean(entry.onboardingPriceId) : true
    })),
    founders: {
      maxCamps: FOUNDERS_MAX_CAMPS
    }
  };
}

export async function createTenantCheckoutSession({
  tenant,
  billingOperator = null,
  planCode = "",
  planTier = "",
  successUrl,
  cancelUrl
}) {
  const mode = getBillingMode();
  const currentBilling = resolveTenantBilling(tenant);
  const planCodeFromTier = String(planTier || "").trim().toLowerCase() === "premium"
    ? "institutional"
    : String(planTier || "").trim().toLowerCase() === "base"
    ? "legacy"
    : "";
  const normalizedPlanCode = normalizePlanCode(
    planCode || planCodeFromTier || currentBilling.billingPlan,
    tenant.planTier
  );
  const catalogEntry = getCatalogEntry(normalizedPlanCode);
  let tenantForUpdate = tenant;

  if (catalogEntry.code === "founders") {
    const reserved = await ensureFoundersReservation(tenantForUpdate);
    tenantForUpdate = reserved.tenant;
  }

  const planTierForFeatures = resolveFeatureTierFromBillingPlan(catalogEntry.code);
  const onboardingFeeAmount = catalogEntry.onboardingFeeAmount;
  const onboardingFeeStatus =
    onboardingFeeAmount <= 0 ? ONBOARDING_FEE_WAIVED : ONBOARDING_FEE_UNPAID;
  const onboardingFeeWaived = onboardingFeeStatus === ONBOARDING_FEE_WAIVED;

  if (mode === "mock") {
    if (!allowMockBilling()) {
      const error = new Error(
        "Mock billing mode is disabled in production. Configure Stripe keys or explicitly allow mock billing."
      );
      error.statusCode = 503;
      error.code = "MOCK_BILLING_DISABLED";
      throw error;
    }

    const mockSessionId = `mock_cs_${Date.now()}_${tenant.slug}`;
    const mockCheckoutUrl = `${env.MOCK_BILLING_BASE_URL}/checkout?tenant=${encodeURIComponent(
      tenant.slug
    )}&plan=${catalogEntry.code}&session=${mockSessionId}`;

    const updated = await updateTenantWithBillingPatch(tenantForUpdate, {
      tenantPatch: {
        planTier: planTierForFeatures,
        onboardingFeeAmount,
        stripePriceId: catalogEntry.annualPriceId || `mock_price_${catalogEntry.code}`,
        billingStatus: "trialing",
        onboardingFeePaid: onboardingFeeWaived
      },
      billingPatch: {
        planCode: catalogEntry.code,
        lifecycleStatus: "checkout_started",
        onboardingFeeStatus,
        onboardingFeeWaived,
        onboardingFeeWaiveReason: onboardingFeeWaived ? "founders" : "",
        checkoutStartedAt: nowIso(),
        lastCheckoutSessionId: mockSessionId,
        lastCheckoutSessionStatus: "open",
        lastCheckoutCreatedAt: nowIso()
      }
    });

    await writeBillingAudit(updated._id, "billing_checkout_started", {
      mode,
      planCode: catalogEntry.code,
      checkoutSessionId: mockSessionId
    }).catch(() => {});

    return {
      mode,
      sessionId: mockSessionId,
      checkoutUrl: mockCheckoutUrl,
      planCode: catalogEntry.code,
      onboardingFeeAmount,
      tenant: updated,
      message:
        "Mock billing mode active. Set STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET to enable live Stripe checkout."
    };
  }

  if (!catalogEntry.annualPriceId) {
    const error = new Error(
      `Missing Stripe annual price ID for plan '${catalogEntry.code}'. Configure the corresponding STRIPE_PRICE_* variable.`
    );
    error.statusCode = 400;
    error.code = "STRIPE_PRICE_MISSING";
    throw error;
  }
  if (catalogEntry.onboardingFeeAmount > 0 && !catalogEntry.onboardingPriceId) {
    const error = new Error(
      `Missing Stripe onboarding price ID for plan '${catalogEntry.code}'. Configure the corresponding STRIPE_PRICE_*_ONBOARDING variable.`
    );
    error.statusCode = 400;
    error.code = "STRIPE_ONBOARDING_PRICE_MISSING";
    throw error;
  }

  const customerId = await ensureStripeCustomer(tenantForUpdate, billingOperator);
  const lineItems = [{ price: catalogEntry.annualPriceId, quantity: 1 }];
  if (catalogEntry.onboardingFeeAmount > 0) {
    lineItems.push({
      price: catalogEntry.onboardingPriceId,
      quantity: 1
    });
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: lineItems,
    success_url: successUrl || env.STRIPE_SUCCESS_URL || defaultSuccessUrl(tenantForUpdate),
    cancel_url: cancelUrl || env.STRIPE_CANCEL_URL || defaultCancelUrl(tenantForUpdate),
    client_reference_id: String(tenantForUpdate._id),
    allow_promotion_codes: true,
    billing_address_collection: "required",
    metadata: {
      tenantId: String(tenantForUpdate._id),
      tenantSlug: tenantForUpdate.slug,
      planCode: catalogEntry.code,
      planTier: planTierForFeatures,
      onboardingFeeAmount: String(onboardingFeeAmount),
      onboardingFeeStatus
    },
    subscription_data: {
      metadata: {
        tenantId: String(tenantForUpdate._id),
        tenantSlug: tenantForUpdate.slug,
        planCode: catalogEntry.code,
        planTier: planTierForFeatures
      }
    }
  });

  const updated = await updateTenantWithBillingPatch(tenantForUpdate, {
    tenantPatch: {
      planTier: planTierForFeatures,
      onboardingFeeAmount,
      stripeCustomerId: customerId,
      stripePriceId: catalogEntry.annualPriceId,
      billingStatus: "trialing",
      onboardingFeePaid: onboardingFeeWaived
    },
    billingPatch: {
      planCode: catalogEntry.code,
      lifecycleStatus: "checkout_started",
      onboardingFeeStatus,
      onboardingFeeWaived,
      onboardingFeeWaiveReason: onboardingFeeWaived ? "founders" : "",
      checkoutStartedAt: nowIso(),
      lastCheckoutSessionId: session.id,
      lastCheckoutSessionStatus: String(session.status || "open").toLowerCase(),
      lastCheckoutCreatedAt: nowIso(),
      stripePriceId: catalogEntry.annualPriceId,
      initiatedByUserId: String(billingOperator?._id || "").trim() || null
    }
  });

  await writeBillingAudit(updated._id, "billing_checkout_started", {
    mode,
    planCode: catalogEntry.code,
    checkoutSessionId: session.id,
    requestedByUserId: String(billingOperator?._id || "").trim() || null
  }).catch(() => {});

  return {
    mode,
    sessionId: session.id,
    checkoutUrl: session.url,
    planCode: catalogEntry.code,
    onboardingFeeAmount,
    tenant: updated
  };
}

function buildMissingTenantWebhookError(payload = {}, eventType = "") {
  const error = new Error(
    `Unable to map Stripe event '${String(eventType || "").trim()}' to a tenant.`
  );
  error.code = "BILLING_TENANT_NOT_FOUND";
  error.statusCode = 422;
  error.webhookContext = {
    tenantId: pickTenantIdFromPayload(payload) || null,
    tenantSlug: String(payload?.metadata?.tenantSlug || "").trim(),
    stripeCustomerId: pickStripeCustomerIdFromPayload(payload),
    stripeSubscriptionId: pickStripeSubscriptionIdFromPayload(payload)
  };
  return error;
}

async function applyLegacyTenantDedupe(tenant, eventId = "", enabled = false) {
  if (!enabled) return tenant;
  const deduped = await appendProcessedEventId(tenant, eventId);
  if (deduped === null) return null;
  return deduped || tenant;
}

async function handleCheckoutSessionCompleted(event, session, { useTenantEventDedupe = false } = {}) {
  let tenant = await findTenantForStripePayload(session);
  if (!tenant) throw buildMissingTenantWebhookError(session, event.type);

  tenant = await applyLegacyTenantDedupe(tenant, event.id, useTenantEventDedupe);
  if (!tenant) {
    return {
      skipped: true,
      tenantContext: buildWebhookTenantContext(null, session)
    };
  }

  const tenantBilling = resolveTenantBilling(tenant);
  const metadataPlanCode = normalizePlanCode(
    String(session?.metadata?.planCode || "").trim(),
    tenant.planTier
  );
  let lifecycleStatus = inferCheckoutLifecycleStatus(session);
  let stripePriceId = tenant.stripePriceId;
  let currentPeriodEnd = tenantBilling.currentPeriodEnd;
  let resolvedPlanCode = metadataPlanCode;
  let planTier = resolveFeatureTierFromBillingPlan(resolvedPlanCode);

  if (session.subscription && stripe) {
    const subscription = await stripe.subscriptions.retrieve(String(session.subscription), {
      expand: ["items.data.price"]
    });
    const priceId = String(subscription?.items?.data?.[0]?.price?.id || "").trim();
    stripePriceId = priceId || stripePriceId;
    resolvedPlanCode = normalizePlanCode(
      String(subscription?.metadata?.planCode || "").trim() ||
        getPlanCodeFromStripePriceId(priceId, tenant),
      tenant.planTier
    );
    planTier = resolveFeatureTierFromBillingPlan(resolvedPlanCode);
    lifecycleStatus = mapStripeLifecycleStatus(subscription.status);
    const periodEnd = Number(subscription?.current_period_end || 0);
    if (periodEnd > 0) currentPeriodEnd = new Date(periodEnd * 1000).toISOString();
  }

  lifecycleStatus = coerceLifecycleTransition(tenant, lifecycleStatus, event.type);
  const catalog = getCatalogEntry(resolvedPlanCode);
  const computedOnboardingStatus =
    catalog.onboardingFeeAmount <= 0 ? ONBOARDING_FEE_WAIVED : ONBOARDING_FEE_UNPAID;
  const onboardingFeeStatus = coerceOnboardingFeeStatus(tenant, computedOnboardingStatus, {
    allowPaidRegression: resolvedPlanCode !== tenantBilling.billingPlan
  });

  const updated = await updateTenantWithBillingPatch(tenant, {
    tenantPatch: {
      planTier,
      stripeCustomerId: String(session.customer || tenant.stripeCustomerId || "").trim(),
      stripeSubscriptionId: String(session.subscription || tenant.stripeSubscriptionId || "").trim(),
      stripePriceId: stripePriceId || tenant.stripePriceId,
      onboardingFeeAmount: catalog.onboardingFeeAmount,
      onboardingFeePaid: onboardingFeeStatus !== ONBOARDING_FEE_UNPAID,
      billingStatus: toLegacyBillingStatusFromLifecycle(lifecycleStatus)
    },
    billingPatch: {
      planCode: resolvedPlanCode,
      lifecycleStatus,
      onboardingFeeStatus,
      onboardingFeeWaived: onboardingFeeStatus === ONBOARDING_FEE_WAIVED,
      onboardingFeeWaiveReason: onboardingFeeStatus === ONBOARDING_FEE_WAIVED ? "founders" : "",
      lastCheckoutSessionId: String(session.id || "").trim(),
      lastCheckoutSessionStatus: String(session.status || "").trim().toLowerCase(),
      currentPeriodEnd
    }
  });

  await writeBillingAudit(updated._id, "billing_checkout_completed", {
    eventId: event.id,
    stripeSessionId: session.id,
    planCode: resolvedPlanCode
  }).catch(() => {});

  return {
    skipped: false,
    tenantContext: buildWebhookTenantContext(updated, session)
  };
}

async function handleSubscriptionUpdate(event, subscription, { useTenantEventDedupe = false } = {}) {
  let tenant = await findTenantForStripePayload(subscription);
  if (!tenant) throw buildMissingTenantWebhookError(subscription, event.type);

  tenant = await applyLegacyTenantDedupe(tenant, event.id, useTenantEventDedupe);
  if (!tenant) {
    return {
      skipped: true,
      tenantContext: buildWebhookTenantContext(null, subscription)
    };
  }

  const stripePriceId = String(subscription?.items?.data?.[0]?.price?.id || "").trim();
  const resolvedPlanCode = normalizePlanCode(
    String(subscription?.metadata?.planCode || "").trim() ||
      getPlanCodeFromStripePriceId(stripePriceId, tenant),
    tenant.planTier
  );
  const planTier = resolveFeatureTierFromBillingPlan(resolvedPlanCode);
  const lifecycleStatus = coerceLifecycleTransition(
    tenant,
    mapStripeLifecycleStatus(subscription.status),
    event.type
  );
  const billing = resolveTenantBilling(tenant);
  const periodEnd = Number(subscription?.current_period_end || 0);

  const updated = await updateTenantWithBillingPatch(tenant, {
    tenantPatch: {
      planTier,
      stripeCustomerId: String(subscription.customer || tenant.stripeCustomerId || "").trim(),
      stripeSubscriptionId: String(subscription.id || tenant.stripeSubscriptionId || "").trim(),
      stripePriceId: stripePriceId || tenant.stripePriceId,
      billingStatus: toLegacyBillingStatusFromLifecycle(lifecycleStatus)
    },
    billingPatch: {
      planCode: resolvedPlanCode,
      lifecycleStatus,
      onboardingFeeStatus: billing.onboardingFeeStatus,
      currentPeriodEnd: periodEnd > 0 ? new Date(periodEnd * 1000).toISOString() : billing.currentPeriodEnd
    }
  });

  await writeBillingAudit(updated._id, "billing_subscription_updated", {
    eventId: event.id,
    stripeSubscriptionId: subscription.id,
    lifecycleStatus,
    planCode: resolvedPlanCode
  }).catch(() => {});

  return {
    skipped: false,
    tenantContext: buildWebhookTenantContext(updated, subscription)
  };
}

async function handleInvoicePaid(event, invoice, { useTenantEventDedupe = false } = {}) {
  let tenant = await findTenantForStripePayload(invoice);
  if (!tenant) throw buildMissingTenantWebhookError(invoice, event.type);

  tenant = await applyLegacyTenantDedupe(tenant, event.id, useTenantEventDedupe);
  if (!tenant) {
    return {
      skipped: true,
      tenantContext: buildWebhookTenantContext(null, invoice)
    };
  }

  const billing = resolveTenantBilling(tenant);
  const invoiceHasOnboarding = hasOnboardingFeeLine(invoice, tenant);
  const onboardingFeeStatus = coerceOnboardingFeeStatus(
    tenant,
    invoiceHasOnboarding ? ONBOARDING_FEE_PAID : billing.onboardingFeeStatus
  );
  const lifecycleStatus = coerceLifecycleTransition(
    tenant,
    billing.lifecycleStatus === "canceled" ? "canceled" : "active",
    event.type
  );

  const updated = await updateTenantWithBillingPatch(tenant, {
    tenantPatch: {
      billingStatus: toLegacyBillingStatusFromLifecycle(lifecycleStatus),
      onboardingFeePaid:
        onboardingFeeStatus === ONBOARDING_FEE_PAID ||
        onboardingFeeStatus === ONBOARDING_FEE_WAIVED,
      onboardingFeeInvoiceId: invoiceHasOnboarding
        ? String(invoice.id || tenant.onboardingFeeInvoiceId || "").trim()
        : tenant.onboardingFeeInvoiceId
    },
    billingPatch: {
      lifecycleStatus,
      onboardingFeeStatus,
      onboardingFeeWaived: onboardingFeeStatus === ONBOARDING_FEE_WAIVED,
      lastInvoiceId: String(invoice.id || "").trim(),
      lastInvoiceStatus: String(invoice.status || "").trim().toLowerCase()
    }
  });

  await writeBillingAudit(updated._id, "billing_invoice_paid", {
    eventId: event.id,
    stripeInvoiceId: invoice.id,
    onboardingFeePaid: invoiceHasOnboarding
  }).catch(() => {});

  return {
    skipped: false,
    tenantContext: buildWebhookTenantContext(updated, invoice)
  };
}

async function handleInvoicePaymentFailed(event, invoice, { useTenantEventDedupe = false } = {}) {
  let tenant = await findTenantForStripePayload(invoice);
  if (!tenant) throw buildMissingTenantWebhookError(invoice, event.type);

  tenant = await applyLegacyTenantDedupe(tenant, event.id, useTenantEventDedupe);
  if (!tenant) {
    return {
      skipped: true,
      tenantContext: buildWebhookTenantContext(null, invoice)
    };
  }

  const lifecycleStatus = coerceLifecycleTransition(tenant, "past_due", event.type);
  const updated = await updateTenantWithBillingPatch(tenant, {
    tenantPatch: {
      billingStatus: toLegacyBillingStatusFromLifecycle(lifecycleStatus)
    },
    billingPatch: {
      lifecycleStatus,
      lastInvoiceId: String(invoice.id || "").trim(),
      lastInvoiceStatus: String(invoice.status || "payment_failed").trim().toLowerCase()
    }
  });

  await writeBillingAudit(updated._id, "billing_invoice_failed", {
    eventId: event.id,
    stripeInvoiceId: invoice.id
  }).catch(() => {});

  return {
    skipped: false,
    tenantContext: buildWebhookTenantContext(updated, invoice)
  };
}

async function handlePaymentIntent(event, paymentIntent, { useTenantEventDedupe = false } = {}) {
  let tenant = await findTenantForStripePayload(paymentIntent);
  if (!tenant && paymentIntent?.invoice && stripe) {
    try {
      const invoice = await stripe.invoices.retrieve(String(paymentIntent.invoice));
      tenant = await findTenantForStripePayload(invoice || {});
    } catch {
      tenant = null;
    }
  }
  if (!tenant) throw buildMissingTenantWebhookError(paymentIntent, event.type);

  tenant = await applyLegacyTenantDedupe(tenant, event.id, useTenantEventDedupe);
  if (!tenant) {
    return {
      skipped: true,
      tenantContext: buildWebhookTenantContext(null, paymentIntent)
    };
  }

  const type = String(event.type || "").trim().toLowerCase();
  const succeeded = type === "payment_intent.succeeded";
  const status = String(paymentIntent.status || "").trim().toLowerCase();
  const metadataOnboarding =
    String(paymentIntent?.metadata?.lineType || "").trim().toLowerCase() === "onboarding_fee";
  const billing = resolveTenantBilling(tenant);
  const onboardingFeeStatus = coerceOnboardingFeeStatus(
    tenant,
    metadataOnboarding && succeeded ? ONBOARDING_FEE_PAID : billing.onboardingFeeStatus
  );
  const lifecycleStatus = coerceLifecycleTransition(
    tenant,
    succeeded ? (billing.lifecycleStatus === "canceled" ? "canceled" : "active") : "past_due",
    event.type
  );

  const updated = await updateTenantWithBillingPatch(tenant, {
    tenantPatch: {
      onboardingFeePaid:
        onboardingFeeStatus === ONBOARDING_FEE_PAID ||
        onboardingFeeStatus === ONBOARDING_FEE_WAIVED,
      billingStatus: toLegacyBillingStatusFromLifecycle(lifecycleStatus)
    },
    billingPatch: {
      lifecycleStatus,
      onboardingFeeStatus,
      lastPaymentIntentId: String(paymentIntent.id || "").trim(),
      lastPaymentIntentStatus: status
    }
  });

  await writeBillingAudit(updated._id, "billing_payment_intent_updated", {
    eventId: event.id,
    paymentIntentId: paymentIntent.id,
    status,
    onboardingFeeSettled: metadataOnboarding && succeeded
  }).catch(() => {});

  return {
    skipped: false,
    tenantContext: buildWebhookTenantContext(updated, paymentIntent)
  };
}

export async function processStripeEvent(event) {
  const eventType = String(event?.type || "").trim();
  if (!eventType) {
    return {
      processed: false,
      duplicate: false,
      ledger: false
    };
  }

  const receipt = await registerStripeWebhookEventReceipt(event);
  if (receipt.duplicateProcessed) {
    return {
      processed: false,
      duplicate: true,
      ledger: receipt.available,
      eventId: String(event?.id || "").trim(),
      type: eventType
    };
  }

  const handlerOptions = {
    useTenantEventDedupe: !receipt.available
  };
  const payload = event?.data?.object || {};
  let webhookContext = buildWebhookTenantContext(null, payload);

  try {
    let handlerResult = { skipped: false };
    switch (eventType) {
      case "checkout.session.completed": {
        handlerResult = await handleCheckoutSessionCompleted(event, payload, handlerOptions);
        webhookContext = handlerResult?.tenantContext || webhookContext;
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        handlerResult = await handleSubscriptionUpdate(event, payload, handlerOptions);
        webhookContext = handlerResult?.tenantContext || webhookContext;
        break;
      }
      case "invoice.paid": {
        handlerResult = await handleInvoicePaid(event, payload, handlerOptions);
        webhookContext = handlerResult?.tenantContext || webhookContext;
        break;
      }
      case "invoice.payment_failed": {
        handlerResult = await handleInvoicePaymentFailed(event, payload, handlerOptions);
        webhookContext = handlerResult?.tenantContext || webhookContext;
        break;
      }
      case "payment_intent.succeeded":
      case "payment_intent.payment_failed": {
        handlerResult = await handlePaymentIntent(event, payload, handlerOptions);
        webhookContext = handlerResult?.tenantContext || webhookContext;
        break;
      }
      default:
        break;
    }

    if (handlerResult?.skipped) {
      return {
        processed: false,
        duplicate: true,
        ledger: receipt.available,
        eventId: String(event?.id || "").trim(),
        type: eventType
      };
    }

    await markStripeWebhookEventProcessed(event, webhookContext);
    return {
      processed: true,
      duplicate: false,
      ledger: receipt.available,
      eventId: String(event?.id || "").trim(),
      type: eventType
    };
  } catch (error) {
    const fallbackContext = {
      ...webhookContext,
      ...(error?.webhookContext || {})
    };
    await markStripeWebhookEventFailed(event, error, fallbackContext);
    throw error;
  }
}

export async function constructStripeEventFromRequest(req) {
  if (getBillingMode() === "mock") {
    if (!allowMockBilling()) {
      const error = new Error(
        "Mock webhook ingestion is disabled in production. Configure Stripe webhook secrets."
      );
      error.statusCode = 503;
      error.code = "MOCK_BILLING_DISABLED";
      throw error;
    }

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

export async function createBillingPortalUrl({ tenant, returnUrl, returnPath }) {
  const mode = getBillingMode();
  const fallbackUrl = `${env.MOCK_BILLING_BASE_URL}/portal?tenant=${encodeURIComponent(tenant.slug)}`;

  if (mode === "mock") {
    if (!allowMockBilling()) {
      return {
        mode,
        url: "",
        message: "Billing portal unavailable until Stripe is configured for this environment."
      };
    }

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

  let finalReturnUrl = String(returnUrl || "").trim();
  if (!finalReturnUrl && returnPath) {
    finalReturnUrl = `${env.FRONTEND_ORIGIN}${String(returnPath || "").trim()}`;
  }
  if (!finalReturnUrl) {
    finalReturnUrl =
      env.STRIPE_BILLING_PORTAL_RETURN_URL || `${env.FRONTEND_ORIGIN}/t/${tenant.slug}/admin/billing`;
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: tenant.stripeCustomerId,
    return_url: finalReturnUrl
  });

  return {
    mode,
    url: session.url
  };
}

export function buildBillingPublicSnapshot(tenant = {}) {
  const readiness = isBillingReadyForLaunch(tenant);
  const catalogEntry = getCatalogEntry(readiness.billingPlan);
  return {
    billingPlan: readiness.billingPlan,
    annualAmount: catalogEntry.annualAmount,
    lifecycleStatus: readiness.lifecycleStatus,
    billingStatus: readiness.legacyStatus,
    onboardingFeeStatus: readiness.onboardingFeeStatus,
    onboardingFeeAmount: readiness.onboardingFeeAmount,
    onboardingFeePaid: readiness.onboardingFeePaid,
    onboardingFeeWaived: readiness.onboardingFeeWaived,
    currentPeriodEnd: readiness.currentPeriodEnd,
    foundersReserved: readiness.foundersReserved,
    foundersSlot: readiness.foundersSlot,
    foundersEligible: readiness.foundersEligible,
    launchReady: readiness.ok,
    launchReadiness: {
      lifecycleReady: readiness.lifecycleReady,
      feeReady: readiness.feeReady
    }
  };
}
