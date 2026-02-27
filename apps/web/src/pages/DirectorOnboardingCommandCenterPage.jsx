import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Badge, Button, Card, PageShell, SectionTitle } from "@pondbridge/ui";
import { requestJson } from "../lib/http.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useTenant } from "../context/TenantContext.jsx";

const PHASES = [
  {
    id: "phase_1",
    label: "Phase 1: Brand + Message",
    steps: ["name_branding", "welcome_message"]
  },
  {
    id: "phase_2",
    label: "Phase 2: Access + Import",
    steps: ["signup_controls", "import_alumni"]
  },
  {
    id: "phase_3",
    label: "Phase 3: Modules + Launch",
    steps: ["modules", "review_launch"]
  }
];

function progressPercent(items = []) {
  if (!items.length) return 0;
  const completed = items.filter((item) => item.status === "completed").length;
  return Math.round((completed / items.length) * 100);
}

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

function billingReadinessHint({
  lifecycleStatus = "",
  onboardingFeeStatus = "",
  billingReady = false
} = {}) {
  if (billingReady) return "Billing is confirmed. Launch gate is clear.";

  const lifecycle = String(lifecycleStatus || "").trim().toLowerCase();
  const feeStatus = String(onboardingFeeStatus || "").trim().toLowerCase();

  if (lifecycle === "checkout_started") {
    return "Checkout completed, but Stripe confirmation is still syncing. This usually resolves in under a minute.";
  }
  if (lifecycle === "past_due" || lifecycle === "incomplete") {
    return "Billing is past due or incomplete. Open the billing portal to resolve payment before launch.";
  }
  if (lifecycle === "canceled" || lifecycle === "paused") {
    return "Subscription is not active. Restart checkout or update the subscription in billing portal.";
  }
  if (feeStatus === "unpaid") {
    return "Onboarding fee is still unpaid. Launch stays blocked until Stripe marks it paid.";
  }
  return "Billing is still pending. Refresh this page after Stripe processing finishes.";
}

function launchGuideDismissedKey(slug = "") {
  return `pondbridge_launch_guide_dismissed_${String(slug || "").trim().toLowerCase() || "default"}`;
}

export default function DirectorOnboardingCommandCenterPage() {
  const { slug } = useParams();
  const { token, user } = useAuth();
  const { tenant } = useTenant();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [payload, setPayload] = useState(null);
  const [billing, setBilling] = useState(null);
  const [updatingBilling, setUpdatingBilling] = useState(false);
  const [startingCheckout, setStartingCheckout] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [syncingBilling, setSyncingBilling] = useState(false);
  const [showLaunchGuide, setShowLaunchGuide] = useState(false);
  const [selectedPlanCode, setSelectedPlanCode] = useState("legacy");

  const isSuperAdmin = Boolean(user?.roles?.includes("super_admin"));
  const checkoutQueryState = String(searchParams.get("checkout") || "").trim().toLowerCase();
  const launchedQueryState = String(searchParams.get("launched") || "").trim().toLowerCase();

  const loadCommandCenter = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setLoading(true);
      setError("");
    }
    try {
      const [onboardingPayload, billingPayload] = await Promise.all([
        requestJson("/api/tenants/me/onboarding", { token }),
        requestJson("/api/tenants/me/billing", { token })
      ]);
      setPayload(onboardingPayload);
      setBilling(billingPayload);
      const livePlanCode = String(
        billingPayload?.tenant?.billingPlan || billingPayload?.billing?.billingPlan || "legacy"
      )
        .trim()
        .toLowerCase();
      if (livePlanCode) {
        setSelectedPlanCode(livePlanCode);
      }
      return { onboardingPayload, billingPayload };
    } catch (requestError) {
      if (!silent) {
        setError(requestError.message);
      }
      return null;
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, [token]);

  useEffect(() => {
    loadCommandCenter();
  }, [loadCommandCenter]);

  useEffect(() => {
    if (checkoutQueryState === "success") {
      setStatus("Stripe checkout completed. Billing activation may take a few seconds.");
      setError("");
    } else if (checkoutQueryState === "cancel") {
      setError("Stripe checkout was canceled. Restart checkout when you are ready.");
      setStatus("");
    }
  }, [checkoutQueryState]);

  useEffect(() => {
    if (launchedQueryState !== "1" || !slug) {
      setShowLaunchGuide(false);
      return;
    }
    if (typeof window === "undefined") return;

    try {
      const dismissed = window.localStorage.getItem(launchGuideDismissedKey(slug)) === "1";
      setShowLaunchGuide(!dismissed);
    } catch {
      setShowLaunchGuide(true);
    }
  }, [launchedQueryState, slug]);

  function dismissLaunchGuide() {
    if (typeof window === "undefined") {
      setShowLaunchGuide(false);
      return;
    }
    try {
      window.localStorage.setItem(launchGuideDismissedKey(slug), "1");
    } catch {
      // Ignore storage write failures and still dismiss in-memory.
    }
    setShowLaunchGuide(false);
  }

  async function markBillingReady() {
    setUpdatingBilling(true);
    setError("");
    setStatus("");

    try {
      await requestJson("/api/tenants/me/billing", {
        method: "PATCH",
        token,
        body: {
          billingStatus: "active",
          onboardingFeePaid: true,
          onboardingFeeInvoiceId: `manual-${Date.now()}`
        }
      });
      setStatus("Billing marked ready.");
      await loadCommandCenter();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setUpdatingBilling(false);
    }
  }

  async function startStripeCheckout() {
    setStartingCheckout(true);
    setError("");
    setStatus("");

    try {
      const successUrl = `${window.location.origin}/t/${slug}/onboarding?checkout=success`;
      const cancelUrl = `${window.location.origin}/t/${slug}/onboarding?checkout=cancel`;
      const response = await requestJson("/api/tenants/me/billing/checkout", {
        method: "POST",
        token,
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

  async function launchNetwork() {
    setLaunching(true);
    setError("");
    setStatus("");

    try {
      const response = await requestJson("/api/tenants/me/launch", {
        method: "POST",
        token,
        body: {
          mode: "onboarding_command_center"
        }
      });
      const loginUrl = String(response?.network?.loginUrl || "").trim();
      if (loginUrl.startsWith("http")) {
        window.location.assign(loginUrl);
        return;
      }
      await loadCommandCenter();
      setStatus("Network launched successfully.");
      navigate(`/t/${slug}/home`);
    } catch (requestError) {
      const blockers = Array.isArray(requestError?.payload?.error?.details?.blockers)
        ? requestError.payload.error.details.blockers
        : [];
      if (blockers.length > 0) {
        const blockerText = blockers.map((item) => item.label).filter(Boolean).join(", ");
        setError(`Launch blocked. Complete: ${blockerText}`);
      } else {
        setError(requestError.message || "Unable to launch network.");
      }
    } finally {
      setLaunching(false);
    }
  }

  const checklist = payload?.tenant?.onboardingChecklist || [];
  const completion = progressPercent(checklist);
  const completedCount = checklist.filter((item) => item.status === "completed").length;

  const phaseGroups = useMemo(() => {
    return PHASES.map((phase) => ({
      ...phase,
      items: checklist.filter((item) => phase.steps.includes(item.id))
    }));
  }, [checklist]);

  const isPremium =
    String(billing?.tenant?.billingPlan || "").trim().toLowerCase() === "institutional" ||
    payload?.tenant?.planTier === "premium";
  const inactive = payload?.tenant?.status === "inactive";
  const billingReady = Boolean(payload?.readiness?.checks?.find((check) => check.id === "billing")?.ok);
  const launchReady = Boolean(payload?.readiness?.isReady);
  const billingLifecycleStatus = String(
    billing?.tenant?.billingLifecycleStatus || payload?.billing?.lifecycleStatus || "uninitialized"
  )
    .trim()
    .toLowerCase();
  const onboardingFeeStatus = String(
    billing?.tenant?.onboardingFeeStatus || payload?.billing?.onboardingFeeStatus || "unpaid"
  )
    .trim()
    .toLowerCase();
  const billingHint = billingReadinessHint({
    lifecycleStatus: billingLifecycleStatus,
    onboardingFeeStatus,
    billingReady
  });
  const activePlanCode = String(
    billing?.tenant?.billingPlan || billing?.billing?.billingPlan || "legacy"
  )
    .trim()
    .toLowerCase();

  useEffect(() => {
    if (checkoutQueryState !== "success" || billingReady) {
      setSyncingBilling(false);
      return undefined;
    }

    let cancelled = false;
    let attempts = 0;
    let timeoutId = null;
    setSyncingBilling(true);

    async function poll() {
      attempts += 1;
      const refreshed = await loadCommandCenter({ silent: true });
      if (cancelled) return;

      const refreshedReady = Boolean(
        refreshed?.onboardingPayload?.readiness?.checks?.find((check) => check.id === "billing")?.ok
      );
      if (refreshedReady) {
        setStatus("Stripe confirmation received. Billing is ready.");
        setError("");
        setSyncingBilling(false);
        return;
      }

      if (attempts >= 8) {
        setStatus(
          "Checkout completed, but billing confirmation is still pending. Use Refresh or Billing Details in a minute."
        );
        setSyncingBilling(false);
        return;
      }

      timeoutId = window.setTimeout(poll, 4000);
    }

    timeoutId = window.setTimeout(poll, 3000);
    return () => {
      cancelled = true;
      setSyncingBilling(false);
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [billingReady, checkoutQueryState, loadCommandCenter]);

  if (loading) {
    return (
      <PageShell className="pb-cedar-page command-center-shell">
        <Card>Loading onboarding command center...</Card>
      </PageShell>
    );
  }

  return (
    <PageShell className="pb-cedar-page command-center-shell">
      {showLaunchGuide ? (
        <Card className="launch-guide-banner">
          <SectionTitle>Your network is live. Here&apos;s what to do next.</SectionTitle>
          <ol className="launch-guide-list">
            <li>
              Import your alumni list.
              <Link className="link-button secondary" to={`/t/${slug}/settings/imports`}>
                Go to Imports
              </Link>
            </li>
            <li>
              Invite key alumni to join and seed early activity.
              <Link className="link-button secondary" to={`/t/${slug}/admin`}>
                Open Admin
              </Link>
            </li>
            <li>
              Finalize your welcome message and content.
              <Link className="link-button secondary" to={`/t/${slug}/settings/content`}>
                Edit Content
              </Link>
            </li>
          </ol>
          <div className="inline-actions">
            <Button variant="secondary" onClick={dismissLaunchGuide}>
              Got it
            </Button>
          </div>
        </Card>
      ) : null}
      <Card>
        <h1>Welcome, {payload?.tenant?.name || tenant?.name || "Your Camp"} Director</h1>
        <p className="muted">
          Keep setup moving with this checklist, then launch when all items are ready.
        </p>
        <div className="progress-wrap">
          <div className="progress-head">
            <strong>{completedCount} of {checklist.length} complete</strong>
            <span>{completion}%</span>
          </div>
          <div className="progress-track">
            <span className="progress-fill" style={{ width: `${completion}%` }} />
          </div>
        </div>
        <div className="inline-actions">
          <Button onClick={() => navigate(`/t/${slug}/admin`)}>Open Director Dashboard</Button>
          {payload?.tenant?.onboardingStatus !== "live" ? (
            <Button onClick={launchNetwork} disabled={!launchReady || launching}>
              {launching ? "Launching..." : "Launch Network"}
            </Button>
          ) : null}
          <Button variant="secondary" onClick={loadCommandCenter}>
            Refresh
          </Button>
          {payload?.tenant?.onboardingStatus === "live" ? (
            <Badge tone="success">Network is Live</Badge>
          ) : (
            <Badge tone="neutral">Setup in Progress</Badge>
          )}
          {billingReady ? <Badge tone="success">Billing Ready</Badge> : <Badge tone="danger">Billing Pending</Badge>}
          {syncingBilling ? <Badge tone="neutral">Syncing Stripe...</Badge> : null}
        </div>
        {inactive ? (
          <p className="error-text">
            Your camp is currently inactive. Please contact support before launching.
          </p>
        ) : null}
        {!billingReady ? <p className="muted billing-sync-note">{billingHint}</p> : null}
        {error ? <p className="error-text">{error}</p> : null}
        {status ? <p className="success-text">{status}</p> : null}
      </Card>

      {payload?.tenant?.onboardingStatus === "live" && !showLaunchGuide ? (
        <Card>
          <SectionTitle>First 3 Things To Do</SectionTitle>
          <p className="muted">
            Your network is live. Complete these steps to get alumni connected.
          </p>
          <div className="post-launch-steps">
            <article className="post-launch-step">
              <div className="post-launch-step-number">1</div>
              <div className="post-launch-step-content">
                <h4>Import your alumni</h4>
                <p>Upload a CSV of alumni to populate your network directory.</p>
              </div>
              <Link className="link-button secondary" to={`/t/${slug}/settings/imports`}>
                Go to Imports
              </Link>
            </article>
            <article className="post-launch-step">
              <div className="post-launch-step-number">2</div>
              <div className="post-launch-step-content">
                <h4>Send first invitations</h4>
                <p>Invite alumni by email so they can create accounts and join.</p>
              </div>
              <Link className="link-button secondary" to={`/t/${slug}/admin`}>
                Manage Invites
              </Link>
            </article>
            <article className="post-launch-step">
              <div className="post-launch-step-number">3</div>
              <div className="post-launch-step-content">
                <h4>Fine-tune your settings</h4>
                <p>Adjust branding, signup controls, and content for your network.</p>
              </div>
              <Link className="link-button secondary" to={`/t/${slug}/admin`}>
                Open Settings
              </Link>
            </article>
          </div>
        </Card>
      ) : null}

      <div className="command-center-grid">
        <Card>
          <SectionTitle>Checklist by Phase</SectionTitle>
          <div className="phase-stack">
            {phaseGroups.map((phase) => (
              <article key={phase.id} className="phase-card">
                <h3>{phase.label}</h3>
                {phase.items.length === 0 ? (
                  <p className="muted">No tasks in this phase yet.</p>
                ) : (
                  <ul className="checklist-list">
                    {phase.items.map((item) => (
                      <li key={item.id} className={item.status === "completed" ? "done" : ""}>
                        {item.status === "completed" ? "✓" : "○"} {item.label}
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            ))}
          </div>
        </Card>

        <Card>
          <SectionTitle>Billing Step</SectionTitle>
          <p>
            <strong>Plan:</strong> {billingPlanLabel(activePlanCode)}
          </p>
          <p>
            <strong>Status:</strong> {billing?.tenant?.billingStatus || "unknown"}
          </p>
          <p>
            <strong>Lifecycle:</strong> {billing?.tenant?.billingLifecycleStatus || "uninitialized"}
          </p>
          <p>
            <strong>Onboarding fee:</strong> {formatMoney(billing?.tenant?.onboardingFeeAmount || 0)}
          </p>
          <p>
            <strong>Onboarding fee status:</strong> {billing?.tenant?.onboardingFeeStatus || "unpaid"}
          </p>
          <p>
            <strong>Readiness:</strong> {billingReady ? "Ready" : "Blocked until billing is ready"}
          </p>
          <p className="muted billing-readiness-hint">{billingHint}</p>
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
          {billing?.foundersAvailability ? (
            <p className="muted">
              Founders slots: {billing.foundersAvailability.reserved}/{billing.foundersAvailability.max} reserved
              {" · "}
              {billing.foundersAvailability.remaining} remaining
            </p>
          ) : null}
          <div className="inline-actions">
            <Button onClick={startStripeCheckout} disabled={startingCheckout}>
              {startingCheckout
                ? "Redirecting..."
                : selectedPlanCode === activePlanCode
                ? "Start Stripe Checkout"
                : "Switch Plan & Checkout"}
            </Button>
            {billing?.manageSubscriptionUrl ? (
              <a className="link-button" href={billing.manageSubscriptionUrl} target="_blank" rel="noreferrer">
                Open Billing Portal
              </a>
            ) : (
              <Button variant="secondary" disabled>
                Billing Portal Unavailable
              </Button>
            )}
            <Link className="link-button secondary" to={`/t/${slug}/admin/billing`}>
              Billing Details
            </Link>
            {billing?.mode === "mock" || isSuperAdmin ? (
              <Button variant="secondary" onClick={markBillingReady} disabled={updatingBilling}>
                {updatingBilling ? "Updating..." : "Mark Billing Ready"}
              </Button>
            ) : null}
          </div>
        </Card>
      </div>

      <Card>
        <SectionTitle>Live Preview Tile</SectionTitle>
        <div
          className="wizard-preview"
          style={{
            "--brand-primary": payload?.tenant?.onboardingDraft?.theme?.brandPrimary || "#002b5c",
            "--brand-secondary": payload?.tenant?.onboardingDraft?.theme?.brandSecondary || "#d3dde8",
            "--bg": payload?.tenant?.onboardingDraft?.theme?.bg || "#f5f7fa",
            "--text": payload?.tenant?.onboardingDraft?.theme?.text || "#0f172a",
            "--card": payload?.tenant?.onboardingDraft?.theme?.card || "#ffffff",
            "--font-display": "\"Roboto Slab\", \"Avenir Next\", serif",
            "--font-body": "\"Inter\", \"Avenir Next\", \"Segoe UI\", sans-serif"
          }}
        >
          <div className="wizard-preview-nav">
            {payload?.tenant?.onboardingDraft?.theme?.logoUrl ? (
              <img src={payload.tenant.onboardingDraft.theme.logoUrl} alt="Camp logo preview" />
            ) : null}
            <strong>{payload?.tenant?.onboardingDraft?.content?.networkDisplayName || `${payload?.tenant?.name || "Your Camp"} Alumni Network`}</strong>
          </div>
          <div className="wizard-preview-content">
            <article className="wizard-preview-card">
              <h3>{payload?.tenant?.onboardingDraft?.content?.welcomeHeadline || "Welcome to your network"}</h3>
              <p>{payload?.tenant?.onboardingDraft?.content?.welcomeBody || "Your welcome message appears here."}</p>
            </article>
          </div>
        </div>
      </Card>

      {payload?.tenant?.onboardingStatus === "live" ? (
        <Card>
          <SectionTitle>Post-Launch Settings</SectionTitle>
          <div className="inline-actions">
            <Link className="link-button secondary" to={`/t/${slug}/settings/branding`}>
              Branding
            </Link>
            <Link className="link-button secondary" to={`/t/${slug}/settings/signup`}>
              Signup
            </Link>
            <Link className="link-button secondary" to={`/t/${slug}/settings/content`}>
              Content
            </Link>
            <Link className="link-button secondary" to={`/t/${slug}/settings/admins`}>
              Admins
            </Link>
            <Link className="link-button secondary" to={`/t/${slug}/settings/imports`}>
              Imports
            </Link>
          </div>
        </Card>
      ) : null}

      <Card>
        <SectionTitle>Need Help?</SectionTitle>
        <p className="muted">
          You can finish setup quickly. If needed, our onboarding team can help with branding and imports.
        </p>
        <div className="inline-actions">
          {payload?.tenant?.content?.contactEmail ? (
            <a className="link-button secondary" href={`mailto:${payload.tenant.content.contactEmail}`}>
              Email Support
            </a>
          ) : (
            <a className="link-button secondary" href="mailto:support@pondbridge.co">
              Email PondBridge
            </a>
          )}
          {isPremium ? (
            <a className="link-button" href="mailto:support@pondbridge.co?subject=Onboarding%20Call">
              Schedule Onboarding Call
            </a>
          ) : (
            <Button variant="secondary" disabled>
              Onboarding Call (Premium)
            </Button>
          )}
        </div>
      </Card>
    </PageShell>
  );
}
