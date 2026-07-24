import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Badge, Button, Card } from "@pondbridge/ui";
import AgentWorkspace from "../../components/agent/AgentWorkspace.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { requestJson } from "../../lib/http.js";

const OPERATIONS_STARTERS = [
  "Show me what needs attention",
  "Check a camp's launch health",
  "Review billing risk",
  "Check email delivery"
];

const FINANCE_STARTERS = [
  "Show me what needs attention in billing",
  "Review failed payments",
  "Look up a camp's billing state",
  "Explain configured MRR"
];

function messageId(prefix = "message") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function primaryRole(user) {
  const roles = new Set(user?.roles || []);
  if (roles.has("super_admin")) return "super_admin";
  if (roles.has("support_admin")) return "support_admin";
  if (roles.has("finance_admin")) return "finance_admin";
  return "unknown";
}

function roleLabel(role) {
  if (role === "super_admin") return "Super admin";
  if (role === "support_admin") return "Support admin";
  if (role === "finance_admin") return "Finance admin";
  return "Admin";
}

function formatMoney(value = 0) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

function formatPercent(value) {
  if (value == null) return "Unavailable";
  return `${Number(value).toFixed(1)}%`;
}

function superEvidenceTarget(href = "") {
  const value = String(href || "");
  if (value.startsWith("/super/billing/failed")) return "failed_payments";
  if (value.startsWith("/super/billing")) return "billing";
  if (value.startsWith("/super/email")) return "email";
  if (value.startsWith("/super/status") || value.startsWith("/super/pulse")) return "pulse";
  if (value.startsWith("/super/tenants")) return "camps";
  if (value.startsWith("/super/settings")) return "settings";
  if (value.startsWith("/super/dashboard")) return "dashboard";
  return "other";
}

function safeSuperEvidenceHref(href = "") {
  const value = String(href || "");
  if (/^\/super\/(status|billing|email|tenants|settings|dashboard)(\/|\?|$)/.test(value)) return value;
  return "/super/status";
}

export function buildSuperGuidedAnswer({ question, role, operationalData }) {
  const normalized = String(question || "").toLowerCase();
  const isFinance = role === "finance_admin";

  if (normalized.includes("create") || normalized.includes("add a camp") || normalized.includes("new camp")) {
    if (role !== "super_admin") {
      return {
        content: "Creating a camp requires the super-admin role. You can still inspect existing camp records within your authorized workspace.",
        links: [{ label: isFinance ? "Open billing records" : "Open camp records", href: isFinance ? "/super/billing/tenants" : "/super/tenants" }]
      };
    }
    return {
      content: "I can prepare you for camp setup, but the final creation stays in the reviewed Add a camp form. Gather the camp name, URL slug, primary director email, and billing plan, then verify the summary before submitting.",
      links: [{ label: "Start reviewed camp setup", href: "/super/tenants/create" }]
    };
  }

  if (normalized.includes("payment") || normalized.includes("billing") || normalized.includes("mrr")) {
    const stats = operationalData?.stats || {};
    const configuredMrr = stats.mrr ?? stats.mrrCurrent ?? 0;
    const failures = stats.failedPayments ?? 0;
    return {
      content: `Configured MRR is ${formatMoney(configuredMrr)} based on PondBridge's current tenant plan state${operationalData?.trendAvailable === false || operationalData?.billingTrendAvailable === false ? "; it is not a Stripe revenue ledger" : ""}. ${failures} failed payment${failures === 1 ? "" : "s"} currently need review. Open the billing evidence screens before taking any follow-up action.`,
      links: [
        { label: "Open tenant billing", href: "/super/billing/tenants" },
        { label: "Review failed payments", href: "/super/billing/failed" }
      ]
    };
  }

  if (normalized.includes("email") || normalized.includes("delivery") || normalized.includes("resend")) {
    if (isFinance) {
      return {
        content: "Transactional email telemetry is outside the finance role. Your console is limited to billing investigation.",
        links: [{ label: "Return to tenant billing", href: "/super/billing/tenants" }]
      };
    }
    const rate = operationalData?.stats?.emailHealthRate;
    return {
      content: `The latest seven-day delivery health is ${formatPercent(rate)}. Use Email delivery for provider-backed event evidence and Platform status for the aggregate alert.`,
      links: [
        { label: "Open transactional email", href: "/super/email/transactional" },
        { label: "Open platform status", href: "/super/status" }
      ]
    };
  }

  if (normalized.includes("camp") || normalized.includes("tenant") || normalized.includes("launch")) {
    return {
      content: isFinance
        ? "Search Tenant Billing by camp name or slug to inspect the role-authorized billing state. The finance role cannot access member or general tenant operations."
        : "Search the Camp Directory by name or slug, then verify onboarding status, billing state, and current counts in the existing console. The Operations Guide does not change camp state.",
      links: [
        {
          label: isFinance ? "Search tenant billing" : "Open Camp Directory",
          href: isFinance ? "/super/billing/tenants" : "/super/tenants"
        }
      ]
    };
  }

  if (isFinance) {
    const stats = operationalData?.stats || {};
    return {
      content: `${stats.failedPayments || 0} failed payment${stats.failedPayments === 1 ? "" : "s"} and ${stats.churned30d || 0} churned subscription${stats.churned30d === 1 ? "" : "s"} are reflected in the current PondBridge billing state. Start with failed payments, then verify individual tenant records.`,
      links: [
        { label: "Review failed payments", href: "/super/billing/failed" },
        { label: "Open tenant billing", href: "/super/billing/tenants" }
      ]
    };
  }

  const alerts = operationalData?.alerts || [];
  return alerts.length
    ? {
        content: `${alerts.length} current platform alert${alerts.length === 1 ? "" : "s"} need review. The highest visible item is: ${alerts[0].message}. Use the linked console evidence to investigate.`,
        links: alerts.slice(0, 4).map((alert) => ({ label: alert.message, href: safeSuperEvidenceHref(alert.href) }))
      }
    : {
        content: "Platform status currently shows no critical alerts. Review the camp records or the full status page for broader operational context.",
        links: [
          { label: "Open platform status", href: "/super/status" },
          { label: "Open Camp Directory", href: "/super/tenants" }
        ]
      };
}

export default function SuperOperationsAgentPage() {
  const { token, user, getAuthToken } = useAuth();
  const role = primaryRole(user);
  const isFinance = role === "finance_admin";
  const responseRef = useRef(null);
  const workspaceTrackedRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [capability, setCapability] = useState(null);
  const [operationalData, setOperationalData] = useState(null);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState([]);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState("");

  const authenticatedRequest = useCallback(
    (path, options = {}) =>
      requestJson(path, {
        token,
        getToken: () => getAuthToken({ forceRefresh: true }),
        ...options
      }),
    [getAuthToken, token]
  );

  const loadWorkspace = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const [capabilityPayload, dataPayload] = await Promise.all([
        authenticatedRequest("/api/super/copilot/capabilities"),
        authenticatedRequest(isFinance ? "/api/super/billing/overview" : "/api/super/platform-pulse")
      ]);
      setCapability(capabilityPayload);
      setOperationalData(dataPayload);
    } catch (requestError) {
      setError(requestError.message || "Could not load current operations evidence.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [authenticatedRequest, isFinance]);

  const trackWorkspaceEvent = useCallback((eventType, target = "other") => {
    authenticatedRequest("/api/super/copilot/events", {
      method: "POST",
      body: {
        eventType,
        mode: capability?.available ? "ai" : "guided",
        target
      }
    }).catch(() => {});
  }, [authenticatedRequest, capability?.available]);

  useEffect(() => {
    if (token) loadWorkspace();
  }, [loadWorkspace, token]);

  useEffect(() => {
    if (!operationalData || workspaceTrackedRef.current) return;
    workspaceTrackedRef.current = true;
    trackWorkspaceEvent("workspace_opened");
  }, [operationalData, trackWorkspaceEvent]);

  useEffect(() => {
    if (!operationalData || messages.length) return;
    const stats = operationalData.stats || {};
    const content = isFinance
      ? `I checked the current billing state. Configured MRR is ${formatMoney(stats.mrr || 0)}, with ${stats.failedPayments || 0} failed payment${stats.failedPayments === 1 ? "" : "s"} requiring review.`
      : (operationalData.alerts || []).length
        ? `Platform status has ${(operationalData.alerts || []).length} current alert${(operationalData.alerts || []).length === 1 ? "" : "s"}. First: ${(operationalData.alerts || [])[0].message}.`
        : "Platform status has no critical alerts right now. Ask about a camp, billing workflow, or console screen.";
    setMessages([
      {
        id: messageId("welcome"),
        role: "assistant",
        author: capability?.available ? "Operations Agent" : "Operations Guide",
        content,
        links: isFinance
          ? [{ label: "Review failed payments", href: "/super/billing/failed" }]
          : [{ label: "Open platform status", href: "/super/status" }]
      }
    ]);
  }, [capability?.available, isFinance, messages.length, operationalData]);

  const metrics = useMemo(() => {
    const stats = operationalData?.stats || {};
    if (isFinance) {
      return [
        { label: "Configured MRR", value: formatMoney(stats.mrr || 0), detail: "Plan state" },
        { label: "Failed payments", value: stats.failedPayments ?? 0, detail: "Needs review" },
        { label: "New subscriptions", value: stats.newSubscriptions30d ?? 0, detail: "Last 30 days" },
        { label: "Churned", value: stats.churned30d ?? 0, detail: "Last 30 days" }
      ];
    }
    return [
      { label: "Active camps", value: stats.activeTenants ?? 0, detail: "Live" },
      { label: "Configured MRR", value: formatMoney(stats.mrrCurrent || 0), detail: "Not Stripe revenue" },
      { label: "Email health", value: formatPercent(stats.emailHealthRate), detail: "Seven days" },
      { label: "Approval-mode camps", value: stats.pendingApprovals ?? 0, detail: "Signup setting" }
    ];
  }, [isFinance, operationalData]);

  const workflows = useMemo(() => {
    if (isFinance) {
      return [
        { label: "Review billing status", detail: "Plans, MRR, and camp records", href: "/super/billing/tenants" },
        { label: "Resolve failed payments", detail: "Open the current exception queue", href: "/super/billing/failed" }
      ];
    }
    return [
      { label: "Review platform status", detail: "See alerts and connected systems", href: "/super/status" },
      { label: "Find a camp", detail: "Search and inspect camp records", href: "/super/tenants" },
      ...(role === "super_admin"
        ? [{ label: "Set up a new camp", detail: "Open the reviewed provisioning flow", href: "/super/tenants/create" }]
        : []),
      { label: "Review billing risk", detail: "Plans and failed payments", href: "/super/billing/tenants" },
      { label: "Check email delivery", detail: "Inspect provider-backed evidence", href: "/super/email/transactional" }
    ];
  }, [isFinance, role]);

  async function submitOperationsQuestion(questionInput) {
    const nextQuestion = String(questionInput || "").trim();
    if (!nextQuestion || asking) return;
    trackWorkspaceEvent("question_submitted");
    setQuestion("");
    setError("");
    setMessages((current) => [...current, { id: messageId("user"), role: "user", content: nextQuestion }]);
    setAsking(true);
    try {
      const result = capability?.available
        ? await authenticatedRequest("/api/super/copilot/ask", {
            method: "POST",
            body: { question: nextQuestion }
          })
        : buildSuperGuidedAnswer({ question: nextQuestion, role, operationalData });
      setMessages((current) => [
        ...current,
        {
          id: messageId("assistant"),
          role: "assistant",
          author: capability?.available ? "Operations Agent" : "Operations Guide",
          content: result.answer || result.content,
          links: result.links || [],
          disclaimer: result.disclaimer || (capability?.available
            ? "Read-only investigation. Verify evidence in the linked console screen before taking action."
            : "Guided answer based on the live console summary. No action was taken.")
        }
      ]);
      window.requestAnimationFrame(() => responseRef.current?.focus());
    } catch (requestError) {
      setError(requestError.message || "The investigation could not be completed. No action was taken.");
    } finally {
      setAsking(false);
    }
  }

  function askOperationsAgent(event) {
    event.preventDefault();
    return submitOperationsQuestion(question);
  }

  function refreshWorkspace() {
    trackWorkspaceEvent("refresh_requested");
    return loadWorkspace({ silent: true });
  }

  function trackEvidenceLink(item) {
    trackWorkspaceEvent("evidence_opened", superEvidenceTarget(item?.href));
  }

  if (loading && !operationalData) {
    return <Card><p className="muted">Preparing the Operations Agent workspace…</p></Card>;
  }

  if (!operationalData) {
    return (
      <Card>
        <h1>Operations workspace unavailable</h1>
        <p className="error-text" role="alert">{error || "Current operational evidence could not be loaded."}</p>
        <Button onClick={() => loadWorkspace()}>Try again</Button>
      </Card>
    );
  }

  const alerts = isFinance
    ? (operationalData?.stats?.failedPayments > 0
        ? [{ id: "failed", message: `${operationalData.stats.failedPayments} failed payments need review`, href: "/super/billing/failed" }]
        : [])
    : operationalData?.alerts || [];

  return (
    <div className="super-panel-stack super-agent-page">
      <AgentWorkspace
        eyebrow="PondBridge control room"
        title="What do you need to run today?"
        subtitle="Ask in plain language. PondBridge checks the live operating picture and takes you to the reviewed control when a decision or change is needed."
        status={
          <>
            <Badge tone="neutral">{roleLabel(role)}</Badge>
            <Badge tone={capability?.available ? "success" : "neutral"}>
              {capability?.available ? "AI pilot on" : "Guided mode"}
            </Badge>
            <Badge tone="success">Safe by default</Badge>
          </>
        }
        boundary={
          <>
            <strong>Investigation first.</strong> The agent can explain authorized aggregate data and guide a workflow, but it cannot silently create camps, change billing or access, send email, provision domains, delete data, or bypass permissions. Those steps open an explicit reviewed control.
            {capability?.available ? " OpenAI receives the question and minimum aggregate context; PondBridge stores audit hashes and usage metadata, not raw conversations." : " AI is off, so the local guide summarizes the live evidence below."}
          </>
        }
        messages={messages}
        responseRef={responseRef}
        onEvidenceClick={trackEvidenceLink}
        busy={asking}
        composer={{
          id: "super-operations-question",
          question,
          onQuestionChange: setQuestion,
          onSubmit: askOperationsAgent,
          onStarterSelect: submitOperationsQuestion,
          starters: isFinance ? FINANCE_STARTERS : OPERATIONS_STARTERS,
          label: "Ask PondBridge",
          placeholder: isFinance ? "What should I review in billing today?" : "What needs attention, or which workflow should I start?",
          submitLabel: "Send"
        }}
        rail={
          <>
            <Card className="agent-rail-card">
              <div className="super-agent-rail-heading">
                <div>
                  <p>Right now</p>
                  <h2>Today at a glance</h2>
                </div>
                <span className={`super-agent-health ${alerts.length ? "needs-review" : "is-steady"}`}>
                  {alerts.length ? `${alerts.length} to review` : "Steady"}
                </span>
              </div>
              <div className="agent-metric-grid">
                {metrics.map((metric) => (
                  <div key={metric.label} className="agent-metric">
                    <span>{metric.label}</span>
                    <strong>{metric.value}</strong>
                    <small>{metric.detail}</small>
                  </div>
                ))}
              </div>
              <div className="agent-rail-actions">
                <Button variant="secondary" onClick={refreshWorkspace} loading={refreshing}>
                  {refreshing ? "Refreshing…" : "Refresh evidence"}
                </Button>
                <Link
                  className="link-button secondary"
                  to={isFinance ? "/super/billing/tenants" : "/super/status"}
                  onClick={() => trackWorkspaceEvent("evidence_opened", isFinance ? "billing" : "pulse")}
                >
                  {isFinance ? "Open billing status" : "Open platform status"}
                </Link>
              </div>
              {alerts.length ? (
                <ul className="agent-alert-list super-agent-alert-list">
                  {alerts.slice(0, 5).map((alert) => (
                    <li key={alert.id}>
                      {alert.message}
                      <Link to={safeSuperEvidenceHref(alert.href)} onClick={() => trackEvidenceLink(alert)}>Open evidence</Link>
                    </li>
                  ))}
                </ul>
              ) : null}
            </Card>

            <Card className="agent-rail-card super-agent-workflow-card">
              <p className="super-agent-rail-eyebrow">Direct paths</p>
              <h3>Start a workflow</h3>
              <div className="super-agent-workflows">
                {workflows.map((workflow) => (
                  <Link key={workflow.href} to={workflow.href} onClick={() => trackWorkspaceEvent("evidence_opened", superEvidenceTarget(workflow.href))}>
                    <span>
                      <strong>{workflow.label}</strong>
                      <small>{workflow.detail}</small>
                    </span>
                    <b aria-hidden="true">→</b>
                  </Link>
                ))}
              </div>
            </Card>
          </>
        }
      >
        {error ? <p className="agent-page-feedback error-text" role="alert">{error}</p> : null}
      </AgentWorkspace>
    </div>
  );
}
