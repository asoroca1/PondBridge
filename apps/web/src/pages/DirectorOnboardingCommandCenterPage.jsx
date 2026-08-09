import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Badge, Button, Card, PageShell, SectionTitle } from "@pondbridge/ui";
import { requestJson } from "../lib/http.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useTenant } from "../context/TenantContext.jsx";
import { resolveAlumniWord, resolveNetworkDisplayName } from "../lib/campLabels.js";

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

const READINESS_PHASES = [
  {
    id: "readiness_identity",
    label: "Identity + Message",
    steps: ["headline"]
  },
  {
    id: "readiness_access",
    label: "Access + Agreements",
    steps: ["signup", "legal"]
  },
  {
    id: "readiness_operations",
    label: "Modules + Billing",
    steps: ["modules", "module_setup", "billing"]
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
  if (normalized === "test") return "Internal Test";
  if (normalized === "founders") return "Founders";
  if (normalized === "institutional") return "Institutional";
  return "Legacy";
}

function billingPlanIsPremium(code = "") {
  const normalized = String(code || "").trim().toLowerCase();
  return normalized === "founders" || normalized === "institutional" || normalized === "test";
}

function resolveLaunchRedirectTarget(payload = {}, slug = "") {
  const homeUrl = String(payload?.network?.homeUrl || "").trim();
  if (homeUrl) return homeUrl;

  const appUrl = String(payload?.network?.appUrl || "").trim();
  if (appUrl) return appUrl;

  const loginUrl = String(payload?.network?.loginUrl || "").trim();
  if (loginUrl) return loginUrl;

  const safeSlug = String(slug || "").trim().toLowerCase();
  return safeSlug ? `/t/${safeSlug}/home` : "/home";
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

function normalizeHexColor(value = "", fallback = "#002b5c") {
  const raw = String(value || "").trim();
  const hex = raw.startsWith("#") ? raw.slice(1) : raw;
  if (/^[0-9a-fA-F]{6}$/.test(hex)) return `#${hex.toLowerCase()}`;
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    const expanded = hex
      .split("")
      .map((part) => `${part}${part}`)
      .join("");
    return `#${expanded.toLowerCase()}`;
  }
  return fallback;
}

function hexToRgb(hex = "#002b5c") {
  const normalized = normalizeHexColor(hex).slice(1);
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16)
  };
}

function srgbChannelToLinear(channel = 0) {
  const normalized = Math.max(0, Math.min(255, Number(channel) || 0)) / 255;
  if (normalized <= 0.04045) return normalized / 12.92;
  return ((normalized + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex = "#002b5c") {
  const { r, g, b } = hexToRgb(hex);
  return (
    0.2126 * srgbChannelToLinear(r) +
    0.7152 * srgbChannelToLinear(g) +
    0.0722 * srgbChannelToLinear(b)
  );
}

function contrastRatio(baseHex = "#002b5c", candidateHex = "#ffffff") {
  const base = relativeLuminance(baseHex);
  const candidate = relativeLuminance(candidateHex);
  const brightest = Math.max(base, candidate);
  const darkest = Math.min(base, candidate);
  return (brightest + 0.05) / (darkest + 0.05);
}

function readableTextColorOnBrand(brandHex = "#002b5c") {
  const light = "#ffffff";
  const dark = "#0f172a";
  return contrastRatio(brandHex, light) >= contrastRatio(brandHex, dark) ? light : dark;
}

export default function DirectorOnboardingCommandCenterPage() {
  const { token } = useAuth();
  const { tenant, slug } = useTenant();
  const alumniWord = resolveAlumniWord(tenant);
  const alumniWordTitle = resolveAlumniWord(tenant, { capitalized: true });
  const networkDisplayName = resolveNetworkDisplayName(tenant);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [payload, setPayload] = useState(null);
  const [billing, setBilling] = useState(null);
  const [featureInventory, setFeatureInventory] = useState(null);
  const [startingCheckout, setStartingCheckout] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [syncingBilling, setSyncingBilling] = useState(false);
  const [showLaunchGuide, setShowLaunchGuide] = useState(false);
  const [selectedPlanCode, setSelectedPlanCode] = useState("legacy");
  const previewTheme = payload?.tenant?.onboardingDraft?.theme || {};
  const previewContent = payload?.tenant?.onboardingDraft?.content || {};
  const previewBrandPrimary = normalizeHexColor(
    previewTheme.brandPrimary || payload?.tenant?.theme?.brandPrimary || tenant?.theme?.brandPrimary || "#002b5c"
  );
  const previewBrandOnPrimary = readableTextColorOnBrand(previewBrandPrimary);
  const previewLogoUrl = String(
    previewTheme.logoUrl || payload?.tenant?.theme?.logoUrl || tenant?.theme?.logoUrl || ""
  ).trim();
  const previewNetworkName = String(
    previewContent.networkDisplayName ||
      payload?.tenant?.content?.networkDisplayName ||
      networkDisplayName ||
      `${payload?.tenant?.name || tenant?.name || "Your Camp"} ${alumniWordTitle} Network`
  ).trim();
  const previewLogoInitials =
    previewNetworkName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0))
      .join("")
      .toUpperCase() || "CN";

  const checkoutQueryState = String(searchParams.get("checkout") || "").trim().toLowerCase();
  const launchedQueryState = String(searchParams.get("launched") || "").trim().toLowerCase();

  const loadCommandCenter = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setLoading(true);
      setError("");
    }
    try {
      const [onboardingPayload, billingPayload, featurePayload] = await Promise.all([
        requestJson("/api/tenants/me/onboarding", { token }),
        requestJson("/api/tenants/me/billing", { token }),
        requestJson(`/api/t/${slug}/admin/features`, { token }).catch(() => null)
      ]);
      setPayload(onboardingPayload);
      setBilling(billingPayload);
      setFeatureInventory(featurePayload);
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
  }, [slug, token]);

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
      const action = String(response?.action || "").trim().toLowerCase();
      const checkoutUrl = String(response?.checkoutUrl || "").trim();
      if (checkoutUrl) {
        window.location.assign(checkoutUrl);
        return;
      }
      if (action === "subscription_updated") {
        setStatus(response?.notes || "Subscription updated. Refreshing billing state.");
        await loadCommandCenter();
        setStartingCheckout(false);
        return;
      }
      if (action === "complimentary_plan") {
        setStatus(response?.notes || "This network is on a complimentary plan. No Stripe checkout is required.");
        await loadCommandCenter();
        setStartingCheckout(false);
        return;
      }
      throw new Error(
        response?.notes ||
          "Unable to start Stripe checkout. Open the billing portal to manage your subscription."
      );
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
      const redirectTarget = resolveLaunchRedirectTarget(response, slug);
      if (redirectTarget.startsWith("http")) {
        window.location.assign(redirectTarget);
        return;
      }
      await loadCommandCenter();
      setStatus("Network launched successfully.");
      navigate(redirectTarget);
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

  const legacyChecklist = payload?.tenant?.onboardingChecklist || [];
  const readinessChecklist = (payload?.readiness?.checks || []).map((item) => ({
    ...item,
    status: item.ok ? "completed" : "not_started"
  }));
  const checklist = readinessChecklist.length ? readinessChecklist : legacyChecklist;
  const completion = progressPercent(checklist);
  const completedCount = checklist.filter((item) => item.status === "completed").length;
  const usesServerReadiness = readinessChecklist.length > 0;
  const isLive = payload?.tenant?.onboardingStatus === "live";

  const phaseGroups = useMemo(() => {
    const phases = usesServerReadiness ? READINESS_PHASES : PHASES;
    return phases.map((phase) => ({
      ...phase,
      items: checklist.filter((item) => phase.steps.includes(item.id))
    }));
  }, [checklist, usesServerReadiness]);

  const isPremium =
    billingPlanIsPremium(billing?.tenant?.billingPlan || "") || payload?.tenant?.planTier === "premium";
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
  const lastInvoiceStatus = String(billing?.billing?.lastInvoiceStatus || "").trim().toLowerCase();
  const lastInvoiceErrorCode = String(billing?.billing?.lastInvoiceErrorCode || "").trim();
  const lastInvoiceErrorMessage = String(billing?.billing?.lastInvoiceErrorMessage || "").trim();
  const showInvoiceFinalizationWarning = lastInvoiceStatus === "finalization_failed";

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
              {`Review your ${alumniWord} invitation list before sending.`}
              <Link className="link-button secondary" to={`/t/${slug}/admin/people/add`}>
                Review Invitations
              </Link>
            </li>
            <li>
              {`Invite key ${alumniWord} to join and seed early activity.`}
              <Link className="link-button secondary" to={`/t/${slug}/admin`}>
                Open Admin
              </Link>
            </li>
            <li>
              Finalize your welcome message and content.
              <Link className="link-button secondary" to={`/t/${slug}/admin/settings/network`}>
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
          {isLive
            ? "Review the server-confirmed launch evidence, then use the post-launch tools to grow your community."
            : "Keep setup moving with these server-confirmed checks, then launch when every required item is ready."}
        </p>
        <div className="progress-wrap">
          <div className="progress-head">
            <strong>
              {completedCount} of {checklist.length} {usesServerReadiness ? "launch checks ready" : "complete"}
            </strong>
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
            {`Your network is live. Complete these steps to get ${alumniWord} connected.`}
          </p>
          <div className="post-launch-steps">
            <article className="post-launch-step">
              <div className="post-launch-step-number">1</div>
              <div className="post-launch-step-content">
                <h4>{`Prepare your ${alumniWord} invitations`}</h4>
                <p>Upload a CSV or add recipients, review every row, then explicitly send invitations.</p>
              </div>
              <Link className="link-button secondary" to={`/t/${slug}/admin/people/add`}>
                Review Invitations
              </Link>
            </article>
            <article className="post-launch-step">
              <div className="post-launch-step-number">2</div>
              <div className="post-launch-step-content">
                <h4>Send first invitations</h4>
                <p>{`Invite ${alumniWord} by email so they can create accounts and join.`}</p>
              </div>
              <Link className="link-button secondary" to={`/t/${slug}/admin/people/add`}>
                Manage Invites
              </Link>
            </article>
            <article className="post-launch-step">
              <div className="post-launch-step-number">3</div>
              <div className="post-launch-step-content">
                <h4>Fine-tune your settings</h4>
                <p>Adjust branding, signup controls, and content for your network.</p>
              </div>
              <Link className="link-button secondary" to={`/t/${slug}/admin/settings/network`}>
                Open Settings
              </Link>
            </article>
          </div>
        </Card>
      ) : null}

      <div className="command-center-grid">
        <Card>
          <SectionTitle>{usesServerReadiness ? "Launch Readiness Evidence" : "Checklist by Phase"}</SectionTitle>
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
          {showInvoiceFinalizationWarning ? (
            <p className="error-text">
              Stripe could not finalize the latest invoice.
              {lastInvoiceErrorCode ? ` Code: ${lastInvoiceErrorCode}.` : ""}
              {lastInvoiceErrorMessage ? ` ${lastInvoiceErrorMessage}` : ""}
            </p>
          ) : null}
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
                    {plan.code === "institutional"
                      ? ` + ${formatMoney(plan.onboardingFeeAmount)} onboarding (first checkout only)`
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
                : billingReady && selectedPlanCode === activePlanCode
                ? "Manage Active Subscription"
                : selectedPlanCode === activePlanCode
                ? "Start Stripe Checkout"
                : "Switch Plan & Checkout"}
            </Button>
            {billing?.manageSubscriptionUrl ? (
              <a className="link-button" href={billing.manageSubscriptionUrl} target="_blank" rel="noreferrer">
                Open Billing Portal
              </a>
            ) : !billingReady ? (
              <Button variant="secondary" disabled>
                Billing Portal Unavailable
              </Button>
            ) : null}
            <Link className="link-button secondary" to={`/t/${slug}/admin/billing`}>
              Billing Details
            </Link>
          </div>
        </Card>
      </div>

      <Card>
        <SectionTitle>Features &amp; Services</SectionTitle>
        {featureInventory ? (
          <>
            <p className="muted">
              This is the same server-confirmed inventory used by Director Settings. It includes member modules, plan capabilities, provider readiness, and controlled AI pilots.
            </p>
            <div className="inline-actions">
              <Badge tone="success">{featureInventory.summary?.activeModules || 0}/{featureInventory.summary?.totalModules || 0} modules ready</Badge>
              <Badge tone="success">{featureInventory.summary?.ready || 0} director tools ready</Badge>
              {(featureInventory.summary?.moduleAttention || featureInventory.summary?.attention) ? (
                <Badge tone="warning">{(featureInventory.summary?.moduleAttention || 0) + (featureInventory.summary?.attention || 0)} need setup</Badge>
              ) : null}
            </div>
            <div className="director-onboarding-feature-grid">
              <section>
                <h3>Community modules</h3>
                <ul className="checklist-list">
                  {(featureInventory.modules || []).map((item) => (
                    <li key={item.key} className={item.status === "active" ? "done" : ""}>
                      {item.status === "active" ? "✓" : "○"} {item.label} — {item.statusLabel}
                    </li>
                  ))}
                </ul>
              </section>
              <section>
                <h3>Director toolkit</h3>
                <ul className="checklist-list">
                  {(featureInventory.capabilities || []).map((item) => (
                    <li key={item.key} className={item.status === "active" ? "done" : ""}>
                      {item.status === "active" ? "✓" : "○"} {item.label} — {item.statusLabel}
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          </>
        ) : (
          <p className="muted">Live feature status could not be loaded. Open Director Settings to retry.</p>
        )}
        <div className="inline-actions">
          <Link className="link-button secondary" to={`/t/${slug}/admin/settings/features`}>
            Configure Features &amp; Services
          </Link>
        </div>
      </Card>

      <Card>
        <SectionTitle>Live Preview Tile</SectionTitle>
        <div
          className="wizard-preview"
          style={{
            "--brand-primary": previewBrandPrimary,
            "--brand-on-primary": previewBrandOnPrimary,
            "--brand-secondary": previewTheme.brandSecondary || "#d3dde8",
            "--bg": previewTheme.bg || "#f5f7fa",
            "--text": previewTheme.text || "#0f172a",
            "--card": previewTheme.card || "#ffffff",
            "--font-display": "\"Inter Variable\", Inter, \"Avenir Next\", \"Segoe UI\", sans-serif",
            "--font-body": "\"Inter Variable\", Inter, \"Avenir Next\", \"Segoe UI\", sans-serif"
          }}
        >
          <div className="wizard-preview-nav">
            {previewLogoUrl ? (
              <img src={previewLogoUrl} alt="Camp logo preview" />
            ) : (
              <span className="wizard-preview-nav-fallback" aria-hidden="true">
                {previewLogoInitials}
              </span>
            )}
            <strong>{previewNetworkName}</strong>
          </div>
          <div className="wizard-preview-content">
            <article className="wizard-preview-card">
              <h3>{previewContent.welcomeHeadline || "Welcome to your network"}</h3>
              <p>{previewContent.welcomeBody || "Your welcome message appears here."}</p>
            </article>
          </div>
        </div>
      </Card>

      {payload?.tenant?.onboardingStatus === "live" ? (
        <Card>
          <SectionTitle>Post-Launch Settings</SectionTitle>
          <div className="inline-actions">
            <Link className="link-button secondary" to={`/t/${slug}/admin/settings/branding`}>
              Branding
            </Link>
            <Link className="link-button secondary" to={`/t/${slug}/admin/settings/network`}>
              Network &amp; content
            </Link>
            <Link className="link-button secondary" to={`/t/${slug}/admin/settings/admins`}>
              Admins
            </Link>
            <Link className="link-button secondary" to={`/t/${slug}/admin/people/add`}>
              Invitations
            </Link>
          </div>
        </Card>
      ) : null}

      <Card>
        <SectionTitle>Need Help?</SectionTitle>
        <p className="muted">
          You can finish setup quickly. If needed, our onboarding team can help with branding and invitation preparation.
        </p>
        <div className="inline-actions">
          {payload?.tenant?.content?.contactEmail ? (
            <a className="link-button secondary" href={`mailto:${payload.tenant.content.contactEmail}`}>
              Email Support
            </a>
          ) : (
            <a className="link-button secondary" href="mailto:support@pondbridgealumni.com">
              Email PondBridge
            </a>
          )}
          {isPremium ? (
            <a className="link-button" href="mailto:support@pondbridgealumni.com?subject=Onboarding%20Call">
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
