import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Badge, Button, Card } from "@pondbridge/ui";
import { useAuth } from "../../context/AuthContext.jsx";
import { requestJson } from "../../lib/http.js";

const CONNECTION_LABELS = {
  stripe: "Billing records",
  resend: "Transactional email",
  r2: "File storage",
  loops: "Lifecycle email",
  posthog: "Product analytics",
  trigger: "Background jobs"
};

function formatMoney(value = 0) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

function formatDateTime(value) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function readableStatus(value = "") {
  if (value && typeof value === "object") {
    const mode = String(value.mode || "").trim().toLowerCase();
    if (mode === "mock") return "Mock mode";
    if (value.configured === true && mode) return `${mode.charAt(0).toUpperCase()}${mode.slice(1)} configured`;
    if (value.configured === true) return "Configured";
    if (value.configured === false) return "Needs setup";
    if (value.available === true) return "Available";
    if (value.available === false) return "Unavailable";
  }
  const normalized = String(value || "unknown").replace(/_/g, " ");
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function connectionTone(value = "") {
  if (value && typeof value === "object") {
    if (String(value.mode || "").trim().toLowerCase() === "mock") return "warning";
    if (value.configured === true || value.available === true) return "success";
    if (value.configured === false || value.available === false) return "warning";
  }
  const normalized = String(value || "").toLowerCase();
  if (["connected", "configured", "db_synced", "healthy", "available"].includes(normalized)) return "success";
  if (["partial", "degraded"].includes(normalized)) return "warning";
  return "neutral";
}

function safeAlertHref(href = "") {
  const value = String(href || "");
  if (/^\/super\/(billing|email|tenants)(\/|\?|$)/.test(value)) return value;
  return "/super/status";
}

function StatusMetric({ label, value, detail, tone = "neutral" }) {
  return (
    <article className={`super-status-metric tone-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

export default function SuperStatusPage() {
  const { token, getAuthToken } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const loadStatus = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const payload = await requestJson("/api/super/platform-pulse", {
        token,
        getToken: () => getAuthToken({ forceRefresh: true })
      });
      setData(payload);
    } catch (loadError) {
      setError(loadError.message || "Could not load current platform status.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [getAuthToken, token]);

  useEffect(() => {
    if (!token) return undefined;
    loadStatus();
    const intervalId = window.setInterval(() => loadStatus({ silent: true }), 60_000);
    return () => window.clearInterval(intervalId);
  }, [loadStatus, token]);

  const connections = useMemo(
    () => Object.entries(data?.integrations || {}).map(([key, value]) => ({
      key,
      label: CONNECTION_LABELS[key] || key,
      value,
      tone: connectionTone(value)
    })),
    [data?.integrations]
  );

  if (loading && !data) {
    return <Card><p className="muted">Checking current platform status…</p></Card>;
  }

  if (!data) {
    return (
      <Card className="super-status-unavailable">
        <h1>Platform status is unavailable</h1>
        <p className="error-text" role="alert">{error || "Live status evidence could not be loaded."}</p>
        <Button onClick={() => loadStatus()}>Try again</Button>
      </Card>
    );
  }

  const stats = data.stats || {};
  const alerts = data.alerts || [];
  const needsAttention = alerts.length > 0;

  return (
    <div className="super-panel-stack super-status-page">
      <section className={`super-status-hero ${needsAttention ? "needs-attention" : "is-steady"}`}>
        <div className="super-status-hero-copy">
          <p className="super-status-eyebrow">Live operating picture</p>
          <h1>Platform status</h1>
          <p>
            {needsAttention
              ? `${alerts.length} item${alerts.length === 1 ? "" : "s"} need review. Nothing has been changed automatically.`
              : "No critical alerts are present in the current platform summary."}
          </p>
          <span>Updated {formatDateTime(data.generatedAt)} · refreshes every 60 seconds</span>
        </div>
        <div className="super-status-hero-actions">
          <Badge tone={needsAttention ? "warning" : "success"}>
            {needsAttention ? "Review needed" : "Core signals steady"}
          </Badge>
          <Button variant="secondary" onClick={() => loadStatus({ silent: true })} loading={refreshing}>
            {refreshing ? "Refreshing…" : "Refresh status"}
          </Button>
        </div>
      </section>

      {error ? <p className="super-inline-error" role="alert">{error}</p> : null}

      <section className="super-status-metrics" aria-label="Platform status summary">
        <StatusMetric label="Live camps" value={stats.activeTenants ?? 0} detail="Active and launched" tone="success" />
        <StatusMetric label="Configured MRR" value={formatMoney(stats.mrrCurrent || 0)} detail="Plan state, not Stripe revenue" />
        <StatusMetric
          label="Email delivery"
          value={stats.emailHealthRate == null ? "Awaiting data" : `${Number(stats.emailHealthRate).toFixed(1)}%`}
          detail="Provider evidence, last 7 days"
          tone={stats.emailHealthRate == null ? "neutral" : stats.emailHealthRate >= 95 ? "success" : "warning"}
        />
        <StatusMetric
          label="Import reports"
          value={stats.failedJobs7d ?? 0}
          detail="With errors in the last 7 days"
          tone={stats.failedJobs7d > 0 ? "warning" : "success"}
        />
      </section>

      <div className="super-status-content-grid">
        <Card className="super-status-attention-card">
          <div className="super-status-section-heading">
            <div>
              <p>Priority queue</p>
              <h2>Needs attention</h2>
            </div>
            <Badge tone={needsAttention ? "warning" : "success"}>{alerts.length}</Badge>
          </div>
          {alerts.length ? (
            <div className="super-status-alerts">
              {alerts.map((alert) => (
                <article key={alert.id} className={`tone-${alert.tone || "neutral"}`}>
                  <div>
                    <strong>{alert.message}</strong>
                    <small>Detected {formatDateTime(alert.time)}</small>
                  </div>
                  <Link to={safeAlertHref(alert.href)}>Review evidence</Link>
                </article>
              ))}
            </div>
          ) : (
            <div className="super-status-empty">
              <span aria-hidden="true">✓</span>
              <div>
                <strong>No critical alerts</strong>
                <p>Ask PondBridge for a broader operational check or open a record directly.</p>
              </div>
            </div>
          )}
        </Card>

        <Card className="super-status-connections-card">
          <div className="super-status-section-heading">
            <div>
              <p>Evidence sources</p>
              <h2>System connections</h2>
            </div>
          </div>
          <div className="super-status-connections">
            {connections.map((connection) => (
              <div key={connection.key}>
                <span><i className={`tone-${connection.tone}`} aria-hidden="true" />{connection.label}</span>
                <Badge tone={connection.tone}>{readableStatus(connection.value)}</Badge>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <section className="super-status-areas" aria-labelledby="operating-areas-heading">
        <div className="super-status-section-heading">
          <div>
            <p>Drill down</p>
            <h2 id="operating-areas-heading">Operating areas</h2>
          </div>
        </div>
        <div className="super-status-area-grid">
          <Link to="/super/tenants" className="super-status-area-card">
            <span>Camps</span>
            <strong>{stats.activeTenants ?? 0} live</strong>
            <small>{stats.pendingApprovals ?? 0} use approval-mode signup</small>
            <b>Open camp records →</b>
          </Link>
          <Link to="/super/billing/tenants" className="super-status-area-card">
            <span>Billing</span>
            <strong>{formatMoney(stats.mrrCurrent || 0)} configured</strong>
            <small>Review plan state and failed payments</small>
            <b>Open billing records →</b>
          </Link>
          <Link to="/super/email/transactional" className="super-status-area-card">
            <span>Email delivery</span>
            <strong>{stats.emailHealthRate == null ? "No telemetry yet" : `${Number(stats.emailHealthRate).toFixed(1)}% healthy`}</strong>
            <small>Provider-backed events from the last 7 days</small>
            <b>Open delivery evidence →</b>
          </Link>
        </div>
      </section>
    </div>
  );
}
