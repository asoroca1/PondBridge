const LEGACY_BILLING_STATUSES = new Set(["trialing", "active", "past_due", "canceled"]);
const LIFECYCLE_STATUSES = new Set([
  "uninitialized",
  "checkout_started",
  "active",
  "past_due",
  "canceled",
  "incomplete",
  "trialing",
  "paused"
]);
const ONBOARDING_FEE_STATUSES = new Set(["unpaid", "paid", "waived"]);
const BILLING_PLAN_CODES = new Set(["flagship", "test"]);

// Retired plan codes still stored on existing tenants. They all resolve to the
// single Flagship plan so historical records keep reading cleanly.
const RETIRED_BILLING_PLAN_CODES = new Map([
  ["legacy", "flagship"],
  ["founders", "flagship"],
  ["institutional", "flagship"],
  ["base", "flagship"],
  ["premium", "flagship"]
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function toIso(value) {
  const parsed = safeDate(value);
  return parsed ? parsed.toISOString() : null;
}

function normalizeLegacyBillingStatus(value = "", fallback = "trialing") {
  const normalized = String(value || "").trim().toLowerCase();
  if (LEGACY_BILLING_STATUSES.has(normalized)) return normalized;
  return fallback;
}

function normalizeLifecycleStatus(value = "", fallback = "uninitialized") {
  const normalized = String(value || "").trim().toLowerCase();
  if (LIFECYCLE_STATUSES.has(normalized)) return normalized;
  return fallback;
}

function normalizeOnboardingFeeStatus(value = "", fallback = "unpaid") {
  const normalized = String(value || "").trim().toLowerCase();
  if (ONBOARDING_FEE_STATUSES.has(normalized)) return normalized;
  return fallback;
}

function defaultBillingPlanFromTier() {
  // Flagship is the only plan PondBridge sells, regardless of stored feature tier.
  return "flagship";
}

function normalizeBillingPlanCode(value = "", fallback = "flagship") {
  const normalized = String(value || "").trim().toLowerCase();
  if (BILLING_PLAN_CODES.has(normalized)) return normalized;
  if (RETIRED_BILLING_PLAN_CODES.has(normalized)) {
    return RETIRED_BILLING_PLAN_CODES.get(normalized);
  }
  return fallback;
}

function inferLifecycleFromLegacy(tenant, legacyStatus) {
  const hasSubscription = Boolean(String(tenant?.stripeSubscriptionId || "").trim());
  const hasCustomer = Boolean(String(tenant?.stripeCustomerId || "").trim());
  const isLive = String(tenant?.onboardingStatus || "").trim().toLowerCase() === "live";

  // Preserve legacy behavior for already-launched networks until explicit lifecycle
  // metadata is written by checkout/webhook sync.
  if (isLive) return legacyStatus;

  if (hasSubscription) return legacyStatus;
  if (legacyStatus === "trialing" && hasCustomer) return "checkout_started";
  if (legacyStatus === "trialing" && !hasCustomer) return "uninitialized";
  return legacyStatus;
}

function normalizeProcessedEventIds(values = []) {
  if (!Array.isArray(values)) return [];
  return [...new Set(
    values.map((value) => String(value || "").trim()).filter(Boolean)
  )].slice(-250);
}

export function resolveTenantBilling(tenant = {}) {
  const tenantSettings = isPlainObject(tenant.settings) ? tenant.settings : {};
  const billingSettings = isPlainObject(tenantSettings.billing) ? tenantSettings.billing : {};
  const billingPlan = normalizeBillingPlanCode(
    billingSettings.planCode,
    defaultBillingPlanFromTier(tenant.planTier)
  );

  const legacyStatus = normalizeLegacyBillingStatus(tenant.billingStatus || billingSettings.legacyStatus || "trialing");
  const lifecycleStatus = normalizeLifecycleStatus(
    billingSettings.lifecycleStatus,
    inferLifecycleFromLegacy(tenant, legacyStatus)
  );

  const onboardingFeeAmount = Number(
    Object.prototype.hasOwnProperty.call(tenant, "onboardingFeeAmount")
      ? tenant.onboardingFeeAmount
      : billingSettings.onboardingFeeAmount || 0
  );
  const onboardingFeeWaived = Boolean(
    billingSettings.onboardingFeeWaived || onboardingFeeAmount <= 0
  );
  const onboardingFeePaid = Boolean(
    tenant.onboardingFeePaid ||
      billingSettings.onboardingFeeStatus === "paid" ||
      onboardingFeeWaived
  );
  const onboardingFeeStatus = normalizeOnboardingFeeStatus(
    billingSettings.onboardingFeeStatus,
    onboardingFeeWaived ? "waived" : onboardingFeePaid ? "paid" : "unpaid"
  );

  return {
    legacyStatus,
    lifecycleStatus,
    billingPlan,
    onboardingFeeAmount,
    onboardingFeePaid,
    onboardingFeeStatus,
    onboardingFeeWaived,
    onboardingFeeWaiveReason: String(billingSettings.onboardingFeeWaiveReason || "").trim(),
    currentPeriodEnd: toIso(billingSettings.currentPeriodEnd),
    lastInvoiceId: String(
      billingSettings.lastInvoiceId || tenant.onboardingFeeInvoiceId || ""
    ).trim(),
    lastInvoiceStatus: String(billingSettings.lastInvoiceStatus || "").trim(),
    lastInvoiceErrorCode: String(billingSettings.lastInvoiceErrorCode || "").trim(),
    lastInvoiceErrorMessage: String(billingSettings.lastInvoiceErrorMessage || "").trim(),
    lastInvoiceFinalizationFailedAt: toIso(billingSettings.lastInvoiceFinalizationFailedAt),
    lastPaymentIntentId: String(billingSettings.lastPaymentIntentId || "").trim(),
    lastPaymentIntentStatus: String(billingSettings.lastPaymentIntentStatus || "").trim(),
    lastCheckoutSessionId: String(billingSettings.lastCheckoutSessionId || "").trim(),
    lastCheckoutSessionStatus: String(billingSettings.lastCheckoutSessionStatus || "").trim(),
    lastCheckoutCreatedAt: toIso(billingSettings.lastCheckoutCreatedAt),
    initialCheckoutCompletedAt: toIso(billingSettings.initialCheckoutCompletedAt),
    activatedAt: toIso(billingSettings.activatedAt),
    canceledAt: toIso(billingSettings.canceledAt),
    processedEventIds: normalizeProcessedEventIds(billingSettings.processedEventIds || [])
  };
}

export function buildTenantSettingsWithBillingPatch(tenant = {}, billingPatch = {}) {
  const currentSettings = isPlainObject(tenant.settings) ? tenant.settings : {};
  const currentBilling = isPlainObject(currentSettings.billing) ? currentSettings.billing : {};

  const merged = {
    ...currentBilling,
    ...billingPatch
  };

  if (Object.prototype.hasOwnProperty.call(merged, "processedEventIds")) {
    merged.processedEventIds = normalizeProcessedEventIds(merged.processedEventIds);
  }

  return {
    ...currentSettings,
    billing: merged
  };
}

export function mapStripeLifecycleStatus(status = "") {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "active") return "active";
  if (normalized === "trialing") return "trialing";
  if (normalized === "past_due" || normalized === "unpaid") return "past_due";
  if (normalized === "canceled" || normalized === "incomplete_expired") return "canceled";
  if (normalized === "incomplete") return "incomplete";
  if (normalized === "paused") return "paused";
  return "past_due";
}

export function toLegacyBillingStatusFromLifecycle(lifecycleStatus = "") {
  const normalized = normalizeLifecycleStatus(lifecycleStatus);
  if (normalized === "active") return "active";
  if (normalized === "trialing") return "trialing";
  if (normalized === "canceled") return "canceled";
  if (normalized === "past_due" || normalized === "paused" || normalized === "incomplete") {
    return "past_due";
  }
  if (normalized === "checkout_started" || normalized === "uninitialized") return "trialing";
  return "past_due";
}

export function isBillingReadyForLaunch(tenant = {}) {
  const billing = resolveTenantBilling(tenant);
  const lifecycleReady = billing.lifecycleStatus === "active" || billing.lifecycleStatus === "trialing";
  const feeReady = billing.onboardingFeeStatus === "paid" || billing.onboardingFeeStatus === "waived";

  return {
    ...billing,
    lifecycleReady,
    feeReady,
    ok: lifecycleReady && feeReady
  };
}

export function isTenantBillingAccessAllowed(tenant = {}) {
  const billing = resolveTenantBilling(tenant);
  const status = billing.lifecycleStatus;

  if (status === "active" || status === "trialing") {
    return {
      allowed: true,
      reason: "ok",
      inGrace: false,
      billing
    };
  }

  if (status === "past_due") {
    const graceUntil = safeDate(tenant?.billingGraceUntil);
    const inGrace = Boolean(graceUntil && graceUntil > new Date());
    return {
      allowed: inGrace,
      reason: inGrace ? "grace_period" : "past_due",
      inGrace,
      billing
    };
  }

  return {
    allowed: false,
    reason: status,
    inGrace: false,
    billing
  };
}

export function resolveFeatureTierFromBillingPlan(planCode = "") {
  // Every live plan (Flagship and the internal test tier) is the full product.
  normalizeBillingPlanCode(planCode);
  return "premium";
}

export function resolveTenantFeatureTier(tenant = {}) {
  return resolveFeatureTierFromBillingPlan(resolveTenantBilling(tenant).billingPlan);
}

export function normalizeBillingPlan(planCode = "", fallbackFromTier = "base") {
  return normalizeBillingPlanCode(planCode, defaultBillingPlanFromTier(fallbackFromTier));
}
