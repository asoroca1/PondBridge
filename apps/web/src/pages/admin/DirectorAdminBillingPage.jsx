import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button, Card, Select } from "@pondbridge/ui";
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

      <div className="director-admin-two-col">
        <Card>
          <PageHeader
            title="Billing"
            subtitle="Plan and billing summary for your network."
            actions={<Button variant="secondary" onClick={loadBilling}>Refresh</Button>}
          />
          {error ? <p className="error-text">{error}</p> : null}
          {status ? <p className="success-text">{status}</p> : null}
          <p>
            <strong>Plan:</strong> {billingPlanLabel(currentPlanCode)}
          </p>
          <p>
            <strong>Status:</strong>{" "}
            <span className={`director-admin-status-badge tone-${statusTone(tenant.billingStatus)}`.trim()}>
              {String(tenant.billingStatus || "trialing").replace(/_/g, " ")}
            </span>
          </p>
          <p>
            <strong>Lifecycle:</strong> {tenant.billingLifecycleStatus || "uninitialized"}
          </p>
          <p>
            <strong>Onboarding fee:</strong> {formatMoney(tenant.onboardingFeeAmount)}
          </p>
          <p>
            <strong>Onboarding status:</strong> {tenant.onboardingFeeStatus || (tenant.onboardingFeePaid ? "paid" : "unpaid")}
          </p>
          <p>
            <strong>Launch ready:</strong> {payload?.billing?.launchReady ? "Yes" : "No"}
          </p>
          <p>
            <strong>Members:</strong>{" "}
            {usage.memberLimit ? `${usage.members} / ${usage.memberLimit}` : `${usage.members} (unlimited)`}
          </p>
          {usage.memberLimit ? (
            <div className="director-admin-progress">
              <span style={{ width: `${Math.min(100, usage.memberUsagePercent || 0)}%` }} />
            </div>
          ) : null}
          <div className="inline-actions">
            {payload?.manageBillingUrl ? (
              <a className="link-button" href={payload.manageBillingUrl} target="_blank" rel="noreferrer">
                Manage Billing
              </a>
            ) : (
              <Button variant="secondary" disabled>
                Billing Portal Unavailable
              </Button>
            )}
          </div>
        </Card>

        <Card>
          <h2 className="pb-section-title">Plan & Checkout</h2>
          <p className="muted">
            Choose Legacy, Founders, or Institutional and continue in Stripe Checkout.
          </p>
          {Array.isArray(payload?.catalog?.plans) && payload.catalog.plans.length ? (
            <label>
              Select billing plan
              <Select
                value={selectedPlanCode}
                onChange={(event) => setSelectedPlanCode(event.target.value)}
              >
                {payload.catalog.plans.map((plan) => (
                  <option key={plan.code} value={plan.code}>
                    {plan.label} · {formatMoney(plan.annualAmount)}/yr
                    {plan.onboardingFeeAmount > 0
                      ? ` + ${formatMoney(plan.onboardingFeeAmount)} onboarding`
                      : " · no onboarding fee"}
                  </option>
                ))}
              </Select>
            </label>
          ) : null}
          {payload?.foundersAvailability ? (
            <p className="muted">
              Founders slots: {payload.foundersAvailability.reserved}/{payload.foundersAvailability.max} reserved
              {" · "}
              {payload.foundersAvailability.remaining} remaining
            </p>
          ) : null}
          <div className="inline-actions">
            <Button onClick={startCheckout} disabled={startingCheckout}>
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
        </Card>
      </div>

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
