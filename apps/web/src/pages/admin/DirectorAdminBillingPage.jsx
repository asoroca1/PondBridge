import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button, Card } from "@pondbridge/ui";
import { PageHeader } from "../../components/admin/AdminUi.jsx";
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
    subtitle: "Premium features for the first 5 camps."
  },
  {
    code: "legacy",
    title: "Legacy",
    subtitle: "Base tier with core network tools."
  },
  {
    code: "institutional",
    title: "Institutional",
    subtitle: "Premium tier with institutional support."
  }
];

export default function DirectorAdminBillingPage() {
  const { slug, request } = useAdminApi();
  const [searchParams] = useSearchParams();
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [selectedPlanCode, setSelectedPlanCode] = useState("legacy");
  const [startingCheckout, setStartingCheckout] = useState(false);

  const checkoutQueryState = String(searchParams.get("checkout") || "").trim().toLowerCase();

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
      const checkoutUrl = String(response?.checkoutUrl || "").trim();
      if (!checkoutUrl) {
        throw new Error("Stripe checkout URL was not returned.");
      }
      window.location.assign(checkoutUrl);
    } catch (requestError) {
      setError(requestError.message || "Unable to start Stripe checkout.");
      setStartingCheckout(false);
    }
  }

  if (loading && !payload) {
    return (
      <Card>
        <p className="muted">Loading billing...</p>
      </Card>
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
  const catalogPlans = Array.isArray(payload?.catalog?.plans) ? payload.catalog.plans : [];
  const catalogPlansByCode = new Map(
    catalogPlans
      .map((plan) => [String(plan?.code || "").trim().toLowerCase(), plan])
      .filter(([code]) => Boolean(code))
  );
  const selectedPlan = catalogPlansByCode.get(String(selectedPlanCode || "").trim().toLowerCase()) || null;
  const selectedPlanIsAvailable = Boolean(selectedPlan);
  const memberUsagePercent = Math.min(100, Math.max(0, Number(usage.memberUsagePercent || 0)));
  const memberUsageLabel = usage.memberLimit
    ? `${usage.members || 0} / ${usage.memberLimit}`
    : `${usage.members || 0} (unlimited)`;

  return (
    <div className="director-admin-stack">
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

      <Card className="director-admin-billing-overview">
        <PageHeader
          title="Billing"
          subtitle="Manage your plan, payment status, and launch readiness."
          actions={<Button variant="secondary" onClick={loadBilling}>Refresh</Button>}
        />
        {error ? <p className="error-text">{error}</p> : null}
        {status ? <p className="success-text">{status}</p> : null}

        <div className="director-admin-billing-metrics">
          <div className="director-admin-billing-metric">
            <span>Current Plan</span>
            <strong>{billingPlanLabel(currentPlanCode)}</strong>
            <small>{catalogPlansByCode.get(currentPlanCode)?.label || "Selected tenant billing tier"}</small>
          </div>
          <div className="director-admin-billing-metric">
            <span>Billing Status</span>
            <strong>
              <span className={`director-admin-status-badge tone-${statusTone(tenant.billingStatus)}`.trim()}>
                {String(tenant.billingStatus || "trialing").replace(/_/g, " ")}
              </span>
            </strong>
            <small>Lifecycle: {tenant.billingLifecycleStatus || "uninitialized"}</small>
          </div>
          <div className="director-admin-billing-metric">
            <span>Onboarding Fee</span>
            <strong>{formatMoney(tenant.onboardingFeeAmount)}</strong>
            <small>
              {tenant.onboardingFeeStatus || (tenant.onboardingFeePaid ? "paid" : "unpaid")}
            </small>
          </div>
          <div className="director-admin-billing-metric">
            <span>Member Usage</span>
            <strong>{memberUsageLabel}</strong>
            <small>{payload?.billing?.launchReady ? "Launch ready" : "Not launch ready"}</small>
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
              Manage Billing Portal
            </a>
          ) : (
            <Button variant="secondary" disabled>
              Billing Portal Unavailable
            </Button>
          )}
        </div>
      </Card>

      <Card className="director-admin-billing-plans">
        <div className="director-admin-billing-plan-head">
          <h2 className="pb-section-title">Choose Your Plan</h2>
          <p className="muted">Founders, Legacy, and Institutional tiers are available in Stripe checkout.</p>
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
                    ? plan.onboardingFeeAmount > 0
                      ? `${formatMoney(plan.onboardingFeeAmount)} onboarding fee`
                      : "No onboarding fee"
                    : "Contact support to enable this tier for your tenant."}
                </p>
                {foundersAvailability ? (
                  <p className="director-admin-billing-tier-detail">
                    {foundersAvailability.remaining} founders slots remaining
                  </p>
                ) : null}
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

        <div className="director-admin-billing-checkout-row">
          <div>
            <p className="director-admin-billing-checkout-title">
              {selectedPlan ? `Ready to checkout: ${selectedPlan.label}` : "Select a plan to continue"}
            </p>
            {selectedPlan ? (
              <p className="muted">
                {selectedPlanCode === currentPlanCode
                  ? "You are checking out on your current tier."
                  : "This will switch your tenant billing tier at checkout."}
              </p>
            ) : null}
          </div>
          <div className="inline-actions">
            <Button onClick={startCheckout} disabled={startingCheckout || !selectedPlanIsAvailable}>
              {startingCheckout
                ? "Redirecting..."
                : selectedPlanCode === currentPlanCode
                ? "Start Stripe Checkout"
                : "Switch Plan & Checkout"}
            </Button>
            <Button variant="secondary" onClick={loadBilling}>
              Refresh Billing
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <h2 className="pb-section-title">Recent Invoices</h2>
        {!payload?.invoices?.length ? (
          <p className="muted">Invoice history will appear here once Stripe sync is enabled.</p>
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
