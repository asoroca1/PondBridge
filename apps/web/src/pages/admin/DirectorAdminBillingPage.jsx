import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button, Card } from "@pondbridge/ui";
import { useTenant } from "../../context/TenantContext.jsx";
import useAdminApi from "./useAdminApi.js";

function formatDate(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleDateString();
}

function formatMoney(value = 0) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

function statusTone(status = "") {
  const key = String(status || "").trim().toLowerCase();
  if (["active", "sent", "used", "live", "approved", "paid"].includes(key)) return "success";
  if (["pending", "scheduled", "trialing", "in_setup", "in_progress"].includes(key)) return "warning";
  if (["failed", "denied", "past_due", "removed", "flagged", "canceled"].includes(key)) return "danger";
  return "neutral";
}

function billingPlanLabel(code = "") {
  const normalized = String(code || "").trim().toLowerCase();
  if (normalized === "test") return "Internal Test";
  if (normalized === "founders") return "Founders";
  if (normalized === "institutional") return "Institutional";
  return "Legacy";
}

const BILLING_TIER_DEFINITIONS = [
  {
    code: "test",
    title: "Internal Test",
    subtitle: "$10/year for validating live production billing flows.",
    tone: "premium",
    perks: [
      "Live Stripe subscription checkout",
      "No onboarding fee",
      "Allowlisted camps only"
    ]
  },
  {
    code: "founders",
    title: "Founders",
    subtitle: "$2,500/year for the first five partner camps.",
    tone: "premium",
    perks: [
      "All premium modules enabled",
      "Launch coaching + priority support",
      "No onboarding fee"
    ]
  },
  {
    code: "legacy",
    title: "Legacy",
    subtitle: "$3,000/year with core alumni network features.",
    tone: "base",
    perks: [
      "Core member directory + search",
      "Invites, onboarding, and admin tools",
      "No onboarding fee"
    ]
  },
  {
    code: "institutional",
    title: "Institutional",
    subtitle: "$3,800/year with a one-time $200 onboarding fee on initial checkout.",
    tone: "premium",
    perks: [
      "All premium modules enabled",
      "Institutional support and scale",
      "One-time onboarding fee is not charged on renewals"
    ]
  }
];

const BILLING_TIER_DEFINITIONS_BY_CODE = new Map(
  BILLING_TIER_DEFINITIONS.map((tier) => [tier.code, tier])
);

const BILLING_TIER_CODES = new Set(BILLING_TIER_DEFINITIONS.map((tier) => tier.code));

function normalizeBillingPlanCode(code = "") {
  const normalized = String(code || "").trim().toLowerCase();
  return BILLING_TIER_CODES.has(normalized) ? normalized : "";
}

function formatStatusLabel(value = "", fallback = "Unknown") {
  const normalized = String(value || "").trim();
  if (!normalized) return fallback;
  return normalized.replace(/_/g, " ");
}

function formatLifecycleLabel(value = "", fallback = "Uninitialized") {
  const normalized = String(value || "").trim();
  if (!normalized) return fallback;
  return normalized.replace(/_/g, " ");
}

export default function DirectorAdminBillingPage() {
  const { slug, request } = useAdminApi();
  const { tenant: tenantConfig } = useTenant();
  const [searchParams] = useSearchParams();
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [selectedPlanCode, setSelectedPlanCode] = useState("");
  const [startingCheckout, setStartingCheckout] = useState(false);
  const [cancellingSubscription, setCancellingSubscription] = useState(false);
  const [resumingSubscription, setResumingSubscription] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const checkoutQueryState = String(searchParams.get("checkout") || "").trim().toLowerCase();
  const demoAccessEnabled = Boolean(tenantConfig?.accessSettings?.demoAccessEnabled);

  const loadBilling = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await request("/billing");
      setPayload(response);
      const liveLifecycleStatus = String(
        response?.tenant?.billingLifecycleStatus || response?.billing?.lifecycleStatus || ""
      )
        .trim()
        .toLowerCase();
      const livePlanCode = normalizeBillingPlanCode(
        response?.tenant?.billingPlan || response?.billing?.billingPlan
      );
      setSelectedPlanCode(liveLifecycleStatus === "uninitialized" ? "" : livePlanCode);
    } catch (requestError) {
      setError(requestError.message || "Failed to load billing.");
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    loadBilling();
  }, [loadBilling]);

  useEffect(() => {
    if (checkoutQueryState === "success") {
      setStatus("Stripe checkout completed. Billing activation may take a few seconds.");
      setError("");
    } else if (checkoutQueryState === "cancel") {
      setError("Stripe checkout was canceled.");
      setStatus("");
    }
  }, [checkoutQueryState]);

  async function startCheckout() {
    setStartingCheckout(true);
    setError("");
    setStatus("");

    try {
      const successUrl = `${window.location.origin}/t/${slug}/admin/billing?checkout=success`;
      const cancelUrl = `${window.location.origin}/t/${slug}/admin/billing?checkout=cancel`;
      const response = await request("/billing/checkout", {
        method: "POST",
        body: {
          planCode: selectedPlanCode,
          successUrl,
          cancelUrl
        }
      });
      const action = String(response?.action || "").trim().toLowerCase();
      const checkoutUrl = String(response?.checkoutUrl || "").trim();
      if (checkoutUrl) {
        window.location.assign(checkoutUrl);
        return;
      }

      if (action === "subscription_updated") {
        setStatus(
          response?.notes ||
            "Your subscription was updated. Refreshing billing details now."
        );
        await loadBilling();
        setStartingCheckout(false);
        return;
      }

      if (action === "complimentary_plan") {
        setStatus(
          response?.notes ||
            "This network is on a complimentary plan. No Stripe checkout is required."
        );
        await loadBilling();
        setStartingCheckout(false);
        return;
      }

      throw new Error(
        response?.notes ||
          "Unable to start checkout. Use the billing portal to manage your subscription."
      );
    } catch (requestError) {
      setError(requestError.message || "Unable to start Stripe checkout.");
      setStartingCheckout(false);
    }
  }

  async function cancelSubscription() {
    setCancellingSubscription(true);
    setError("");
    setStatus("");
    try {
      const response = await request("/billing/cancel", {
        method: "POST",
        body: { cancelAtPeriodEnd: true }
      });
      setStatus(response?.message || "Your subscription has been scheduled for cancellation.");
      setShowCancelConfirm(false);
      await loadBilling();
    } catch (requestError) {
      setError(requestError.message || "Unable to cancel subscription.");
    } finally {
      setCancellingSubscription(false);
    }
  }

  async function resumeSubscription() {
    setResumingSubscription(true);
    setError("");
    setStatus("");
    try {
      const response = await request("/billing/resume", {
        method: "POST"
      });
      setStatus(response?.message || "Your subscription has been resumed.");
      await loadBilling();
    } catch (requestError) {
      setError(requestError.message || "Unable to resume subscription.");
    } finally {
      setResumingSubscription(false);
    }
  }

  if (loading && !payload && !demoAccessEnabled) {
    return (
      <Card>
        <p className="muted">Loading billing...</p>
      </Card>
    );
  }

  if (demoAccessEnabled) {
    return (
      <div className="director-admin-stack director-admin-billing-page">
        <PageHeader
          title="Billing"
          subtitle="This is a preview of the billing management page. Billing is not active for demo networks."
        />

        <Card className="director-admin-banner tone-info">
          <p>
            You are viewing a <strong>demo network</strong>. The billing features shown below are a preview
            of what camp directors see when managing their subscription. No charges or payment methods apply.
          </p>
        </Card>

        <div className="director-admin-billing-top-grid">
          <Card className="director-admin-billing-summary-card">
            <div className="director-admin-billing-summary-head">
              <div>
                <p className="director-admin-billing-kicker">Current Plan</p>
                <h2>Founders</h2>
                <p className="muted">$2,500/year for the first five partner camps.</p>
              </div>
              <span className="director-admin-billing-tone-pill is-premium">Premium</span>
            </div>

            <div className="director-admin-billing-key-grid">
              <div className="director-admin-billing-key-item">
                <span>Billing Status</span>
                <strong>
                  <span className="director-admin-status-badge tone-success">active</span>
                </strong>
              </div>
              <div className="director-admin-billing-key-item">
                <span>Lifecycle</span>
                <strong>active</strong>
              </div>
              <div className="director-admin-billing-key-item">
                <span>Onboarding Fee</span>
                <strong>$0</strong>
                <small>waived</small>
              </div>
              <div className="director-admin-billing-key-item">
                <span>Renews On</span>
                <strong>Jan 1, 2027</strong>
                <small>Next payment: $2,500</small>
              </div>
              <div className="director-admin-billing-key-item">
                <span>Member Usage</span>
                <strong>142 (unlimited)</strong>
                <small>Launch ready</small>
              </div>
              <div className="director-admin-billing-key-item">
                <span>Lifecycle Dates</span>
                <strong>Active 3/15/2026</strong>
                <small>No cancellation recorded</small>
              </div>
            </div>

            <div className="inline-actions">
              <Button variant="secondary" disabled>Open Billing Portal</Button>
              <Button variant="secondary" disabled>Refresh Billing</Button>
              <Button variant="danger" disabled>Cancel Plan</Button>
            </div>
          </Card>

          <Card className="director-admin-billing-checkout-card">
            <div className="director-admin-billing-summary-head">
              <div>
                <p className="director-admin-billing-kicker">Plan & Checkout</p>
                <h2>Founders</h2>
                <p className="muted">$2,500/year for the first five partner camps.</p>
              </div>
              <span className="director-admin-billing-tone-pill is-premium">Premium</span>
            </div>

            <div className="director-admin-billing-checkout-price">
              <p className="director-admin-billing-tier-price">$2,500/year</p>
              <p className="director-admin-billing-tier-detail">No onboarding fee</p>
              <p className="director-admin-billing-tier-detail">Pay now: $2,500. Renews later: $2,500/year.</p>
              <p className="director-admin-billing-tier-detail">2 founders slots remaining</p>
            </div>

            <div className="director-admin-billing-checkout-row">
              <div>
                <p className="director-admin-billing-checkout-title">Checkout on current tier</p>
                <p className="muted">Stripe will confirm the final billing details before you pay.</p>
              </div>
              <div className="inline-actions">
                <Button disabled>Start Stripe Checkout</Button>
              </div>
            </div>
          </Card>
        </div>

        <Card className="director-admin-billing-plans">
          <div className="director-admin-billing-plan-head">
            <h2 className="pb-section-title">Choose your billing tier</h2>
            <p className="muted">Available tiers are shown below for this network.</p>
          </div>

          <div className="director-admin-billing-tier-grid">
            {BILLING_TIER_DEFINITIONS.filter((tier) => tier.code !== "test").map((tier) => (
              <article
                key={tier.code}
                className={[
                  "director-admin-billing-tier-card",
                  tier.code === "founders" ? "is-current is-selected" : ""
                ].filter(Boolean).join(" ")}
              >
                <div className="director-admin-billing-tier-top">
                  <h3>{tier.title}</h3>
                  <div className="director-admin-billing-tier-badges">
                    {tier.code === "founders" ? <span className="director-admin-billing-tier-badge">Current</span> : null}
                  </div>
                </div>
                <p className="muted">{tier.subtitle}</p>
                <p className="director-admin-billing-tier-price">
                  {tier.code === "founders" ? "$2,500/year" : tier.code === "legacy" ? "$3,000/year" : "$3,800/year"}
                </p>
                <p className="director-admin-billing-tier-detail">
                  {tier.code === "institutional" ? "$200 onboarding fee on first checkout only" : "No onboarding fee"}
                </p>
                <ul className="director-admin-billing-tier-list">
                  {tier.perks.map((perk) => (
                    <li key={perk}>{perk}</li>
                  ))}
                </ul>
                <Button variant={tier.code === "founders" ? "primary" : "secondary"} disabled>
                  {tier.code === "founders" ? "Selected Plan" : "Select Plan"}
                </Button>
              </article>
            ))}
          </div>
        </Card>

        <Card className="director-admin-billing-invoices-card">
          <div className="director-admin-billing-invoice-head">
            <h2 className="pb-section-title">Recent Invoices</h2>
            <p className="muted">Latest Stripe invoice records for this network.</p>
          </div>
          <div className="director-admin-table-wrap">
            <table className="director-admin-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Download</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>3/15/2026</td>
                  <td>$2,500</td>
                  <td>paid</td>
                  <td><span className="muted">PDF</span></td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    );
  }

  const tenant = payload?.tenant || {};
  const usage = payload?.usage || {};
  const billingStatus = String(tenant.billingStatus || "").toLowerCase();
  const lifecycleStatus = String(tenant.billingLifecycleStatus || "").toLowerCase();
  const isComplimentary = Boolean(payload?.tenant?.isComplimentary || payload?.billing?.isComplimentary);
  const resolvedCurrentPlanCode = normalizeBillingPlanCode(tenant.billingPlan || payload?.billing?.billingPlan);
  const initialCheckoutCompletedAt = tenant.initialCheckoutCompletedAt || payload?.billing?.initialCheckoutCompletedAt;
  const renewalDate = tenant.currentPeriodEnd || payload?.billing?.currentPeriodEnd || null;
  const activationDate = tenant.activatedAt || payload?.billing?.activatedAt || null;
  const cancellationDate = tenant.canceledAt || payload?.billing?.canceledAt || null;
  const hasNoActivePlan = lifecycleStatus === "uninitialized" && !initialCheckoutCompletedAt && !renewalDate && !activationDate;
  const currentPlanCode = hasNoActivePlan ? "" : resolvedCurrentPlanCode;
  const showTrialBanner = billingStatus === "trialing" && !hasNoActivePlan;
  const showPastDueBanner = billingStatus === "past_due";
  const showCheckoutBanner = lifecycleStatus === "checkout_started";
  const lastInvoiceStatus = String(payload?.billing?.lastInvoiceStatus || "").trim().toLowerCase();
  const lastInvoiceErrorCode = String(payload?.billing?.lastInvoiceErrorCode || "").trim();
  const lastInvoiceErrorMessage = String(payload?.billing?.lastInvoiceErrorMessage || "").trim();
  const showInvoiceFinalizationBanner =
    lastInvoiceStatus === "finalization_failed" && !hasNoActivePlan && !isComplimentary;
  const subscriptionCancelAtPeriodEnd = Boolean(payload?.subscription?.cancelAtPeriodEnd);
  const hasActiveSubscription = ["active", "trialing", "past_due"].includes(lifecycleStatus);
  const showCancelBanner = subscriptionCancelAtPeriodEnd && hasActiveSubscription;
  const catalogPlans = Array.isArray(payload?.catalog?.plans) ? payload.catalog.plans : [];
  const catalogPlansByCode = new Map(
    catalogPlans
      .map((plan) => [String(plan?.code || "").trim().toLowerCase(), plan])
      .filter(([code]) => Boolean(code))
  );
  const visibleTierDefinitions = BILLING_TIER_DEFINITIONS.filter((tier) =>
    catalogPlansByCode.has(tier.code)
  );
  const normalizedSelectedPlanCode = normalizeBillingPlanCode(selectedPlanCode);
  const selectedPlan = catalogPlansByCode.get(normalizedSelectedPlanCode) || null;
  const selectedPlanIsAvailable = Boolean(selectedPlan);
  const currentPlan = catalogPlansByCode.get(currentPlanCode) || null;
  const selectedTierDefinition = BILLING_TIER_DEFINITIONS_BY_CODE.get(normalizedSelectedPlanCode) || null;
  const currentTierDefinition = BILLING_TIER_DEFINITIONS_BY_CODE.get(currentPlanCode) || null;
  const billingStatusLabel = isComplimentary
    ? "complimentary"
    : hasNoActivePlan
    ? "no active plan"
    : formatStatusLabel(tenant.billingStatus, "trialing");
  const billingStatusBadgeTone = isComplimentary ? "success" : hasNoActivePlan ? "neutral" : statusTone(tenant.billingStatus);
  const lifecycleLabel = formatLifecycleLabel(tenant.billingLifecycleStatus, "uninitialized");
  const onboardingFeeLabel = hasNoActivePlan ? "-" : isComplimentary ? "$0" : formatMoney(tenant.onboardingFeeAmount);
  const onboardingFeeStatusLabel = hasNoActivePlan
    ? "inactive"
    : isComplimentary
      ? "waived"
    : formatStatusLabel(
        tenant.onboardingFeeStatus || (tenant.onboardingFeePaid ? "paid" : "unpaid"),
        tenant.onboardingFeePaid ? "paid" : "unpaid"
      );
  const planSummaryLabel = hasNoActivePlan
    ? "Billing has not been activated for this network yet."
    : isComplimentary
      ? "This network is on a complimentary premium plan. No Stripe charge is required."
    : currentPlan?.label || currentTierDefinition?.subtitle || "Selected tenant billing tier";
  const memberUsagePercent = Math.min(100, Math.max(0, Number(usage.memberUsagePercent || 0)));
  const memberUsageLabel = usage.memberLimit
    ? `${usage.members || 0} / ${usage.memberLimit}`
    : `${usage.members || 0} (unlimited)`;
  const selectedPlanPriceLabel = hasNoActivePlan
    ? "Billing inactive"
    : isComplimentary
      ? "No charge"
    : selectedPlan
      ? `${formatMoney(selectedPlan.annualAmount)}/year`
      : "Not available";
  const checkoutButtonLabel = startingCheckout
    ? "Redirecting..."
    : isComplimentary
      ? "No Payment Required"
    : hasNoActivePlan
      ? "No Active Plan"
      : normalizedSelectedPlanCode === currentPlanCode
        ? "Start Stripe Checkout"
        : "Switch Plan & Checkout";
  const showInvoiceTable = Array.isArray(payload?.invoices) && payload.invoices.length > 0;
  const institutionalOnboardingAppliesNow =
    normalizedSelectedPlanCode === "institutional" && !initialCheckoutCompletedAt;
  const selectedPlanPayNowAmount = selectedPlan
    ? Number(selectedPlan.annualAmount || 0) +
      (institutionalOnboardingAppliesNow ? Number(selectedPlan.onboardingFeeAmount || 0) : 0)
    : 0;
  const selectedPlanRenewsAmount = selectedPlan ? Number(selectedPlan.annualAmount || 0) : 0;
  const showSelectedPlanPaymentBreakdown = Boolean(selectedPlan) && !hasNoActivePlan && !isComplimentary;
  const selectedPlanOnboardingLabel = hasNoActivePlan
    ? "Billing is inactive for this network. Controls stay disabled until a plan is activated."
    : isComplimentary
      ? "Complimentary access is active. No checkout or renewal charge applies."
    : selectedPlan
      ? normalizedSelectedPlanCode === "institutional"
        ? institutionalOnboardingAppliesNow
          ? `${formatMoney(selectedPlan.onboardingFeeAmount)} onboarding charged now (first checkout only)`
          : "Institutional onboarding already handled; renewals are annual only"
        : "No onboarding fee"
      : "Contact support to enable this tier.";
  const foundersAvailabilityRemaining = Number(payload?.foundersAvailability?.remaining);
  const foundersAvailabilityText = Number.isFinite(foundersAvailabilityRemaining)
    ? `${foundersAvailabilityRemaining} founders slots remaining`
    : "";
  const currentPlanTitle = hasNoActivePlan ? "No Active Plan" : isComplimentary ? "Complimentary Premium" : billingPlanLabel(currentPlanCode);
  const currentPlanToneClass = hasNoActivePlan ? "is-inactive" : `is-${currentTierDefinition?.tone || "base"}`;
  const currentPlanToneLabel = hasNoActivePlan
    ? "Inactive"
    : currentTierDefinition?.tone === "premium"
      ? "Premium"
      : "Base";
  const checkoutPlanTitle = hasNoActivePlan ? "No Active Plan" : isComplimentary ? "Complimentary Plan" : selectedTierDefinition?.title || "Select a tier";
  const checkoutPlanSubtitle = hasNoActivePlan
    ? "This billing page is available in read-only mode until a plan is activated for your network."
    : isComplimentary
      ? "Camp Cedar is on a special no-charge plan, so Stripe checkout is disabled."
    : selectedTierDefinition?.subtitle || "Choose an available tier, then continue to Stripe.";
  const checkoutStateTitle = hasNoActivePlan
    ? "Billing activation required"
    : isComplimentary
      ? "No checkout required"
    : selectedPlan
      ? normalizedSelectedPlanCode === currentPlanCode
        ? "Checkout on current tier"
        : "Switch tier at checkout"
      : "Select a plan to continue";
  const checkoutStateDescription = isComplimentary
    ? "This complimentary plan stays active without a Stripe payment step."
    : "Stripe will confirm the final billing details before you pay.";
  const invoiceEmptyMessage = hasNoActivePlan
    ? "Invoices will appear here after billing is activated for this network."
    : isComplimentary
      ? "Complimentary networks do not generate Stripe invoices."
    : "Invoice history will appear here once Stripe sync is enabled.";

  return (
    <div className="director-admin-stack director-admin-billing-page">
      <header className="pb-admin-ui-page-header director-admin-billing-page-header">
        <div className="pb-admin-ui-page-copy director-admin-billing-page-copy">
          <p className="director-admin-billing-header-eyebrow">Director Billing</p>
          <h1>Billing</h1>
          <p className="director-admin-billing-header-subtitle">
            Manage plan tier, payment status, and Stripe checkout for your network.
          </p>
          <div className="director-admin-billing-header-meta">
            <span className={`director-admin-billing-header-chip ${currentPlanToneClass}`}>
              Plan: {currentPlanTitle}
            </span>
            <span className={`director-admin-billing-header-chip is-status-${billingStatusBadgeTone}`}>
              Status: {billingStatusLabel}
            </span>
            <span className="director-admin-billing-header-chip is-muted">
              Lifecycle: {hasNoActivePlan ? "inactive" : lifecycleLabel}
            </span>
          </div>
        </div>
        <div className="pb-admin-ui-page-actions director-admin-billing-page-actions">
          <Button variant="secondary" onClick={loadBilling} disabled={hasNoActivePlan}>Refresh</Button>
        </div>
      </header>

      {hasNoActivePlan ? (
        <Card className="director-admin-banner tone-info">
          <p>
            No active plan. Billing details are shown in read-only mode until a plan is activated for this
            network.
          </p>
        </Card>
      ) : null}

      {isComplimentary ? (
        <Card className="director-admin-banner tone-info">
          <p>This network is on a complimentary premium plan. Stripe checkout and the billing portal are not required.</p>
        </Card>
      ) : null}

      {showTrialBanner ? (
        <Card className="director-admin-banner tone-info">
          <p>Your free trial is active. Add a payment method to keep your network live.</p>
          {payload?.manageBillingUrl ? (
            <a className="link-button" href={payload.manageBillingUrl} target="_blank" rel="noreferrer">
              Add Payment Method
            </a>
          ) : null}
        </Card>
      ) : null}

      {showPastDueBanner ? (
        <Card className="director-admin-banner tone-danger">
          <p>Your payment failed. Update your payment method to restore full access.</p>
          {payload?.manageBillingUrl ? (
            <a className="link-button" href={payload.manageBillingUrl} target="_blank" rel="noreferrer">
              Update Payment Method
            </a>
          ) : null}
        </Card>
      ) : null}

      {showCheckoutBanner ? (
        <Card className="director-admin-banner tone-info">
          <p>Stripe checkout is in progress. Complete payment to activate launch readiness.</p>
        </Card>
      ) : null}

      {showInvoiceFinalizationBanner ? (
        <Card className="director-admin-banner tone-warning">
          <p>
            Stripe could not finalize the latest invoice, so billing may need attention before the next collection
            attempt.
            {lastInvoiceErrorCode ? ` Error code: ${lastInvoiceErrorCode}.` : ""}
            {lastInvoiceErrorMessage ? ` ${lastInvoiceErrorMessage}` : ""}
          </p>
          {payload?.manageBillingUrl ? (
            <a className="link-button" href={payload.manageBillingUrl} target="_blank" rel="noreferrer">
              Open Billing Portal
            </a>
          ) : null}
        </Card>
      ) : null}

      {showCancelBanner ? (
        <Card className="director-admin-banner tone-warning">
          <p>
            Your subscription is scheduled to cancel{renewalDate ? ` on ${formatDate(renewalDate)}` : " at the end of the current billing period"}.
            You will retain access until then.
          </p>
          <Button variant="secondary" onClick={resumeSubscription} disabled={resumingSubscription}>
            {resumingSubscription ? "Resuming..." : "Resume Subscription"}
          </Button>
        </Card>
      ) : null}

      {error ? <p className="error-text">{error}</p> : null}
      {status ? <p className="success-text">{status}</p> : null}

      <div className="director-admin-billing-top-grid">
        <Card className={`director-admin-billing-summary-card${hasNoActivePlan ? " is-readonly" : ""}`}>
          <div className="director-admin-billing-summary-head">
            <div>
              <p className="director-admin-billing-kicker">Current Plan</p>
              <h2>{currentPlanTitle}</h2>
              <p className="muted">{planSummaryLabel}</p>
            </div>
            <span className={`director-admin-billing-tone-pill ${currentPlanToneClass}`}>
              {currentPlanToneLabel}
            </span>
          </div>

          <div className="director-admin-billing-key-grid">
            <div className="director-admin-billing-key-item">
              <span>Billing Status</span>
              <strong>
                <span className={`director-admin-status-badge tone-${billingStatusBadgeTone}`.trim()}>
                  {billingStatusLabel}
                </span>
              </strong>
            </div>
            <div className="director-admin-billing-key-item">
              <span>Lifecycle</span>
              <strong>{lifecycleLabel}</strong>
            </div>
            <div className="director-admin-billing-key-item">
              <span>Onboarding Fee</span>
              <strong>{onboardingFeeLabel}</strong>
              <small>{onboardingFeeStatusLabel}</small>
            </div>
            <div className="director-admin-billing-key-item">
              <span>{subscriptionCancelAtPeriodEnd ? "Access Until" : "Renews On"}</span>
              <strong>{formatDate(renewalDate)}</strong>
              <small>
                {hasNoActivePlan
                  ? "Activate billing to begin renewals"
                  : subscriptionCancelAtPeriodEnd
                  ? "Cancels at end of period"
                  : renewalDate
                    ? `Next payment: ${currentPlan ? formatMoney(currentPlan.annualAmount) : formatMoney(payload?.billing?.annualAmount)}`
                    : "No renewal date yet"}
              </small>
            </div>
            <div className="director-admin-billing-key-item">
              <span>Member Usage</span>
              <strong>{memberUsageLabel}</strong>
              <small>{payload?.billing?.launchReady ? "Launch ready" : "Not launch ready"}</small>
            </div>
            <div className="director-admin-billing-key-item">
              <span>Lifecycle Dates</span>
              <strong>{activationDate ? `Active ${formatDate(activationDate)}` : hasNoActivePlan ? "Billing inactive" : "Pending activation"}</strong>
              <small>
                {cancellationDate
                  ? `Canceled ${formatDate(cancellationDate)}`
                  : hasNoActivePlan
                    ? "No activation recorded"
                    : "No cancellation recorded"}
              </small>
            </div>
          </div>

          {usage.memberLimit ? (
            <div className="director-admin-billing-usage">
              <div className="director-admin-progress">
                <span style={{ width: `${memberUsagePercent}%` }} />
              </div>
              <small>{memberUsagePercent}% of member limit used</small>
            </div>
          ) : null}

          <div className="inline-actions">
            {payload?.manageBillingUrl && !hasNoActivePlan && !isComplimentary ? (
              <a className="link-button" href={payload.manageBillingUrl} target="_blank" rel="noreferrer">
                Open Billing Portal
              </a>
            ) : (
              <Button variant="secondary" disabled>
                Billing Portal Unavailable
              </Button>
            )}
            <Button variant="secondary" onClick={loadBilling} disabled={hasNoActivePlan}>Refresh Billing</Button>
            {hasActiveSubscription && !subscriptionCancelAtPeriodEnd && !hasNoActivePlan && !isComplimentary ? (
              <Button variant="danger" onClick={() => setShowCancelConfirm(true)} disabled={hasNoActivePlan}>
                Cancel Plan
              </Button>
            ) : null}
            {subscriptionCancelAtPeriodEnd && !hasNoActivePlan && !isComplimentary ? (
              <Button variant="secondary" onClick={resumeSubscription} disabled={resumingSubscription}>
                {resumingSubscription ? "Resuming..." : "Resume Plan"}
              </Button>
            ) : null}
          </div>

          {showCancelConfirm ? (
            <Card className="director-admin-banner tone-danger" style={{ marginTop: "1rem" }}>
              <p>
                <strong>Are you sure you want to cancel?</strong> Your subscription will remain active
                until the end of the current billing period{renewalDate ? ` (${formatDate(renewalDate)})` : ""}.
                After that, your network will lose access to paid features.
              </p>
              <div className="inline-actions">
                <Button variant="danger" onClick={cancelSubscription} disabled={cancellingSubscription}>
                  {cancellingSubscription ? "Cancelling..." : "Yes, Cancel Subscription"}
                </Button>
                <Button variant="secondary" onClick={() => setShowCancelConfirm(false)}>
                  Keep My Plan
                </Button>
              </div>
            </Card>
          ) : null}
        </Card>

        <Card className={`director-admin-billing-checkout-card${hasNoActivePlan ? " is-readonly" : ""}`}>
          <div className="director-admin-billing-summary-head">
            <div>
              <p className="director-admin-billing-kicker">Plan & Checkout</p>
              <h2>{checkoutPlanTitle}</h2>
              <p className="muted">{checkoutPlanSubtitle}</p>
            </div>
            <span className={`director-admin-billing-tone-pill ${hasNoActivePlan ? "is-inactive" : `is-${selectedTierDefinition?.tone || "base"}`}`}>
              {hasNoActivePlan ? "Inactive" : selectedTierDefinition?.tone === "premium" ? "Premium" : "Base"}
            </span>
          </div>

          <div className="director-admin-billing-checkout-price">
            <p className="director-admin-billing-tier-price">{selectedPlanPriceLabel}</p>
            <p className="director-admin-billing-tier-detail">{selectedPlanOnboardingLabel}</p>
            {showSelectedPlanPaymentBreakdown ? (
              <p className="director-admin-billing-tier-detail">
                Pay now: {formatMoney(selectedPlanPayNowAmount)}. Renews later: {formatMoney(selectedPlanRenewsAmount)}/year.
              </p>
            ) : null}
            {normalizedSelectedPlanCode === "founders" && foundersAvailabilityText && !isComplimentary ? (
              <p className="director-admin-billing-tier-detail">{foundersAvailabilityText}</p>
            ) : null}
          </div>

          <div className="director-admin-billing-checkout-row">
            <div>
              <p className="director-admin-billing-checkout-title">{checkoutStateTitle}</p>
              <p className="muted">{checkoutStateDescription}</p>
            </div>
            <div className="inline-actions">
              <Button onClick={startCheckout} disabled={startingCheckout || !selectedPlanIsAvailable || hasNoActivePlan || isComplimentary}>
                {checkoutButtonLabel}
              </Button>
            </div>
          </div>
        </Card>
      </div>

      <Card className={`director-admin-billing-plans${hasNoActivePlan || isComplimentary ? " is-readonly" : ""}`}>
        <div className="director-admin-billing-plan-head">
          <h2 className="pb-section-title">Choose your billing tier</h2>
          <p className="muted">Available tiers are shown below for this network.</p>
        </div>

        <div className="director-admin-billing-tier-grid">
          {visibleTierDefinitions.map((tier) => {
            const plan = catalogPlansByCode.get(tier.code) || null;
            const isCurrent = currentPlanCode === tier.code;
            const isSelected = selectedPlanCode === tier.code;
            const isUnavailable = !plan;
            const foundersAvailability = tier.code === "founders" ? payload?.foundersAvailability : null;

            return (
              <article
                key={tier.code}
                className={[
                  "director-admin-billing-tier-card",
                  isCurrent ? "is-current" : "",
                  isSelected ? "is-selected" : "",
                  isUnavailable || hasNoActivePlan || isComplimentary ? "is-disabled" : ""
                ].filter(Boolean).join(" ")}
              >
                <div className="director-admin-billing-tier-top">
                  <h3>{tier.title}</h3>
                  <div className="director-admin-billing-tier-badges">
                    {isCurrent ? <span className="director-admin-billing-tier-badge">Current</span> : null}
                    {isSelected && !isCurrent ? (
                      <span className="director-admin-billing-tier-badge is-selected">Selected</span>
                    ) : null}
                  </div>
                </div>
                <p className="muted">{tier.subtitle}</p>
                <p className="director-admin-billing-tier-price">
                  {plan ? `${formatMoney(plan.annualAmount)}/year` : "Not currently available"}
                </p>
                <p className="director-admin-billing-tier-detail">
                  {plan
                    ? tier.code === "institutional"
                      ? `${formatMoney(plan.onboardingFeeAmount)} onboarding fee on first checkout only`
                      : "No onboarding fee"
                    : "Contact support to enable this tier for your tenant."}
                </p>
                {foundersAvailability ? (
                  <p className="director-admin-billing-tier-detail">
                    {foundersAvailability.remaining} founders slots remaining
                  </p>
                ) : null}
                <ul className="director-admin-billing-tier-list">
                  {tier.perks.map((perk) => (
                    <li key={perk}>{perk}</li>
                  ))}
                </ul>
                <Button
                  type="button"
                  variant={isSelected ? "primary" : "secondary"}
                  onClick={() => setSelectedPlanCode(tier.code)}
                  disabled={isUnavailable || hasNoActivePlan || isComplimentary}
                >
                  {isSelected ? "Selected Plan" : "Select Plan"}
                </Button>
              </article>
            );
          })}
        </div>
      </Card>

      <Card className={`director-admin-billing-invoices-card${hasNoActivePlan ? " is-readonly" : ""}`}>
        <div className="director-admin-billing-invoice-head">
          <h2 className="pb-section-title">Recent Invoices</h2>
          <p className="muted">Latest Stripe invoice records for this network.</p>
        </div>
        {!showInvoiceTable ? (
          <div className="director-admin-billing-empty">
            <p className="muted">{invoiceEmptyMessage}</p>
          </div>
        ) : (
          <div className="director-admin-table-wrap">
            <table className="director-admin-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Download</th>
                </tr>
              </thead>
              <tbody>
                {payload.invoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td>{formatDate(invoice.date)}</td>
                    <td>{formatMoney(invoice.amount)}</td>
                    <td>{invoice.status}</td>
                    <td>
                      {invoice.pdfUrl ? (
                        <a href={invoice.pdfUrl} target="_blank" rel="noreferrer">
                          PDF
                        </a>
                      ) : invoice.hostedInvoiceUrl ? (
                        <a href={invoice.hostedInvoiceUrl} target="_blank" rel="noreferrer">
                          View
                        </a>
                      ) : (
                        "-"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
