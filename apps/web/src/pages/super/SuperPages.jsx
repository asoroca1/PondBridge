import { Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Badge, Button, Card, Input, Select } from "@pondbridge/ui";
import { useAuth } from "../../context/AuthContext.jsx";
import { requestJson } from "../../lib/http.js";

function roleFromUser(user) {
  const roles = new Set(user?.roles || []);
  if (roles.has("super_admin")) return "super_admin";
  if (roles.has("support_admin")) return "support_admin";
  if (roles.has("finance_admin")) return "finance_admin";
  return "unknown";
}

function canMutate(role) {
  return role === "super_admin";
}

function formatMoney(value = 0) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

function formatPct(value = 0, decimals = 1) {
  return `${Number(value || 0).toFixed(decimals)}%`;
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString();
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function formatDuration(seconds = 0) {
  const total = Number(seconds || 0);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  if (mins <= 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
}

function toneForStatus(status = "") {
  const key = String(status || "").toLowerCase();
  if (["active", "completed", "live", "delivered", "success"].includes(key)) return "success";
  if (["running", "trialing", "sent", "info"].includes(key)) return "info";
  if (["past_due", "failed", "bounced", "danger", "error"].includes(key)) return "danger";
  if (["queued", "pending", "warning", "partial", "trial"].includes(key)) return "warning";
  if (["comp", "beta"].includes(key)) return "purple";
  return "neutral";
}

function StatusBadge({ status, tone }) {
  const computedTone = tone || toneForStatus(status);
  return <span className={`super-status super-status-${computedTone}`}>{String(status || "").replace(/_/g, " ")}</span>;
}

function PanelHeader({ title, subtitle, actions }) {
  return (
    <header className="super-panel-header">
      <div>
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {actions ? <div className="super-panel-actions">{actions}</div> : null}
    </header>
  );
}

function StatCard({ label, value, subtext, tone = "neutral", onClick }) {
  const className = `super-stat-card tone-${tone} ${onClick ? "is-clickable" : ""}`.trim();
  if (onClick) {
    return (
      <button type="button" className={className} onClick={onClick}>
        <span>{label}</span>
        <strong>{value}</strong>
        {subtext ? <small>{subtext}</small> : null}
      </button>
    );
  }

  return (
    <article className={className}>
      <span>{label}</span>
      <strong>{value}</strong>
      {subtext ? <small>{subtext}</small> : null}
    </article>
  );
}

function SparkBars({ items = [], percent = false }) {
  const values = items.map((item) => Number(item.value || item.rate || 0));
  const max = Math.max(1, ...values);

  return (
    <div className="super-sparkbars" role="img" aria-label="trend chart">
      {items.map((item) => {
        const raw = Number(item.value ?? item.rate ?? 0);
        const height = Math.max(4, Math.round((raw / max) * 100));
        return (
          <div key={`${item.date || item.month || item.stage || Math.random()}`} className="super-sparkbar-wrap" title={`${item.date || item.month || ""} ${percent ? formatPct(raw) : raw}`}>
            <div className="super-sparkbar" style={{ height: `${height}%` }} />
            <small>{(item.date || item.month || item.stage || "").toString().slice(-2)}</small>
          </div>
        );
      })}
    </div>
  );
}

function HorizontalBars({ items = [], valueKey = "value", labelKey = "label", suffix = "" }) {
  const max = Math.max(1, ...items.map((item) => Number(item[valueKey] || 0)));

  return (
    <div className="super-horizontal-bars">
      {items.map((item) => {
        const value = Number(item[valueKey] || 0);
        const width = Math.max(2, Math.round((value / max) * 100));
        return (
          <div className="super-horizontal-row" key={`${item[labelKey]}_${value}`}>
            <p>{item[labelKey]}</p>
            <div className="super-horizontal-track">
              <span className="super-horizontal-fill" style={{ width: `${width}%` }} />
            </div>
            <strong>
              {value}
              {suffix}
            </strong>
          </div>
        );
      })}
    </div>
  );
}

function ExportCsvButton({ rows, headers, filename = "export.csv" }) {
  function exportCsv() {
    const lines = [headers.map((header) => header.label).join(",")];
    for (const row of rows) {
      const values = headers.map((header) => {
        const value = row[header.key];
        const serialized = value == null ? "" : String(value);
        return `"${serialized.replace(/"/g, '""')}"`;
      });
      lines.push(values.join(","));
    }
    const blob = new Blob([`${lines.join("\n")}\n`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Button variant="secondary" onClick={exportCsv}>
      Export CSV
    </Button>
  );
}

function LoadingBlock({ label = "Loading..." }) {
  return (
    <Card>
      <p className="muted">{label}</p>
    </Card>
  );
}

export function SuperPlatformPulsePage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function loadData() {
    try {
      setError("");
      const payload = await requestJson("/api/super/platform-pulse", { token });
      setData(payload);
    } catch (loadError) {
      setError(loadError.message || "Failed to load platform pulse.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    loadData();

    const id = window.setInterval(loadData, 60000);
    return () => window.clearInterval(id);
  }, [token]);

  if (loading && !data) return <LoadingBlock label="Loading platform pulse..." />;

  const stats = data?.stats || {};

  return (
    <div className="super-panel-stack">
      <Card>
        <PanelHeader
          title="Platform Pulse"
          subtitle={`Last updated: ${formatDateTime(data?.generatedAt)} · Auto-refreshes every 60s`}
          actions={<Button variant="secondary" onClick={loadData}>Refresh</Button>}
        />
        {error ? <p className="error-text">{error}</p> : null}

        <div className="super-stat-grid seven-up">
          <StatCard label="Active Tenants" value={stats.activeTenants ?? 0} subtext="Live camps" tone="success" />
          <StatCard
            label="MRR"
            value={formatMoney(stats.mrrCurrent || 0)}
            subtext={`${stats.mrrDeltaPercent >= 0 ? "+" : ""}${formatPct(stats.mrrDeltaPercent || 0)} vs last month`}
            tone={stats.mrrDeltaPercent >= 0 ? "success" : "danger"}
          />
          <StatCard
            label="Email Health"
            value={formatPct(stats.emailHealthRate || 0)}
            subtext="Delivery rate 7d"
            tone={stats.emailHealthRate > 95 ? "success" : stats.emailHealthRate >= 90 ? "warning" : "danger"}
          />
          <StatCard label="Open Jobs" value={stats.openJobs ?? 0} subtext="Running + queued" tone="info" />
          <StatCard
            label="Failed Jobs (7d)"
            value={stats.failedJobs7d ?? 0}
            subtext="Needs review"
            tone={stats.failedJobs7d > 0 ? "danger" : "success"}
          />
          <StatCard label="New Members (7d)" value={stats.newMembers7d ?? 0} subtext="Across all tenants" tone="neutral" />
          <StatCard
            label="Pending Approvals"
            value={stats.pendingApprovals ?? 0}
            subtext="Camps awaiting review"
            tone={stats.pendingApprovals > 0 ? "warning" : "neutral"}
          />
        </div>
      </Card>

      <div className="super-two-col super-three-split super-equal-height super-pulse-visual-row">
        <Card className="super-visual-card">
          <h2 className="pb-section-title">MRR Trend (7d)</h2>
          <SparkBars items={data?.charts?.mrr7d || []} />
        </Card>
        <Card className="super-visual-card">
          <h2 className="pb-section-title">Email Health (7d)</h2>
          <SparkBars items={data?.charts?.emailHealth7d || []} percent />
        </Card>
        <Card className="super-visual-card">
          <h2 className="pb-section-title">Alerts Feed</h2>
          <div className="super-alert-feed">
            {(data?.alerts || []).length ? (
              data.alerts.map((alert) => (
                <article key={alert.id} className={`super-alert-item tone-${alert.tone || "neutral"}`}>
                  <p>{alert.message}</p>
                  <small>{formatDateTime(alert.time)}</small>
                  <Link to={alert.href}>Open</Link>
                </article>
              ))
            ) : (
              <p className="muted">No critical alerts right now.</p>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

export function SuperTenantsPage() {
  const { token, user } = useAuth();
  const role = roleFromUser(user);

  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [claimLink, setClaimLink] = useState("");
  const [filters, setFilters] = useState({ search: "", status: "", plan: "", billingStatus: "" });
  const [form, setForm] = useState({
    name: "",
    slug: "",
    planTier: "base",
    onboardingFeeAmount: 0,
    directorEmail: ""
  });

  async function loadData() {
    const query = new URLSearchParams();
    if (filters.search.trim()) query.set("search", filters.search.trim());
    if (filters.status) query.set("status", filters.status);
    if (filters.plan) query.set("plan", filters.plan);
    if (filters.billingStatus) query.set("billingStatus", filters.billingStatus);

    try {
      setError("");
      const [dashboard, tenants] = await Promise.all([
        requestJson("/api/super/dashboard", { token }),
        requestJson(`/api/super/tenants${query.toString() ? `?${query.toString()}` : ""}`, { token })
      ]);
      setSummary(dashboard.counts);
      setItems(tenants.items || []);
    } catch (loadError) {
      setError(loadError.message || "Could not load tenants.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    loadData();
  }, [token, filters.search, filters.status, filters.plan, filters.billingStatus]);

  async function createCamp(event) {
    event.preventDefault();
    setError("");
    setStatus("");
    setClaimLink("");
    try {
      const payload = await requestJson("/api/super/tenants", {
        method: "POST",
        token,
        body: form
      });
      const nextClaimLink = payload.directorClaimLink || payload.directorInvite?.claimUrl || "";
      setClaimLink(nextClaimLink);
      setStatus(nextClaimLink ? `Created ${payload.tenant.name}. Director claim link is ready.` : `Created ${payload.tenant.name}.`);
      setForm({ name: "", slug: "", planTier: "base", onboardingFeeAmount: 0, directorEmail: "" });
      loadData();
    } catch (createError) {
      setError(createError.message || "Could not create camp.");
    }
  }

  async function copyClaim() {
    if (!claimLink) return;
    await navigator.clipboard.writeText(claimLink);
    setStatus("Claim link copied.");
  }

  async function toggleTenant(camp) {
    try {
      setStatus("");
      setError("");
      const nextStatus = camp.status === "active" ? "inactive" : "active";
      await requestJson(`/api/super/tenants/${camp._id}`, {
        method: "PATCH",
        token,
        body: { status: nextStatus }
      });
      setStatus(`${camp.name} is now ${nextStatus}.`);
      loadData();
    } catch (toggleError) {
      setError(toggleError.message || "Could not update tenant status.");
    }
  }

  return (
    <div className="super-panel-stack">
      <Card>
        <PanelHeader title="Tenants" subtitle="Create and manage camp tenants." />
        {loading ? <p className="muted">Loading tenant summary...</p> : null}
        {summary ? (
          <div className="super-stat-grid three-up">
            <StatCard label="Camps" value={summary.tenants || 0} subtext="Total tenant records" tone="neutral" />
            <StatCard label="Users" value={summary.users || 0} subtext="Across all camps" tone="neutral" />
            <StatCard label="Profiles" value={summary.profiles || 0} subtext="Member profiles" tone="neutral" />
          </div>
        ) : null}
        {error ? <p className="error-text">{error}</p> : null}
        {status ? <p className="success-text">{status}</p> : null}
        {claimLink ? (
          <div className="super-inline-row">
            <Input readOnly value={claimLink} />
            <Button variant="secondary" onClick={copyClaim}>
              Copy
            </Button>
          </div>
        ) : null}
      </Card>

      <div className="super-two-col super-align-start super-tenants-layout-row">
        <Card className="super-tenants-create-card">
          <h2 className="pb-section-title">Create Camp</h2>
          <form className="super-form-grid" onSubmit={createCamp}>
            <label>
              Camp name
              <Input value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} required />
            </label>
            <label>
              Camp URL key
              <Input
                value={form.slug}
                placeholder="cedar"
                onChange={(event) => setForm((prev) => ({ ...prev, slug: event.target.value }))}
                required
              />
            </label>
            <label>
              Plan tier
              <Select value={form.planTier} onChange={(event) => setForm((prev) => ({ ...prev, planTier: event.target.value }))}>
                <option value="base">Base</option>
                <option value="premium">Premium</option>
              </Select>
            </label>
            <label>
              Onboarding fee
              <Input
                type="number"
                min={0}
                value={form.onboardingFeeAmount}
                onChange={(event) => setForm((prev) => ({ ...prev, onboardingFeeAmount: Number(event.target.value || 0) }))}
              />
            </label>
            <label className="full-width">
              Director email (optional)
              <Input
                type="email"
                value={form.directorEmail}
                onChange={(event) => setForm((prev) => ({ ...prev, directorEmail: event.target.value }))}
              />
            </label>
            <div className="super-form-actions full-width">
              <Button disabled={!canMutate(role)}>Create camp</Button>
              {!canMutate(role) ? <small className="muted">View only role</small> : null}
            </div>
          </form>
        </Card>

        <Card className="super-tenants-filter-card">
          <h2 className="pb-section-title">Filters</h2>
          <div className="super-filter-grid super-filter-grid-tenants">
            <label>
              Search
              <Input value={filters.search} onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))} />
            </label>
            <label>
              Status
              <Select value={filters.status} onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}>
                <option value="">All</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </Select>
            </label>
            <label>
              Plan
              <Select value={filters.plan} onChange={(event) => setFilters((prev) => ({ ...prev, plan: event.target.value }))}>
                <option value="">All</option>
                <option value="base">Base</option>
                <option value="premium">Premium</option>
              </Select>
            </label>
            <label>
              Billing
              <Select
                value={filters.billingStatus}
                onChange={(event) => setFilters((prev) => ({ ...prev, billingStatus: event.target.value }))}
              >
                <option value="">All</option>
                <option value="trialing">Trialing</option>
                <option value="active">Active</option>
                <option value="past_due">Past Due</option>
                <option value="canceled">Canceled</option>
              </Select>
            </label>
          </div>
        </Card>
      </div>

      <Card>
        <h2 className="pb-section-title">Tenant List</h2>
        <div className="super-table-wrap">
          <table className="super-data-table">
            <thead>
              <tr>
                <th>Camp</th>
                <th>Slug</th>
                <th>Status</th>
                <th>Plan</th>
                <th>Users</th>
                <th>Profiles</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((camp) => (
                <tr key={camp._id}>
                  <td>{camp.name}</td>
                  <td>{camp.slug}</td>
                  <td>
                    <StatusBadge status={camp.status} />
                  </td>
                  <td>{camp.planTier === "premium" ? "Premium" : "Base"}</td>
                  <td>{camp.counts?.users || 0}</td>
                  <td>{camp.counts?.profiles || 0}</td>
                  <td>
                    <Button variant="secondary" onClick={() => toggleTenant(camp)} disabled={!canMutate(role)}>
                      {camp.status === "active" ? "Disable" : "Enable"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

export function SuperEmailTransactionalPage() {
  const { token, user } = useAuth();
  const role = roleFromUser(user);
  const [days, setDays] = useState(7);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [filters, setFilters] = useState({ tenant: "", emailType: "", status: "", search: "" });

  async function loadData() {
    try {
      setError("");
      const payload = await requestJson(`/api/super/email/transactional?days=${days}`, { token });
      setData(payload);
    } catch (loadError) {
      setError(loadError.message || "Could not load transactional email panel.");
    }
  }

  useEffect(() => {
    loadData();
  }, [token, days]);

  const rows = useMemo(() => {
    const source = data?.rows || [];
    return source.filter((row) => {
      const matchTenant = filters.tenant ? row.tenantName === filters.tenant : true;
      const matchType = filters.emailType ? row.emailType === filters.emailType : true;
      const matchStatus = filters.status ? row.status === filters.status : true;
      const matchSearch = filters.search
        ? row.messageId.toLowerCase().includes(filters.search.toLowerCase())
        : true;
      return matchTenant && matchType && matchStatus && matchSearch;
    });
  }, [data, filters]);

  const tenants = useMemo(() => Array.from(new Set((data?.rows || []).map((row) => row.tenantName))), [data]);

  async function retryRow(row) {
    try {
      setStatus("");
      await requestJson("/api/super/email/retry", {
        method: "POST",
        token,
        body: { inviteId: row.id }
      });
      setStatus(`Retry queued for ${row.recipientDomain}.`);
      loadData();
    } catch (retryError) {
      setError(retryError.message || "Could not queue retry.");
    }
  }

  return (
    <div className="super-panel-stack">
      <Card>
        <PanelHeader
          title="Transactional Email — Health"
          subtitle="Delivery health, bounce diagnostics, and retry controls."
          actions={
            <div className="super-inline-row">
              <Select value={days} onChange={(event) => setDays(Number(event.target.value || 7))}>
                <option value={7}>Last 7 days</option>
                <option value={14}>Last 14 days</option>
                <option value={30}>Last 30 days</option>
              </Select>
              <ExportCsvButton
                rows={rows}
                filename="transactional-email-log.csv"
                headers={[
                  { key: "timestamp", label: "Timestamp" },
                  { key: "tenantName", label: "Tenant" },
                  { key: "emailType", label: "Email Type" },
                  { key: "recipientDomain", label: "Recipient Domain" },
                  { key: "status", label: "Status" },
                  { key: "messageId", label: "Message ID" }
                ]}
              />
            </div>
          }
        />

        {error ? <p className="error-text">{error}</p> : null}
        {status ? <p className="success-text">{status}</p> : null}

        <div className="super-stat-grid four-up">
          <StatCard label="Delivery Rate" value={formatPct(data?.stats?.deliveryRate || 0)} subtext="Last period" tone="success" />
          <StatCard
            label="Bounce Rate"
            value={formatPct(data?.stats?.bounceRate || 0)}
            subtext="Warn if >2%"
            tone={(data?.stats?.bounceRate || 0) > 2 ? "danger" : "warning"}
          />
          <StatCard
            label="Spam Rate"
            value={formatPct(data?.stats?.spamRate || 0, 2)}
            subtext="Last 30d"
            tone={(data?.stats?.spamRate || 0) > 0.1 ? "danger" : "neutral"}
          />
          <StatCard label="Total Sent" value={data?.stats?.totalSent || 0} subtext="Across all tenants" tone="neutral" />
        </div>
      </Card>

      <div className="super-two-col super-equal-height super-visuals-row">
        <Card className="super-visual-card">
          <h2 className="pb-section-title">Delivery Rate — 7d</h2>
          <SparkBars items={data?.charts?.deliverySeries || []} percent />
        </Card>
        <Card className="super-visual-card">
          <h2 className="pb-section-title">Bounce Rate — 7d</h2>
          <SparkBars items={data?.charts?.bounceSeries || []} percent />
        </Card>
      </div>

      <div className="super-two-col super-equal-height super-visuals-row">
        <Card className="super-visual-card">
          <h2 className="pb-section-title">Top Bouncing Domains</h2>
          {(data?.topBouncingDomains || []).length ? (
            <table className="super-data-table compact">
              <thead>
                <tr>
                  <th>Domain</th>
                  <th>Bounces</th>
                  <th>Rate</th>
                </tr>
              </thead>
              <tbody>
                {data.topBouncingDomains.map((row) => (
                  <tr key={row.domain}>
                    <td>{row.domain}</td>
                    <td>{row.bounces}</td>
                    <td>{formatPct(row.rate || 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">No bounce issues detected.</p>
          )}
        </Card>
        <Card className="super-visual-card">
          <h2 className="pb-section-title">Volume by Tenant</h2>
          <HorizontalBars items={(data?.charts?.volumeByTenant || []).map((item) => ({ label: item.tenantName, value: item.sent }))} />
        </Card>
      </div>

      <Card className="super-filter-table-card">
        <div className="super-filter-grid super-filter-grid-email">
          <label>
            Tenant
            <Select value={filters.tenant} onChange={(event) => setFilters((prev) => ({ ...prev, tenant: event.target.value }))}>
              <option value="">All</option>
              {tenants.map((tenant) => (
                <option key={tenant} value={tenant}>
                  {tenant}
                </option>
              ))}
            </Select>
          </label>
          <label>
            Email type
            <Select
              value={filters.emailType}
              onChange={(event) => setFilters((prev) => ({ ...prev, emailType: event.target.value }))}
            >
              <option value="">All</option>
              <option value="director_invite">Director invite</option>
              <option value="member_invite">Member invite</option>
            </Select>
          </label>
          <label>
            Status
            <Select value={filters.status} onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}>
              <option value="">All</option>
              <option value="sent">Sent</option>
              <option value="delivered">Delivered</option>
              <option value="bounced">Bounced</option>
            </Select>
          </label>
          <label>
            Search message ID
            <Input value={filters.search} onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))} />
          </label>
        </div>

        <div className="super-table-wrap">
          <table className="super-data-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Tenant</th>
                <th>Email Type</th>
                <th>Recipient Domain</th>
                <th>Status</th>
                <th>Message ID</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{formatDateTime(row.timestamp)}</td>
                  <td>{row.tenantName}</td>
                  <td>{row.emailType}</td>
                  <td>{row.recipientDomain}</td>
                  <td>
                    <StatusBadge status={row.status} tone={row.statusTone} />
                  </td>
                  <td className="mono">{row.messageId}</td>
                  <td>
                    {row.canRetry && canMutate(role) ? (
                      <Button variant="secondary" onClick={() => retryRow(row)}>
                        Retry
                      </Button>
                    ) : (
                      <span className="muted">-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

export function SuperEmailBroadcastPage() {
  const { token, user } = useAuth();
  const role = roleFromUser(user);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [contactForm, setContactForm] = useState({ email: "", campName: "", tier: "base", stage: "Invited" });
  const [suppressEmail, setSuppressEmail] = useState("");

  async function loadData() {
    try {
      setError("");
      const payload = await requestJson("/api/super/email/broadcast", { token });
      setData(payload);
    } catch (loadError) {
      setError(loadError.message || "Could not load broadcast panel.");
    }
  }

  useEffect(() => {
    loadData();
  }, [token]);

  async function addContact(event) {
    event.preventDefault();
    try {
      setStatus("");
      await requestJson("/api/super/email/broadcast/contact", {
        method: "POST",
        token,
        body: contactForm
      });
      setStatus("Director contact queued for sync.");
      setContactForm({ email: "", campName: "", tier: "base", stage: "Invited" });
    } catch (requestError) {
      setError(requestError.message || "Could not queue contact.");
    }
  }

  async function suppressContact(event) {
    event.preventDefault();
    try {
      setStatus("");
      await requestJson("/api/super/email/broadcast/suppress", {
        method: "POST",
        token,
        body: { email: suppressEmail }
      });
      setStatus("Suppress request queued.");
      setSuppressEmail("");
    } catch (requestError) {
      setError(requestError.message || "Could not queue suppression.");
    }
  }

  return (
    <div className="super-panel-stack">
      <Card>
        <PanelHeader
          title="Broadcast & Lifecycle Email — Loops"
          subtitle="Manage director lifecycle sequences and contact health."
          actions={
            <a className="link-button secondary" href="https://loops.so" target="_blank" rel="noreferrer">
              Open in Loops
            </a>
          }
        />
        {error ? <p className="error-text">{error}</p> : null}
        {status ? <p className="success-text">{status}</p> : null}
        <div className="super-stat-grid four-up">
          <StatCard label="Total Contacts" value={data?.contacts?.total || 0} subtext="In Loops" />
          <StatCard label="Subscribed" value={data?.contacts?.subscribed || 0} subtext="Active" tone="success" />
          <StatCard label="Unsubscribed" value={data?.contacts?.unsubscribed || 0} subtext="Last 30d" tone="warning" />
          <StatCard label="Bounced" value={data?.contacts?.bounced || 0} subtext="Hard bounces" tone="danger" />
        </div>
      </Card>

      <Card>
        <h2 className="pb-section-title">Active Sequences</h2>
        <div className="super-table-wrap">
          <table className="super-data-table">
            <thead>
              <tr>
                <th>Sequence</th>
                <th>Enrolled</th>
                <th>Open Rate</th>
                <th>Click Rate</th>
                <th>Unsubscribes</th>
                <th>Last Send</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {(data?.sequences || []).map((sequence) => (
                <tr key={sequence.id}>
                  <td>{sequence.name}</td>
                  <td>{sequence.enrolled}</td>
                  <td>
                    <StatusBadge
                      status={formatPct(sequence.openRate)}
                      tone={sequence.openRate > 30 ? "success" : sequence.openRate >= 15 ? "warning" : "danger"}
                    />
                  </td>
                  <td>{formatPct(sequence.clickRate)}</td>
                  <td>{sequence.unsubscribes}</td>
                  <td>{formatDateTime(sequence.lastSendAt)}</td>
                  <td>
                    <a href={sequence.externalUrl} target="_blank" rel="noreferrer" className="super-inline-link">
                      View in Loops
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="super-two-col">
        <Card>
          <h2 className="pb-section-title">Contacts by Onboarding Stage</h2>
          <HorizontalBars
            items={(data?.contactsByStage || []).map((item) => ({ label: item.stage, value: item.count }))}
          />
        </Card>
        <Card>
          <h2 className="pb-section-title">Quick Actions</h2>
          <form className="super-form-grid" onSubmit={addContact}>
            <label>
              Director email
              <Input
                type="email"
                value={contactForm.email}
                onChange={(event) => setContactForm((prev) => ({ ...prev, email: event.target.value }))}
                required
                disabled={!canMutate(role)}
              />
            </label>
            <label>
              Camp name
              <Input
                value={contactForm.campName}
                onChange={(event) => setContactForm((prev) => ({ ...prev, campName: event.target.value }))}
                required
                disabled={!canMutate(role)}
              />
            </label>
            <label>
              Tier
              <Select
                value={contactForm.tier}
                onChange={(event) => setContactForm((prev) => ({ ...prev, tier: event.target.value }))}
                disabled={!canMutate(role)}
              >
                <option value="base">Base</option>
                <option value="premium">Premium</option>
              </Select>
            </label>
            <label>
              Stage
              <Select
                value={contactForm.stage}
                onChange={(event) => setContactForm((prev) => ({ ...prev, stage: event.target.value }))}
                disabled={!canMutate(role)}
              >
                <option>Invited</option>
                <option>Account Created</option>
                <option>Branding Done</option>
                <option>Features Done</option>
                <option>Launched</option>
              </Select>
            </label>
            <div className="super-form-actions full-width">
              <Button disabled={!canMutate(role)}>+ Add Director Contact</Button>
            </div>
          </form>

          <form className="super-form-grid top-space" onSubmit={suppressContact}>
            <label>
              Suppress contact email
              <Input
                type="email"
                value={suppressEmail}
                onChange={(event) => setSuppressEmail(event.target.value)}
                disabled={!canMutate(role)}
                required
              />
            </label>
            <div className="super-form-actions full-width">
              <Button variant="secondary" disabled={!canMutate(role)}>
                Suppress Contact
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}

export function SuperBillingOverviewPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  async function loadData() {
    try {
      setError("");
      const payload = await requestJson("/api/super/billing/overview", { token });
      setData(payload);
    } catch (loadError) {
      setError(loadError.message || "Could not load billing overview.");
    }
  }

  useEffect(() => {
    loadData();
  }, [token]);

  return (
    <div className="super-panel-stack">
      <Card>
        <PanelHeader
          title="Billing Overview"
          subtitle="Revenue, plan mix, and payment health from Stripe-synced billing state."
          actions={<ExportCsvButton rows={data?.charts?.mrrTrend60d || []} headers={[{ key: "date", label: "Date" }, { key: "value", label: "MRR" }]} filename="billing-mrr-trend.csv" />}
        />
        {error ? <p className="error-text">{error}</p> : null}

        <div className="super-stat-grid four-up">
          <StatCard label="MRR" value={formatMoney(data?.stats?.mrr || 0)} subtext={`${formatPct(data?.stats?.mrrDeltaPercent || 0)} vs last month`} tone="success" />
          <StatCard label="New Subs (30d)" value={data?.stats?.newSubscriptions30d || 0} subtext="New paying tenants" tone="info" />
          <StatCard
            label="Churned (30d)"
            value={data?.stats?.churned30d || 0}
            subtext={`${formatMoney(data?.stats?.churnedMrrLost30d || 0)} MRR lost`}
            tone="warning"
          />
          <StatCard
            label="Failed Payments"
            value={data?.stats?.failedPayments || 0}
            subtext="Unresolved"
            tone={(data?.stats?.failedPayments || 0) > 0 ? "danger" : "success"}
          />
        </div>
      </Card>

      <div className="super-two-col super-equal-height super-visuals-row">
        <Card className="super-visual-card">
          <h2 className="pb-section-title">MRR Trend — 60d</h2>
          <SparkBars items={data?.charts?.mrrTrend60d || []} />
        </Card>
        <Card className="super-visual-card">
          <h2 className="pb-section-title">Plan Distribution</h2>
          <HorizontalBars
            items={[
              { label: "Base", value: data?.charts?.planDistribution?.base || 0 },
              { label: "Premium", value: data?.charts?.planDistribution?.premium || 0 },
              { label: "Trial", value: data?.charts?.planDistribution?.trial || 0 },
              { label: "Comp", value: data?.charts?.planDistribution?.comp || 0 }
            ]}
          />
        </Card>
      </div>
    </div>
  );
}

export function SuperBillingTenantsPage() {
  const { token, user } = useAuth();
  const role = roleFromUser(user);
  const [filters, setFilters] = useState({ search: "", plan: "", status: "", paymentMethod: "" });
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], total: 0, page: 1, pageSize: 25 });
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [selected, setSelected] = useState(null);

  async function loadData() {
    const query = new URLSearchParams({ page: String(page), pageSize: "25" });
    if (filters.search.trim()) query.set("search", filters.search.trim());
    if (filters.plan) query.set("plan", filters.plan);
    if (filters.status) query.set("status", filters.status);
    if (filters.paymentMethod) query.set("paymentMethod", filters.paymentMethod);

    try {
      setError("");
      const payload = await requestJson(`/api/super/billing/tenants?${query.toString()}`, { token });
      setData(payload);
    } catch (loadError) {
      setError(loadError.message || "Could not load tenant billing table.");
    }
  }

  useEffect(() => {
    loadData();
  }, [token, filters.search, filters.plan, filters.status, filters.paymentMethod, page]);

  async function runAction(action, extra = {}) {
    if (!selected) return;
    try {
      setError("");
      await requestJson(`/api/super/billing/tenants/${selected.id}/actions`, {
        method: "POST",
        token,
        body: { action, ...extra }
      });
      setStatusMessage("Billing action saved.");
      loadData();
      setSelected((prev) => ({ ...prev, ...extra }));
    } catch (actionError) {
      setError(actionError.message || "Billing action failed.");
    }
  }

  return (
    <div className="super-panel-stack">
      <Card>
        <PanelHeader title="Tenant Billing" subtitle="Plan, status, and payment health by tenant." />
        {error ? <p className="error-text">{error}</p> : null}
        {statusMessage ? <p className="success-text">{statusMessage}</p> : null}

        <div className="super-filter-grid super-filter-grid-billing">
          <label>
            Search camp
            <Input value={filters.search} onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))} />
          </label>
          <label>
            Plan tier
            <Select value={filters.plan} onChange={(event) => setFilters((prev) => ({ ...prev, plan: event.target.value }))}>
              <option value="">All</option>
              <option value="base">Base</option>
              <option value="premium">Premium</option>
            </Select>
          </label>
          <label>
            Billing status
            <Select value={filters.status} onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}>
              <option value="">All</option>
              <option value="active">Active</option>
              <option value="past_due">Past due</option>
              <option value="trialing">Trialing</option>
              <option value="canceled">Canceled</option>
              <option value="comp">Comp</option>
            </Select>
          </label>
          <label>
            Payment method
            <Select
              value={filters.paymentMethod}
              onChange={(event) => setFilters((prev) => ({ ...prev, paymentMethod: event.target.value }))}
            >
              <option value="">All</option>
              <option value="ok">Card on file</option>
              <option value="issue">Card issue</option>
              <option value="no_card">No card</option>
            </Select>
          </label>
        </div>

        <div className="super-table-wrap">
          <table className="super-data-table">
            <thead>
              <tr>
                <th>Camp</th>
                <th>Plan</th>
                <th>Status</th>
                <th>MRR</th>
                <th>Next Renewal</th>
                <th>Payment Method</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((row) => (
                <tr key={row.id} onClick={() => setSelected(row)} className={selected?.id === row.id ? "is-selected" : ""}>
                  <td>{row.name}</td>
                  <td>{row.planTier === "premium" ? "Premium" : "Base"}</td>
                  <td>
                    <StatusBadge status={row.billingStatus} />
                  </td>
                  <td>{formatMoney(row.mrr)}</td>
                  <td>{formatDate(row.nextRenewal)}</td>
                  <td>{row.paymentMethodLabel}</td>
                  <td>
                    <Button variant="secondary" onClick={(event) => {
                      event.stopPropagation();
                      setSelected(row);
                    }}>
                      View
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="super-pagination">
          <small>
            Showing {(data.page - 1) * data.pageSize + 1}–{Math.min(data.page * data.pageSize, data.total)} of {data.total}
          </small>
          <div className="super-inline-row">
            <Button variant="secondary" onClick={() => setPage((prev) => Math.max(1, prev - 1))} disabled={data.page <= 1}>
              Prev
            </Button>
            <Badge tone="neutral">Page {data.page}</Badge>
            <Button
              variant="secondary"
              onClick={() => setPage((prev) => prev + 1)}
              disabled={data.page * data.pageSize >= data.total}
            >
              Next
            </Button>
          </div>
        </div>
      </Card>

      {selected ? (
        <div className="super-sidepanel-overlay" onClick={() => setSelected(null)}>
          <aside className="super-sidepanel" onClick={(event) => event.stopPropagation()}>
            <header className="super-sidepanel-head">
              <div>
                <h2>{selected.name}</h2>
                <StatusBadge status={selected.billingStatus} />
              </div>
              <button type="button" className="super-sidepanel-close" onClick={() => setSelected(null)}>
                ×
              </button>
            </header>

            <section>
              <h3>Plan Summary</h3>
              <p>
                <strong>Plan:</strong> {selected.planTier === "premium" ? "Premium" : "Base"}
              </p>
              <p>
                <strong>MRR:</strong> {formatMoney(selected.mrr)}
              </p>
              <p>
                <strong>Next Renewal:</strong> {formatDate(selected.nextRenewal)}
              </p>
            </section>

            <section>
              <h3>Payment Method</h3>
              <p>{selected.paymentMethodLabel}</p>
              {selected.stripeCustomerId ? (
                <a href={`https://dashboard.stripe.com/customers/${selected.stripeCustomerId}`} target="_blank" rel="noreferrer">
                  View in Stripe
                </a>
              ) : null}
            </section>

            <section>
              <h3>Actions</h3>
              {canMutate(role) ? (
                <div className="super-panel-actions-vertical">
                  <div className="super-inline-row">
                    <Button variant="secondary" onClick={() => runAction("change_plan", { planTier: "base" })}>
                      Set Base
                    </Button>
                    <Button variant="secondary" onClick={() => runAction("change_plan", { planTier: "premium" })}>
                      Set Premium
                    </Button>
                  </div>
                  <Button variant="secondary" onClick={() => runAction("extend_trial")}>Extend Trial</Button>
                  <Button variant="secondary" onClick={() => runAction("mark_comp")}>Mark as Comp</Button>
                  <Button variant="danger" onClick={() => runAction("cancel_subscription")}>Cancel Subscription</Button>
                </div>
              ) : (
                <p className="muted">View only role. Mutations are disabled.</p>
              )}
            </section>
          </aside>
        </div>
      ) : null}
    </div>
  );
}

export function SuperBillingFailedPage() {
  const { token, user } = useAuth();
  const role = roleFromUser(user);
  const [data, setData] = useState({ items: [], count: 0 });
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  async function loadData() {
    try {
      setError("");
      const payload = await requestJson("/api/super/billing/failed", { token });
      setData(payload);
    } catch (loadError) {
      setError(loadError.message || "Could not load failed payments.");
    }
  }

  useEffect(() => {
    loadData();
    const id = window.setInterval(loadData, 30000);
    return () => window.clearInterval(id);
  }, [token]);

  async function rowAction(path, body = {}) {
    try {
      setStatus("");
      await requestJson(path, { method: "POST", token, body });
      setStatus("Action completed.");
      loadData();
    } catch (actionError) {
      setError(actionError.message || "Action failed.");
    }
  }

  return (
    <div className="super-panel-stack">
      <Card>
        <PanelHeader title="Failed Payments" subtitle="Priority queue for unresolved payment issues." />
        {data.count > 0 ? <p className="super-critical-banner">{data.count} tenants have payment issues requiring attention.</p> : null}
        {error ? <p className="error-text">{error}</p> : null}
        {status ? <p className="success-text">{status}</p> : null}

        <div className="super-table-wrap">
          <table className="super-data-table">
            <thead>
              <tr>
                <th>Camp</th>
                <th>Days Overdue</th>
                <th>Plan</th>
                <th>Amount Due</th>
                <th>Last Attempt</th>
                <th>Decline Reason</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((row) => (
                <tr key={row.id}>
                  <td>{row.name}</td>
                  <td>{row.daysOverdue}</td>
                  <td>{row.planTier === "premium" ? "Premium" : "Base"}</td>
                  <td>{formatMoney(row.amountDue)}</td>
                  <td>{formatDateTime(row.lastAttempt)}</td>
                  <td>{row.declineReason}</td>
                  <td>
                    {canMutate(role) ? (
                      <div className="super-inline-row wrap">
                        <Button variant="secondary" onClick={() => rowAction(`/api/super/billing/failed/${row.id}/retry`)}>
                          Retry
                        </Button>
                        <Button variant="secondary" onClick={() => rowAction(`/api/super/billing/failed/${row.id}/reminder`)}>
                          Reminder
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => {
                            const days = Number(window.prompt("Extend grace period by how many days?", "7") || 7);
                            if (!Number.isFinite(days) || days <= 0) return;
                            rowAction(`/api/super/billing/failed/${row.id}/grace`, { days });
                          }}
                        >
                          Grace
                        </Button>
                      </div>
                    ) : (
                      <span className="muted">View only</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!data.count ? <p className="success-text">No failed payments. All tenants are up to date.</p> : null}
      </Card>
    </div>
  );
}

export function SuperAnalyticsEngagementPage() {
  const { token, user } = useAuth();
  const role = roleFromUser(user);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  async function loadData() {
    try {
      setError("");
      const payload = await requestJson("/api/super/analytics/engagement", { token });
      setData(payload);
    } catch (loadError) {
      setError(loadError.message || "Could not load engagement analytics.");
    }
  }

  useEffect(() => {
    loadData();
  }, [token]);

  async function sendReengage(tenantId) {
    try {
      setStatus("");
      await requestJson(`/api/super/analytics/reengage/${tenantId}`, {
        method: "POST",
        token
      });
      setStatus("Re-engagement email sequence queued.");
    } catch (requestError) {
      setError(requestError.message || "Could not queue re-engagement email.");
    }
  }

  return (
    <div className="super-panel-stack">
      <Card>
        <PanelHeader
          title="Platform Engagement"
          subtitle={`Analytics data as of ${formatDateTime(data?.asOf)}`}
          actions={
            <a className="link-button secondary" href="https://posthog.com" target="_blank" rel="noreferrer">
              Open in PostHog
            </a>
          }
        />
        {error ? <p className="error-text">{error}</p> : null}
        {status ? <p className="success-text">{status}</p> : null}

        <div className="super-stat-grid four-up">
          <StatCard label="Active Users (7d)" value={data?.stats?.activeUsers7d || 0} subtext="Unique logins" tone="success" />
          <StatCard
            label="DAU / MAU"
            value={formatPct(data?.stats?.dauMauRatio || 0)}
            subtext="Engagement depth"
            tone={(data?.stats?.dauMauRatio || 0) >= 20 ? "success" : "warning"}
          />
          <StatCard
            label="Profile Completion"
            value={formatPct(data?.stats?.profileCompletion || 0)}
            subtext="Average across tenants"
            tone="info"
          />
          <StatCard
            label="Inactive Tenants"
            value={data?.stats?.inactiveTenants || 0}
            subtext="No activity in 30d"
            tone={(data?.stats?.inactiveTenants || 0) > 0 ? "warning" : "success"}
          />
        </div>
      </Card>

      <div className="super-two-col">
        <Card>
          <h2 className="pb-section-title">New Signups — 7d</h2>
          <SparkBars items={data?.charts?.signups7d || []} />
        </Card>
        <Card>
          <h2 className="pb-section-title">Top Active Tenants</h2>
          <HorizontalBars items={(data?.charts?.topActiveTenants || []).map((item) => ({ label: item.name, value: item.activeUsers }))} />
        </Card>
      </div>

      <Card>
        <h2 className="pb-section-title">Inactive Tenants (30d)</h2>
        <div className="super-table-wrap">
          <table className="super-data-table">
            <thead>
              <tr>
                <th>Camp</th>
                <th>Last Login</th>
                <th>Members</th>
                <th>Plan</th>
                <th>Days Inactive</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {(data?.inactiveTenants || []).map((row) => (
                <tr key={row.tenantId}>
                  <td>{row.name}</td>
                  <td>{formatDate(row.lastLoginAt)}</td>
                  <td>{row.members}</td>
                  <td>{row.planTier === "premium" ? "Premium" : "Base"}</td>
                  <td>{row.daysInactive}</td>
                  <td>
                    {canMutate(role) ? (
                      <Button variant="secondary" onClick={() => sendReengage(row.tenantId)}>
                        Send Re-engagement
                      </Button>
                    ) : (
                      <span className="muted">View only</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

export function SuperAnalyticsFunnelPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  async function loadData() {
    try {
      setError("");
      const payload = await requestJson("/api/super/analytics/funnel", { token });
      setData(payload);
    } catch (loadError) {
      setError(loadError.message || "Could not load onboarding funnel.");
    }
  }

  useEffect(() => {
    loadData();
  }, [token]);

  return (
    <div className="super-panel-stack">
      <Card>
        <PanelHeader title="Director Onboarding Funnel" subtitle="Completion and drop-off across onboarding stages." />
        {error ? <p className="error-text">{error}</p> : null}

        <div className="super-funnel-wrap">
          {(data?.funnel || []).map((step) => (
            <article key={step.id} className={`super-funnel-step ${data?.biggestDropoff === step.id ? "is-highlight" : ""}`}>
              <h3>{step.label}</h3>
              <strong>{step.count}</strong>
              <p>{formatPct(step.percentOfStart || 0)} of baseline</p>
              {step.dropOffPercent !== 0 ? <small>Drop-off: {formatPct(Math.abs(step.dropOffPercent || 0))}</small> : null}
            </article>
          ))}
        </div>
      </Card>

      <div className="super-two-col">
        <Card>
          <h2 className="pb-section-title">Median Time to Launch</h2>
          <p className="super-kpi-big">{data?.medianTimeToLaunch == null ? "—" : `${data.medianTimeToLaunch} days`}</p>
          <p className="muted">Target: &lt; 7 days</p>
        </Card>
        <Card>
          <h2 className="pb-section-title">Completion Trend by Cohort</h2>
          <SparkBars items={(data?.completionTrend || []).map((point) => ({ month: point.month, value: point.rate }))} percent />
        </Card>
      </div>

      <Card>
        <h2 className="pb-section-title">Stuck Tenants (&gt;{data?.stuckThresholdDays || 7} days)</h2>
        <div className="super-table-wrap">
          <table className="super-data-table">
            <thead>
              <tr>
                <th>Camp</th>
                <th>Last Step</th>
                <th>Days Since Last Step</th>
                <th>Director Email</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {(data?.stuckTenants || []).map((row) => (
                <tr key={row.tenantId}>
                  <td>{row.campName}</td>
                  <td>{row.lastStepCompleted}</td>
                  <td>{row.daysSinceLastStep}</td>
                  <td>{row.directorEmail || "-"}</td>
                  <td>
                    <div className="super-inline-row wrap">
                      {row.directorEmail ? (
                        <a className="super-inline-link" href={`mailto:${row.directorEmail}`}>
                          Email Director
                        </a>
                      ) : null}
                      <Link className="super-inline-link" to={`/t/${row.slug}/onboarding`}>
                        View Onboarding
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

export function SuperAnalyticsFlagsPage() {
  const { token, user } = useAuth();
  const role = roleFromUser(user);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [editingFlags, setEditingFlags] = useState({});

  async function loadData() {
    try {
      setError("");
      const payload = await requestJson("/api/super/analytics/flags", { token });
      setData(payload);
      setEditingFlags(
        Object.fromEntries((payload.flags || []).map((flag) => [flag.key, { ...flag }]))
      );
    } catch (loadError) {
      setError(loadError.message || "Could not load feature flags.");
    }
  }

  useEffect(() => {
    loadData();
  }, [token]);

  function patchLocalFlag(key, patch) {
    setEditingFlags((prev) => ({
      ...prev,
      [key]: { ...prev[key], ...patch }
    }));
  }

  async function saveFlag(key) {
    try {
      setStatus("");
      const payload = editingFlags[key];
      await requestJson(`/api/super/analytics/flags/${key}`, {
        method: "PATCH",
        token,
        body: {
          enabled: payload.enabled,
          rolloutPercent: Number(payload.rolloutPercent || 0),
          tierConfig: payload.tierConfig
        }
      });
      setStatus(`Saved ${payload.name}.`);
      loadData();
    } catch (saveError) {
      setError(saveError.message || "Could not save flag.");
    }
  }

  return (
    <div className="super-panel-stack">
      <Card>
        <PanelHeader
          title="Feature Flags & Module Control"
          subtitle="Control module access by tier and rollout percentage."
          actions={
            <a className="link-button secondary" href="https://posthog.com" target="_blank" rel="noreferrer">
              Open in PostHog
            </a>
          }
        />
        {error ? <p className="error-text">{error}</p> : null}
        {status ? <p className="success-text">{status}</p> : null}
      </Card>

      <Card>
        <h2 className="pb-section-title">Module Adoption</h2>
        <div className="super-table-wrap">
          <table className="super-data-table">
            <thead>
              <tr>
                <th>Module</th>
                <th>Enabled Tenants</th>
                <th>Actively Used (30d)</th>
                <th>Adoption %</th>
              </tr>
            </thead>
            <tbody>
              {(data?.moduleAdoption || []).map((row) => (
                <tr key={row.moduleKey}>
                  <td>{row.moduleName}</td>
                  <td>{row.enabledTenants}</td>
                  <td>{row.activelyUsedTenants}</td>
                  <td>
                    <StatusBadge
                      status={formatPct(row.adoptionPercent || 0)}
                      tone={row.adoptionPercent > 60 ? "success" : row.adoptionPercent >= 30 ? "warning" : "danger"}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <h2 className="pb-section-title">Flag Configurations</h2>
        <div className="super-flag-grid">
          {Object.values(editingFlags).map((flag) => (
            <article key={flag.key} className="super-flag-card">
              <h3>{flag.name}</h3>
              <p className="muted">{flag.description}</p>
              <label>
                Global toggle
                <Select
                  value={flag.enabled ? "enabled" : "disabled"}
                  onChange={(event) => patchLocalFlag(flag.key, { enabled: event.target.value === "enabled" })}
                  disabled={!canMutate(role)}
                >
                  <option value="enabled">Enabled</option>
                  <option value="disabled">Disabled</option>
                </Select>
              </label>
              <label>
                Rollout %
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={flag.rolloutPercent}
                  onChange={(event) => patchLocalFlag(flag.key, { rolloutPercent: Number(event.target.value || 0) })}
                  disabled={!canMutate(role)}
                />
              </label>
              <div className="super-inline-row wrap">
                <label className="super-inline-check">
                  <input
                    type="checkbox"
                    checked={Boolean(flag?.tierConfig?.base)}
                    onChange={(event) =>
                      patchLocalFlag(flag.key, { tierConfig: { ...flag.tierConfig, base: event.target.checked } })
                    }
                    disabled={!canMutate(role)}
                  />
                  Base tier
                </label>
                <label className="super-inline-check">
                  <input
                    type="checkbox"
                    checked={Boolean(flag?.tierConfig?.premium)}
                    onChange={(event) =>
                      patchLocalFlag(flag.key, { tierConfig: { ...flag.tierConfig, premium: event.target.checked } })
                    }
                    disabled={!canMutate(role)}
                  />
                  Premium tier
                </label>
              </div>
              <Button variant="secondary" onClick={() => saveFlag(flag.key)} disabled={!canMutate(role)}>
                Save Changes
              </Button>
            </article>
          ))}
        </div>
      </Card>
    </div>
  );
}

export function SuperJobsHealthPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);

  async function loadData() {
    try {
      setError("");
      const payload = await requestJson("/api/super/jobs/health", { token });
      setData(payload);
    } catch (loadError) {
      setError(loadError.message || "Could not load job health.");
    }
  }

  useEffect(() => {
    loadData();
  }, [token]);

  useEffect(() => {
    if (!autoRefresh) return undefined;
    const id = window.setInterval(loadData, 30000);
    return () => window.clearInterval(id);
  }, [autoRefresh, token]);

  return (
    <div className="super-panel-stack">
      <Card>
        <PanelHeader
          title="Job Health"
          subtitle="Real-time monitoring for background jobs and imports."
          actions={
            <div className="super-inline-row">
              <label className="super-inline-check">
                <input type="checkbox" checked={autoRefresh} onChange={(event) => setAutoRefresh(event.target.checked)} />
                Auto-refresh
              </label>
              <a className="link-button secondary" href="https://trigger.dev" target="_blank" rel="noreferrer">
                Open in Trigger.dev
              </a>
            </div>
          }
        />
        {data?.banner ? <p className="super-warning-banner">{data.banner}</p> : null}
        {error ? <p className="error-text">{error}</p> : null}

        <div className="super-stat-grid four-up">
          <StatCard label="Running" value={data?.queue?.running || 0} subtext="Active now" tone="info" />
          <StatCard label="Queued" value={data?.queue?.queued || 0} subtext="Waiting" tone="warning" />
          <StatCard label="Completed (24h)" value={data?.queue?.completed24h || 0} subtext="Successful" tone="success" />
          <StatCard
            label="Failed (24h)"
            value={data?.queue?.failed24h || 0}
            subtext="Requires review"
            tone={(data?.queue?.failed24h || 0) > 0 ? "danger" : "success"}
          />
        </div>
      </Card>

      <div className="super-two-col">
        <Card>
          <h2 className="pb-section-title">Failure Rate — 7d</h2>
          <SparkBars items={data?.failureRate7d || []} percent />
        </Card>
        <Card>
          <h2 className="pb-section-title">Job Types — 7d</h2>
          <HorizontalBars
            items={(data?.jobTypeBreakdown || []).map((row) => ({ label: row.type, value: row.count }))}
          />
        </Card>
      </div>
    </div>
  );
}

export function SuperJobsLogPage() {
  const { token, user } = useAuth();
  const role = roleFromUser(user);
  const [data, setData] = useState({ items: [] });
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [filters, setFilters] = useState({ status: "", search: "" });
  const [expandedRunId, setExpandedRunId] = useState("");

  async function loadData() {
    const query = new URLSearchParams();
    if (filters.status) query.set("status", filters.status);
    if (filters.search.trim()) query.set("search", filters.search.trim());
    try {
      setError("");
      const payload = await requestJson(`/api/super/jobs/log${query.toString() ? `?${query.toString()}` : ""}`, { token });
      setData(payload);
    } catch (loadError) {
      setError(loadError.message || "Could not load job log.");
    }
  }

  useEffect(() => {
    loadData();
  }, [token, filters.status, filters.search]);

  async function runAction(path, okMessage) {
    try {
      setStatus("");
      await requestJson(path, { method: "POST", token });
      setStatus(okMessage);
      loadData();
    } catch (actionError) {
      setError(actionError.message || "Action failed.");
    }
  }

  return (
    <div className="super-panel-stack">
      <Card>
        <PanelHeader
          title="Job Log"
          subtitle="Cross-tenant job history with payload and progress details."
          actions={
            <ExportCsvButton
              rows={data.items || []}
              filename="jobs-log.csv"
              headers={[
                { key: "timestamp", label: "Timestamp" },
                { key: "tenantName", label: "Tenant" },
                { key: "jobType", label: "Job Type" },
                { key: "status", label: "Status" },
                { key: "durationSeconds", label: "Duration (sec)" },
                { key: "triggeredBy", label: "Triggered By" },
                { key: "runId", label: "Run ID" }
              ]}
            />
          }
        />
        {error ? <p className="error-text">{error}</p> : null}
        {status ? <p className="success-text">{status}</p> : null}

        <div className="super-filter-grid">
          <label>
            Status
            <Select value={filters.status} onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}>
              <option value="">All</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
            </Select>
          </label>
          <label>
            Search run ID
            <Input value={filters.search} onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))} />
          </label>
        </div>

        <div className="super-table-wrap">
          <table className="super-data-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Tenant</th>
                <th>Job Type</th>
                <th>Status</th>
                <th>Duration</th>
                <th>Triggered By</th>
                <th>Run ID</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {(data.items || []).map((row) => (
                <Fragment key={row.runId}>
                  <tr key={row.runId}>
                    <td>{formatDateTime(row.timestamp)}</td>
                    <td>{row.tenantName}</td>
                    <td>{row.jobType}</td>
                    <td>
                      <StatusBadge status={row.status} tone={row.statusTone} />
                    </td>
                    <td>{formatDuration(row.durationSeconds)}</td>
                    <td>{row.triggeredBy}</td>
                    <td className="mono">{row.runId.slice(-10)}</td>
                    <td>
                      <div className="super-inline-row wrap">
                        <Button
                          variant="secondary"
                          onClick={() => setExpandedRunId((prev) => (prev === row.runId ? "" : row.runId))}
                        >
                          {expandedRunId === row.runId ? "Hide" : "Expand"}
                        </Button>
                        {canMutate(role) ? (
                          <>
                            {row.status === "failed" ? (
                              <Button variant="secondary" onClick={() => runAction(`/api/super/jobs/log/${row.runId}/retry`, "Retry queued.")}>Retry</Button>
                            ) : null}
                            <Button variant="secondary" onClick={() => runAction(`/api/super/jobs/log/${row.runId}/cancel`, "Cancel requested.")}>Cancel</Button>
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                  {expandedRunId === row.runId ? (
                    <tr key={`${row.runId}_expanded`} className="super-expanded-row">
                      <td colSpan={8}>
                        <div className="super-expanded-grid">
                          <section>
                            <h4>Payload</h4>
                            <pre>{JSON.stringify(row.payload, null, 2)}</pre>
                          </section>
                          <section>
                            <h4>Progress</h4>
                            <ul>
                              {(row.progress || []).map((item, idx) => (
                                <li key={`${row.runId}_${idx}`}>
                                  <StatusBadge status={item.status} /> {item.label} · {formatDateTime(item.at)}
                                </li>
                              ))}
                            </ul>
                          </section>
                          <section>
                            <h4>Output / Errors</h4>
                            {row.rowErrors?.length ? (
                              <pre>{JSON.stringify(row.rowErrors.slice(0, 10), null, 2)}</pre>
                            ) : (
                              <p className="muted">No row errors captured.</p>
                            )}
                          </section>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

export function SuperJobsImportsPage() {
  const { token, user } = useAuth();
  const role = roleFromUser(user);
  const [data, setData] = useState({ activeImports: [], history: [] });
  const [expandedImportId, setExpandedImportId] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  async function loadData() {
    try {
      setError("");
      const payload = await requestJson("/api/super/jobs/imports", { token });
      setData(payload);
    } catch (loadError) {
      setError(loadError.message || "Could not load imports panel.");
    }
  }

  useEffect(() => {
    loadData();
    const id = window.setInterval(loadData, 5000);
    return () => window.clearInterval(id);
  }, [token]);

  async function rerunImport(id) {
    try {
      await requestJson(`/api/super/jobs/imports/${id}/rerun`, {
        method: "POST",
        token
      });
      setStatus("Import rerun queued.");
    } catch (rerunError) {
      setError(rerunError.message || "Could not queue rerun.");
    }
  }

  return (
    <div className="super-panel-stack">
      <Card>
        <PanelHeader
          title="Data Imports"
          subtitle="Cross-tenant import visibility and error diagnostics."
          actions={
            <Button
              variant="secondary"
              onClick={() => setStatus("Manual import upload modal scaffold is ready for R2 + Trigger.dev wiring.")}
              disabled={!canMutate(role)}
            >
              + Manual Import
            </Button>
          }
        />
        {error ? <p className="error-text">{error}</p> : null}
        {status ? <p className="success-text">{status}</p> : null}
      </Card>

      {data.activeImports?.length ? (
        <Card>
          <h2 className="pb-section-title">Active Imports</h2>
          {data.activeImports.map((item) => (
            <article key={item.id} className="super-active-import-row">
              <p>
                <strong>{item.tenantName}</strong> · {item.fileName}
              </p>
              <div className="super-progress-track">
                <span className="super-progress-fill" style={{ width: `${item.progressPercent || 0}%` }} />
              </div>
            </article>
          ))}
        </Card>
      ) : null}

      <Card>
        <h2 className="pb-section-title">Import History</h2>
        <div className="super-table-wrap">
          <table className="super-data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Tenant</th>
                <th>File</th>
                <th>Rows</th>
                <th>Skipped</th>
                <th>Errors</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {(data.history || []).map((row) => (
                <Fragment key={row.id}>
                  <tr key={row.id}>
                    <td>{formatDateTime(row.createdAt)}</td>
                    <td>{row.tenantName}</td>
                    <td>{row.fileName}</td>
                    <td>{row.rowsProcessed}</td>
                    <td>{row.skippedDuplicates}</td>
                    <td>
                      {row.errorCount > 0 ? <StatusBadge status={row.errorCount} tone="danger" /> : row.errorCount}
                    </td>
                    <td>
                      <StatusBadge status={row.status} tone={row.statusTone} />
                    </td>
                    <td>
                      <div className="super-inline-row wrap">
                        <Button variant="secondary" onClick={() => setExpandedImportId((prev) => (prev === row.id ? "" : row.id))}>
                          {expandedImportId === row.id ? "Hide" : "Errors"}
                        </Button>
                        {row.errorCount > 0 ? (
                          <a className="super-inline-link" href={`/api/super/jobs/imports/${row.id}/errors.csv`} target="_blank" rel="noreferrer">
                            Download Error CSV
                          </a>
                        ) : null}
                        {canMutate(role) ? (
                          <Button variant="secondary" onClick={() => rerunImport(row.id)}>
                            Re-run
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                  {expandedImportId === row.id ? (
                    <tr key={`${row.id}_errors`} className="super-expanded-row">
                      <td colSpan={8}>
                        <h4>{row.errorCount} row errors</h4>
                        {row.rowErrors?.length ? (
                          <table className="super-data-table compact inner">
                            <thead>
                              <tr>
                                <th>Row</th>
                                <th>Code</th>
                                <th>Message</th>
                              </tr>
                            </thead>
                            <tbody>
                              {row.rowErrors.slice(0, 25).map((item) => (
                                <tr key={`${row.id}_${item.rowNumber}_${item.code}`}>
                                  <td>{item.rowNumber}</td>
                                  <td>{item.code}</td>
                                  <td>{item.message}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : (
                          <p className="muted">No row-level errors saved.</p>
                        )}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

export function SuperJobsScheduledPage() {
  const { token, user } = useAuth();
  const role = roleFromUser(user);
  const [data, setData] = useState({ items: [] });
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  async function loadData() {
    try {
      setError("");
      const payload = await requestJson("/api/super/jobs/scheduled", { token });
      setData(payload);
    } catch (loadError) {
      setError(loadError.message || "Could not load scheduled jobs.");
    }
  }

  useEffect(() => {
    loadData();
  }, [token]);

  async function triggerNow(job) {
    try {
      await requestJson(`/api/super/jobs/scheduled/${job.key}/trigger`, {
        method: "POST",
        token
      });
      setStatus(`Triggered ${job.name}.`);
      loadData();
    } catch (requestError) {
      setError(requestError.message || "Could not trigger job.");
    }
  }

  async function toggleJob(job) {
    try {
      await requestJson(`/api/super/jobs/scheduled/${job.key}/toggle`, {
        method: "POST",
        token,
        body: { enabled: !job.enabled }
      });
      setStatus(`${job.name} ${job.enabled ? "disabled" : "enabled"}.`);
      loadData();
    } catch (requestError) {
      setError(requestError.message || "Could not update scheduled job.");
    }
  }

  return (
    <div className="super-panel-stack">
      <Card>
        <PanelHeader title="Scheduled Jobs" subtitle="Manage recurring maintenance and analytics jobs." />
        {error ? <p className="error-text">{error}</p> : null}
        {status ? <p className="success-text">{status}</p> : null}

        <div className="super-table-wrap">
          <table className="super-data-table">
            <thead>
              <tr>
                <th>Job Name</th>
                <th>Schedule</th>
                <th>Last Run</th>
                <th>Last Status</th>
                <th>Next Run</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {(data.items || []).map((job) => (
                <tr key={job.key}>
                  <td>{job.name}</td>
                  <td>
                    <p className="mono">{job.schedule}</p>
                    <small>{job.scheduleHuman}</small>
                  </td>
                  <td>{formatDateTime(job.lastRunAt)}</td>
                  <td>
                    <StatusBadge status={job.lastStatus} />
                  </td>
                  <td>{formatDateTime(job.nextRunAt)}</td>
                  <td>
                    <div className="super-inline-row wrap">
                      <Button variant="secondary" onClick={() => triggerNow(job)} disabled={!canMutate(role)}>
                        Trigger Now
                      </Button>
                      <Button variant="secondary" onClick={() => toggleJob(job)} disabled={!canMutate(role)}>
                        {job.enabled ? "Disable" : "Enable"}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

export function SuperSettingsPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    requestJson("/api/super/settings", { token })
      .then((payload) => setData(payload))
      .catch((loadError) => setError(loadError.message || "Could not load super settings."));
  }, [token]);

  return (
    <div className="super-panel-stack">
      <Card>
        <PanelHeader title="Settings" subtitle="Role-aware access and dashboard behavior." />
        {error ? <p className="error-text">{error}</p> : null}
      </Card>

      {data ? (
        <Card>
          <h2 className="pb-section-title">Access</h2>
          <p>
            <strong>Role:</strong> {data.role}
          </p>
          <p>
            <strong>Mutations enabled:</strong> {data.permissions.canMutate ? "Yes" : "No"}
          </p>
          <p>
            <strong>Read-only mode:</strong> {data.permissions.readOnly ? "Yes" : "No"}
          </p>

          <h2 className="pb-section-title">Runtime Settings</h2>
          <p>
            <strong>Onboarding stuck threshold:</strong> {data.settings.onboardingStuckThresholdDays} days
          </p>
          <p>
            <strong>Platform Pulse refresh:</strong> {data.settings.refreshIntervals.platformPulseSeconds}s
          </p>
          <p>
            <strong>Jobs health refresh:</strong> {data.settings.refreshIntervals.jobsHealthSeconds}s
          </p>
          <p>
            <strong>Imports refresh:</strong> {data.settings.refreshIntervals.importsSeconds}s
          </p>
        </Card>
      ) : null}
    </div>
  );
}
