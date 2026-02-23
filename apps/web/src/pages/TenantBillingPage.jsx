import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button, Card, PageShell, SectionTitle } from "@pondbridge/ui";
import { requestJson } from "../lib/http.js";
import { useAuth } from "../context/AuthContext.jsx";

function formatMoney(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

function billingPlanLabel(code = "") {
  const normalized = String(code || "").trim().toLowerCase();
  if (normalized === "founders") return "Founders";
  if (normalized === "institutional") return "Institutional";
  return "Legacy";
}

export default function TenantBillingPage() {
  const { slug } = useParams();
  const { token } = useAuth();

  const [billing, setBilling] = useState(null);
  const [error, setError] = useState("");
  const [selectedPlanCode, setSelectedPlanCode] = useState("legacy");
  const [startingCheckout, setStartingCheckout] = useState(false);

  async function loadBilling() {
    setError("");
    try {
      const payload = await requestJson(`/api/tenants/me/billing`, { token });
      setBilling(payload);
      const livePlanCode = String(payload?.tenant?.billingPlan || payload?.billing?.billingPlan || "legacy")
        .trim()
        .toLowerCase();
      if (livePlanCode) {
        setSelectedPlanCode(livePlanCode);
      }
    } catch (loadError) {
      setError(loadError.message);
    }
  }

  async function startCheckout() {
    setError("");
    setStartingCheckout(true);

    try {
      const successUrl = `${window.location.origin}/t/${slug}/admin/billing?checkout=success`;
      const cancelUrl = `${window.location.origin}/t/${slug}/admin/billing?checkout=cancel`;
      const payload = await requestJson("/api/tenants/me/billing/checkout", {
        method: "POST",
        token,
        body: {
          planCode: selectedPlanCode,
          successUrl,
          cancelUrl
        }
      });
      const checkoutUrl = String(payload?.checkoutUrl || "").trim();
      if (!checkoutUrl) {
        throw new Error("Stripe checkout URL was not returned.");
      }
      window.location.assign(checkoutUrl);
    } catch (checkoutError) {
      setError(checkoutError.message || "Unable to start Stripe checkout.");
      setStartingCheckout(false);
    }
  }

  useEffect(() => {
    loadBilling();
  }, [token]);

  if (!billing) {
    return (
      <PageShell className="pb-cedar-page">
        <Card>{error ? <span className="error-text">{error}</span> : "Loading billing..."}</Card>
      </PageShell>
    );
  }

  const tenant = billing.tenant;
  const planCode = String(tenant.billingPlan || billing?.billing?.billingPlan || "legacy").trim().toLowerCase();

  return (
    <PageShell className="pb-cedar-page">
      <Card>
        <h1>Camp Billing</h1>
        <p>
          <strong>Camp:</strong> {tenant.name}
        </p>
        <p>
          <strong>Plan:</strong> {billingPlanLabel(planCode)}
        </p>
        <p>
          <strong>Billing status:</strong> {tenant.billingStatus}
        </p>
        <p>
          <strong>Lifecycle:</strong> {tenant.billingLifecycleStatus || "uninitialized"}
        </p>
        <p>
          <strong>Mode:</strong> {billing.mode === "stripe" ? "Stripe" : "Mock billing"}
        </p>
        <p>
          <strong>Launch ready:</strong> {billing?.billing?.launchReady ? "Yes" : "No"}
        </p>
        {billing.notes ? <p className="muted">{billing.notes}</p> : null}

        {Array.isArray(billing?.catalog?.plans) && billing.catalog.plans.length ? (
          <label className="director-command-center-plan-select">
            Plan selection
            <select
              value={selectedPlanCode}
              onChange={(event) => setSelectedPlanCode(event.target.value)}
            >
              {billing.catalog.plans.map((plan) => (
                <option key={plan.code} value={plan.code}>
                  {plan.label} · {formatMoney(plan.annualAmount)}/yr
                  {plan.onboardingFeeAmount > 0
                    ? ` + ${formatMoney(plan.onboardingFeeAmount)} onboarding`
                    : " · no onboarding fee"}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <div className="inline-actions">
          <Button onClick={startCheckout} disabled={startingCheckout}>
            {startingCheckout
              ? "Redirecting..."
              : selectedPlanCode === planCode
              ? "Start Stripe Checkout"
              : "Switch Plan & Checkout"}
          </Button>
          {billing.manageSubscriptionUrl ? (
            <a href={billing.manageSubscriptionUrl} target="_blank" rel="noreferrer" className="link-button">
              Manage subscription
            </a>
          ) : (
            <Button variant="secondary" disabled>
              Manage subscription unavailable
            </Button>
          )}
          <Button variant="secondary" onClick={loadBilling}>
            Refresh billing
          </Button>
          <Link className="link-button secondary" to={`/t/${slug}/admin`}>
            Back to admin
          </Link>
        </div>
      </Card>

      <Card>
        <SectionTitle>Onboarding Fee</SectionTitle>
        <p>
          <strong>Amount:</strong> {formatMoney(tenant.onboardingFeeAmount)}
        </p>
        <p>
          <strong>Status:</strong> {tenant.onboardingFeeStatus || (tenant.onboardingFeePaid ? "paid" : "unpaid")}
        </p>
        <p>
          <strong>Invoice ID:</strong> {tenant.onboardingFeeInvoiceId || "Not available"}
        </p>
        {billing?.foundersAvailability ? (
          <p>
            <strong>Founders slots:</strong> {billing.foundersAvailability.reserved}/{billing.foundersAvailability.max} reserved
          </p>
        ) : null}
      </Card>

      <Card>
        <SectionTitle>Stripe References</SectionTitle>
        <p>
          <strong>Customer ID:</strong> {tenant.stripeCustomerId || "Not set"}
        </p>
        <p>
          <strong>Subscription ID:</strong> {tenant.stripeSubscriptionId || "Not set"}
        </p>
        <p>
          <strong>Price ID:</strong> {tenant.stripePriceId || "Not set"}
        </p>
      </Card>
    </PageShell>
  );
}
