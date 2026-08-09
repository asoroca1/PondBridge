import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button, Card } from "@pondbridge/ui";
import { ModalConfirm, WorkspaceHeader } from "../../components/admin/AdminUi.jsx";
import { useTenant } from "../../context/TenantContext.jsx";
import useAdminApi from "./useAdminApi.js";
import "./director-admin-billing.css";

function formatDate(value) {
  if (!value) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? ""
    : parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatMoney(value = 0) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

// A demo network cannot call the billing API, so it previews the same UI from
// sample data rather than a second hand-written copy of the page.
const DEMO_PAYLOAD = {
  tenant: { billingPlan: "founders", billingStatus: "active", isComplimentary: false },
  billing: { annualAmount: 2500, currentPeriodEnd: "2027-01-01", activatedAt: "2026-03-15" },
  usage: { members: 142, memberLimit: null },
  catalog: { plans: [] }
};

export default function DirectorAdminBillingPage() {
  const { slug, request } = useAdminApi();
  const { tenant: tenantConfig } = useTenant();
  const [searchParams] = useSearchParams();
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);

  const isDemo = Boolean(tenantConfig?.accessSettings?.demoAccessEnabled);
  const checkoutState = String(searchParams.get("checkout") || "").trim().toLowerCase();

  const load = useCallback(async () => {
    if (isDemo) {
      setPayload(DEMO_PAYLOAD);
      setLoading(false);
      return;
    }
    setError("");
    try {
      setPayload(await request("/billing"));
    } catch (requestError) {
      setError(requestError.message || "Could not load billing.");
    } finally {
      setLoading(false);
    }
  }, [isDemo, request]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (checkoutState === "success") setStatus("Payment complete. Activation can take a few seconds.");
    if (checkoutState === "cancel") setError("Checkout was canceled. Nothing was charged.");
  }, [checkoutState]);

  async function act(kind, path, body, message) {
    setBusy(kind);
    setError("");
    setStatus("");
    try {
      const response = await request(path, { method: "POST", body });
      const url = String(response?.checkoutUrl || "").trim();
      if (url) {
        window.location.assign(url);
        return;
      }
      setStatus(response?.message || response?.notes || message);
      setCancelOpen(false);
      await load();
    } catch (requestError) {
      setError(requestError.message || "That could not be completed.");
    } finally {
      setBusy("");
    }
  }

  if (loading && !payload) return <Card><p className="muted">Loading billing…</p></Card>;

  const tenant = payload?.tenant || {};
  const billing = payload?.billing || {};
  const usage = payload?.usage || {};
  const plans = Array.isArray(payload?.catalog?.plans) ? payload.catalog.plans : [];

  const planCode = String(tenant.billingPlan || billing.billingPlan || "").trim().toLowerCase();
  const currentPlan = plans.find((plan) => String(plan?.code || "").toLowerCase() === planCode) || null;
  const isComplimentary = Boolean(tenant.isComplimentary || billing.isComplimentary);
  const hasPlan = Boolean(planCode);
  const cancelAtPeriodEnd = Boolean(payload?.subscription?.cancelAtPeriodEnd);
  const lifecycle = String(tenant.billingLifecycleStatus || "").toLowerCase();
  const isActive = ["active", "trialing", "past_due"].includes(lifecycle);
  const pastDue = String(tenant.billingStatus || "").toLowerCase() === "past_due";

  const renewsAt = tenant.currentPeriodEnd || billing.currentPeriodEnd || null;
  const activatedAt = tenant.activatedAt || billing.activatedAt || null;
  const annual = currentPlan?.annualAmount ?? billing.annualAmount;
  const memberCount = Number(usage.members || 0).toLocaleString();
  const memberLabel = usage.memberLimit ? `${memberCount} of ${usage.memberLimit}` : memberCount;

  // What a director owes, in one sentence, for the state they are actually in.
  const headline = !hasPlan
    ? "No plan yet"
    : isComplimentary
      ? "Nothing — complimentary"
      : `${formatMoney(annual)}/year`;
  const nextLine = !hasPlan
    ? "Choose a plan to get started"
    : isComplimentary
      ? "No payment needed"
      : cancelAtPeriodEnd
        ? `Access ends ${formatDate(renewsAt)}`
        : renewsAt
          ? `Renews ${formatDate(renewsAt)}`
          : "No renewal date yet";

  const canCheckout = !isComplimentary && plans.length > 0 && (!hasPlan || !isActive);
  const canCancel = isActive && hasPlan && !isComplimentary && !cancelAtPeriodEnd;
  const portalUrl = !isComplimentary && hasPlan ? String(payload?.manageBillingUrl || "").trim() : "";

  return (
    <div className="pb-workspace">
      <WorkspaceHeader
        eyebrow="Plan & billing"
        title="Billing"
        subtitle={
          isComplimentary
            ? "This network runs on a complimentary plan. There is nothing to pay."
            : hasPlan
              ? "Your plan, what it costs, and when it renews."
              : "Choose a plan to activate this network."
        }
        actions={
          <Button variant="secondary" size="sm" onClick={load} loading={busy === "refresh"}>
            Refresh
          </Button>
        }
      />

      {isDemo ? (
        <Card className="pb-billing-note">
          <p>This is a demo network. Billing is shown with sample figures and nothing can be charged.</p>
        </Card>
      ) : null}

      {pastDue ? (
        <Card className="pb-billing-note is-warning">
          <p>
            <strong>A payment did not go through.</strong> Update your card in the billing portal to keep
            this network running.
          </p>
        </Card>
      ) : null}

      {cancelAtPeriodEnd ? (
        <Card className="pb-billing-note is-warning">
          <p>
            <strong>Your plan is set to end{renewsAt ? ` on ${formatDate(renewsAt)}` : ""}.</strong>{" "}
            Members keep access until then.
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => act("resume", "/billing/resume", undefined, "Plan resumed.")}
            loading={busy === "resume"}
          >
            Resume plan
          </Button>
        </Card>
      ) : null}

      {error ? <p className="error-text" role="alert">{error}</p> : null}
      {status ? <p className="success-text" role="status">{status}</p> : null}

      <Card>
        <div className="pb-billing-summary">
          <div>
            <span>You pay</span>
            <strong>{headline}</strong>
            <small>{currentPlan?.label || (hasPlan ? planCode : "No plan selected")}</small>
          </div>
          <div>
            <span>Next</span>
            <strong>{nextLine}</strong>
            <small>{activatedAt ? `Active since ${formatDate(activatedAt)}` : "Not activated yet"}</small>
          </div>
          <div>
            <span>Members</span>
            <strong>{memberLabel}</strong>
            <small>{usage.memberLimit ? "of your plan limit" : "no limit on this plan"}</small>
          </div>
        </div>

        {portalUrl || canCancel ? (
          <div className="pb-billing-actions">
            {portalUrl ? (
              <a className="link-button secondary" href={portalUrl} target="_blank" rel="noreferrer">
                Manage payment method
              </a>
            ) : null}
            {canCancel ? (
              <Button variant="ghost" onClick={() => setCancelOpen(true)}>Cancel plan</Button>
            ) : null}
          </div>
        ) : null}
      </Card>

      {canCheckout ? (
        <Card>
          <h2 className="pb-section-title">{hasPlan ? "Change plan" : "Choose a plan"}</h2>
          <div className="pb-billing-plans">
            {plans.map((plan) => {
              const code = String(plan?.code || "").toLowerCase();
              const current = code === planCode;
              return (
                <div key={code} className={`pb-billing-plan${current ? " is-current" : ""}`}>
                  <div>
                    <strong>{plan.label || code}</strong>
                    <span>{formatMoney(plan.annualAmount)}/year</span>
                    {plan.onboardingFeeAmount ? (
                      <small>Plus a one-time {formatMoney(plan.onboardingFeeAmount)} setup fee</small>
                    ) : null}
                  </div>
                  {current ? (
                    <span className="pb-billing-current">Current</span>
                  ) : (
                    <Button
                      size="sm"
                      loading={busy === `checkout:${code}`}
                      onClick={() => act(
                        `checkout:${code}`,
                        "/billing/checkout",
                        {
                          planCode: code,
                          successUrl: `${window.location.origin}/t/${slug}/admin/billing?checkout=success`,
                          cancelUrl: `${window.location.origin}/t/${slug}/admin/billing?checkout=cancel`
                        },
                        "Plan updated."
                      )}
                      disabled={isDemo}
                    >
                      {hasPlan ? "Switch" : "Choose"}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      ) : null}

      <ModalConfirm
        open={cancelOpen}
        title="Cancel this plan?"
        description={
          renewsAt
            ? `Members keep access until ${formatDate(renewsAt)}, then the network stops. You can resume before then.`
            : "Members keep access until the end of the current period. You can resume before then."
        }
        confirmLabel="Cancel plan"
        cancelLabel="Keep plan"
        tone="danger"
        busy={busy === "cancel"}
        onConfirm={() => act("cancel", "/billing/cancel", { cancelAtPeriodEnd: true }, "Plan will end at the period close.")}
        onCancel={() => setCancelOpen(false)}
      />
    </div>
  );
}
