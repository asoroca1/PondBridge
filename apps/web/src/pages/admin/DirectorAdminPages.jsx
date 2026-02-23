import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Outlet, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Badge, Button, Card, Input, Select, Textarea } from "@pondbridge/ui";
import { requestBlob, requestJson } from "../../lib/http.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { useTenant } from "../../context/TenantContext.jsx";

function formatDate(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleDateString();
}

function formatDateTime(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString();
}

function formatMoney(value = 0) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

function statusTone(status = "") {
  const key = String(status || "").trim().toLowerCase();
  if (["active", "sent", "live", "approved", "paid"].includes(key)) return "success";
  if (["pending", "scheduled", "trialing", "in_setup", "in_progress"].includes(key)) return "warning";
  if (["failed", "denied", "past_due", "removed", "flagged", "canceled"].includes(key)) return "danger";
  return "neutral";
}

function downloadTextAsFile(text, filename, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function parseIdsParam(value = "") {
  return [...new Set(
    String(value || "")
      .split(",")
      .map((item) => String(item || "").trim())
      .filter(Boolean)
  )];
}

function useAdminApi() {
  const { slug } = useParams();
  const { token } = useAuth();

  const request = useCallback(
    (path, options = {}) =>
      requestJson(`/api/t/${slug}/admin${path}`, {
        token,
        ...options
      }),
    [slug, token]
  );

  const download = useCallback(
    (path) =>
      requestBlob(`/api/t/${slug}/admin${path}`, {
        token
      }),
    [slug, token]
  );

  return { slug, token, request, download };
}

function AdminPageHeader({ title, subtitle = "", actions = null }) {
  return (
    <header className="director-admin-page-head">
      <div>
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {actions ? <div className="director-admin-page-actions">{actions}</div> : null}
    </header>
  );
}

function StatCard({ label, value, hint = "", tone = "neutral" }) {
  return (
    <article className={`director-admin-stat-card tone-${tone}`.trim()}>
      <span>{label}</span>
      <strong>{value}</strong>
      {hint ? <small>{hint}</small> : null}
    </article>
  );
}

export function DirectorAdminDashboardPage() {
  const { slug, request } = useAdminApi();
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await request("/dashboard");
      setPayload(data);
    } catch (requestError) {
      setError(requestError.message || "Failed to load dashboard.");
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  if (loading && !payload) {
    return (
      <Card>
        <p className="muted">Loading director dashboard...</p>
      </Card>
    );
  }

  const stats = payload?.stats || {};
  const tenant = payload?.tenant || {};
  const showPendingApprovals = tenant.accessPolicy === "approval_queue";
  const statCards = [
    {
      key: "total-members",
      label: "Total Members",
      value: stats.totalMembers || 0,
      hint: `${stats.totalMembersDelta >= 0 ? "+" : ""}${stats.totalMembersDelta || 0}% vs prior window`,
      tone: "success"
    },
    {
      key: "new-this-week",
      label: "New This Week",
      value: stats.newThisWeek || 0,
      hint: "Last 7 days",
      tone: "neutral"
    },
    {
      key: "profile-completion",
      label: "Profile Completion",
      value: `${stats.profileCompletion || 0}%`,
      hint: "Average across network",
      tone: Number(stats.profileCompletion || 0) >= 80 ? "success" : "warning"
    }
  ];
  if (showPendingApprovals) {
    statCards.splice(2, 0, {
      key: "pending-approvals",
      label: "Pending Approvals",
      value: stats.pendingApprovals || 0,
      hint: "Awaiting review",
      tone: stats.pendingApprovals > 0 ? "warning" : "neutral"
    });
  }
  const quickActions = [
    { to: `/t/${slug}/admin/members`, label: "View Members" },
    { to: `/t/${slug}/admin/email/compose`, label: "Send Email" },
    { to: `/t/${slug}/admin/members/import`, label: "Import Data" },
    { to: `/t/${slug}/admin/settings/network`, label: "Settings" }
  ];

  return (
    <div className="director-admin-stack">
      <Card>
        <AdminPageHeader
          title="Network Admin"
          subtitle={`${tenant.name || "Your Network"} · ${tenant.status || "in_setup"}${
            tenant.launchedAt ? ` · Live since ${formatDate(tenant.launchedAt)}` : ""
          }`}
          actions={
            <>
              <Link className="link-button secondary" to={`/t/${slug}/home`}>
                View Network
              </Link>
              <Button variant="secondary" onClick={loadDashboard}>
                Refresh
              </Button>
            </>
          }
        />
        {error ? <p className="error-text">{error}</p> : null}
        <div className="director-admin-stat-grid">
          {statCards.map((item) => (
            <StatCard
              key={item.key}
              label={item.label}
              value={item.value}
              hint={item.hint}
              tone={item.tone}
            />
          ))}
        </div>
      </Card>

      <div className="director-admin-two-col director-admin-dashboard-two-col">
        <Card className="director-admin-equal-panel">
          <h2 className="pb-section-title">Quick Actions</h2>
          <div className="director-admin-quick-grid">
            {quickActions.map((item) => (
              <Link key={item.to} className="link-button" to={item.to}>
                {item.label}
              </Link>
            ))}
          </div>
        </Card>

        <Card className="director-admin-equal-panel">
          <h2 className="pb-section-title">Network Status</h2>
          <p>
            <strong>Status:</strong>{" "}
            <span className={`director-admin-status-badge tone-${statusTone(tenant.status)}`.trim()}>
              {String(tenant.status || "in_setup").replace(/_/g, " ")}
            </span>
          </p>
          <p>
            <strong>Plan:</strong> {tenant.planTier || "base"}
          </p>
          <p>
            <strong>Access policy:</strong> {String(tenant.accessPolicy || "open").replace(/_/g, " ")}
          </p>
          <p>
            <strong>Last email:</strong>{" "}
            {payload?.lastEmail
              ? `${payload.lastEmail.subject} (${formatDate(payload.lastEmail.sentAt)})`
              : "No sends yet"}
          </p>
          <div className="inline-actions">
            <Link className="link-button secondary" to={`/t/${slug}/admin/billing`}>
              Manage Billing
            </Link>
          </div>
        </Card>
      </div>

      <Card>
        <h2 className="pb-section-title">Recent Activity</h2>
        {!payload?.recentActivity?.length ? (
          <p className="muted">No recent activity yet. Invite your first members to get started.</p>
        ) : (
          <ul className="director-admin-activity-list">
            {payload.recentActivity.map((item) => (
              <li key={item.id}>
                <span>{item.label}</span>
                <small>{formatDateTime(item.createdAt)}</small>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

export function DirectorAdminMembersPage() {
  const navigate = useNavigate();
  const { slug, request, download } = useAdminApi();
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState({
    role: "all",
    year: "all",
    status: "all",
    completion: "all",
    sort: "join_desc"
  });
  const [page, setPage] = useState(1);
  const [payload, setPayload] = useState(null);
  const [selected, setSelected] = useState([]);
  const [editingMember, setEditingMember] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const totalPages = Math.max(1, Math.ceil(Number(payload?.total || 0) / Number(payload?.pageSize || 25)));

  const loadMembers = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: "25",
        q: query,
        role: filters.role,
        year: filters.year,
        status: filters.status,
        completion: filters.completion,
        sort: filters.sort
      });
      const response = await request(`/members?${params.toString()}`);
      setPayload(response);
    } catch (requestError) {
      setError(requestError.message || "Failed to load members.");
    } finally {
      setLoading(false);
    }
  }, [filters.completion, filters.role, filters.sort, filters.status, filters.year, page, query, request]);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  useEffect(() => {
    setSelected((prev) => prev.filter((id) => payload?.items?.some((item) => item.id === id)));
  }, [payload?.items]);

  function toggleAll(event) {
    if (!payload?.items?.length) return;
    if (event.target.checked) {
      setSelected(payload.items.map((item) => item.id));
      return;
    }
    setSelected([]);
  }

  function toggleOne(memberId) {
    setSelected((prev) =>
      prev.includes(memberId) ? prev.filter((id) => id !== memberId) : [...prev, memberId]
    );
  }

  async function downloadCsv() {
    setError("");
    try {
      const blob = await download("/export/csv");
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${slug}-members.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (requestError) {
      setError(requestError.message || "Failed to export CSV.");
    }
  }

  async function runBulkAction(action) {
    if (selected.length === 0) return;
    setError("");
    setStatus("");
    try {
      const response = await request("/members/bulk-action", {
        method: "POST",
        body: {
          action,
          ids: selected
        }
      });

      if (action === "export" && response.csv) {
        downloadTextAsFile(response.csv, `${slug}-selected-members.csv`, "text/csv;charset=utf-8");
      }

      if (action === "email") {
        navigate(`/t/${slug}/admin/email/compose?selected=${selected.join(",")}`);
        return;
      }

      setStatus(`${response.affected || selected.length} members updated.`);
      setSelected([]);
      await loadMembers();
    } catch (requestError) {
      setError(requestError.message || "Bulk action failed.");
    }
  }

  async function saveMemberEdit(event) {
    event.preventDefault();
    if (!editingMember?.id) return;
    setSaving(true);
    setError("");
    try {
      await request(`/members/${editingMember.id}`, {
        method: "PATCH",
        body: {
          firstName: editingMember.firstName,
          lastName: editingMember.lastName,
          cityState: editingMember.location,
          roleAtCamp: editingMember.role,
          status: editingMember.status,
          bio: editingMember.bio || "",
          emails: editingMember.email ? [editingMember.email] : []
        }
      });
      setEditingMember(null);
      await loadMembers();
    } catch (requestError) {
      setError(requestError.message || "Failed to save member.");
    } finally {
      setSaving(false);
    }
  }

  const roleOptions = payload?.filters?.roleOptions || [];
  const yearOptions = payload?.filters?.yearOptions || [];

  return (
    <div className="director-admin-stack">
      <Card>
        <AdminPageHeader
          title="Members"
          subtitle="Search, filter, edit, and manage your network members."
          actions={
            <>
              <Link className="link-button" to={`/t/${slug}/admin/settings/admins`}>
                Invite Members
              </Link>
              <Link className="link-button secondary" to={`/t/${slug}/admin/members/import`}>
                Import Data
              </Link>
              <button type="button" className="link-button secondary" onClick={downloadCsv}>
                Export CSV
              </button>
            </>
          }
        />

        <div className="director-admin-filter-row">
          <Input
            value={query}
            onChange={(event) => {
              setPage(1);
              setQuery(event.target.value);
            }}
            placeholder="Search by name, email, or year..."
          />
          <Select
            value={filters.role}
            onChange={(event) => {
              setPage(1);
              setFilters((prev) => ({ ...prev, role: event.target.value }));
            }}
          >
            <option value="all">All Roles</option>
            {roleOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
          <Select
            value={filters.year}
            onChange={(event) => {
              setPage(1);
              setFilters((prev) => ({ ...prev, year: event.target.value }));
            }}
          >
            <option value="all">All Years</option>
            {yearOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
          <Select
            value={filters.status}
            onChange={(event) => {
              setPage(1);
              setFilters((prev) => ({ ...prev, status: event.target.value }));
            }}
          >
            <option value="all">All Statuses</option>
            <option value="active">Active</option>
            <option value="pending">Pending</option>
            <option value="flagged">Flagged</option>
            <option value="removed">Removed</option>
          </Select>
          <Select
            value={filters.completion}
            onChange={(event) => {
              setPage(1);
              setFilters((prev) => ({ ...prev, completion: event.target.value }));
            }}
          >
            <option value="all">All Completion</option>
            <option value="low">Low (&lt;40%)</option>
            <option value="medium">Medium (40-79%)</option>
            <option value="high">High (80%+)</option>
          </Select>
          <Select
            value={filters.sort}
            onChange={(event) => setFilters((prev) => ({ ...prev, sort: event.target.value }))}
          >
            <option value="join_desc">Newest</option>
            <option value="join_asc">Oldest</option>
            <option value="name_asc">Name A-Z</option>
            <option value="name_desc">Name Z-A</option>
            <option value="completion_desc">Completion high-low</option>
            <option value="completion_asc">Completion low-high</option>
            <option value="last_active_desc">Last active recent</option>
          </Select>
        </div>

        {selected.length > 0 ? (
          <div className="director-admin-bulk-bar">
            <span>{selected.length} members selected</span>
            <div className="inline-actions">
              <Button variant="secondary" onClick={() => runBulkAction("approve")}>
                Approve All
              </Button>
              <Button variant="secondary" onClick={() => runBulkAction("remove")}>
                Remove Selected
              </Button>
              <Button variant="secondary" onClick={() => runBulkAction("export")}>
                Export Selected
              </Button>
              <Button variant="secondary" onClick={() => navigate(`/t/${slug}/admin/email/compose?selected=${selected.join(",")}`)}>
                Email Selected
              </Button>
              <Button variant="secondary" onClick={() => setSelected([])}>
                Clear
              </Button>
            </div>
          </div>
        ) : null}

        {error ? <p className="error-text">{error}</p> : null}
        {status ? <p className="success-text">{status}</p> : null}

        <div className="director-admin-table-wrap">
          <table className="director-admin-table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    checked={Boolean(payload?.items?.length) && selected.length === payload.items.length}
                    onChange={toggleAll}
                  />
                </th>
                <th>Name</th>
                <th>Role</th>
                <th>Years at Camp</th>
                <th>Location</th>
                <th>Completion</th>
                <th>Join Date</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="muted">
                    Loading members...
                  </td>
                </tr>
              ) : !payload?.items?.length ? (
                <tr>
                  <td colSpan={9} className="muted">
                    No members found.
                  </td>
                </tr>
              ) : (
                payload.items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.includes(item.id)}
                        onChange={() => toggleOne(item.id)}
                      />
                    </td>
                    <td>
                      <div className="director-admin-member-cell">
                        <strong>{item.fullName || "Unnamed Member"}</strong>
                        <small>{item.email || "No email"}</small>
                      </div>
                    </td>
                    <td>{item.role || "Member"}</td>
                    <td>{item.yearsAtCamp?.join(", ") || "-"}</td>
                    <td>{item.location || "-"}</td>
                    <td>
                      <div className="director-admin-progress">
                        <span style={{ width: `${item.completionScore || 0}%` }} />
                      </div>
                      <small>{item.completionScore || 0}%</small>
                    </td>
                    <td>{formatDate(item.joinDate)}</td>
                    <td>
                      <span className={`director-admin-status-badge tone-${statusTone(item.status)}`.trim()}>
                        {item.status}
                      </span>
                    </td>
                    <td>
                      <div className="inline-actions">
                        <Link className="director-admin-inline-link" to={`/t/${slug}/profile/${item.id}`}>
                          View
                        </Link>
                        <button
                          type="button"
                          className="director-admin-inline-link"
                          onClick={() => setEditingMember({ ...item })}
                        >
                          Edit
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="director-admin-pagination">
          <small>
            Page {page} of {totalPages} · {payload?.total || 0} members
          </small>
          <div className="inline-actions">
            <Button variant="secondary" onClick={() => setPage((prev) => Math.max(1, prev - 1))} disabled={page <= 1}>
              Previous
            </Button>
            <Button
              variant="secondary"
              onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
              disabled={page >= totalPages}
            >
              Next
            </Button>
          </div>
        </div>
      </Card>

      {editingMember ? (
        <div className="director-admin-modal-backdrop" role="dialog" aria-modal="true">
          <div className="director-admin-modal">
            <h2>Edit Member — {editingMember.fullName}</h2>
            <form className="director-admin-form-grid" onSubmit={saveMemberEdit}>
              <label>
                First name
                <Input
                  value={editingMember.firstName || ""}
                  onChange={(event) =>
                    setEditingMember((prev) => ({ ...prev, firstName: event.target.value }))
                  }
                />
              </label>
              <label>
                Last name
                <Input
                  value={editingMember.lastName || ""}
                  onChange={(event) =>
                    setEditingMember((prev) => ({ ...prev, lastName: event.target.value }))
                  }
                />
              </label>
              <label className="full-width">
                Email
                <Input
                  value={editingMember.email || ""}
                  onChange={(event) =>
                    setEditingMember((prev) => ({ ...prev, email: event.target.value }))
                  }
                />
              </label>
              <label>
                Role
                <Input
                  value={editingMember.role || ""}
                  onChange={(event) =>
                    setEditingMember((prev) => ({ ...prev, role: event.target.value }))
                  }
                />
              </label>
              <label>
                Location
                <Input
                  value={editingMember.location || ""}
                  onChange={(event) =>
                    setEditingMember((prev) => ({ ...prev, location: event.target.value }))
                  }
                />
              </label>
              <label className="full-width">
                Bio
                <Textarea
                  value={editingMember.bio || ""}
                  onChange={(event) =>
                    setEditingMember((prev) => ({ ...prev, bio: event.target.value }))
                  }
                />
              </label>
              <label>
                Status
                <Select
                  value={editingMember.status || "active"}
                  onChange={(event) =>
                    setEditingMember((prev) => ({ ...prev, status: event.target.value }))
                  }
                >
                  <option value="active">Active</option>
                  <option value="pending">Pending</option>
                  <option value="flagged">Flagged</option>
                  <option value="removed">Removed</option>
                </Select>
              </label>
              <div className="director-admin-modal-actions full-width">
                <Button type="submit" disabled={saving}>
                  {saving ? "Saving..." : "Save Changes"}
                </Button>
                <Button type="button" variant="secondary" onClick={() => setEditingMember(null)}>
                  Cancel
                </Button>
                <Link className="link-button secondary" to={`/t/${slug}/profile/${editingMember.id}`}>
                  View Full Profile
                </Link>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function DirectorAdminApprovalsPage() {
  const { slug, request } = useAdminApi();
  const { tenant } = useTenant();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const signupMode =
    tenant?.config?.accessRules?.signupMode ||
    tenant?.settings?.signupMode ||
    tenant?.accessSettings?.signupMode ||
    "open";

  const loadApprovals = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await request("/members/approvals?status=pending");
      setItems(response.items || []);
    } catch (requestError) {
      setError(requestError.message || "Failed to load approvals.");
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    loadApprovals();
  }, [loadApprovals]);

  async function approve(requestId) {
    setError("");
    setStatus("");
    try {
      await request(`/members/approvals/${requestId}/approve`, { method: "POST" });
      setStatus("Request approved.");
      await loadApprovals();
    } catch (requestError) {
      setError(requestError.message || "Failed to approve request.");
    }
  }

  async function deny(requestId) {
    const reason = window.prompt("Optional denial reason");
    setError("");
    setStatus("");
    try {
      await request(`/members/approvals/${requestId}/deny`, {
        method: "POST",
        body: { reason: reason || "" }
      });
      setStatus("Request denied.");
      await loadApprovals();
    } catch (requestError) {
      setError(requestError.message || "Failed to deny request.");
    }
  }

  async function approveAll() {
    for (const item of items) {
      await approve(item.id);
    }
  }

  if (signupMode !== "approval_queue") {
    return (
      <Card>
        <AdminPageHeader
          title="Pending Approvals"
          subtitle="This page is only used when access policy is approval-required."
        />
        <p className="muted">
          Your current access policy is <strong>{String(signupMode).replace(/_/g, " ")}</strong>.
        </p>
        <Link className="link-button secondary" to={`/t/${slug}/admin/settings/access`}>
          Change access policy
        </Link>
      </Card>
    );
  }

  return (
    <Card>
      <AdminPageHeader
        title="Pending Approvals"
        subtitle={`${items.length} people are waiting to join ${tenant?.name || "your network"}.`}
        actions={
          items.length > 1 ? (
            <Button variant="secondary" onClick={approveAll}>
              Approve All
            </Button>
          ) : null
        }
      />
      <div className="director-admin-info-banner">
        <p>
          Your network is set to approval-required access. Review each request before granting
          access.
        </p>
        <Link className="link-button secondary" to={`/t/${slug}/admin/settings/access`}>
          Change access policy
        </Link>
      </div>
      {error ? <p className="error-text">{error}</p> : null}
      {status ? <p className="success-text">{status}</p> : null}
      <div className="director-admin-table-wrap">
        <table className="director-admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Request Message</th>
              <th>Requested</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="muted">
                  Loading pending requests...
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={6}>
                  <div className="director-admin-empty">
                    <h3>All caught up — no pending approvals.</h3>
                    <p>New requests will appear here as people try to join your network.</p>
                  </div>
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr key={item.id}>
                  <td>{`${item.firstName || ""} ${item.lastName || ""}`.trim()}</td>
                  <td>{item.email}</td>
                  <td>{item.selfReportedRole || "Member"}</td>
                  <td>{item.requestMessage || "-"}</td>
                  <td>{formatDateTime(item.requestedAt)}</td>
                  <td>
                    <div className="inline-actions">
                      <Button onClick={() => approve(item.id)}>Approve</Button>
                      <Button variant="secondary" onClick={() => deny(item.id)}>
                        Deny
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function DirectorAdminImportPage() {
  const { slug, token, request, download } = useAdminApi();
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);

  const loadHistory = useCallback(async () => {
    try {
      const payload = await requestJson("/api/tenants/me/import/history", { token });
      setHistory(payload.items || []);
    } catch {
      setHistory([]);
    }
  }, [token]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  async function runImport() {
    if (!file) {
      setError("Choose a CSV file first.");
      return;
    }

    setLoading(true);
    setError("");
    setStatus("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("enableFuzzyMatch", "true");
      formData.append("fuzzyDistance", "1");
      const payload = await request("/import-csv", {
        method: "POST",
        body: formData
      });
      setResult(payload.report || null);
      setStatus("Import completed.");
      await loadHistory();
    } catch (requestError) {
      setError(requestError.message || "Import failed.");
    } finally {
      setLoading(false);
    }
  }

  async function downloadTemplate() {
    setError("");
    try {
      const blob = await download("/members/template.csv");
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "pondbridge-members-template.csv";
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (requestError) {
      setError(requestError.message || "Unable to download template.");
    }
  }

  async function downloadFailures() {
    if (!result?.failureCsvDownloadPath) return;
    try {
      const blob = await requestBlob(result.failureCsvDownloadPath, { token });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${slug}-import-errors.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (requestError) {
      setError(requestError.message || "Unable to download error report.");
    }
  }

  return (
    <div className="director-admin-stack">
      <Card>
        <AdminPageHeader
          title="Import Members"
          subtitle="Upload a spreadsheet to add or update members in your network."
          actions={
            <button type="button" className="link-button secondary" onClick={downloadTemplate}>
              Download Template CSV
            </button>
          }
        />
        <div className="director-admin-import-steps">
          <span className={`director-admin-step-pill ${file ? "done" : "active"}`}>1. Upload</span>
          <span className={`director-admin-step-pill ${result ? "done" : file ? "active" : ""}`}>2. Validate</span>
          <span className={`director-admin-step-pill ${result ? "active" : ""}`}>3. Results</span>
        </div>
        <div className="director-admin-upload-box">
          <p>Drag and drop your CSV file here, or browse to upload.</p>
          <Input
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => setFile(event.target.files?.[0] || null)}
          />
          {file ? (
            <p className="muted">
              Selected file: <strong>{file.name}</strong>
            </p>
          ) : null}
        </div>
        <div className="inline-actions">
          <Button onClick={runImport} disabled={loading || !file}>
            {loading ? "Importing..." : "Start Import"}
          </Button>
          <Link className="link-button secondary" to={`/t/${slug}/admin/members`}>
            View Members
          </Link>
        </div>
        {error ? <p className="error-text">{error}</p> : null}
        {status ? <p className="success-text">{status}</p> : null}
      </Card>

      {result ? (
        <Card>
          <h2 className="pb-section-title">Import Results</h2>
          <div className="director-admin-import-summary">
            <p>
              <strong>Rows read:</strong> {result.rowsRead || 0}
            </p>
            <p>
              <strong>Added:</strong> {result.createdCount || 0}
            </p>
            <p>
              <strong>Updated:</strong> {result.updatedCount || 0}
            </p>
            <p>
              <strong>Skipped duplicates:</strong> {result.skippedDuplicates || 0}
            </p>
            <p>
              <strong>Errors:</strong> {result.errorCount || 0}
            </p>
          </div>
          {result.hasFailureCsv ? (
            <Button variant="secondary" onClick={downloadFailures}>
              Download Error Report
            </Button>
          ) : null}
        </Card>
      ) : null}

      <Card>
        <h2 className="pb-section-title">Past Imports</h2>
        {!history.length ? (
          <p className="muted">No past imports yet.</p>
        ) : (
          <div className="director-admin-table-wrap">
            <table className="director-admin-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>File</th>
                  <th>Added</th>
                  <th>Updated</th>
                  <th>Errors</th>
                </tr>
              </thead>
              <tbody>
                {history.map((item) => (
                  <tr key={item.id}>
                    <td>{formatDateTime(item.createdAt)}</td>
                    <td>{item.fileName}</td>
                    <td>{item.summary?.createdCount || 0}</td>
                    <td>{item.summary?.updatedCount || 0}</td>
                    <td>{item.summary?.errorCount || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

export function DirectorAdminEmailComposePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { slug, request } = useAdminApi();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [recipientPreview, setRecipientPreview] = useState({ count: 0, excludedCount: 0, preview: [] });
  const [form, setForm] = useState({
    mode: "all",
    rolesText: "",
    yearsText: "",
    customIdsText: parseIdsParam(searchParams.get("selected") || "").join(","),
    subject: String(searchParams.get("subject") || ""),
    body: String(searchParams.get("body") || ""),
    scheduleType: "now",
    scheduledFor: ""
  });

  const targeting = useMemo(() => {
    return {
      mode: form.mode,
      roles: form.rolesText
        .split(/[\n,;]+/g)
        .map((item) => String(item || "").trim())
        .filter(Boolean),
      years: form.yearsText
        .split(/[\n,;]+/g)
        .map((item) => String(item || "").trim())
        .filter(Boolean),
      profileIds: parseIdsParam(form.customIdsText),
      label:
        form.mode === "all"
          ? "All Members"
          : form.mode === "role"
          ? "By Role"
          : form.mode === "year"
          ? "By Year"
          : "Custom Selection"
    };
  }, [form.customIdsText, form.mode, form.rolesText, form.yearsText]);

  useEffect(() => {
    let active = true;
    request("/email/recipients-preview", {
      method: "POST",
      body: { targeting }
    })
      .then((payload) => {
        if (!active) return;
        setRecipientPreview(payload);
      })
      .catch(() => {
        if (!active) return;
        setRecipientPreview({ count: 0, excludedCount: 0, preview: [] });
      });

    return () => {
      active = false;
    };
  }, [request, targeting]);

  async function sendTestEmail() {
    setError("");
    setStatus("");
    try {
      await request("/email/test", {
        method: "POST",
        body: {
          subject: form.subject,
          body: form.body
        }
      });
      setStatus("Test email sent to your admin inbox.");
    } catch (requestError) {
      setError(requestError.message || "Failed to send test email.");
    }
  }

  async function sendEmail(event) {
    event.preventDefault();
    if (!form.subject.trim() || !form.body.trim() || recipientPreview.count <= 0) {
      setError("Subject, body, and at least one recipient are required.");
      return;
    }

    setSending(true);
    setError("");
    setStatus("");
    try {
      await request("/email/send", {
        method: "POST",
        body: {
          subject: form.subject,
          body: form.body,
          targeting,
          scheduledFor: form.scheduleType === "later" ? form.scheduledFor : ""
        }
      });
      setStatus("Email queued successfully.");
      navigate(`/t/${slug}/admin/email/history`);
    } catch (requestError) {
      setError(requestError.message || "Failed to send email.");
    } finally {
      setSending(false);
    }
  }

  return (
    <Card>
      <AdminPageHeader
        title="Send Email"
        subtitle="Compose and send a branded email to your network."
        actions={
          <Link className="link-button secondary" to={`/t/${slug}/admin/email/history`}>
            Sent History
          </Link>
        }
      />
      <form className="director-admin-email-layout" onSubmit={sendEmail}>
        <section className="director-admin-email-composer director-admin-email-composer-full">
          <label>
            To
            <Select
              value={form.mode}
              onChange={(event) => setForm((prev) => ({ ...prev, mode: event.target.value }))}
            >
              <option value="all">All Members</option>
              <option value="role">By Role</option>
              <option value="year">By Year</option>
              <option value="custom">Custom Selection</option>
            </Select>
          </label>
          {form.mode === "role" ? (
            <label>
              Roles (comma or line separated)
              <Textarea
                value={form.rolesText}
                onChange={(event) => setForm((prev) => ({ ...prev, rolesText: event.target.value }))}
                placeholder="Camper, Counselor"
              />
            </label>
          ) : null}
          {form.mode === "year" ? (
            <label>
              Years at camp (comma or line separated)
              <Textarea
                value={form.yearsText}
                onChange={(event) => setForm((prev) => ({ ...prev, yearsText: event.target.value }))}
                placeholder="2018, 2019, 2020"
              />
            </label>
          ) : null}
          {form.mode === "custom" ? (
            <label>
              Member IDs
              <Textarea
                value={form.customIdsText}
                onChange={(event) => setForm((prev) => ({ ...prev, customIdsText: event.target.value }))}
                placeholder="Paste member profile IDs separated by commas"
              />
            </label>
          ) : null}
          <p className="muted">
            {recipientPreview.count || 0} members will receive this email.
            {recipientPreview.excludedCount ? ` ${recipientPreview.excludedCount} excluded.` : ""}
          </p>

          <label>
            Subject
            <Input
              value={form.subject}
              maxLength={120}
              onChange={(event) => setForm((prev) => ({ ...prev, subject: event.target.value }))}
              placeholder="Subject line"
            />
          </label>
          <label>
            Body
            <Textarea
              value={form.body}
              onChange={(event) => setForm((prev) => ({ ...prev, body: event.target.value }))}
              placeholder="Write your message here..."
            />
          </label>

          <label>
            Send timing
            <Select
              value={form.scheduleType}
              onChange={(event) => setForm((prev) => ({ ...prev, scheduleType: event.target.value }))}
            >
              <option value="now">Send now</option>
              <option value="later">Schedule for later</option>
            </Select>
          </label>
          {form.scheduleType === "later" ? (
            <label>
              Scheduled date/time
              <Input
                type="datetime-local"
                value={form.scheduledFor}
                onChange={(event) => setForm((prev) => ({ ...prev, scheduledFor: event.target.value }))}
              />
            </label>
          ) : null}

          {error ? <p className="error-text">{error}</p> : null}
          {status ? <p className="success-text">{status}</p> : null}
          <div className="inline-actions">
            <Button type="button" variant="secondary" onClick={sendTestEmail}>
              Send Test Email
            </Button>
            <Button type="submit" disabled={sending || recipientPreview.count <= 0}>
              {sending ? "Sending..." : form.scheduleType === "later" ? "Schedule Email" : "Send Email"}
            </Button>
          </div>
          <div className="director-admin-recipient-preview">
            <h3>Recipient preview</h3>
            <p className="muted">Sending to: {recipientPreview.count || 0} members</p>
            <ul className="director-admin-preview-recipient-list">
              {(recipientPreview.preview || []).map((person) => (
                <li key={person.id}>
                  <span>{person.name}</span>
                  <small>{person.email}</small>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </form>
    </Card>
  );
}

export function DirectorAdminEmailHistoryPage() {
  const { slug, request } = useAdminApi();
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadHistory = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await request("/email/history");
      setItems(response.items || []);
    } catch (requestError) {
      setError(requestError.message || "Failed to load sent emails.");
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  return (
    <Card>
      <AdminPageHeader
        title="Sent Emails"
        subtitle="Delivery and engagement history for your network sends."
        actions={
          <Link className="link-button" to={`/t/${slug}/admin/email/compose`}>
            Compose New Email
          </Link>
        }
      />
      {error ? <p className="error-text">{error}</p> : null}
      <div className="director-admin-table-wrap">
        <table className="director-admin-table">
          <thead>
            <tr>
              <th>Subject</th>
              <th>Recipients</th>
              <th>Sent</th>
              <th>Open Rate</th>
              <th>Click Rate</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="muted">
                  Loading sent emails...
                </td>
              </tr>
            ) : !items.length ? (
              <tr>
                <td colSpan={7}>
                  <div className="director-admin-empty">
                    <h3>No emails sent yet.</h3>
                    <p>Compose your first email to the network.</p>
                  </div>
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr key={item.id}>
                  <td>{item.subject}</td>
                  <td>{item.recipientCount || 0}</td>
                  <td>{formatDateTime(item.sentAt || item.createdAt)}</td>
                  <td>{Number(item.stats?.openRate || 0).toFixed(1)}%</td>
                  <td>{Number(item.stats?.clickRate || 0).toFixed(1)}%</td>
                  <td>
                    <span className={`director-admin-status-badge tone-${statusTone(item.status)}`.trim()}>
                      {item.status}
                    </span>
                  </td>
                  <td>
                    <button type="button" className="director-admin-inline-link" onClick={() => setSelected(item)}>
                      View Details
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {selected ? (
        <div className="director-admin-modal-backdrop">
          <div className="director-admin-modal">
            <h2>{selected.subject}</h2>
            <p className="muted">
              {selected.status} · {formatDateTime(selected.sentAt || selected.createdAt)}
            </p>
            <p>
              <strong>Recipients:</strong> {selected.recipientCount}
            </p>
            <p>
              <strong>Open rate:</strong> {Number(selected.stats?.openRate || 0).toFixed(1)}%
            </p>
            <p>
              <strong>Click rate:</strong> {Number(selected.stats?.clickRate || 0).toFixed(1)}%
            </p>
            <Textarea value={selected.body || ""} readOnly />
            <div className="director-admin-modal-actions">
              <Link
                className="link-button secondary"
                to={`/t/${slug}/admin/email/compose?subject=${encodeURIComponent(selected.subject)}&body=${encodeURIComponent(selected.body || "")}`}
              >
                Resend as new
              </Link>
              <Button variant="secondary" onClick={() => setSelected(null)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function SimpleBars({ items = [], valueKey = "count", labelKey = "label" }) {
  const max = Math.max(1, ...items.map((item) => Number(item[valueKey] || 0)));
  return (
    <div className="director-admin-bars">
      {items.map((item) => {
        const value = Number(item[valueKey] || 0);
        return (
          <div key={`${item[labelKey]}_${value}`} className="director-admin-bar-row">
            <p>{item[labelKey]}</p>
            <div className="director-admin-bar-track">
              <span style={{ width: `${Math.max(6, Math.round((value / max) * 100))}%` }} />
            </div>
            <strong>{value}</strong>
          </div>
        );
      })}
    </div>
  );
}

export function DirectorAdminAnalyticsPage() {
  const { request } = useAdminApi();
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadAnalytics = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await request("/analytics/network");
      setPayload(response);
    } catch (requestError) {
      setError(requestError.message || "Failed to load analytics.");
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    loadAnalytics();
  }, [loadAnalytics]);

  if (loading && !payload) {
    return (
      <Card>
        <p className="muted">Loading analytics...</p>
      </Card>
    );
  }

  return (
    <div className="director-admin-stack">
      <Card>
        <AdminPageHeader
          title="Network Analytics"
          subtitle={`Analytics data updates daily. Last generated: ${formatDateTime(payload?.generatedAt)}`}
          actions={<Button variant="secondary" onClick={loadAnalytics}>Refresh</Button>}
        />
        {error ? <p className="error-text">{error}</p> : null}
        <div className="director-admin-stat-grid">
          <StatCard label="Active Members (7d)" value={payload?.metrics?.activeMembers7d || 0} />
          <StatCard label="Total Members" value={payload?.metrics?.totalMembers || 0} />
          <StatCard label="Directory Searches (30d)" value={payload?.metrics?.directorySearches30d || 0} />
          <StatCard
            label="Profile Completion"
            value={`${payload?.metrics?.profileCompletion || 0}%`}
            tone={Number(payload?.metrics?.profileCompletion || 0) >= 80 ? "success" : "warning"}
          />
        </div>
      </Card>

      <div className="director-admin-two-col">
        <Card>
          <h2 className="pb-section-title">Feature Usage</h2>
          <SimpleBars
            items={(payload?.featureUsage || []).map((item) => ({
              label: item.module,
              count: item.count
            }))}
          />
        </Card>
        <Card>
          <h2 className="pb-section-title">New vs Returning</h2>
          <SimpleBars
            items={(payload?.newVsReturningByWeek || []).map((item) => ({
              label: item.week,
              count: item.returningMembers + item.newMembers
            }))}
          />
        </Card>
      </div>

      <Card>
        <h2 className="pb-section-title">Most Active Members (Last 30 Days)</h2>
        <div className="director-admin-table-wrap">
          <table className="director-admin-table">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Name</th>
                <th>Role</th>
                <th>Logins</th>
                <th>Profile Complete</th>
                <th>Last Active</th>
              </tr>
            </thead>
            <tbody>
              {(payload?.topActiveMembers || []).slice(0, 10).map((item, index) => (
                <tr key={item.profileId || item.userId}>
                  <td>{index + 1}</td>
                  <td>{item.name}</td>
                  <td>{item.role}</td>
                  <td>{item.logins}</td>
                  <td>{item.completionScore}%</td>
                  <td>{formatDateTime(item.lastActiveAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <h2 className="pb-section-title">Email Campaign Performance</h2>
        <div className="director-admin-table-wrap">
          <table className="director-admin-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Subject</th>
                <th>Recipients</th>
                <th>Open Rate</th>
                <th>Click Rate</th>
              </tr>
            </thead>
            <tbody>
              {(payload?.emailPerformance || []).map((item) => (
                <tr key={item.id}>
                  <td>{formatDate(item.sentAt)}</td>
                  <td>{item.subject}</td>
                  <td>{item.recipientCount}</td>
                  <td>{Number(item.openRate || 0).toFixed(1)}%</td>
                  <td>{Number(item.clickRate || 0).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function modulePreviewPath(slug, key) {
  const map = {
    directory: `/t/${slug}/search`,
    search: `/t/${slug}/search`,
    photoStream: `/t/${slug}/photo-stream`,
    chat: `/t/${slug}/chat-rooms`,
    map: `/t/${slug}/location-map`,
    familyTrees: `/t/${slug}/family-trees`,
    relatedProfiles: `/t/${slug}/search`,
    newsletter: `/t/${slug}/cedar-chest`,
    merchShop: `/t/${slug}/home`
  };
  return map[key] || `/t/${slug}/home`;
}

export function DirectorAdminFeaturesPage() {
  const { slug, request } = useAdminApi();
  const [payload, setPayload] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [moduleDisplayNames, setModuleDisplayNames] = useState({ newsletter: "Newsletter" });

  const loadFeatures = useCallback(async () => {
    setError("");
    try {
      const response = await request("/features");
      setPayload(response);
      setModuleDisplayNames(response.moduleDisplayNames || { newsletter: "Newsletter" });
    } catch (requestError) {
      setError(requestError.message || "Failed to load features.");
    }
  }, [request]);

  useEffect(() => {
    loadFeatures();
  }, [loadFeatures]);

  async function saveModules(nextModules, nextNames = moduleDisplayNames) {
    setSaving(true);
    setError("");
    setStatus("");
    try {
      await request("/features", {
        method: "PATCH",
        body: {
          modules: nextModules,
          moduleDisplayNames: nextNames
        }
      });
      setStatus("Features updated.");
      await loadFeatures();
    } catch (requestError) {
      setError(requestError.message || "Failed to update features.");
    } finally {
      setSaving(false);
    }
  }

  if (!payload) {
    return (
      <Card>
        <p className="muted">Loading features...</p>
      </Card>
    );
  }

  return (
    <Card>
      <AdminPageHeader
        title="Features & Modules"
        subtitle="Control which features are active in your network. Changes apply immediately."
        actions={
          <>
            <Badge tone="neutral">{payload?.tenant?.planTier || "base"} plan</Badge>
            {payload?.tenant?.planTier === "base" ? (
              <Link className="link-button secondary" to={`/t/${slug}/admin/billing`}>
                Upgrade Plan
              </Link>
            ) : null}
          </>
        }
      />
      {error ? <p className="error-text">{error}</p> : null}
      {status ? <p className="success-text">{status}</p> : null}
      <div className="director-admin-modules-grid">
        {(payload.modules || []).map((module) => (
          <article
            key={module.key}
            className={`director-admin-module-card ${module.enabled ? "is-enabled" : ""} ${module.locked ? "is-locked" : ""}`.trim()}
          >
            <header>
              <div>
                <h3>{module.label}</h3>
                <p>{module.description}</p>
              </div>
              {module.locked ? (
                <span className="director-admin-status-badge tone-warning">Premium</span>
              ) : (
                <label className="director-admin-switch">
                  <input
                    type="checkbox"
                    checked={Boolean(module.enabled)}
                    onChange={(event) => {
                      const nextEnabled = Boolean(event.target.checked);
                      if (!nextEnabled && module.enabled) {
                        const confirmed = window.confirm(
                          `Turn off ${module.label}? This hides it from members, but data is preserved.`
                        );
                        if (!confirmed) return;
                      }
                      const nextModules = Object.fromEntries(
                        payload.modules.map((item) => [item.key, item.key === module.key ? nextEnabled : item.enabled])
                      );
                      setPayload((prev) => ({
                        ...prev,
                        modules: prev.modules.map((item) =>
                          item.key === module.key ? { ...item, enabled: nextEnabled } : item
                        )
                      }));
                      saveModules(nextModules);
                    }}
                    disabled={saving}
                  />
                  <span>{module.enabled ? "On" : "Off"}</span>
                </label>
              )}
            </header>
            {module.key === "newsletter" && !module.locked ? (
              <div className="director-admin-module-settings">
                <label>
                  Newsletter display name
                  <Input
                    value={moduleDisplayNames.newsletter || ""}
                    onChange={(event) =>
                      setModuleDisplayNames((prev) => ({ ...prev, newsletter: event.target.value }))
                    }
                    placeholder="Newsletter"
                  />
                </label>
                <Button
                  variant="secondary"
                  onClick={() => {
                    const nextModules = Object.fromEntries(
                      payload.modules.map((item) => [item.key, item.enabled])
                    );
                    saveModules(nextModules, moduleDisplayNames);
                  }}
                  disabled={saving}
                >
                  Save Settings
                </Button>
              </div>
            ) : null}
            {module.locked ? (
              <p className="muted">This feature requires Premium.</p>
            ) : (
              <Link className="director-admin-inline-link" to={modulePreviewPath(slug, module.key)}>
                Preview in network
              </Link>
            )}
          </article>
        ))}
      </div>
    </Card>
  );
}

export function DirectorAdminBillingPage() {
  const { request } = useAdminApi();
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadBilling = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await request("/billing");
      setPayload(response);
    } catch (requestError) {
      setError(requestError.message || "Failed to load billing.");
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    loadBilling();
  }, [loadBilling]);

  if (loading && !payload) {
    return (
      <Card>
        <p className="muted">Loading billing...</p>
      </Card>
    );
  }

  const tenant = payload?.tenant || {};
  const usage = payload?.usage || {};
  const billingStatus = String(tenant.billingStatus || "").toLowerCase();
  const showTrialBanner = billingStatus === "trialing";
  const showPastDueBanner = billingStatus === "past_due";

  return (
    <div className="director-admin-stack">
      {showTrialBanner ? (
        <Card className="director-admin-banner tone-info">
          <p>Your free trial is active. Add a payment method to keep your network live.</p>
          {payload?.manageBillingUrl ? (
            <a className="link-button" href={payload.manageBillingUrl} target="_blank" rel="noreferrer">
              Add Payment Method
            </a>
          ) : null}
        </Card>
      ) : null}

      {showPastDueBanner ? (
        <Card className="director-admin-banner tone-danger">
          <p>Your payment failed. Update your payment method to restore full access.</p>
          {payload?.manageBillingUrl ? (
            <a className="link-button" href={payload.manageBillingUrl} target="_blank" rel="noreferrer">
              Update Payment Method
            </a>
          ) : null}
        </Card>
      ) : null}

      <div className="director-admin-two-col">
        <Card>
          <AdminPageHeader
            title="Billing"
            subtitle="Plan and billing summary for your network."
            actions={<Button variant="secondary" onClick={loadBilling}>Refresh</Button>}
          />
          {error ? <p className="error-text">{error}</p> : null}
          <p>
            <strong>Plan:</strong> {tenant.planTier === "premium" ? "Premium Plan" : "Base Plan"}
          </p>
          <p>
            <strong>Status:</strong>{" "}
            <span className={`director-admin-status-badge tone-${statusTone(tenant.billingStatus)}`.trim()}>
              {String(tenant.billingStatus || "trialing").replace(/_/g, " ")}
            </span>
          </p>
          <p>
            <strong>Onboarding fee:</strong> {formatMoney(tenant.onboardingFeeAmount)}
          </p>
          <p>
            <strong>Onboarding paid:</strong> {tenant.onboardingFeePaid ? "Yes" : "No"}
          </p>
          <p>
            <strong>Members:</strong>{" "}
            {usage.memberLimit ? `${usage.members} / ${usage.memberLimit}` : `${usage.members} (unlimited)`}
          </p>
          {usage.memberLimit ? (
            <div className="director-admin-progress">
              <span style={{ width: `${Math.min(100, usage.memberUsagePercent || 0)}%` }} />
            </div>
          ) : null}
          <div className="inline-actions">
            {payload?.manageBillingUrl ? (
              <a className="link-button" href={payload.manageBillingUrl} target="_blank" rel="noreferrer">
                Manage Billing
              </a>
            ) : (
              <Button variant="secondary" disabled>
                Billing Portal Unavailable
              </Button>
            )}
          </div>
        </Card>

        {tenant.planTier === "base" ? (
          <Card>
            <h2 className="pb-section-title">Unlock Premium</h2>
            <p className="muted">Everything in Base, plus:</p>
            <ul className="director-admin-feature-list">
              <li>Advanced analytics</li>
              <li>Premium modules</li>
              <li>Priority support</li>
              <li>Custom domain options</li>
            </ul>
            {payload?.manageBillingUrl ? (
              <a className="link-button" href={payload.manageBillingUrl} target="_blank" rel="noreferrer">
                Upgrade to Premium
              </a>
            ) : null}
          </Card>
        ) : null}
      </div>

      <Card>
        <h2 className="pb-section-title">Recent Invoices</h2>
        {!payload?.invoices?.length ? (
          <p className="muted">Invoice history will appear here once Stripe sync is enabled.</p>
        ) : (
          <div className="director-admin-table-wrap">
            <table className="director-admin-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Download</th>
                </tr>
              </thead>
              <tbody>
                {payload.invoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td>{formatDate(invoice.date)}</td>
                    <td>{formatMoney(invoice.amount)}</td>
                    <td>{invoice.status}</td>
                    <td>
                      {invoice.pdfUrl ? (
                        <a href={invoice.pdfUrl} target="_blank" rel="noreferrer">
                          PDF
                        </a>
                      ) : (
                        "-"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function useSettingsLoader() {
  const { request } = useAdminApi();
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await request("/settings");
      setPayload(response);
    } catch (requestError) {
      setError(requestError.message || "Failed to load settings.");
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    load();
  }, [load]);

  return { payload, setPayload, loading, error, load };
}

export function DirectorAdminSettingsLayout() {
  return <div className="director-admin-settings-content"><Outlet /></div>;
}

export function DirectorAdminSettingsNetworkPage() {
  const { request } = useAdminApi();
  const { payload, loading, error, load } = useSettingsLoader();
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [form, setForm] = useState({
    networkName: "",
    tagline: "",
    aboutText: "",
    contactEmail: "",
    websiteUrl: ""
  });

  useEffect(() => {
    if (!payload?.identity) return;
    setForm({
      networkName: payload.identity.networkName || "",
      tagline: payload.identity.tagline || "",
      aboutText: payload.identity.aboutText || "",
      contactEmail: payload.identity.contactEmail || "",
      websiteUrl: payload.identity.websiteUrl || ""
    });
  }, [payload?.identity]);

  async function saveIdentity(event) {
    event.preventDefault();
    setSaving(true);
    setStatus("");
    try {
      await request("/settings/identity", { method: "PATCH", body: form });
      setStatus("Network identity saved.");
      await load();
    } finally {
      setSaving(false);
    }
  }

  if (loading && !payload) return <Card><p className="muted">Loading settings...</p></Card>;

  return (
    <Card>
      <h2 className="pb-section-title">Network Identity</h2>
      {error ? <p className="error-text">{error}</p> : null}
      {status ? <p className="success-text">{status}</p> : null}
      <form className="director-admin-form-grid" onSubmit={saveIdentity}>
        <label>
          Network Name
          <Input value={form.networkName} onChange={(event) => setForm((prev) => ({ ...prev, networkName: event.target.value }))} />
        </label>
        <label>
          Tagline
          <Input value={form.tagline} maxLength={120} onChange={(event) => setForm((prev) => ({ ...prev, tagline: event.target.value }))} />
        </label>
        <label className="full-width">
          About Text
          <Textarea value={form.aboutText} onChange={(event) => setForm((prev) => ({ ...prev, aboutText: event.target.value }))} />
        </label>
        <label>
          Contact Email
          <Input type="email" value={form.contactEmail} onChange={(event) => setForm((prev) => ({ ...prev, contactEmail: event.target.value }))} />
        </label>
        <label>
          Website URL
          <Input type="url" value={form.websiteUrl} onChange={(event) => setForm((prev) => ({ ...prev, websiteUrl: event.target.value }))} />
        </label>
        <div className="director-admin-form-actions full-width">
          <Button type="submit" disabled={saving}>
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function DirectorAdminSettingsBrandingPage() {
  const { request, slug, token } = useAdminApi();
  const { payload, loading, error, load } = useSettingsLoader();
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [uploadingField, setUploadingField] = useState("");
  const [form, setForm] = useState({
    brandPrimary: "#002b5c",
    logoUrl: "",
    heroImageUrl: ""
  });

  useEffect(() => {
    if (!payload?.branding) return;
    setForm({
      brandPrimary: payload.branding.brandPrimary || "#002b5c",
      logoUrl: payload.branding.logoUrl || "",
      heroImageUrl: payload.branding.heroImageUrl || ""
    });
  }, [payload?.branding]);

  async function uploadBrandingBlob({ blob, fileType, scope }) {
    const extension =
      fileType === "image/png"
        ? "png"
        : fileType === "image/webp"
          ? "webp"
          : fileType === "image/gif"
            ? "gif"
            : fileType === "image/svg+xml"
              ? "svg"
              : "jpg";

    const presign = await requestJson(`/api/t/${slug}/uploads/presign-public`, {
      method: "POST",
      token,
      body: {
        fileName: `${scope}-${Date.now()}.${extension}`,
        fileType: fileType || "image/jpeg",
        scope
      }
    });

    const headers =
      presign?.headers && typeof presign.headers === "object" ? presign.headers : undefined;
    const uploadResponse = await fetch(String(presign?.uploadUrl || ""), {
      method: "PUT",
      ...(headers ? { headers } : {}),
      body: blob
    });

    if (!uploadResponse.ok) {
      throw new Error("Upload failed.");
    }

    const objectUrl = String(presign?.objectUrl || presign?.publicUrl || "").trim();
    if (!objectUrl) {
      throw new Error("Upload succeeded but no object URL was returned.");
    }

    return objectUrl;
  }

  async function saveBranding(event) {
    event.preventDefault();
    setSaving(true);
    setStatus("");
    setUploadError("");
    try {
      const payloadToSave = { ...form };
      if (String(payloadToSave.logoUrl || "").startsWith("data:")) {
        const blob = await fetch(payloadToSave.logoUrl).then((response) => response.blob());
        payloadToSave.logoUrl = await uploadBrandingBlob({
          blob,
          fileType: blob.type || "image/jpeg",
          scope: "branding-logo"
        });
      }
      if (String(payloadToSave.heroImageUrl || "").startsWith("data:")) {
        const blob = await fetch(payloadToSave.heroImageUrl).then((response) => response.blob());
        payloadToSave.heroImageUrl = await uploadBrandingBlob({
          blob,
          fileType: blob.type || "image/jpeg",
          scope: "branding-hero"
        });
      }

      await request("/settings/branding", { method: "PATCH", body: payloadToSave });
      setForm(payloadToSave);
      setStatus("Branding saved.");
      await load();
    } catch (saveError) {
      setUploadError(saveError.message || "Unable to save branding.");
    } finally {
      setSaving(false);
    }
  }

  async function onFilePick(field, file) {
    if (!file) return;
    if (!String(file.type || "").startsWith("image/")) {
      setUploadError("Only image files are supported for branding uploads.");
      return;
    }

    const scope = field === "logoUrl" ? "branding-logo" : "branding-hero";
    setUploadError("");
    setStatus("");
    setUploadingField(field);

    try {
      const objectUrl = await uploadBrandingBlob({
        blob: file,
        fileType: file.type || "image/jpeg",
        scope
      });
      setForm((prev) => ({ ...prev, [field]: objectUrl }));
    } catch (uploadErrorState) {
      setUploadError(uploadErrorState.message || "Unable to upload image.");
    } finally {
      setUploadingField("");
    }
  }

  if (loading && !payload) return <Card><p className="muted">Loading settings...</p></Card>;

  return (
    <Card>
      <h2 className="pb-section-title">Branding</h2>
      {error ? <p className="error-text">{error}</p> : null}
      {uploadError ? <p className="error-text">{uploadError}</p> : null}
      {status ? <p className="success-text">{status}</p> : null}
      <form className="director-admin-form-grid" onSubmit={saveBranding}>
        <label className="full-width">
          Logo Upload
          <Input type="file" accept="image/*" onChange={(event) => onFilePick("logoUrl", event.target.files?.[0] || null)} />
        </label>
        <label className="full-width">
          Hero Image Upload
          <Input type="file" accept="image/*" onChange={(event) => onFilePick("heroImageUrl", event.target.files?.[0] || null)} />
        </label>
        <label>
          Primary Color
          <Input type="color" value={form.brandPrimary} onChange={(event) => setForm((prev) => ({ ...prev, brandPrimary: event.target.value }))} />
        </label>
        <label>
          Primary Color Hex
          <Input value={form.brandPrimary} onChange={(event) => setForm((prev) => ({ ...prev, brandPrimary: event.target.value }))} />
        </label>
        <div className="director-admin-brand-preview full-width" style={{ borderColor: form.brandPrimary }}>
          <div className="director-admin-brand-preview-head" style={{ background: form.brandPrimary }}>
            {form.logoUrl ? <img src={form.logoUrl} alt="" /> : <span>PB</span>}
            <strong>Preview — network header</strong>
          </div>
          <div className="director-admin-brand-preview-body">
            {form.heroImageUrl ? <img src={form.heroImageUrl} alt="" /> : <p className="muted">Hero preview</p>}
          </div>
        </div>
        <div className="director-admin-form-actions full-width">
          <Button type="submit" disabled={saving || Boolean(uploadingField)}>
            {uploadingField ? "Uploading..." : saving ? "Saving..." : "Save Branding"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function DirectorAdminSettingsAccessPage() {
  const { request } = useAdminApi();
  const { payload, loading, error, load } = useSettingsLoader();
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [form, setForm] = useState({
    signupMode: "open",
    accessCode: "",
    allowedEmailDomains: "",
    requireProfileCompletion: false
  });

  useEffect(() => {
    if (!payload?.access) return;
    setForm({
      signupMode: payload.access.signupMode || "open",
      accessCode: "",
      allowedEmailDomains: (payload.access.allowedEmailDomains || []).join("\n"),
      requireProfileCompletion: Boolean(payload.access.requireProfileCompletion)
    });
  }, [payload?.access]);

  async function saveAccess(event) {
    event.preventDefault();
    setSaving(true);
    setStatus("");
    try {
      await request("/settings/access", {
        method: "PATCH",
        body: {
          signupMode: form.signupMode,
          accessCode: form.accessCode,
          allowedEmailDomains: form.allowedEmailDomains,
          requireProfileCompletion: form.requireProfileCompletion
        }
      });
      setStatus("Access settings saved.");
      await load();
    } finally {
      setSaving(false);
    }
  }

  if (loading && !payload) return <Card><p className="muted">Loading settings...</p></Card>;

  return (
    <Card>
      <h2 className="pb-section-title">Access Policy</h2>
      {error ? <p className="error-text">{error}</p> : null}
      {status ? <p className="success-text">{status}</p> : null}
      <form className="director-admin-form-grid" onSubmit={saveAccess}>
        <label className="full-width">
          How do people join your network?
          <Select value={form.signupMode} onChange={(event) => setForm((prev) => ({ ...prev, signupMode: event.target.value }))}>
            <option value="open">Open</option>
            <option value="code">Code</option>
            <option value="approval_queue">Approval required</option>
            <option value="invite_only">Invite only</option>
          </Select>
        </label>
        {form.signupMode === "code" ? (
          <label className="full-width">
            Join Code
            <Input
              value={form.accessCode}
              onChange={(event) => setForm((prev) => ({ ...prev, accessCode: event.target.value }))}
              placeholder="Set or rotate join code"
            />
          </label>
        ) : null}
        <label className="full-width">
          Allowed email domains (optional, one per line)
          <Textarea
            value={form.allowedEmailDomains}
            onChange={(event) => setForm((prev) => ({ ...prev, allowedEmailDomains: event.target.value }))}
          />
        </label>
        <label className="director-admin-inline-check full-width">
          <input
            type="checkbox"
            checked={form.requireProfileCompletion}
            onChange={(event) => setForm((prev) => ({ ...prev, requireProfileCompletion: event.target.checked }))}
          />
          <span>Require profile completion for access to all modules.</span>
        </label>
        <div className="director-admin-form-actions full-width">
          <Button type="submit" disabled={saving}>
            {saving ? "Saving..." : "Save Access Settings"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function DirectorAdminSettingsAdminsPage() {
  const { request } = useAdminApi();
  const [payload, setPayload] = useState({ admins: [], pendingInvites: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const loadAdmins = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await request("/settings/admins");
      setPayload(response);
    } catch (requestError) {
      setError(requestError.message || "Failed to load admin list.");
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    loadAdmins();
  }, [loadAdmins]);

  async function inviteAdmin(event) {
    event.preventDefault();
    setSaving(true);
    setStatus("");
    setError("");
    try {
      await request("/settings/admins/invite", {
        method: "POST",
        body: { email }
      });
      setStatus("Admin invite sent.");
      setEmail("");
      await loadAdmins();
    } catch (requestError) {
      setError(requestError.message || "Failed to send invite.");
    } finally {
      setSaving(false);
    }
  }

  async function removeAdmin(userId) {
    if (!window.confirm("Remove this admin?")) return;
    setError("");
    try {
      await request(`/settings/admins/${userId}`, { method: "DELETE" });
      await loadAdmins();
    } catch (requestError) {
      setError(requestError.message || "Failed to remove admin.");
    }
  }

  return (
    <Card>
      <h2 className="pb-section-title">Admins</h2>
      {error ? <p className="error-text">{error}</p> : null}
      {status ? <p className="success-text">{status}</p> : null}
      <div className="director-admin-table-wrap">
        <table className="director-admin-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Role</th>
              <th>Added</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} className="muted">
                  Loading admins...
                </td>
              </tr>
            ) : (
              payload.admins.map((item) => (
                <tr key={item.id}>
                  <td>{item.email}</td>
                  <td>{item.role}</td>
                  <td>{formatDate(item.addedAt)}</td>
                  <td>
                    {item.role === "Director" ? (
                      <span className="muted">Protected</span>
                    ) : (
                      <button type="button" className="director-admin-inline-link" onClick={() => removeAdmin(item.id)}>
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <form className="director-admin-inline-form" onSubmit={inviteAdmin}>
        <Input
          type="email"
          value={email}
          placeholder="director2@yourcamp.org"
          onChange={(event) => setEmail(event.target.value)}
        />
        <Button type="submit" disabled={saving || !email.trim()}>
          {saving ? "Sending..." : "Send Invite"}
        </Button>
      </form>

      {payload.pendingInvites.length ? (
        <>
          <h3 className="pb-section-title">Pending Invites</h3>
          <ul className="director-admin-simple-list">
            {payload.pendingInvites.map((item) => (
              <li key={item.id}>
                <span>{item.email}</span>
                <small>Expires {formatDate(item.expiresAt)}</small>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </Card>
  );
}

export function DirectorAdminSettingsNotificationsPage() {
  const { request } = useAdminApi();
  const { payload, loading, error, load } = useSettingsLoader();
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [form, setForm] = useState({
    newMemberJoined: true,
    approvalRequests: true,
    memberFlagged: true,
    weeklySummary: true
  });

  useEffect(() => {
    if (!payload?.notifications) return;
    setForm({
      newMemberJoined: Boolean(payload.notifications.newMemberJoined),
      approvalRequests: Boolean(payload.notifications.approvalRequests),
      memberFlagged: Boolean(payload.notifications.memberFlagged),
      weeklySummary: Boolean(payload.notifications.weeklySummary)
    });
  }, [payload?.notifications]);

  async function saveNotifications(event) {
    event.preventDefault();
    setSaving(true);
    setStatus("");
    try {
      await request("/settings/notifications", {
        method: "PATCH",
        body: form
      });
      setStatus("Notification preferences saved.");
      await load();
    } finally {
      setSaving(false);
    }
  }

  if (loading && !payload) return <Card><p className="muted">Loading settings...</p></Card>;

  return (
    <Card>
      <h2 className="pb-section-title">Notification Preferences</h2>
      {error ? <p className="error-text">{error}</p> : null}
      {status ? <p className="success-text">{status}</p> : null}
      <form className="director-admin-form-grid" onSubmit={saveNotifications}>
        {[
          ["newMemberJoined", "New member joined"],
          ["approvalRequests", "Approval requests"],
          ["memberFlagged", "Member flagged"],
          ["weeklySummary", "Weekly summary"]
        ].map(([key, label]) => (
          <label key={key} className="director-admin-inline-check full-width">
            <input
              type="checkbox"
              checked={Boolean(form[key])}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  [key]: event.target.checked
                }))
              }
            />
            <span>{label}</span>
          </label>
        ))}
        <div className="director-admin-form-actions full-width">
          <Button type="submit" disabled={saving}>
            {saving ? "Saving..." : "Save Preferences"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function DirectorAdminSettingsDangerPage() {
  const { request } = useAdminApi();
  const { payload, loading, error, load } = useSettingsLoader();
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleteNote, setDeleteNote] = useState("");

  async function togglePause(paused) {
    setBusy(true);
    setStatus("");
    try {
      await request("/settings/pause", { method: "POST", body: { paused } });
      setStatus(paused ? "Network paused." : "Network resumed.");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function requestDeletion(event) {
    event.preventDefault();
    setBusy(true);
    setStatus("");
    try {
      await request("/settings/delete-request", {
        method: "POST",
        body: { note: deleteNote }
      });
      setStatus("Deletion requested. Our team will follow up within 24 hours.");
      setDeleteNote("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (loading && !payload) return <Card><p className="muted">Loading settings...</p></Card>;

  const isPaused = payload?.tenant?.status === "inactive";

  return (
    <Card className="director-admin-danger-card">
      <h2 className="pb-section-title">Danger Zone</h2>
      {error ? <p className="error-text">{error}</p> : null}
      {status ? <p className="success-text">{status}</p> : null}
      <div className="director-admin-danger-block">
        <h3>Pause Network</h3>
        <p>Temporarily hide your network. Members cannot log in while paused.</p>
        <Button variant="secondary" onClick={() => togglePause(!isPaused)} disabled={busy}>
          {isPaused ? "Resume Network" : "Pause Network"}
        </Button>
      </div>
      <div className="director-admin-danger-block">
        <h3>Request Deletion</h3>
        <p>
          Deletion requires super admin confirmation and is processed with a safety window.
        </p>
        <form className="director-admin-form-grid" onSubmit={requestDeletion}>
          <label className="full-width">
            Note to PondBridge (optional)
            <Textarea value={deleteNote} onChange={(event) => setDeleteNote(event.target.value)} />
          </label>
          <div className="director-admin-form-actions full-width">
            <Button type="submit" disabled={busy}>
              {busy ? "Submitting..." : "Request Deletion"}
            </Button>
          </div>
        </form>
        {payload?.deletionRequest?.status === "requested" ? (
          <p className="muted">
            Deletion requested on {formatDateTime(payload.deletionRequest.requestedAt)}.
          </p>
        ) : null}
      </div>
    </Card>
  );
}
