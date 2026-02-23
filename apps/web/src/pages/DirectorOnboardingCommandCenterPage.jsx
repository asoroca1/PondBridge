import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
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

export default function DirectorOnboardingCommandCenterPage() {
  const { slug } = useParams();
  const { token, user } = useAuth();
  const { tenant } = useTenant();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [payload, setPayload] = useState(null);
  const [billing, setBilling] = useState(null);
  const [updatingBilling, setUpdatingBilling] = useState(false);

  const isSuperAdmin = Boolean(user?.roles?.includes("super_admin"));

  async function loadCommandCenter() {
    setLoading(true);
    setError("");
    try {
      const [onboardingPayload, billingPayload] = await Promise.all([
        requestJson("/api/tenants/me/onboarding", { token }),
        requestJson("/api/tenants/me/billing", { token })
      ]);
      setPayload(onboardingPayload);
      setBilling(billingPayload);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCommandCenter();
  }, [token]);

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

  const checklist = payload?.tenant?.onboardingChecklist || [];
  const completion = progressPercent(checklist);
  const completedCount = checklist.filter((item) => item.status === "completed").length;

  const phaseGroups = useMemo(() => {
    return PHASES.map((phase) => ({
      ...phase,
      items: checklist.filter((item) => phase.steps.includes(item.id))
    }));
  }, [checklist]);

  const isPremium = payload?.tenant?.planTier === "premium";
  const inactive = payload?.tenant?.status === "inactive";
  const billingReady = Boolean(payload?.readiness?.checks?.find((check) => check.id === "billing")?.ok);

  if (loading) {
    return (
      <PageShell className="pb-cedar-page command-center-shell">
        <Card>Loading onboarding command center...</Card>
      </PageShell>
    );
  }

  return (
    <PageShell className="pb-cedar-page command-center-shell">
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
          <Button variant="secondary" onClick={loadCommandCenter}>
            Refresh
          </Button>
          {payload?.tenant?.onboardingStatus === "live" ? (
            <Badge tone="success">Network is Live</Badge>
          ) : (
            <Badge tone="neutral">Setup in Progress</Badge>
          )}
          {billingReady ? <Badge tone="success">Billing Ready</Badge> : <Badge tone="danger">Billing Pending</Badge>}
        </div>
        {inactive ? (
          <p className="error-text">
            Your camp is currently inactive. Please contact support before launching.
          </p>
        ) : null}
        {error ? <p className="error-text">{error}</p> : null}
        {status ? <p className="success-text">{status}</p> : null}
      </Card>

      {payload?.tenant?.onboardingStatus === "live" ? (
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
            <strong>Status:</strong> {billing?.tenant?.billingStatus || "unknown"}
          </p>
          <p>
            <strong>Onboarding fee:</strong> {formatMoney(billing?.tenant?.onboardingFeeAmount || 0)}
          </p>
          <p>
            <strong>Onboarding fee paid:</strong> {billing?.tenant?.onboardingFeePaid ? "Yes" : "No"}
          </p>
          <p>
            <strong>Readiness:</strong> {billingReady ? "Ready" : "Blocked until billing is ready"}
          </p>
          <div className="inline-actions">
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
