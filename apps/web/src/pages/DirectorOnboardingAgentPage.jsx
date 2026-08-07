import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Badge, Button, Card, PageShell, Select } from "@pondbridge/ui";
import AgentWorkspace from "../components/agent/AgentWorkspace.jsx";
import { ModalDialog } from "../components/admin/AdminUi.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useTenant } from "../context/TenantContext.jsx";
import { resolveCampAiName } from "../lib/campLabels.js";
import { requestJson } from "../lib/http.js";

const SETUP_STARTERS = [
  "What should I do next?",
  "Explain my launch blockers.",
  "Help me choose an access policy.",
  "Draft a welcome announcement."
];

const LIVE_STARTERS = [
  "What should I prioritize today?",
  "How can I grow participation?",
  "Draft a community update.",
  "How healthy is our community?"
];

const CHECK_LINKS = {
  headline: { label: "Edit network identity", path: "/admin/settings/network" },
  signup: { label: "Choose access policy", path: "/admin/settings/access" },
  modules: { label: "Review modules", path: "/admin/features" },
  module_setup: { label: "Complete module setup", path: "/admin/features" },
  billing: { label: "Open billing", path: "/admin/billing" },
  legal: { label: "Review and accept agreements", path: "/director-legal" },
  logo: { label: "Add camp branding", path: "/admin/settings/branding" },
  initial_members: { label: "Prepare invitations", path: "/admin/people/add" }
};

function messageId(prefix = "message") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function tenantLink(slug, checkId) {
  const item = CHECK_LINKS[checkId];
  if (!item) return { label: "Open director dashboard", href: `/t/${slug}/admin` };
  return { label: item.label, href: `/t/${slug}${item.path}` };
}

function formatMoney(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

function planLabel(code = "") {
  const labels = {
    test: "Internal Test",
    legacy: "Legacy",
    founders: "Founders",
    institutional: "Institutional"
  };
  return labels[String(code || "").trim().toLowerCase()] || "Legacy";
}

function launchTarget(response = {}, slug = "") {
  return (
    String(response?.network?.homeUrl || response?.network?.appUrl || response?.network?.loginUrl || "").trim() ||
    `/t/${slug}/home`
  );
}

function directorEvidenceTarget(href = "") {
  const value = String(href || "");
  if (value.includes("/settings/access")) return "access";
  if (value.includes("/admin/billing")) return "billing";
  if (value.includes("/settings/branding")) return "branding";
  if (value.includes("/onboarding/details")) return "detailed_setup";
  if (value.includes("/admin/features")) return "features";
  if (value.includes("/admin/people/add")) return "invites";
  if (value.includes("/admin/growth")) return "growth";
  if (value.includes("/director-legal")) return "legal";
  if (value.includes("/settings/network")) return "network";
  if (value.includes("/admin")) return "dashboard";
  return "other";
}

function pluralize(value, singular, plural = `${singular}s`) {
  return `${Number(value || 0)} ${Number(value || 0) === 1 ? singular : plural}`;
}

function dashboardBrief(dashboard = {}) {
  if (!dashboard?.stats) {
    return {
      content: "The live dashboard snapshot is temporarily unavailable, so I will not guess at current member or activity numbers.",
      links: []
    };
  }
  const stats = dashboard?.stats || {};
  const queue = Array.isArray(dashboard?.actionQueue) ? dashboard.actionQueue : [];
  const priorityLine = queue.length
    ? `First priority: ${queue[0].title}.`
    : "There are no immediate operational items in the action queue.";

  return {
    content: [
      "Current director brief:",
      `• ${pluralize(stats.totalMembers, "active member")}; ${pluralize(stats.newThisWeek, "new member")} in the last 7 days.`,
      `• Profiles average ${Number(stats.profileCompletion || 0)}% complete.`,
      `• ${pluralize(stats.pendingApprovals, "access request")} pending; ${pluralize(stats.openSafetyReports, "open safety report")}.`,
      `• ${priorityLine}`
    ].join("\n"),
    links: queue
      .slice(0, 4)
      .map((item) => ({
        label: String(item.actionLabel || item.title || "Review priority"),
        href: String(item.href || "")
      }))
      .filter((item) => item.href.startsWith("/t/"))
  };
}

export function buildDirectorGuidedAnswer({ question, payload, billing, dashboard, slug }) {
  const normalized = String(question || "").toLowerCase();
  const isLive = payload?.tenant?.onboardingStatus === "live";
  const checks = payload?.readiness?.checks || [];
  const blockers = checks.filter((item) => !item.ok);
  const firstBlocker = blockers[0];
  const complete = checks.filter((item) => item.ok).length;
  const links = firstBlocker ? [tenantLink(slug, firstBlocker.id)] : [{ label: "Open Director Dashboard", href: `/t/${slug}/admin` }];

  if (normalized.includes("access") || normalized.includes("join") || normalized.includes("signup")) {
    return {
      content:
        "Choose open access only when anyone should be able to register. Use invite-only for a controlled first launch, approval queue when directors should review applicants, or an access code for a shared trusted group. PondBridge enforces the saved policy on the server.",
      links: [tenantLink(slug, "signup")]
    };
  }

  if (normalized.includes("welcome") || normalized.includes("announcement") || normalized.includes("draft")) {
    const campName = payload?.tenant?.name || "your camp";
    return {
      content: isLive
        ? `Editable starting point:\n\nHello ${campName} community — here’s what’s happening this week. Take a moment to update your profile, reconnect with someone from your camp years, and join the latest conversations. We’re glad you’re part of this community.`
        : `Editable starting point:\n\nWelcome to the ${campName} community on PondBridge. This is a place to reconnect, share updates, and support one another across generations. Complete your profile and say hello when you join. We’re glad you’re here.`,
      links: isLive
        ? [{ label: "Edit and send this update", href: `/t/${slug}/admin/email/compose` }]
        : [tenantLink(slug, "headline")]
    };
  }

  if (
    isLive &&
    (normalized.includes("grow") || normalized.includes("participation") || normalized.includes("activity") || normalized.includes("alumni"))
  ) {
    const metrics = dashboardBrief(dashboard);
    return {
      content: `${metrics.content}\n\nRecommended next move: use Alumni Growth to build a focused cohort, review the audience, measure invite-to-signup conversion, and repeat weekly. No campaign was created or sent.`,
      links: [
        ...metrics.links,
        { label: "Open Alumni Growth", href: `/t/${slug}/admin/growth` },
        { label: "Compose an engagement campaign", href: `/t/${slug}/admin/email/compose?audience=inactive_30` }
      ].slice(0, 6)
    };
  }

  if (normalized.includes("invite") || normalized.includes("member") || normalized.includes("grow")) {
    return {
      content: isLive
        ? "Start with the people most likely to participate: recent staff, engaged alumni, and a few trusted community champions. Import or add a small first group, personalize the invitation, then watch signups and profile completion before expanding the next wave. Invitations are always reviewed and sent from the dedicated screen."
        : "Prepare a small, representative invitation list before launch so your community does not open empty. Add trusted camp champions first, verify the access policy, and review every recipient in the invitation workspace. The guide cannot send invitations.",
      links: [tenantLink(slug, "initial_members"), { label: "Review members", href: `/t/${slug}/admin/people/member` }]
    };
  }

  if (
    isLive &&
    (normalized.includes("health") || normalized.includes("prioritize") || normalized.includes("today") || normalized.includes("next"))
  ) {
    const brief = dashboardBrief(dashboard);
    return {
      content: `${brief.content}\n\nThese are measured dashboard facts. Review the linked source before acting; no action was taken.`,
      links: [
        ...brief.links,
        { label: "Open full Director Dashboard", href: `/t/${slug}/admin/dashboard` }
      ].slice(0, 6)
    };
  }

  if (normalized.includes("billing") || normalized.includes("plan") || normalized.includes("payment")) {
    const activePlan = billing?.tenant?.billingPlan || billing?.billing?.billingPlan || "legacy";
    const lifecycle = billing?.tenant?.billingLifecycleStatus || "uninitialized";
    return {
      content: `The current plan is ${planLabel(activePlan)} and the billing lifecycle is ${String(lifecycle).replace(/_/g, " ")}. Billing is ${checks.find((item) => item.id === "billing")?.ok ? "ready for launch" : "still a launch blocker"}. Use Billing Details to verify the Stripe-backed state.`,
      links: [tenantLink(slug, "billing")]
    };
  }

  if (normalized.includes("block") || normalized.includes("launch")) {
    return blockers.length
      ? {
          content: `Launch is waiting on ${blockers.length} required item${blockers.length === 1 ? "" : "s"}: ${blockers.map((item) => item.label).join("; ")}. Start with ${firstBlocker.label.toLowerCase()}.`,
          links: blockers.slice(0, 4).map((item) => tenantLink(slug, item.id))
        }
      : {
          content: "Every required server-side launch check is passing. Review the live plan, then use the separate Launch Network control when you are ready. The guide cannot launch for you.",
          links
        };
  }

  if (isLive) {
    return {
      content: "Your camp community is live. I can help you interpret the current director status, plan an invitation wave, draft a member update, or find the right setting. Open the control room for live priorities and verified metrics.",
      links: [
        { label: "Open camp control room", href: `/t/${slug}/admin` },
        { label: "Invite members", href: `/t/${slug}/admin/people/add` }
      ]
    };
  }

  return firstBlocker
    ? {
        content: `${complete} of ${checks.length} required launch checks are complete. Your next best step is: ${firstBlocker.label}. I’ll keep the live plan updated as you finish work in the linked director screens.`,
        links
      }
    : {
        content: "Your required launch checks are complete. Review the optional branding and invitation steps, then launch from the separate confirmed control when you are ready.",
        links
      };
}

export default function DirectorOnboardingAgentPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { token } = useAuth();
  const { tenant, slug } = useTenant();
  const responseRef = useRef(null);
  const workspaceTrackedRef = useRef(false);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [payload, setPayload] = useState(null);
  const [billing, setBilling] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [capability, setCapability] = useState(null);
  const [featureInventory, setFeatureInventory] = useState(null);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState([]);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedPlan, setSelectedPlan] = useState("legacy");
  const [startingCheckout, setStartingCheckout] = useState(false);
  const [launchDialogOpen, setLaunchDialogOpen] = useState(false);
  const [launching, setLaunching] = useState(false);
  const aiName = resolveCampAiName(tenant);

  const loadWorkspace = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const [onboardingPayload, billingPayload, dashboardPayload, capabilityPayload, featurePayload] = await Promise.all([
        requestJson("/api/tenants/me/onboarding", { token }),
        requestJson("/api/tenants/me/billing", { token }),
        requestJson(`/api/t/${slug}/admin/dashboard`, { token }).catch(() => null),
        requestJson(`/api/t/${slug}/admin/copilot/capabilities`, { token }).catch(() => null),
        requestJson(`/api/t/${slug}/admin/features`, { token }).catch(() => null)
      ]);
      setPayload(onboardingPayload);
      setBilling(billingPayload);
      setDashboard(dashboardPayload);
      setCapability(capabilityPayload);
      setFeatureInventory(featurePayload);
      setSelectedPlan(
        String(billingPayload?.tenant?.billingPlan || billingPayload?.billing?.billingPlan || "legacy").toLowerCase()
      );
      return { onboardingPayload, billingPayload, dashboardPayload };
    } catch (requestError) {
      setError(requestError.message || "Could not load the onboarding workspace.");
      return null;
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [slug, token]);

  const trackWorkspaceEvent = useCallback((eventType, target = "other") => {
    requestJson(`/api/t/${slug}/admin/copilot/events`, {
      method: "POST",
      token,
      body: {
        eventType,
        mode: capability?.available ? "ai" : "guided",
        target
      }
    }).catch(() => {});
  }, [capability?.available, slug, token]);

  useEffect(() => {
    loadWorkspace();
  }, [loadWorkspace]);

  useEffect(() => {
    if (!payload || workspaceTrackedRef.current) return;
    workspaceTrackedRef.current = true;
    trackWorkspaceEvent("workspace_opened");
  }, [payload, trackWorkspaceEvent]);

  useEffect(() => {
    if (!payload || messages.length) return;
    const checks = payload?.readiness?.checks || [];
    const blockers = checks.filter((item) => !item.ok);
    const campName = payload?.tenant?.name || tenant?.name || "your camp";
    const content = payload?.tenant?.onboardingStatus === "live"
      ? `Hi — I’m ${aiName}. I can help you prioritize work for ${campName}, understand live camp status, find the right director tool, or create an editable draft. I will never send or change anything for you.`
      : blockers.length
        ? `Hi — I’m ${aiName}, your setup guide for ${campName}. I checked the live launch requirements: ${checks.length - blockers.length} of ${checks.length} are ready. The next blocker is ${blockers[0].label.toLowerCase()}.`
        : `Hi — I’m ${aiName}, your setup guide for ${campName}. All required launch checks are passing. I can help you review the plan before you use the confirmed launch control.`;
    setMessages([
      {
        id: messageId("welcome"),
        role: "assistant",
        author: aiName,
        content,
        links: blockers[0] ? [tenantLink(slug, blockers[0].id)] : []
      }
    ]);
  }, [aiName, messages.length, payload, slug, tenant?.name]);

  useEffect(() => {
    const checkoutState = String(searchParams.get("checkout") || "").toLowerCase();
    if (checkoutState === "success") {
      setNotice("Stripe checkout completed. Refreshing the server-confirmed billing state.");
      loadWorkspace({ silent: true });
    } else if (checkoutState === "cancel") {
      setError("Stripe checkout was canceled. No billing change was confirmed.");
    }
  }, [loadWorkspace, searchParams]);

  const checks = payload?.readiness?.checks || [];
  const optionalChecks = payload?.readiness?.optionalChecks || [];
  const completed = checks.filter((item) => item.ok).length;
  const launchReady = Boolean(payload?.readiness?.isReady);
  const isLive = payload?.tenant?.onboardingStatus === "live";
  const activePlan = String(billing?.tenant?.billingPlan || billing?.billing?.billingPlan || "legacy").toLowerCase();
  const availablePlans = billing?.catalog?.plans || [];

  const planItems = useMemo(
    () => [...checks, ...optionalChecks].map((item) => ({ ...item, optional: optionalChecks.includes(item) })),
    [checks, optionalChecks]
  );

  async function submitGuideQuestion(questionInput) {
    const nextQuestion = String(questionInput || "").trim();
    if (!nextQuestion || asking) return;
    trackWorkspaceEvent("question_submitted");
    setQuestion("");
    setError("");
    setMessages((current) => [
      ...current,
      { id: messageId("user"), role: "user", content: nextQuestion }
    ]);
    setAsking(true);
    try {
      let result;
      if (capability?.available) {
        result = await requestJson(`/api/t/${slug}/admin/copilot/ask`, {
          method: "POST",
          token,
          body: { question: nextQuestion }
        });
      } else {
        result = buildDirectorGuidedAnswer({
          question: nextQuestion,
          payload,
          billing,
          dashboard,
          slug
        });
      }
      setMessages((current) => [
        ...current,
        {
          id: messageId("assistant"),
          role: "assistant",
          author: aiName,
          content: result.answer || result.content,
          links: result.links || [],
          disclaimer: result.disclaimer || (capability?.available ? "Verify current state in the linked PondBridge screen." : "Guided answer based on the live onboarding checklist. No action was taken.")
        }
      ]);
      window.requestAnimationFrame(() => responseRef.current?.focus());
    } catch (requestError) {
      setError(requestError.message || "The guide could not answer. No action was taken.");
    } finally {
      setAsking(false);
    }
  }

  function askGuide(event) {
    event.preventDefault();
    return submitGuideQuestion(question);
  }

  async function startCheckout() {
    trackWorkspaceEvent("evidence_opened", "billing");
    setStartingCheckout(true);
    setError("");
    setNotice("");
    try {
      const result = await requestJson("/api/tenants/me/billing/checkout", {
        method: "POST",
        token,
        body: {
          planCode: selectedPlan,
          successUrl: `${window.location.origin}/t/${slug}/onboarding?checkout=success`,
          cancelUrl: `${window.location.origin}/t/${slug}/onboarding?checkout=cancel`
        }
      });
      const checkoutUrl = String(result?.checkoutUrl || "").trim();
      if (checkoutUrl) {
        window.location.assign(checkoutUrl);
        return;
      }
      setNotice(result?.notes || "Billing state was updated. Refreshing live evidence.");
      await loadWorkspace({ silent: true });
    } catch (requestError) {
      setError(requestError.message || "Could not start Stripe checkout.");
    } finally {
      setStartingCheckout(false);
    }
  }

  async function launchNetwork() {
    setLaunching(true);
    setError("");
    setNotice("");
    try {
      const result = await requestJson("/api/tenants/me/launch", {
        method: "POST",
        token,
        body: { mode: "director_agent_workspace" }
      });
      setLaunchDialogOpen(false);
      const target = launchTarget(result, slug);
      if (target.startsWith("http")) window.location.assign(target);
      else navigate(target);
    } catch (requestError) {
      const blockers = requestError?.payload?.error?.details?.blockers || [];
      setError(
        blockers.length
          ? `Launch is blocked by: ${blockers.map((item) => item.label).join("; ")}.`
          : requestError.message || "Could not launch the network."
      );
      setLaunchDialogOpen(false);
      await loadWorkspace({ silent: true });
    } finally {
      setLaunching(false);
    }
  }

  function refreshWorkspace() {
    trackWorkspaceEvent("refresh_requested");
    return loadWorkspace({ silent: true });
  }

  function openLaunchReview() {
    trackWorkspaceEvent("launch_review_opened");
    setLaunchDialogOpen(true);
  }

  function trackEvidenceLink(item) {
    trackWorkspaceEvent("evidence_opened", directorEvidenceTarget(item?.href));
  }

  if (loading && !payload) {
    return (
      <PageShell className="pb-cedar-page">
        <Card>Preparing your guided onboarding workspace…</Card>
      </PageShell>
    );
  }

  if (!payload) {
    return (
      <PageShell className="pb-cedar-page">
        <Card>
          <h1>Onboarding workspace unavailable</h1>
          <p className="error-text" role="alert">{error || "The live onboarding state could not be loaded."}</p>
          <Button onClick={() => loadWorkspace()}>Try again</Button>
        </Card>
      </PageShell>
    );
  }

  return (
    <PageShell className="pb-cedar-page director-agent-page">
      <AgentWorkspace
        variant={isLive ? "chat" : "workspace"}
        assistantName={aiName}
        thinkingLabel={`${aiName} is checking live camp data…`}
        eyebrow={isLive ? "Director workspace" : "Director onboarding"}
        title={isLive ? aiName : `Launch with ${aiName}`}
        subtitle={
          isLive
            ? "Ask about priorities, members, communications, settings, or an editable draft."
            : "Ask a question, follow the live plan, and make changes in the linked director tools. Your server-confirmed status updates here."
        }
        status={
          <>
            <Badge tone={isLive ? "success" : "neutral"}>{isLive ? "Network live" : `${completed}/${checks.length} ready`}</Badge>
            <Badge tone={capability?.available ? "success" : "neutral"}>
              {capability?.available ? "AI pilot on" : "Guided mode"}
            </Badge>
          </>
        }
        boundary={
          <>
            <strong>You stay in control.</strong> This guide explains live setup status and drafts text, but cannot change settings, accept terms, charge a card, send invitations, or launch the network.
            {capability?.available ? " OpenAI receives the question and minimum aggregate camp context; PondBridge stores audit hashes and usage metadata, not the raw conversation." : " AI is off for this camp, so answers come locally from the live checklist."}
          </>
        }
        messages={messages}
        responseRef={responseRef}
        onEvidenceClick={trackEvidenceLink}
        busy={asking}
        composer={{
          id: "director-onboarding-question",
          question,
          onQuestionChange: setQuestion,
          onSubmit: askGuide,
          onStarterSelect: submitGuideQuestion,
          starters: isLive ? LIVE_STARTERS : SETUP_STARTERS,
          label: "What do you want to work on?",
          placeholder: isLive
            ? "For example: Help me plan this week's member update."
            : "For example: What should I finish before inviting our first members?",
          submitLabel: `Send to ${aiName}`
        }}
        rail={isLive ? null : (
          <>
            <Card className="agent-rail-card">
              <h2>{isLive ? "Verified camp status" : "Live launch plan"}</h2>
              <p>
                {isLive
                  ? "Your launch foundation is complete. Review any setting below or use the control room for today’s operational priorities."
                  : launchReady
                    ? "All required launch evidence is ready."
                    : `${checks.length - completed} required item${checks.length - completed === 1 ? "" : "s"} still need attention.`}
              </p>
              <ul className="agent-plan-list">
                {planItems.map((item) => {
                  const link = tenantLink(slug, item.id);
                  return (
                    <li key={item.id} className={`agent-plan-item ${item.ok ? "is-complete" : ""}`}>
                      <span className="agent-plan-mark" aria-hidden="true">{item.ok ? "✓" : "○"}</span>
                      <div>
                        <strong>{item.label}{item.optional ? " (optional)" : ""}</strong>
                        <Link to={link.href} onClick={() => trackEvidenceLink(link)}>
                          {item.ok ? "Review evidence" : link.label}
                        </Link>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <div className="agent-rail-actions">
                {!isLive ? (
                  <Button disabled={!launchReady} onClick={openLaunchReview}>
                    {launchReady ? "Review & Launch Network" : "Launch checks incomplete"}
                  </Button>
                ) : (
                  <Button onClick={() => navigate(`/t/${slug}/admin`)}>Open Director Dashboard</Button>
                )}
                <Button variant="secondary" onClick={refreshWorkspace} loading={refreshing}>
                  {refreshing ? "Refreshing…" : "Refresh live evidence"}
                </Button>
                <Link
                  className="link-button secondary"
                  to={`/t/${slug}/onboarding/details`}
                  onClick={() => trackWorkspaceEvent("evidence_opened", "detailed_setup")}
                >
                  Open detailed setup center
                </Link>
              </div>
            </Card>

            <Card className="agent-rail-card">
              <h3>Features &amp; services</h3>
              {featureInventory ? (
                <p>
                  <strong>{featureInventory.summary?.activeModules || 0}</strong> of {featureInventory.summary?.totalModules || 0} community modules are ready. {featureInventory.summary?.ready || 0} director capabilities are ready.
                </p>
              ) : (
                <p className="muted">Live feature status is temporarily unavailable. Open settings to retry.</p>
              )}
              {(featureInventory?.summary?.moduleAttention || featureInventory?.summary?.attention) ? (
                <p className="muted">
                  {(featureInventory?.summary?.moduleAttention || 0) + (featureInventory?.summary?.attention || 0)} item(s) need configuration before every selected feature is fully operational.
                </p>
              ) : null}
              {featureInventory ? <details className="director-agent-feature-details">
                <summary>Review complete feature status</summary>
                <ul className="agent-plan-list">
                  {[...(featureInventory?.modules || []), ...(featureInventory?.capabilities || [])].map((item) => (
                    <li key={`${item.category || "module"}:${item.key}`} className={`agent-plan-item ${item.status === "active" ? "is-complete" : ""}`}>
                      <span className="agent-plan-mark" aria-hidden="true">{item.status === "active" ? "✓" : "○"}</span>
                      <div>
                        <strong>{item.label}</strong>
                        <small>{item.statusLabel}</small>
                      </div>
                    </li>
                  ))}
                </ul>
              </details> : null}
              <Link
                className="link-button secondary"
                to={`/t/${slug}/admin/features`}
                onClick={() => trackWorkspaceEvent("evidence_opened", "features")}
              >
                Configure features &amp; services
              </Link>
            </Card>

            <Card className="agent-rail-card">
              <h3>Plan & billing</h3>
              <p>Current plan: <strong>{planLabel(activePlan)}</strong></p>
              {availablePlans.length ? (
                <label className="director-agent-plan-select" htmlFor="director-agent-plan">
                  Plan selection
                  <Select id="director-agent-plan" value={selectedPlan} onChange={(event) => setSelectedPlan(event.target.value)}>
                    {availablePlans.map((plan) => (
                      <option key={plan.code} value={plan.code}>
                        {plan.label} · {formatMoney(plan.annualAmount)}/yr
                      </option>
                    ))}
                  </Select>
                </label>
              ) : null}
              <div className="agent-rail-actions">
                <Button variant="secondary" onClick={startCheckout} loading={startingCheckout}>
                  {selectedPlan === activePlan ? "Open Stripe checkout" : "Switch plan in Stripe"}
                </Button>
                {billing?.manageSubscriptionUrl ? (
                  <a
                    className="link-button secondary"
                    href={billing.manageSubscriptionUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => trackWorkspaceEvent("evidence_opened", "billing")}
                  >
                    Open billing portal
                  </a>
                ) : null}
                <Link
                  className="link-button secondary"
                  to={`/t/${slug}/admin/billing`}
                  onClick={() => trackWorkspaceEvent("evidence_opened", "billing")}
                >
                  View billing evidence
                </Link>
              </div>
            </Card>
          </>
        )}
      >
        {error ? <p className="agent-page-feedback error-text" role="alert">{error}</p> : null}
        {notice ? <p className="agent-page-feedback success-text" role="status">{notice}</p> : null}
      </AgentWorkspace>

      <ModalDialog
        open={launchDialogOpen}
        title="Launch this network?"
        description={`This publishes the saved onboarding configuration and makes the member network live. ${aiName} cannot undo this action.`}
        onClose={launching ? undefined : () => setLaunchDialogOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setLaunchDialogOpen(false)} disabled={launching}>Keep reviewing</Button>
            <Button onClick={launchNetwork} loading={launching}>{launching ? "Launching…" : "Launch Network"}</Button>
          </>
        }
      >
        <p>All required server-side checks are currently passing. Confirm only when your camp is ready for members.</p>
      </ModalDialog>
    </PageShell>
  );
}
