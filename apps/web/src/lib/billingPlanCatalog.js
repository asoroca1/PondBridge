// Billing plan helpers shared by the director onboarding wizard and any other
// screen that has to turn a plan code into something a director can read.
//
// The API is the source of truth for which plans a camp may buy and what they
// cost (GET /api/tenants/me/billing -> catalog.plans). This module only holds
// presentation copy, and deliberately knows about EVERY plan code the API can
// return. A screen that hardcodes a subset silently rewrites the director's
// choice to whichever plan it does know about, which is how a $10 internal test
// selection ended up opening a $1,200 Flagship checkout.

export const BILLING_PLAN_PRESENTATION = [
  {
    code: "flagship",
    title: "Flagship Plan",
    annualAmount: 1200,
    onboardingFeeAmount: 0,
    summary: "Every PondBridge feature, billed annually with no onboarding fee."
  },
  {
    code: "test",
    title: "Internal Test Plan",
    annualAmount: 10,
    onboardingFeeAmount: 0,
    summary: "Internal production validation plan. Not for customer camps."
  }
];

export const DEFAULT_BILLING_PLAN = BILLING_PLAN_PRESENTATION[0];

export const KNOWN_BILLING_PLAN_CODES = BILLING_PLAN_PRESENTATION.map((item) => item.code);

function cleanCode(value = "") {
  return String(value || "").trim().toLowerCase();
}

function toFiniteNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// Keeps any plan code the API recognises. Only genuinely unknown codes fall back
// to Flagship, so a real selection is never quietly downgraded.
export function normalizeBillingPlanCode(value = "") {
  const normalized = cleanCode(value);
  return KNOWN_BILLING_PLAN_CODES.includes(normalized) ? normalized : DEFAULT_BILLING_PLAN.code;
}

export function resolveTenantBillingPlanCode(tenant = null, fallback = "") {
  const raw = cleanCode(tenant?.billingPlan || tenant?.billing?.billingPlan);
  return KNOWN_BILLING_PLAN_CODES.includes(raw) ? raw : fallback;
}

// Merges the server catalog with local presentation copy. Server values win for
// price and description; the local entry supplies fallback copy only. Plans the
// API does not offer are dropped, so a camp can never pick one checkout rejects.
export function buildBillingPlanOptions(catalogPlans = []) {
  const plans = Array.isArray(catalogPlans) ? catalogPlans : [];
  const merged = plans
    .map((plan) => {
      const code = cleanCode(plan?.code);
      const meta = BILLING_PLAN_PRESENTATION.find((item) => item.code === code);
      if (!meta) return null;

      const label = String(plan?.label || "").trim();
      const description = String(plan?.description || "").trim();

      return {
        ...meta,
        title: label ? `${label} Plan` : meta.title,
        summary: description || meta.summary,
        annualAmount: toFiniteNumber(plan?.annualAmount, meta.annualAmount),
        onboardingFeeAmount: toFiniteNumber(plan?.onboardingFeeAmount, meta.onboardingFeeAmount)
      };
    })
    .filter(Boolean);

  return merged.length ? merged : [DEFAULT_BILLING_PLAN];
}

export function billingPlanLabel(code = "", options = BILLING_PLAN_PRESENTATION) {
  const normalized = normalizeBillingPlanCode(code);
  const source = Array.isArray(options) && options.length ? options : BILLING_PLAN_PRESENTATION;
  const match =
    source.find((item) => item.code === normalized) ||
    BILLING_PLAN_PRESENTATION.find((item) => item.code === normalized);
  return match ? match.title : DEFAULT_BILLING_PLAN.title;
}
