import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Badge, Button, Card, Input, Select } from "@pondbridge/ui";
import { useAuth } from "../../context/AuthContext.jsx";
import { requestJson } from "../../lib/http.js";
import { ModalDialog, useDialogFocus } from "../../components/admin/AdminUi.jsx";

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

const BILLING_PLAN_OPTIONS = [
  {
    code: "flagship",
    label: "Flagship",
    annualAmount: 1200,
    onboardingFeeAmount: 0
  },
  {
    code: "test",
    label: "Internal Test",
    annualAmount: 10,
    onboardingFeeAmount: 0
  }
];

function billingPlanLabel(code = "") {
  const normalized = String(code || "").trim().toLowerCase();
  const option = BILLING_PLAN_OPTIONS.find((item) => item.code === normalized);
  return option?.label || "Flagship";
}

function billingPlanOptionByCode(code = "") {
  const normalized = String(code || "").trim().toLowerCase();
  return BILLING_PLAN_OPTIONS.find((item) => item.code === normalized) || BILLING_PLAN_OPTIONS[0];
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

function TenantMetricIcon({ kind }) {
  if (kind === "camps") {
    return (
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <rect x="6" y="14" width="28" height="18" rx="2" />
        <path d="M10 14h20L20 7z" />
        <path d="M16 32V22h8v10" />
      </svg>
    );
  }

  if (kind === "users") {
    return (
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <circle cx="14" cy="14" r="5" />
        <circle cx="26" cy="15" r="4" />
        <path d="M7 30c0-4 3-7 7-7s7 3 7 7" />
        <path d="M21 30c0-3 2-6 5-6s5 3 5 6" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 40 40" aria-hidden="true">
      <rect x="6" y="9" width="28" height="22" rx="3" />
      <circle cx="14" cy="18" r="3" />
      <path d="M10 26c0-3 2-5 4-5s4 2 4 5" />
      <path d="M22 15h8M22 20h8M22 25h6" />
    </svg>
  );
}

function TenantMetricCard({ label, value, subtext, kind }) {
  return (
    <article className={`super-tenant-metric-card ${kind ? `kind-${kind}` : ""}`.trim()}>
      <div className="super-tenant-metric-head">
        <span>{label}</span>
        <div className="super-tenant-metric-icon">
          <TenantMetricIcon kind={kind} />
        </div>
      </div>
      <strong>{value}</strong>
      <small>{subtext}</small>
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
  const { token, getAuthToken } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function loadData() {
    try {
      setError("");
      const payload = await requestJson("/api/super/platform-pulse", {
        token,
        getToken: () => getAuthToken({ forceRefresh: true })
      });
      setData(payload);
    } catch (loadError) {
      setError(loadError.message || "Failed to load platform pulse.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!token) return undefined;
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
            label="Configured MRR"
            value={formatMoney(stats.mrrCurrent || 0)}
            subtext="Active plan value; not Stripe revenue"
            tone="success"
          />
          <StatCard
            label="Email Health"
            value={stats.emailHealthRate == null ? "Not available" : formatPct(stats.emailHealthRate)}
            subtext="Resend delivery rate 7d"
            tone={stats.emailHealthRate == null ? "neutral" : stats.emailHealthRate > 95 ? "success" : stats.emailHealthRate >= 90 ? "warning" : "danger"}
          />
          <StatCard label="Open Jobs" value="Not connected" subtext="Queue telemetry unavailable" tone="neutral" />
          <StatCard
            label="Failed Import Reports (7d)"
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

      <div className="super-two-col super-equal-height super-pulse-visual-row">
        <Card className="super-visual-card">
          <h2 className="pb-section-title">MRR Trend</h2>
          <p className="muted">Not available until historical Stripe subscription snapshots are stored.</p>
        </Card>
        <Card className="super-visual-card">
          <h2 className="pb-section-title">Email Health (7d)</h2>
          {stats.emailHealthRate == null ? (
            <p className="muted">No Resend webhook telemetry is available for this period.</p>
          ) : (
            <SparkBars items={data?.charts?.emailHealth7d || []} percent />
          )}
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
  const [_loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [provisioningTenantId, setProvisioningTenantId] = useState("");
  const [deletingTenantId, setDeletingTenantId] = useState("");
  const [wipeTarget, setWipeTarget] = useState(null);
  const [wipeConfirmation, setWipeConfirmation] = useState("");
  const [filters, setFilters] = useState({ search: "", status: "", plan: "", billingStatus: "" });

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
    // Don't fire API calls before auth bootstrap has provided a token.
    // Without this guard the first render always hits the API with an empty
    // token, gets a 401, and briefly shows "Could not load tenants."
    if (!token) return;
    setLoading(true);
    loadData();
  }, [token, filters.search, filters.status, filters.plan, filters.billingStatus]);

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

  async function provisionDomain(camp) {
    try {
      setError("");
      setStatus("");
      setProvisioningTenantId(String(camp._id || ""));
      const payload = await requestJson(`/api/super/tenants/${camp._id}/provision-domain`, {
        method: "POST",
        token,
        body: {}
      });
      const result = payload?.result || {};
      const detail = [result?.dnsAction, result?.pagesAction].filter(Boolean).join(", ");
      setStatus(
        detail
          ? `Domain provisioned for ${camp.name}: ${payload?.domain || camp.customDomain || ""} (${detail}).`
          : `Domain provisioned for ${camp.name}: ${payload?.domain || camp.customDomain || ""}.`
      );
      loadData();
    } catch (provisionError) {
      setError(provisionError.message || "Could not provision camp domain.");
    } finally {
      setProvisioningTenantId("");
    }
  }

  function requestTenantWipe(camp) {
    setWipeTarget(camp);
    setWipeConfirmation("");
    setError("");
  }

  function closeTenantWipe() {
    if (deletingTenantId) return;
    setWipeTarget(null);
    setWipeConfirmation("");
  }

  async function wipeTenant() {
    const camp = wipeTarget;
    if (!camp) return;
    const phrase = `WIPE ${camp.slug} ${camp._id}`;
    if (wipeConfirmation !== phrase) return;

    try {
      setError("");
      setStatus("");
      setDeletingTenantId(String(camp._id || ""));
      const payload = await requestJson(`/api/super/tenants/${camp._id}/hard-delete`, {
        method: "DELETE",
        token,
        body: {
          mode: "manual_super_console",
          slug: String(camp.slug || "").trim().toLowerCase(),
          confirmation: wipeConfirmation
        }
      });

      const removed = payload?.removed?.counts || {};
      const removedTotal = Object.values(removed).reduce((sum, value) => sum + Number(value || 0), 0);
      setStatus(`Deleted ${camp.name} and wiped ${removedTotal} related record${removedTotal === 1 ? "" : "s"}.`);
      setWipeTarget(null);
      setWipeConfirmation("");
      loadData();
    } catch (deleteError) {
      setError(deleteError.message || "Could not wipe camp.");
    } finally {
      setDeletingTenantId("");
    }
  }

  return (
    <div className="super-panel-stack">
      <Card className="super-tenants-summary-card">
        <PanelHeader title="Tenants" subtitle="Create and manage camp tenants." />
        {summary ? (
          <div className="super-tenant-metric-grid">
            <TenantMetricCard label="Camps" value={summary.tenants || 0} subtext="Total tenant records" kind="camps" />
            <TenantMetricCard label="Users" value={summary.users || 0} subtext="Across all camps" kind="users" />
            <TenantMetricCard label="Profiles" value={summary.profiles || 0} subtext="Member profiles" kind="profiles" />
          </div>
        ) : null}
        {error ? <p className="error-text">{error}</p> : null}
        {status ? <p className="success-text">{status}</p> : null}
      </Card>

      <Card className="super-tenants-table-card">
        <header className="super-tenant-list-head">
          <div>
            <h2 className="pb-section-title">Tenant List</h2>
            <p className="super-tenant-list-subtitle">Filter camps by status, billing plan, and billing state.</p>
          </div>
        </header>
        <div className="super-filter-grid super-filter-grid-tenants super-filter-grid-tenants-inline">
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
              {BILLING_PLAN_OPTIONS.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.label}
                </option>
              ))}
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
        <div className="super-table-wrap">
          <table className="super-data-table">
            <thead>
              <tr>
                <th>Camp</th>
                <th>Domain</th>
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
                  <td>{camp.customDomain || `${camp.slug}.pondbridgealumni.com`}</td>
                  <td>{camp.slug}</td>
                  <td>
                    <StatusBadge status={camp.status} />
                  </td>
                  <td>{billingPlanLabel(camp.billingPlan)}</td>
                  <td>{camp.counts?.users || 0}</td>
                  <td>{camp.counts?.profiles || 0}</td>
                  <td>
                    <details className="super-row-actions">
                      <summary aria-label={`Manage ${camp.name}`}>Manage</summary>
                      <div className="super-row-actions-menu">
                        <Button variant="secondary" onClick={() => toggleTenant(camp)} disabled={!canMutate(role)}>
                          {camp.status === "active" ? "Disable Camp" : "Enable Camp"}
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => provisionDomain(camp)}
                          disabled={!canMutate(role) || provisioningTenantId === String(camp._id || "")}
                        >
                          {provisioningTenantId === String(camp._id || "") ? "Provisioning..." : "Provision Domain"}
                        </Button>
                        <Button
                          variant="danger"
                          onClick={() => requestTenantWipe(camp)}
                          disabled={!canMutate(role) || deletingTenantId === String(camp._id || "")}
                        >
                          {deletingTenantId === String(camp._id || "") ? "Wiping..." : "Wipe Camp"}
                        </Button>
                      </div>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <ModalDialog
        open={Boolean(wipeTarget)}
        title="Permanently wipe this camp?"
        description={wipeTarget ? `This deletes ${wipeTarget.name} and all tenant-scoped backend records. Clerk users belonging only to this camp are also deleted.` : ""}
        onClose={closeTenantWipe}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={closeTenantWipe} disabled={Boolean(deletingTenantId)}>
              Keep Camp
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={wipeTenant}
              disabled={!wipeTarget || wipeConfirmation !== `WIPE ${wipeTarget.slug} ${wipeTarget._id}` || Boolean(deletingTenantId)}
            >
              {deletingTenantId ? "Wiping..." : "Permanently Wipe Camp"}
            </Button>
          </>
        }
      >
        {wipeTarget ? (
          <label className="director-admin-dialog-field">
            Type <code>{`WIPE ${wipeTarget.slug} ${wipeTarget._id}`}</code> to continue
            <Input
              value={wipeConfirmation}
              onChange={(event) => setWipeConfirmation(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        ) : null}
      </ModalDialog>
    </div>
  );
}

export function SuperTenantCreatePage() {
  const { token, user } = useAuth();
  const role = roleFromUser(user);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [createResult, setCreateResult] = useState(null);
  const createResultRef = useRef(null);
  const [creating, setCreating] = useState(false);
  // State updates are batched, so a double-click inside one tick would still
  // see `creating === false`. The ref flips synchronously on the first click.
  const creatingRef = useRef(false);
  const [form, setForm] = useState({
    name: "",
    slug: "",
    billingPlan: "flagship",
    directorEmail: ""
  });

  async function createCamp(event) {
    event.preventDefault();
    // Creation reaches Cloudflare, so it can take several seconds. Without a
    // guard a second click fires a duplicate POST that comes back as
    // "slug already exists" — for a camp the first click just created.
    if (creatingRef.current) return;
    creatingRef.current = true;
    setError("");
    setStatus("");
    setCreateResult(null);
    setCreating(true);
    try {
      const payload = await requestJson("/api/super/tenants", {
        method: "POST",
        token,
        body: form
      });

      const provisioning = payload?.domainProvisioning || {};
      const directorInvite = payload?.directorInvite || null;
      const fallbackClaimPath = String(payload?.inviteLink || "").trim();
      const fallbackClaimLink =
        fallbackClaimPath && fallbackClaimPath.startsWith("/") ? `${window.location.origin}${fallbackClaimPath}` : "";
      const rawClaimLink = payload?.directorClaimLink || directorInvite?.claimUrl || fallbackClaimLink;
      const claimLink = rawClaimLink && rawClaimLink.startsWith("/")
        ? `${window.location.origin}${rawClaimLink}`
        : rawClaimLink;
      const rawNetworkClaimLink = String(payload?.networkDirectorClaimLink || "").trim();
      const networkClaimLink = rawNetworkClaimLink && rawNetworkClaimLink.startsWith("/")
        ? `${window.location.origin}${rawNetworkClaimLink}`
        : rawNetworkClaimLink;
      const domain = payload?.tenant?.customDomain || payload?.network?.domain || "";
      const selectedBillingPlan = String(
        payload?.billingPlan || payload?.tenant?.settings?.billing?.planCode || form.billingPlan || "flagship"
      )
        .trim()
        .toLowerCase();
      const planOption = billingPlanOptionByCode(selectedBillingPlan);

      setCreateResult({
        campName: payload?.tenant?.name || form.name,
        slug: payload?.tenant?.slug || form.slug,
        billingPlan: selectedBillingPlan,
        annualAmount: Number(planOption.annualAmount || 0),
        onboardingFeeAmount: Number(payload?.tenant?.onboardingFeeAmount ?? planOption.onboardingFeeAmount ?? 0),
        networkDisplayName: String(payload?.tenant?.content?.networkDisplayName || "").trim(),
        welcomeHeadline: String(payload?.tenant?.content?.welcomeHeadline || "").trim(),
        welcomeBody: String(payload?.tenant?.content?.welcomeBody || "").trim(),
        domain,
        claimLink,
        networkClaimLink,
        provisioningStatus: String(provisioning?.status || ""),
        provisioningReason: String(provisioning?.reason || provisioning?.message || ""),
        directorEmail: directorInvite?.email || form.directorEmail || "",
        nextSteps: Array.isArray(payload?.nextSteps) ? payload.nextSteps : []
      });
      setForm({ name: "", slug: "", billingPlan: "flagship", directorEmail: "" });
      setStatus("Camp created successfully.");
    } catch (createError) {
      setCreateResult(null);
      setError(createError.message || "Could not create camp.");
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  }

  useEffect(() => {
    if (!createResultRef.current || !createResult) return;
    createResultRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [createResult]);

  async function copyClaim(link) {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setStatus("Director onboarding link copied.");
  }

  return (
    <div className="super-panel-stack">
      <Card className="super-tenants-create-card super-camp-create-form-card">
        <PanelHeader
          title="Create Camp"
          subtitle="Provision a camp, set billing plan, and hand directors a ready onboarding flow."
        />
        {error ? <p className="error-text">{error}</p> : null}
        {status ? <p className="success-text">{status}</p> : null}
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
            Billing plan
            <Select
              value={form.billingPlan}
              onChange={(event) => setForm((prev) => ({ ...prev, billingPlan: event.target.value }))}
            >
              {BILLING_PLAN_OPTIONS.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.label} · {formatMoney(option.annualAmount)}/year
                  {option.onboardingFeeAmount > 0
                    ? ` + ${formatMoney(option.onboardingFeeAmount)} onboarding (first checkout only)`
                    : " · no onboarding fee"}
                </option>
              ))}
            </Select>
          </label>
          <label className="full-width">
            Director contact email (optional)
            <Input
              type="email"
              value={form.directorEmail}
              onChange={(event) => setForm((prev) => ({ ...prev, directorEmail: event.target.value }))}
            />
          </label>
          <div className="super-form-actions full-width">
            <Button type="submit" disabled={!canMutate(role) || creating}>
              {creating ? "Creating camp..." : "Create camp"}
            </Button>
            {!canMutate(role) ? <small className="muted">View only role</small> : null}
            {creating ? (
              <small className="muted">Registering the camp domain with Cloudflare. This can take a few seconds.</small>
            ) : null}
          </div>
          <p className="muted full-width">
            This billing plan is saved to the camp now, so directors land on onboarding with billing already pre-selected.
          </p>
          <p className="muted full-width">
            Internal Test is a live $10/year production tier and only succeeds for allowlisted camp slugs, including
            <code> test23 </code>.
          </p>
        </form>
      </Card>

      {createResult ? (
        <div ref={createResultRef}>
          <Card className="super-camp-create-summary-card" role="status">
          <header className="super-camp-create-summary-header">
            <h2>Camp Ready</h2>
            <p>
              <strong>{createResult.campName}</strong> has been created and is ready for director onboarding.
            </p>
          </header>

          <div className="super-camp-create-summary-grid">
            <article>
              <span>Slug</span>
              <strong>{createResult.slug}</strong>
            </article>
            <article>
              <span>Plan</span>
              <strong>{billingPlanLabel(createResult.billingPlan)}</strong>
            </article>
            <article>
              <span>Annual Billing</span>
              <strong>{formatMoney(createResult.annualAmount)}</strong>
            </article>
            <article>
              <span>Onboarding Fee</span>
              <strong>{formatMoney(createResult.onboardingFeeAmount)}</strong>
            </article>
            <article>
              <span>Domain</span>
              <strong>{createResult.domain || "-"}</strong>
            </article>
            <article>
              <span>Provisioning</span>
              <strong>{createResult.provisioningStatus || "unknown"}</strong>
            </article>
            <article>
              <span>Director Email</span>
              <strong>{createResult.directorEmail || "Not provided"}</strong>
            </article>
          </div>

          <section className="super-create-result">
            <p className="super-create-result-label">Director onboarding link</p>
            {createResult.claimLink ? (
              <div className="super-create-result-link-row">
                <Input readOnly value={createResult.claimLink} />
                <div className="super-create-result-actions">
                  <Button type="button" variant="secondary" onClick={() => copyClaim(createResult.claimLink)}>
                    Copy link
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => window.open(createResult.claimLink, "_blank", "noopener,noreferrer")}
                  >
                    Open link
                  </Button>
                </div>
              </div>
            ) : (
              <p className="super-create-result-note">
                Link unavailable until domain provisioning finishes. Use{" "}
                <code>{`/t/${createResult.slug}/director-claim`}</code> as fallback.
              </p>
            )}

            {createResult.provisioningReason ? (
              <p className="super-create-result-note">
                Provisioning detail: <strong>{createResult.provisioningReason}</strong>
              </p>
            ) : null}
            {createResult.provisioningStatus !== "ok" && createResult.networkClaimLink ? (
              <p className="super-create-result-note">
                Camp domain is still activating. Use the link above now. Direct domain when ready:{" "}
                <a href={createResult.networkClaimLink} target="_blank" rel="noreferrer">
                  {createResult.networkClaimLink}
                </a>
              </p>
            ) : null}
          </section>

          <section className="super-camp-create-network-preview" aria-label="Camp preview">
            <p className="super-create-result-label">Network preview</p>
            <div className="super-camp-create-network-preview-frame">
              <header className="super-camp-create-network-preview-nav">
                <strong>{createResult.networkDisplayName || `${createResult.campName} Network`}</strong>
                <span>{createResult.domain || `${createResult.slug}.pondbridgealumni.com`}</span>
              </header>
              <div className="super-camp-create-network-preview-body">
                <h3>{createResult.welcomeHeadline || `Welcome to ${createResult.networkDisplayName || `${createResult.campName} Network`}`}</h3>
                <p>{createResult.welcomeBody || "Reconnect with members, staff, and directors from every era."}</p>
                <div className="super-camp-create-network-preview-actions">
                  <span>Sign in</span>
                  <span>Create account</span>
                </div>
              </div>
            </div>
          </section>

            {createResult.nextSteps.length ? (
              <section className="super-camp-create-next-steps">
                <h3>Next steps</h3>
                <ol>
                  {createResult.nextSteps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </section>
            ) : null}
          </Card>
        </div>
      ) : null}
    </div>
  );
}

export function SuperEmailTransactionalPage() {
  const { token } = useAuth();
  const [days, setDays] = useState(7);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
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
    if (!token) return;
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

  return (
    <div className="super-panel-stack">
      <Card>
        <PanelHeader
          title="Transactional Email — Health"
          subtitle="Verified provider delivery events and privacy-safe diagnostics."
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
        {data?.notice ? <p className={data.telemetryAvailable ? "muted" : "super-warning-banner"}>{data.notice}</p> : null}

        <div className="super-stat-grid four-up">
          <StatCard
            label="Delivery Rate"
            value={data?.stats?.deliveryRate == null ? "Not available" : formatPct(data.stats.deliveryRate)}
            subtext="Latest provider state"
            tone={data?.stats?.deliveryRate == null ? "neutral" : "success"}
          />
          <StatCard
            label="Bounce Rate"
            value={data?.stats?.bounceRate == null ? "Not available" : formatPct(data.stats.bounceRate)}
            subtext="Warn if >2%"
            tone={data?.stats?.bounceRate == null ? "neutral" : data.stats.bounceRate > 2 ? "danger" : "warning"}
          />
          <StatCard
            label="Spam Rate"
            value={data?.stats?.spamRate == null ? "Not available" : formatPct(data.stats.spamRate, 2)}
            subtext="Last 30d"
            tone={data?.stats?.spamRate == null ? "neutral" : data.stats.spamRate > 0.1 ? "danger" : "neutral"}
          />
          <StatCard label="Tracked Deliveries" value={data?.stats?.totalSent || 0} subtext="Across all camps" tone="neutral" />
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
              <option value="invite">Invite</option>
              <option value="director_broadcast">Director broadcast</option>
              <option value="magic_link">Magic link</option>
              <option value="welcome">Welcome</option>
              <option value="access_approved">Access approved</option>
              <option value="access_denied">Access denied</option>
              <option value="transactional">Other transactional</option>
            </Select>
          </label>
          <label>
            Status
            <Select value={filters.status} onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}>
              <option value="">All</option>
              <option value="sent">Sent</option>
              <option value="delivered">Delivered</option>
              <option value="clicked">Clicked</option>
              <option value="bounced">Bounced</option>
              <option value="complained">Complained</option>
              <option value="failed">Failed</option>
              <option value="delivery_delayed">Delayed</option>
              <option value="suppressed">Suppressed</option>
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
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

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
    if (!token) return;
    loadData();
  }, [token]);

  return (
    <div className="super-panel-stack">
      <Card>
        <PanelHeader
          title="Director Lifecycle Readiness"
          subtitle="PondBridge director-account and onboarding state. Lifecycle automation is not connected."
        />
        {error ? <p className="error-text">{error}</p> : null}
        {data?.notes ? <p className="super-warning-banner">{data.notes}</p> : null}
        <div className="super-stat-grid four-up">
          <StatCard label="Director Accounts" value={data?.contacts?.total || 0} subtext="PondBridge memberships" />
          <StatCard
            label="Active Suppressions"
            value={data?.contacts?.activeSuppressions || 0}
            subtext="Resend bounces and complaints"
            tone={(data?.contacts?.activeSuppressions || 0) > 0 ? "warning" : "success"}
          />
          <StatCard label="Lifecycle Provider" value="Not connected" subtext="No contact sync" tone="neutral" />
          <StatCard label="Automated Sequences" value="Not connected" subtext="No campaigns active" tone="neutral" />
        </div>
      </Card>

      <Card>
        <h2 className="pb-section-title">Director Accounts by Onboarding Stage</h2>
        <HorizontalBars
          items={(data?.contactsByStage || []).map((item) => ({ label: item.stage, value: item.count }))}
        />
      </Card>
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
    if (!token) return;
    loadData();
  }, [token]);

  return (
    <div className="super-panel-stack">
      <Card>
        <PanelHeader
          title="Billing Overview"
          subtitle="Configured recurring value, plan mix, and provider-synchronized lifecycle state."
        />
        {error ? <p className="error-text">{error}</p> : null}

        <div className="super-stat-grid four-up">
          <StatCard label="Configured MRR" value={formatMoney(data?.stats?.mrr || 0)} subtext="Active plans; not Stripe revenue" tone="success" />
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
          <h2 className="pb-section-title">MRR Trend</h2>
          <p className="muted">Not available until historical Stripe subscription snapshots are stored.</p>
        </Card>
        <Card className="super-visual-card">
          <h2 className="pb-section-title">Plan Distribution</h2>
          <HorizontalBars
            items={[
              { label: "Flagship", value: data?.charts?.planDistribution?.flagship || 0 },
              { label: "Internal Test", value: data?.charts?.planDistribution?.test || 0 },
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
  const { token } = useAuth();
  const [filters, setFilters] = useState({ search: "", plan: "", status: "", paymentMethod: "" });
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], total: 0, page: 1, pageSize: 25 });
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const billingPanelRef = useDialogFocus(Boolean(selected), () => setSelected(null));

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
    if (!token) return;
    loadData();
  }, [token, filters.search, filters.plan, filters.status, filters.paymentMethod, page]);

  return (
    <div className="super-panel-stack">
      <Card>
        <PanelHeader title="Tenant Billing" subtitle="Stored plan and Stripe-synchronized lifecycle state by camp." />
        {error ? <p className="error-text">{error}</p> : null}
        <p className="muted">Billing mutations are managed in Stripe until provider-confirmed controls are implemented here.</p>

        <div className="super-filter-grid super-filter-grid-billing">
          <label>
            Search camp
            <Input value={filters.search} onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))} />
          </label>
          <label>
            Plan
            <Select value={filters.plan} onChange={(event) => setFilters((prev) => ({ ...prev, plan: event.target.value }))}>
              <option value="">All</option>
              {BILLING_PLAN_OPTIONS.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.label}
                </option>
              ))}
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
                  <td>{billingPlanLabel(row.billingPlan)}</td>
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
        <div className="super-sidepanel-overlay" onClick={() => setSelected(null)} role="dialog" aria-modal="true" aria-labelledby="super-billing-panel-title">
          <aside ref={billingPanelRef} className="super-sidepanel" onClick={(event) => event.stopPropagation()} tabIndex={-1}>
            <header className="super-sidepanel-head">
              <div>
                <h2 id="super-billing-panel-title">{selected.name}</h2>
                <StatusBadge status={selected.billingStatus} />
              </div>
              <button type="button" className="super-sidepanel-close" onClick={() => setSelected(null)} aria-label="Close billing details">
                ×
              </button>
            </header>

            <section>
              <h3>Plan Summary</h3>
              <p>
                <strong>Plan:</strong> {billingPlanLabel(selected.billingPlan)}
                {selected.annualAmount ? ` — ${formatMoney(selected.annualAmount)}/year` : ""}
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
              <h3>Billing controls</h3>
              <p className="muted">Change plans, trials, discounts, invoices, and subscriptions in Stripe so webhook-confirmed state remains authoritative.</p>
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
  const [graceTarget, setGraceTarget] = useState(null);
  const [graceDays, setGraceDays] = useState("7");
  const [graceError, setGraceError] = useState("");

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
    if (!token) return undefined;
    loadData();
    const id = window.setInterval(loadData, 30000);
    return () => window.clearInterval(id);
  }, [token]);

  async function rowAction(path, body = {}) {
    try {
      setError("");
      setStatus("");
      await requestJson(path, { method: "POST", token, body });
      setStatus("Action completed.");
      loadData();
      return true;
    } catch (actionError) {
      setError(actionError.message || "Action failed.");
      return false;
    }
  }

  function requestGraceExtension(row) {
    setGraceTarget(row);
    setGraceDays("7");
    setGraceError("");
  }

  async function applyGraceExtension() {
    const days = Number(graceDays);
    if (!Number.isInteger(days) || days <= 0) {
      setGraceError("Enter a whole number of days greater than zero.");
      return;
    }
    const completed = await rowAction(`/api/super/billing/failed/${graceTarget.id}/grace`, { days });
    if (!completed) return;
    setGraceTarget(null);
    setGraceError("");
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
                  <td>{billingPlanLabel(row.billingPlan)}</td>
                  <td>{formatMoney(row.amountDue)}</td>
                  <td>{formatDateTime(row.lastAttempt)}</td>
                  <td>{row.declineReason}</td>
                  <td>
                    {canMutate(role) ? (
                      <div className="super-inline-row wrap">
                        <Button
                          variant="secondary"
                          onClick={() => requestGraceExtension(row)}
                        >
                          Extend Grace Period
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
      <ModalDialog
        open={Boolean(graceTarget)}
        title="Extend Grace Period"
        description={graceTarget ? `Choose how many days to add for ${graceTarget.name}.` : ""}
        onClose={() => setGraceTarget(null)}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setGraceTarget(null)}>Cancel</Button>
            <Button type="button" onClick={applyGraceExtension}>Extend Grace Period</Button>
          </>
        }
      >
        <label className="director-admin-dialog-field">
          Additional days
          <Input
            type="number"
            min="1"
            step="1"
            value={graceDays}
            onChange={(event) => {
              setGraceDays(event.target.value);
              setGraceError("");
            }}
            aria-invalid={Boolean(graceError)}
            aria-describedby={graceError ? "super-grace-error" : undefined}
          />
        </label>
        {graceError ? <p id="super-grace-error" className="error-text" role="alert">{graceError}</p> : null}
      </ModalDialog>
    </div>
  );
}

export function SuperAnalyticsEngagementPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

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
    if (!token) return;
    loadData();
  }, [token]);

  return (
    <div className="super-panel-stack">
      <Card>
        <PanelHeader
          title="Platform Engagement"
          subtitle={`PondBridge analytics events as of ${formatDateTime(data?.asOf)}`}
        />
        {error ? <p className="error-text">{error}</p> : null}

        <div className="super-stat-grid four-up">
          <StatCard label="Active Users (7d)" value={data?.stats?.activeUsers7d || 0} subtext="Unique logins" tone="success" />
          <StatCard
            label="DAU / MAU"
            value={data?.stats?.dauMauRatio == null ? "Not available" : formatPct(data.stats.dauMauRatio)}
            subtext="Engagement depth"
            tone={data?.stats?.dauMauRatio == null ? "neutral" : data.stats.dauMauRatio >= 20 ? "success" : "warning"}
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
              </tr>
            </thead>
            <tbody>
              {(data?.inactiveTenants || []).map((row) => (
                <tr key={row.tenantId}>
                  <td>{row.name}</td>
                  <td>{formatDate(row.lastLoginAt)}</td>
                  <td>{row.members}</td>
                  <td>{billingPlanLabel(row.billingPlan)}</td>
                  <td>{row.daysInactive}</td>
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
    if (!token) return;
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
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  async function loadData() {
    try {
      setError("");
      const payload = await requestJson("/api/super/analytics/flags", { token });
      setData(payload);
    } catch (loadError) {
      setError(loadError.message || "Could not load module rollout visibility.");
    }
  }

  useEffect(() => {
    if (!token) return;
    loadData();
  }, [token]);

  return (
    <div className="super-panel-stack">
      <Card>
        <PanelHeader
          title="Module Rollout Visibility"
          subtitle="See camp enablement and measured 30-day adoption without implying a global control plane exists."
          actions={
            <Link className="link-button secondary" to="/super/tenants">
              Manage camp modules
            </Link>
          }
        />
        {error ? <p className="error-text">{error}</p> : null}
        {data?.notice ? <p className="super-warning-banner">{data.notice}</p> : null}
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
                  <td>{row.activelyUsedTenants == null ? "Not measured" : row.activelyUsedTenants}</td>
                  <td>
                    {row.adoptionPercent == null ? (
                      <StatusBadge status="Not instrumented" tone="neutral" />
                    ) : (
                      <StatusBadge
                        status={formatPct(row.adoptionPercent)}
                        tone={row.adoptionPercent > 60 ? "success" : row.adoptionPercent >= 30 ? "warning" : "danger"}
                      />
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
    if (!token) return;
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
          subtitle="Completed import-report outcomes. Live queue telemetry is not connected."
          actions={
            <label className="super-inline-check">
              <input type="checkbox" checked={autoRefresh} onChange={(event) => setAutoRefresh(event.target.checked)} />
              Auto-refresh
            </label>
          }
        />
        {data?.banner ? <p className="super-warning-banner">{data.banner}</p> : null}
        {error ? <p className="error-text">{error}</p> : null}

        <div className="super-stat-grid four-up">
          <StatCard label="Running" value="Not connected" subtext="Queue telemetry unavailable" tone="neutral" />
          <StatCard label="Queued" value="Not connected" subtext="Queue telemetry unavailable" tone="neutral" />
          <StatCard label="Completed Reports (24h)" value={data?.queue?.completed24h || 0} subtext="Successful imports" tone="success" />
          <StatCard
            label="Failed Reports (24h)"
            value={data?.queue?.failed24h || 0}
            subtext="Imports requiring review"
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
  const { token } = useAuth();
  const [data, setData] = useState({ items: [] });
  const [error, setError] = useState("");
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
    if (!token) return;
    loadData();
  }, [token, filters.status, filters.search]);

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
        <p className="muted">This view contains completed import reports. Retry and cancel require a future durable job queue.</p>

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
                <th>Details</th>
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
  const { token } = useAuth();
  const [data, setData] = useState({ activeImports: [], history: [] });
  const [expandedImportId, setExpandedImportId] = useState("");
  const [error, setError] = useState("");

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
    if (!token) return undefined;
    loadData();
    const id = window.setInterval(loadData, 5000);
    return () => window.clearInterval(id);
  }, [token]);

  return (
    <div className="super-panel-stack">
      <Card>
        <PanelHeader
          title="Data Imports"
          subtitle="Cross-camp import-report history and error diagnostics."
        />
        {error ? <p className="error-text">{error}</p> : null}
        <p className="muted">Source files are not retained for replay. Re-run controls remain hidden until a durable import workflow exists.</p>
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
  const { token } = useAuth();
  const [data, setData] = useState({ items: [] });
  const [error, setError] = useState("");

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
    if (!token) return;
    loadData();
  }, [token]);

  return (
    <div className="super-panel-stack">
      <Card>
        <PanelHeader title="Scheduled Jobs" subtitle="Durable recurring-work visibility and controls." />
        {error ? <p className="error-text">{error}</p> : null}
        {data?.notice ? <p className="super-warning-banner">{data.notice}</p> : null}

        {(data.items || []).length ? <div className="super-table-wrap">
          <table className="super-data-table">
            <thead>
              <tr>
                <th>Job Name</th>
                <th>Schedule</th>
                <th>Last Run</th>
                <th>Last Status</th>
                <th>Next Run</th>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div> : <p className="muted">There are no connected scheduled jobs to display.</p>}
      </Card>
    </div>
  );
}

export function SuperSettingsPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [rolloutData, setRolloutData] = useState(null);
  const [rolloutDrafts, setRolloutDrafts] = useState({});
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [savingKey, setSavingKey] = useState("");

  function installRolloutData(payload) {
    setRolloutData(payload);
    setRolloutDrafts(Object.fromEntries((payload?.flags || []).map((flag) => [
      flag.featureKey,
      {
        state: flag.state || "disabled",
        killSwitch: flag.killSwitch !== false,
        tenantIds: flag.tenantIds || [],
        excludedTenantIds: flag.excludedTenantIds || []
      }
    ])));
  }

  useEffect(() => {
    if (!token) return;
    Promise.all([
      requestJson("/api/super/settings", { token }),
      requestJson("/api/super/analytics/flags", { token })
    ])
      .then(([settingsPayload, rolloutPayload]) => {
        setData(settingsPayload);
        installRolloutData(rolloutPayload);
      })
      .catch((loadError) => setError(loadError.message || "Could not load super settings."));
  }, [token]);

  function patchRolloutDraft(featureKey, patch) {
    setRolloutDrafts((current) => ({
      ...current,
      [featureKey]: { ...(current[featureKey] || {}), ...patch }
    }));
  }

  function toggleRolloutTenant(featureKey, tenantId, field) {
    const current = rolloutDrafts[featureKey] || {};
    const values = new Set(current[field] || []);
    if (values.has(tenantId)) values.delete(tenantId);
    else values.add(tenantId);
    patchRolloutDraft(featureKey, { [field]: [...values] });
  }

  async function saveRollout(featureKey) {
    try {
      setError("");
      setStatus("");
      setSavingKey(featureKey);
      await requestJson(`/api/super/analytics/flags/${encodeURIComponent(featureKey)}`, {
        method: "PATCH",
        token,
        body: rolloutDrafts[featureKey] || {}
      });
      const refreshed = await requestJson("/api/super/analytics/flags", { token });
      installRolloutData(refreshed);
      setStatus(`${featureKey} rollout saved and audited.`);
    } catch (saveError) {
      setError(saveError.message || "Could not save the rollout control.");
    } finally {
      setSavingKey("");
    }
  }

  return (
    <div className="super-panel-stack">
      <Card>
        <PanelHeader title="Platform settings" subtitle="Role-aware access, runtime status, and reviewed rollout controls." />
        {error ? <p className="error-text" role="alert">{error}</p> : null}
        {status ? <p className="success-text" role="status">{status}</p> : null}
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

      {rolloutData ? (
        <Card>
          <PanelHeader
            title="Rollout controls"
            subtitle="Features fail closed and are evaluated on the server using stable tenant IDs."
          />
          <p className={rolloutData.controlAvailable ? "muted" : "super-warning-banner"}>
            {rolloutData.notice}
          </p>
          <div className="super-rollout-list">
            {(rolloutData.flags || []).map((flag) => {
              const draft = rolloutDrafts[flag.featureKey] || {};
              const cohortField = draft.state === "enabled" ? "excludedTenantIds" : "tenantIds";
              const selected = new Set(draft[cohortField] || []);
              const cohortLabel = draft.state === "enabled" ? "Control camps held back" : "Pilot camps";
              return (
                <article key={flag.featureKey} className="super-rollout-card">
                  <div className="super-rollout-heading">
                    <div>
                      <span className="mono">{flag.featureKey}</span>
                      <h3>{flag.label}</h3>
                      <p>{flag.description}</p>
                    </div>
                    <Badge tone={draft.killSwitch ? "warning" : draft.state === "disabled" ? "neutral" : "success"}>
                      {draft.killSwitch ? "Kill switch on" : draft.state}
                    </Badge>
                  </div>

                  <div className="super-rollout-controls">
                    <label>
                      <span>Rollout state</span>
                      <select
                        value={draft.state || "disabled"}
                        onChange={(event) => patchRolloutDraft(flag.featureKey, { state: event.target.value })}
                        disabled={!data?.permissions?.canMutate || !rolloutData.controlAvailable}
                      >
                        <option value="disabled">Disabled</option>
                        <option value="pilot">Pilot cohort</option>
                        <option value="enabled">Enabled except controls</option>
                      </select>
                    </label>
                    <label className="super-rollout-switch">
                      <input
                        type="checkbox"
                        checked={draft.killSwitch !== false}
                        onChange={(event) => patchRolloutDraft(flag.featureKey, { killSwitch: event.target.checked })}
                        disabled={!data?.permissions?.canMutate || !rolloutData.controlAvailable}
                      />
                      <span>Immediate kill switch</span>
                    </label>
                  </div>

                  {draft.state !== "disabled" ? (
                    <fieldset className="super-rollout-cohort">
                      <legend>{cohortLabel}</legend>
                      <p>
                        {draft.state === "pilot"
                          ? "Only checked camps receive the feature."
                          : "Checked camps remain unchanged while the wider rollout is enabled."}
                      </p>
                      <div>
                        {(rolloutData.tenants || []).map((tenant) => (
                          <label key={tenant.id}>
                            <input
                              type="checkbox"
                              checked={selected.has(tenant.id)}
                              onChange={() => toggleRolloutTenant(flag.featureKey, tenant.id, cohortField)}
                              disabled={!data?.permissions?.canMutate || !rolloutData.controlAvailable}
                            />
                            <span>{tenant.name} <small>/{tenant.slug}</small></span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  ) : null}

                  <div className="super-rollout-footer">
                    <small>Revision {flag.revision || 0} · {flag.updatedAt ? formatDateTime(flag.updatedAt) : "not configured"}</small>
                    <Button
                      onClick={() => saveRollout(flag.featureKey)}
                      loading={savingKey === flag.featureKey}
                      disabled={!data?.permissions?.canMutate || !rolloutData.controlAvailable || Boolean(savingKey)}
                    >
                      Save reviewed rollout
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
