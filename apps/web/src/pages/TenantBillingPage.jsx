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

export default function TenantBillingPage() {
  const { slug } = useParams();
  const { token } = useAuth();

  const [billing, setBilling] = useState(null);
  const [error, setError] = useState("");

  async function loadBilling() {
    setError("");
    try {
      const payload = await requestJson(`/api/tenants/me/billing`, { token });
      setBilling(payload);
    } catch (loadError) {
      setError(loadError.message);
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

  return (
    <PageShell className="pb-cedar-page">
      <Card>
        <h1>Camp Billing</h1>
        <p>
          <strong>Camp:</strong> {tenant.name}
        </p>
        <p>
          <strong>Plan:</strong> {tenant.planTier}
        </p>
        <p>
          <strong>Billing status:</strong> {tenant.billingStatus}
        </p>
        <p>
          <strong>Mode:</strong> {billing.mode === "stripe" ? "Stripe" : "Mock billing"}
        </p>
        {billing.notes ? <p className="muted">{billing.notes}</p> : null}

        <div className="inline-actions">
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
          <strong>Paid:</strong> {tenant.onboardingFeePaid ? "Yes" : "No"}
        </p>
        <p>
          <strong>Invoice ID:</strong> {tenant.onboardingFeeInvoiceId || "Not available"}
        </p>
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
