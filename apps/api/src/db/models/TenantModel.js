import { createModel, toDoc } from "./_factory.js";
import { getSupabaseAdmin } from "../supabaseAdmin.js";
import { env } from "../../config/env.js";

const COLUMNS = {
  id: "id",
  name: "name",
  slug: "slug",
  status: "status",
  planTier: "plan_tier",
  onboardingStatus: "onboarding_status",
  onboardingStep: "onboarding_step",
  onboardingChecklist: "onboarding_checklist",
  onboardingFeeAmount: "onboarding_fee_amount",
  onboardingFeePaid: "onboarding_fee_paid",
  onboardingFeeInvoiceId: "onboarding_fee_invoice_id",
  stripeCustomerId: "stripe_customer_id",
  stripeSubscriptionId: "stripe_subscription_id",
  stripePriceId: "stripe_price_id",
  billingStatus: "billing_status",
  billingGraceUntil: "billing_grace_until",
  theme: "theme",
  content: "content",
  settings: "settings",
  modules: "modules",
  accessSettings: "access_settings",
  onboardingDraft: "onboarding_draft",
  launch: "launch",
  onboardingProgress: "onboarding_progress",
  billingDetails: "billing_details",
  directorLegalAgreement: "director_legal_agreement",
  notificationPrefs: "notification_prefs",
  deletionRequest: "deletion_request",
  addOns: "add_ons",
  customDomain: "custom_domain",
  createdAt: "created_at",
  updatedAt: "updated_at"
};

const base = createModel("tenants", COLUMNS);
const RESERVED_SUBDOMAINS = new Set(["www", "app", "api", "super"]);

function sanitizeDomain(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .split(":")[0];
}

function inferSlugFromDomain(domain = "") {
  const safeDomain = sanitizeDomain(domain);
  if (!safeDomain) return "";

  const safeBase = sanitizeDomain(env.APP_BASE_DOMAIN || "");
  if (safeBase && safeDomain.endsWith(`.${safeBase}`)) {
    const prefix = safeDomain.slice(0, -1 * (safeBase.length + 1));
    const candidate = String(prefix.split(".")[0] || "").trim().toLowerCase();
    if (candidate && !RESERVED_SUBDOMAINS.has(candidate)) return candidate;
  }

  if (safeDomain.endsWith(".localhost")) {
    const prefix = safeDomain.replace(".localhost", "");
    const candidate = String(prefix.split(".")[0] || "").trim().toLowerCase();
    if (candidate && !RESERVED_SUBDOMAINS.has(candidate)) return candidate;
  }

  return "";
}

export const TenantModel = {
  ...base,

  async findBySlug(slug) {
    const { data, error } = await getSupabaseAdmin()
      .from("tenants")
      .select("*")
      .eq("slug", slug.toLowerCase().trim())
      .maybeSingle();
    if (error) throw error;
    return toDoc(data, COLUMNS);
  },

  async findByDomain(domain) {
    const safeDomain = sanitizeDomain(domain);
    if (!safeDomain) return null;

    const inferredSlug = inferSlugFromDomain(safeDomain);
    if (inferredSlug) {
      return this.findBySlug(inferredSlug);
    }

    const { data, error } = await getSupabaseAdmin()
      .from("tenants")
      .select("*")
      .ilike("custom_domain", safeDomain)
      .maybeSingle();
    if (error) throw error;
    return toDoc(data, COLUMNS);
  },

  async findByStripeCustomerId(customerId) {
    const { data, error } = await getSupabaseAdmin()
      .from("tenants")
      .select("*")
      .eq("stripe_customer_id", customerId)
      .maybeSingle();
    if (error) throw error;
    return toDoc(data, COLUMNS);
  },

  async findByStripeSubscriptionId(subscriptionId) {
    const { data, error } = await getSupabaseAdmin()
      .from("tenants")
      .select("*")
      .eq("stripe_subscription_id", subscriptionId)
      .maybeSingle();
    if (error) throw error;
    return toDoc(data, COLUMNS);
  }
};
