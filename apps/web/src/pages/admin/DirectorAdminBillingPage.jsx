import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button, Card } from "@pondbridge/ui";
import { PageHeader } from "../../components/admin/AdminUi.jsx";
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
  if (normalized === "founders") return "Founders";
  if (normalized === "institutional") return "Institutional";
  return "Legacy";
}

const BILLING_TIER_DEFINITIONS = [
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
  const [selectedPlanCode, setSelectedPlanCode] = useState("legacy");
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
      const livePlanCode = String(
        response?.tenant?.billingPlan || response?.billing?.billingPlan || "legacy"
      )
        .trim()
        .toLowerCase();
      if (livePlanCode) {
        setSelectedPlanCode(livePlanCode);
      }
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
            <p className="muted">Three tiers are available: Founders, Legacy, and Institutional.</p>
          </div>

          <div className="director-admin-billing-tier-grid">
            {BILLING_TIER_DEFINITIONS.map((tier) => (
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
  const currentPlanCode = String(tenant.billingPlan || "legacy").trim().toLowerCase();
  const showTrialBanner = billingStatus === "trialing";
  const showPastDueBanner = billingStatus === "past_due";
  const showCheckoutBanner = lifecycleStatus === "checkout_started";
  const subscriptionCancelAtPeriodEnd = Boolean(payload?.subscription?.cancelAtPeriodEnd);
  const hasActiveSubscription = ["active", "trialing", "past_due"].includes(lifecycleStatus);
  const showCancelBanner = subscriptionCancelAtPeriodEnd && hasActiveSubscription;
  const catalogPlans = Array.isArray(payload?.catalog?.plans) ? payload.catalog.plans : [];
  const catalogPlansByCode = new Map(
    catalogPlans
      .map((plan) => [String(plan?.code || "").trim().toLowerCase(), plan])
      .filter(([code]) => Boolean(code))
  );
  const selectedPlan = catalogPlansByCode.get(String(selectedPlanCode || "").trim().toLowerCase()) || null;
  const selectedPlanIsAvailable = Boolean(selectedPlan);
  const currentPlan = catalogPlansByCode.get(currentPlanCode) || null;
  const selectedTierDefinition = BILLING_TIER_DEFINITIONS.find((item) => item.code === selectedPlanCode) || null;
  const currentTierDefinition = BILLING_TIER_DEFINITIONS.find((item) => item.code === currentPlanCode) || null;
  const billingStatusLabel = formatStatusLabel(tenant.billingStatus, "trialing");
  const lifecycleLabel = formatLifecycleLabel(tenant.billingLifecycleStatus, "uninitialized");
  const onboardingFeeLabel = formatMoney(tenant.onboardingFeeAmount);
  const onboardingFeeStatusLabel = formatStatusLabel(
    tenant.onboardingFeeStatus || (tenant.onboardingFeePaid ? "paid" : "unpaid"),
    tenant.onboardingFeePaid ? "paid" : "unpaid"
  );
  const planSummaryLabel = currentPlan?.label || currentTierDefinition?.subtitle || "Selected tenant billing tier";
  const memberUsagePercent = Math.min(100, Math.max(0, Number(usage.memberUsagePercent || 0)));
  const memberUsageLabel = usage.memberLimit
    ? `${usage.members || 0} / ${usage.memberLimit}`
    : `${usage.members || 0} (unlimited)`;
  const selectedPlanPriceLabel = selectedPlan ? `${formatMoney(selectedPlan.annualAmount)}/year` : "Not available";
  const checkoutButtonLabel = startingCheckout
    ? "Redirecting..."
    : selectedPlanCode === currentPlanCode
    ? "Start Stripe Checkout"
    : "Switch Plan & Checkout";
  const showInvoiceTable = Array.isArray(payload?.invoices) && payload.invoices.length > 0;
  const initialCheckoutCompletedAt = tenant.initialCheckoutCompletedAt || payload?.billing?.initialCheckoutCompletedAt;
  const renewalDate = tenant.currentPeriodEnd || payload?.billing?.currentPeriodEnd || null;
  const activationDate = tenant.activatedAt || payload?.billing?.activatedAt || null;
  const cancellationDate = tenant.canceledAt || payload?.billing?.canceledAt || null;
  const institutionalOnboardingAppliesNow =
    selectedPlanCode === "institutional" && !initialCheckoutCompletedAt;
  const selectedPlanPayNowAmount = selectedPlan
    ? Number(selectedPlan.annualAmount || 0) +
      (institutionalOnboardingAppliesNow ? Number(selectedPlan.onboardingFeeAmount || 0) : 0)
    : 0;
  const selectedPlanRenewsAmount = selectedPlan ? Number(selectedPlan.annualAmount || 0) : 0;
  const selectedPlanOnboardingLabel = selectedPlan
    ? selectedPlanCode === "institutional"
      ? institutionalOnboardingAppliesNow
        ? `${formatMoney(selectedPlan.onboardingFeeAmount)} onboarding charged now (first checkout only)`
        : "Institutional onboarding already handled; renewals are annual only"
      : "No onboarding fee"
    : "Contact support to enable this tier.";
  const foundersAvailabilityText = useMemo(() => {
    const remaining = Number(payload?.foundersAvailability?.remaining);
    if (!Number.isFinite(remaining)) return "";
    return `${remaining} founders slots remaining`;
  }, [payload?.foundersAvailability?.remaining]);

  return (
    <div className="director-admin-stack director-admin-billing-page">
      <PageHeader
        title="Billing"
        subtitle="Manage plan tier, payment status, and Stripe checkout for your network."
        actions={<Button variant="secondary" onClick={loadBilling}>Refresh</Button>}
      />

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
        <Card className="director-admin-billing-summary-card">
          <div className="director-admin-billing-summary-head">
            <div>
              <p className="director-admin-billing-kicker">Current Plan</p>
              <h2>{billingPlanLabel(currentPlanCode)}</h2>
              <p className="muted">{planSummaryLabel}</p>
            </div>
            <span className={`director-admin-billing-tone-pill is-${currentTierDefinition?.tone || "base"}`}>
              {currentTierDefinition?.tone === "premium" ? "Premium" : "Base"}
            </span>
          </div>

          <div className="director-admin-billing-key-grid">
            <div className="director-admin-billing-key-item">
              <span>Billing Status</span>
              <strong>
                <span className={`director-admin-status-badge tone-${statusTone(tenant.billingStatus)}`.trim()}>
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
                {subscriptionCancelAtPeriodEnd
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
              <strong>{activationDate ? `Active ${formatDate(activationDate)}` : "Pending activation"}</strong>
              <small>{cancellationDate ? `Canceled ${formatDate(cancellationDate)}` : "No cancellation recorded"}</small>
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
            {payload?.manageBillingUrl ? (
              <a className="link-button" href={payload.manageBillingUrl} target="_blank" rel="noreferrer">
                Open Billing Portal
              </a>
            ) : (
              <Button variant="secondary" disabled>
                Billing Portal Unavailable
              </Button>
            )}
            <Button variant="secondary" onClick={loadBilling}>Refresh Billing</Button>
            {hasActiveSubscription && !subscriptionCancelAtPeriodEnd ? (
              <Button variant="danger" onClick={() => setShowCancelConfirm(true)}>
                Cancel Plan
              </Button>
            ) : null}
            {subscriptionCancelAtPeriodEnd ? (
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

        <Card className="director-admin-billing-checkout-card">
          <div className="director-admin-billing-summary-head">
            <div>
              <p className="director-admin-billing-kicker">Plan & Checkout</p>
              <h2>{selectedTierDefinition?.title || "Select a tier"}</h2>
              <p className="muted">
                {selectedTierDefinition?.subtitle || "Choose Founders, Legacy, or Institutional, then continue to Stripe."}
              </p>
            </div>
            <span className={`director-admin-billing-tone-pill is-${selectedTierDefinition?.tone || "base"}`}>
              {selectedTierDefinition?.tone === "premium" ? "Premium" : "Base"}
            </span>
          </div>

          <div className="director-admin-billing-checkout-price">
            <p className="director-admin-billing-tier-price">{selectedPlanPriceLabel}</p>
            <p className="director-admin-billing-tier-detail">{selectedPlanOnboardingLabel}</p>
            {selectedPlan ? (
              <p className="director-admin-billing-tier-detail">
                Pay now: {formatMoney(selectedPlanPayNowAmount)}. Renews later: {formatMoney(selectedPlanRenewsAmount)}/year.
              </p>
            ) : null}
            {selectedPlanCode === "founders" && foundersAvailabilityText ? (
              <p className="director-admin-billing-tier-detail">{foundersAvailabilityText}</p>
            ) : null}
          </div>

          <div className="director-admin-billing-checkout-row">
            <div>
              <p className="director-admin-billing-checkout-title">
                {selectedPlan
                  ? selectedPlanCode === currentPlanCode
                    ? "Checkout on current tier"
                    : "Switch tier at checkout"
                  : "Select a plan to continue"}
              </p>
              <p className="muted">Stripe will confirm the final billing details before you pay.</p>
            </div>
            <div className="inline-actions">
              <Button onClick={startCheckout} disabled={startingCheckout || !selectedPlanIsAvailable}>
                {checkoutButtonLabel}
              </Button>
            </div>
          </div>
        </Card>
      </div>

      <Card className="director-admin-billing-plans">
        <div className="director-admin-billing-plan-head">
          <h2 className="pb-section-title">Choose your billing tier</h2>
          <p className="muted">Three tiers are available: Founders, Legacy, and Institutional.</p>
        </div>

        <div className="director-admin-billing-tier-grid">
          {BILLING_TIER_DEFINITIONS.map((tier) => {
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
                  isUnavailable ? "is-disabled" : ""
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
                  disabled={isUnavailable}
                >
                  {isSelected ? "Selected Plan" : "Select Plan"}
                </Button>
              </article>
            );
          })}
        </div>
      </Card>

      <Card className="director-admin-billing-invoices-card">
        <div className="director-admin-billing-invoice-head">
          <h2 className="pb-section-title">Recent Invoices</h2>
          <p className="muted">Latest Stripe invoice records for this network.</p>
        </div>
        {!showInvoiceTable ? (
          <div className="director-admin-billing-empty">
            <p className="muted">Invoice history will appear here once Stripe sync is enabled.</p>
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
