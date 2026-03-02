import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Outlet, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Badge, Button, Card, Input, Select, Textarea } from "@pondbridge/ui";
import { requestBlob, requestJson } from "../../lib/http.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { useTenant } from "../../context/TenantContext.jsx";
import {
  DataTable,
  FilterBar,
  LoadingSkeleton,
  ModalConfirm,
  PageHeader,
  SlideOverPanel
} from "../../components/admin/AdminUi.jsx";

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
  if (["active", "sent", "used", "live", "approved", "paid"].includes(key)) return "success";
  if (["pending", "scheduled", "trialing", "in_setup", "in_progress"].includes(key)) return "warning";
  if (["failed", "denied", "past_due", "removed", "flagged", "canceled"].includes(key)) return "danger";
  return "neutral";
}

function billingPlanLabel(code = "") {
  const normalized = String(code || "").trim().toLowerCase();
  if (normalized === "founders") return "Founders";
  if (normalized === "institutional") return "Institutional";
  return "Legacy";
}

const DEFAULT_BRAND_PRIMARY = "#002b5c";

function normalizeBrandHex(value = "", fallback = DEFAULT_BRAND_PRIMARY) {
  const raw = String(value || "").trim();
  const hex = raw.startsWith("#") ? raw.slice(1) : raw;
  if (/^[0-9a-fA-F]{6}$/.test(hex)) return `#${hex.toLowerCase()}`;
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    const expanded = hex
      .split("")
      .map((char) => `${char}${char}`)
      .join("");
    return `#${expanded.toLowerCase()}`;
  }
  return fallback;
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

const INVITE_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function createInviteRow() {
  return {
    id: `invite_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    firstName: "",
    lastName: "",
    email: ""
  };
}

function normalizeInviteName(value = "") {
  return String(value || "").trim().slice(0, 80);
}

function normalizeInviteEmail(value = "") {
  return String(value || "").trim().toLowerCase();
}

function isValidInviteEmail(value = "") {
  return INVITE_EMAIL_REGEX.test(normalizeInviteEmail(value));
}

function useAdminApi() {
  const { slug: paramSlug } = useParams();
  const { slug: tenantSlug, tenant } = useTenant();
  const { token } = useAuth();

  const resolveSlug = useCallback((...values) => {
    for (const value of values) {
      const normalized = String(value || "")
        .trim()
        .toLowerCase();
      if (normalized && normalized !== "undefined" && normalized !== "null") {
        return normalized;
      }
    }
    return "";
  }, []);

  const slug = useMemo(() => {
    const fromStorage =
      typeof window !== "undefined" ? String(localStorage.getItem("pondbridgeTenantSlug") || "") : "";
    return resolveSlug(paramSlug, tenantSlug, tenant?.slug, fromStorage);
  }, [paramSlug, resolveSlug, tenant?.slug, tenantSlug]);

  const request = useCallback(
    (path, options = {}) => {
      if (!slug) {
        throw new Error("Unable to resolve tenant context. Refresh and try again.");
      }
      return requestJson(`/api/t/${slug}/admin${path}`, {
        token,
        ...options
      });
    },
    [slug, token]
  );

  const download = useCallback(
    (path) => {
      if (!slug) {
        throw new Error("Unable to resolve tenant context. Refresh and try again.");
      }
      return requestBlob(`/api/t/${slug}/admin${path}`, {
        token
      });
    },
    [slug, token]
  );

  return { slug, token, request, download };
}

const AdminPageHeader = PageHeader;

function StatCard({ label, value, hint = "", tone = "neutral" }) {
  return (
    <article className={`director-admin-stat-card tone-${tone}`.trim()}>
      <span>{label}</span>
      <strong>{value}</strong>
      {hint ? <small>{hint}</small> : null}
    </article>
  );
}

function normalizeSeries(points = []) {
  const normalized = (Array.isArray(points) ? points : [])
    .map((point, index) => ({
      date: String(point?.date || ""),
      label: String(point?.label || point?.date || `Point ${index + 1}`),
      value: Math.max(0, Number(point?.value || 0))
    }))
    .filter((point) => Boolean(point.date))
    .sort((left, right) => left.date.localeCompare(right.date));

  return normalized.map((point) => ({
    ...point,
    weekKey: weekStartKeyFromDate(point.date)
  }));
}

function weekStartKeyFromDate(dateKey = "") {
  if (!dateKey) return "";
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return "";
  const day = date.getUTCDay();
  const start = new Date(date);
  start.setUTCDate(date.getUTCDate() - day);
  return start.toISOString().slice(0, 10);
}

function weekDateKeysFromStart(weekKey = "") {
  if (!weekKey) return [];
  const start = new Date(`${weekKey}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) return [];
  return Array.from({ length: 7 }, (_unused, index) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });
}

function currentWeekKey() {
  const todayKey = new Date().toISOString().slice(0, 10);
  return weekStartKeyFromDate(todayKey);
}

function formatChartDate(dateKey = "") {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return dateKey;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function buildWeekWindows(points = []) {
  const grouped = new Map();
  for (const point of points) {
    const key = String(point?.weekKey || "");
    if (!key) continue;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(point);
  }
  const thisWeek = currentWeekKey();
  if (thisWeek && !grouped.has(thisWeek)) {
    grouped.set(thisWeek, []);
  }

  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, _values]) => {
      const weekDates = weekDateKeysFromStart(key);
      const startDate = weekDates[0] || key;
      const endDate = weekDates[6] || key;
      return {
        key,
        startDate,
        endDate,
        label: `${formatChartDate(startDate)} - ${formatChartDate(endDate)}`
      };
    });
}

function TimeSeriesChartCard({
  title,
  yLabel,
  xLabel = "Time",
  points = [],
  weekWindows = [],
  activeWeekKey = "",
  onWeekChange = () => {}
}) {
  const series = useMemo(() => normalizeSeries(points), [points]);
  const windows = useMemo(() => (weekWindows.length ? weekWindows : buildWeekWindows(series)), [series, weekWindows]);
  const fallbackWeekKey = windows.length ? windows[windows.length - 1].key : "";
  const selectedWeekKey = windows.some((window) => window.key === activeWeekKey)
    ? activeWeekKey
    : fallbackWeekKey;
  const selectedWeek = windows.find((window) => window.key === selectedWeekKey) || null;
  const sourceWeekSeries = selectedWeek
    ? series.filter((point) => point.weekKey === selectedWeek.key)
    : series;
  const weekDates = useMemo(() => weekDateKeysFromStart(selectedWeekKey), [selectedWeekKey]);
  const weekValueByDate = useMemo(() => {
    const map = new Map();
    for (const point of sourceWeekSeries) {
      map.set(point.date, Number(map.get(point.date) || 0) + Number(point.value || 0));
    }
    return map;
  }, [sourceWeekSeries]);
  const weekSeries = useMemo(
    () =>
      weekDates.map((dateKey) => ({
        date: dateKey,
        label: formatChartDate(dateKey),
        value: Number(weekValueByDate.get(dateKey) || 0),
        weekKey: selectedWeekKey
      })),
    [selectedWeekKey, weekDates, weekValueByDate]
  );
  const [hoverIndex, setHoverIndex] = useState(weekSeries.length ? weekSeries.length - 1 : null);

  useEffect(() => {
    setHoverIndex(weekSeries.length ? weekSeries.length - 1 : null);
  }, [selectedWeekKey, weekSeries.length]);

  if (!weekSeries.length) {
    return (
      <Card className="director-admin-chart-card">
        <div className="director-admin-chart-head">
          <h2 className="pb-section-title">{title}</h2>
        </div>
        <div className="director-admin-chart-empty">No data yet.</div>
      </Card>
    );
  }

  const chartHeight = 232;
  const chartWidth = 560;
  const padding = { top: 16, right: 16, bottom: 38, left: 52 };
  const plotWidth = chartWidth - padding.left - padding.right;
  const plotHeight = chartHeight - padding.top - padding.bottom;
  const maxObservedValue = Math.max(0, ...weekSeries.map((point) => point.value));
  const maxValue = Math.max(1, Math.ceil(maxObservedValue));
  const xStep = weekSeries.length > 1 ? plotWidth / (weekSeries.length - 1) : 0;

  const chartPoints = weekSeries.map((point, index) => {
    const x = padding.left + xStep * index;
    const y = padding.top + (1 - point.value / maxValue) * plotHeight;
    return { ...point, x, y };
  });

  const linePath = chartPoints
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");

  const areaPath = `${linePath} L ${padding.left + plotWidth} ${(padding.top + plotHeight).toFixed(2)} L ${padding.left} ${(padding.top + plotHeight).toFixed(2)} Z`;
  const yTicks = Array.from({ length: maxValue + 1 }, (_unused, index) => index);
  const majorGridYKeys = new Set(
    yTicks.map((value) => (padding.top + (1 - value / maxValue) * plotHeight).toFixed(2))
  );
  const minorGridYs = [0.25, 0.5, 0.75]
    .map((ratio) => padding.top + (1 - ratio) * plotHeight)
    .filter((y) => !majorGridYKeys.has(y.toFixed(2)));
  const xLabelStep = Math.max(1, Math.round(weekSeries.length / 6));
  const xLabelIndexes = new Set(
    weekSeries
      .map((_point, index) => index)
      .filter((index) => index === 0 || index === weekSeries.length - 1 || index % xLabelStep === 0)
  );

  const activeIndex = hoverIndex == null ? null : Math.max(0, Math.min(weekSeries.length - 1, hoverIndex));
  const activePoint = activeIndex == null ? null : chartPoints[activeIndex];
  const activeWeekIndex = Math.max(0, windows.findIndex((window) => window.key === selectedWeekKey));
  const canMovePrev = activeWeekIndex > 0;
  const canMoveNext = activeWeekIndex >= 0 && activeWeekIndex < windows.length - 1;

  const handleMouseMove = (event) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const localX = event.clientX - bounds.left - padding.left;
    const ratio = plotWidth <= 0 ? 0 : Math.max(0, Math.min(1, localX / plotWidth));
    const nextIndex = Math.round(ratio * (weekSeries.length - 1));
    setHoverIndex(nextIndex);
  };

  return (
    <Card className="director-admin-chart-card">
      <div className="director-admin-chart-head">
        <h2 className="pb-section-title">{title}</h2>
        {activePoint ? (
          <span className="director-admin-chart-value">
            {activePoint.value} on {activePoint.label}
          </span>
        ) : null}
      </div>

      <div className="director-admin-chart-week-nav">
        <button
          type="button"
          className="director-admin-chart-week-btn"
          onClick={() => {
            if (!canMovePrev) return;
            onWeekChange(windows[activeWeekIndex - 1]?.key || selectedWeekKey);
          }}
          disabled={!canMovePrev}
          aria-label="Previous week"
        >
          Prev
        </button>
        <div className="director-admin-chart-week-current" aria-live="polite">
          {selectedWeek?.label || "Current week"}
        </div>
        <button
          type="button"
          className="director-admin-chart-week-btn"
          onClick={() => {
            if (!canMoveNext) return;
            onWeekChange(windows[activeWeekIndex + 1]?.key || selectedWeekKey);
          }}
          disabled={!canMoveNext}
          aria-label="Next week"
        >
          Next
        </button>
      </div>

      <div className="director-admin-chart-scroll">
        <svg
          className="director-admin-chart-svg"
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          width={chartWidth}
          height={chartHeight}
          role="img"
          aria-label={title}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverIndex(weekSeries.length ? weekSeries.length - 1 : null)}
        >
          <text
            className="director-admin-chart-axis-label y"
            x={16}
            y={chartHeight / 2}
            transform={`rotate(-90 16 ${chartHeight / 2})`}
          >
            {yLabel}
          </text>
          <text className="director-admin-chart-axis-label x" x={chartWidth / 2} y={chartHeight - 8}>
            {xLabel}
          </text>

          {minorGridYs.map((y) => (
            <line
              key={`minor-${y.toFixed(2)}`}
              className="director-admin-chart-grid-line minor"
              x1={padding.left}
              x2={padding.left + plotWidth}
              y1={y}
              y2={y}
            />
          ))}

          {yTicks.map((value) => {
            const y = padding.top + (1 - value / maxValue) * plotHeight;
            return (
              <g key={value}>
                <line
                  className="director-admin-chart-grid-line"
                  x1={padding.left}
                  x2={padding.left + plotWidth}
                  y1={y}
                  y2={y}
                />
                <text className="director-admin-chart-ytick" x={padding.left - 8} y={y + 4}>
                  {value}
                </text>
              </g>
            );
          })}

          <path className="director-admin-chart-area" d={areaPath} />
          <path className="director-admin-chart-line" d={linePath} />

          {xLabelIndexes.size > 0
            ? [...xLabelIndexes].map((index) => {
                const point = chartPoints[index];
                return (
                  <text key={index} className="director-admin-chart-xtick" x={point.x} y={chartHeight - 18}>
                    {point.label}
                  </text>
                );
              })
            : null}

          {activePoint ? (
            <g>
              <line
                className="director-admin-chart-crosshair"
                x1={activePoint.x}
                x2={activePoint.x}
                y1={padding.top}
                y2={padding.top + plotHeight}
              />
              <circle className="director-admin-chart-dot" cx={activePoint.x} cy={activePoint.y} r={4} />
            </g>
          ) : null}
        </svg>
      </div>
    </Card>
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

  const stats = payload?.stats || {};
  const totalMembers = Number(stats.totalMembers || 0);
  const activeMembers = Number(stats.activeMembers ?? totalMembers);
  const recentSignups = Number(stats.newThisWeek || 0);
  const profileCompletion = Number(stats.profileCompletion || 0);
  const newUsersSeries = payload?.charts?.newUsers || [];
  const signInsSeries = payload?.charts?.signIns || [];
  const normalizedNewUsersSeries = useMemo(() => normalizeSeries(newUsersSeries), [newUsersSeries]);
  const normalizedSignInsSeries = useMemo(() => normalizeSeries(signInsSeries), [signInsSeries]);
  const combinedSeries = useMemo(
    () => [...normalizedNewUsersSeries, ...normalizedSignInsSeries],
    [normalizedNewUsersSeries, normalizedSignInsSeries]
  );
  const weekWindows = useMemo(() => buildWeekWindows(combinedSeries), [combinedSeries]);
  const [activeWeekKey, setActiveWeekKey] = useState("");

  useEffect(() => {
    if (!weekWindows.length) {
      setActiveWeekKey("");
      return;
    }
    const thisWeekKey = currentWeekKey();
    const resolvedKey = weekWindows.some((window) => window.key === thisWeekKey)
      ? thisWeekKey
      : weekWindows[weekWindows.length - 1].key;
    setActiveWeekKey((previous) => (weekWindows.some((window) => window.key === previous) ? previous : resolvedKey));
  }, [weekWindows]);

  if (loading && !payload) {
    return (
      <Card>
        <LoadingSkeleton lines={4} />
      </Card>
    );
  }

  const statCards = [
    {
      key: "total-members",
      label: "Total Members",
      value: totalMembers,
      hint: `${stats.totalMembersDelta >= 0 ? "+" : ""}${stats.totalMembersDelta || 0}% vs prior window`,
      tone: "success"
    },
    {
      key: "active-members",
      label: "Active Members",
      value: activeMembers,
      hint: `${totalMembers ? Math.round((activeMembers / totalMembers) * 100) : 0}% currently active`,
      tone: "neutral"
    },
    {
      key: "recent-signups",
      label: "Recent Signups",
      value: recentSignups,
      hint: "Last 7 days",
      tone: recentSignups > 0 ? "success" : "neutral"
    },
    {
      key: "profile-completion",
      label: "Profile Completion",
      value: `${profileCompletion}%`,
      hint: "Average across members",
      tone: profileCompletion >= 70 ? "success" : "neutral"
    }
  ];

  return (
    <div className="director-admin-stack">
      <Card>
        <AdminPageHeader
          title="Admin Overview"
          className="director-admin-page-head"
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

      <div className="director-admin-two-col director-admin-dashboard-charts">
        <TimeSeriesChartCard
          title="New Users"
          yLabel="New users"
          xLabel="Date"
          points={newUsersSeries}
          weekWindows={weekWindows}
          activeWeekKey={activeWeekKey}
          onWeekChange={setActiveWeekKey}
        />
        <TimeSeriesChartCard
          title="Sign-Ins"
          yLabel="Sign-ins"
          xLabel="Date"
          points={signInsSeries}
          weekWindows={weekWindows}
          activeWeekKey={activeWeekKey}
          onWeekChange={setActiveWeekKey}
        />
      </div>

    </div>
  );
}

export function DirectorAdminMembersPage() {
  const navigate = useNavigate();
  const { slug, request, download } = useAdminApi();
  const requestRef = useRef(request);
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
  const [rowMenuId, setRowMenuId] = useState("");
  const [editingMember, setEditingMember] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingMemberId, setDeletingMemberId] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    requestRef.current = request;
  }, [request]);

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
      const response = await requestRef.current(`/members?${params.toString()}`);
      setPayload(response);
    } catch (requestError) {
      setError(requestError.message || "Failed to load members.");
    } finally {
      setLoading(false);
    }
  }, [filters.completion, filters.role, filters.sort, filters.status, filters.year, page, query, slug]);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  useEffect(() => {
    setSelected((prev) => prev.filter((id) => payload?.items?.some((item) => item.id === id)));
  }, [payload?.items]);

  useEffect(() => {
    if (!rowMenuId) return;
    if (!payload?.items?.some((item) => item.id === rowMenuId)) {
      setRowMenuId("");
    }
  }, [payload?.items, rowMenuId]);

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

  async function hardDeleteMember(member) {
    const memberId = String(member?.id || "").trim();
    if (!memberId) return;

    const label = member?.fullName || member?.email || "this member";
    const confirmed = window.confirm(
      `Delete ${label} from this network permanently?\n\nThis will remove their profile, account membership, chats, forum posts, photos, and feed activity. This cannot be undone.`
    );
    if (!confirmed) return;

    setDeletingMemberId(memberId);
    setError("");
    setStatus("");
    try {
      await request(`/members/${memberId}/hard-delete`, {
        method: "DELETE"
      });
      setRowMenuId("");
      setEditingMember((prev) => (prev?.id === memberId ? null : prev));
      setSelected((prev) => prev.filter((id) => id !== memberId));
      setStatus(`${label} was permanently removed from this network.`);
      await loadMembers();
    } catch (requestError) {
      setError(requestError.message || "Failed to delete member.");
    } finally {
      setDeletingMemberId("");
    }
  }

  const roleOptions = payload?.filters?.roleOptions || [];
  const yearOptions = payload?.filters?.yearOptions || [];

  function resetFilters() {
    setQuery("");
    setPage(1);
    setFilters({
      role: "all",
      year: "all",
      status: "all",
      completion: "all",
      sort: "join_desc"
    });
  }

  return (
    <div className="director-admin-stack">
      <Card>
        <AdminPageHeader
          title="Members"
          subtitle="Search, filter, edit, and manage your network members."
          className="director-admin-page-head"
          actions={
            <>
              <Link className="link-button" to={`/t/${slug}/admin/invites`}>
                Invite Members
              </Link>
              <button type="button" className="link-button secondary" onClick={downloadCsv}>
                Export CSV
              </button>
            </>
          }
        />

        <FilterBar className="director-admin-filter-row">
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
          <Button variant="secondary" onClick={resetFilters}>
            Reset
          </Button>
        </FilterBar>

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

        <DataTable className="director-admin-table-wrap" tableClassName="director-admin-table" minWidth={860}>
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
                      <div className="director-admin-row-actions">
                        <button
                          type="button"
                          className="director-admin-row-menu-trigger"
                          aria-label="Open row actions"
                          onClick={() => setRowMenuId((current) => (current === item.id ? "" : item.id))}
                        >
                          ⋯
                        </button>
                        {rowMenuId === item.id ? (
                          <div className="director-admin-row-menu">
                            <Link
                              className="director-admin-inline-link"
                              to={`/t/${slug}/profile/${item.id}`}
                              onClick={() => setRowMenuId("")}
                            >
                              View Profile
                            </Link>
                            <button
                              type="button"
                              className="director-admin-inline-link"
                              onClick={() => {
                                setRowMenuId("");
                                setEditingMember({ ...item });
                              }}
                            >
                              Edit Member
                            </button>
                            <button
                              type="button"
                              className="director-admin-inline-link"
                              disabled={deletingMemberId === item.id}
                              onClick={() => hardDeleteMember(item)}
                            >
                              {deletingMemberId === item.id ? "Deleting..." : "Delete from Network"}
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
        </DataTable>

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

      <SlideOverPanel
        open={Boolean(editingMember)}
        title={`Edit Member - ${editingMember?.fullName || "Member"}`}
        subtitle="Update profile details without leaving the members table."
        onClose={() => setEditingMember(null)}
        footer={
          <>
            <Link className="link-button secondary" to={`/t/${slug}/profile/${editingMember?.id || ""}`}>
              View Full Profile
            </Link>
            <div className="inline-actions">
              <Button type="button" variant="secondary" onClick={() => setEditingMember(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={saving || !editingMember?.id}
                onClick={() => {
                  const formEl = document.getElementById("director-admin-member-edit-form");
                  formEl?.requestSubmit();
                }}
              >
                {saving ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </>
        }
      >
        {editingMember ? (
          <form id="director-admin-member-edit-form" className="director-admin-form-grid" onSubmit={saveMemberEdit}>
            <h3 className="full-width pb-section-title">Identity</h3>
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

            <h3 className="full-width pb-section-title">Contact</h3>
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
              Location
              <Input
                value={editingMember.location || ""}
                onChange={(event) =>
                  setEditingMember((prev) => ({ ...prev, location: event.target.value }))
                }
              />
            </label>
            <label>
              Role at camp
              <Input
                value={editingMember.role || ""}
                onChange={(event) =>
                  setEditingMember((prev) => ({ ...prev, role: event.target.value }))
                }
              />
            </label>

            <h3 className="full-width pb-section-title">Notes</h3>
            <label className="full-width">
              Bio
              <Textarea
                value={editingMember.bio || ""}
                onChange={(event) =>
                  setEditingMember((prev) => ({ ...prev, bio: event.target.value }))
                }
              />
            </label>

            <h3 className="full-width pb-section-title">Access</h3>
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
          </form>
        ) : null}
      </SlideOverPanel>
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

export function DirectorAdminInvitesPage() {
  const { slug, request, download } = useAdminApi();
  const [rows, setRows] = useState([createInviteRow()]);
  const [file, setFile] = useState(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [sending, setSending] = useState(false);
  const [loadingInvites, setLoadingInvites] = useState(true);
  const [inviteStatusFilter, setInviteStatusFilter] = useState("pending");
  const [invites, setInvites] = useState([]);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [result, setResult] = useState(null);

  const loadInvites = useCallback(async () => {
    setLoadingInvites(true);
    setError("");
    try {
      const filter = String(inviteStatusFilter || "pending").trim();
      const query = filter === "all" ? "" : `?status=${encodeURIComponent(filter)}`;
      const payload = await request(`/invites${query}`);
      setInvites(Array.isArray(payload?.items) ? payload.items : []);
    } catch (requestError) {
      setError(requestError.message || "Unable to load invites.");
    } finally {
      setLoadingInvites(false);
    }
  }, [inviteStatusFilter, request]);

  useEffect(() => {
    loadInvites();
  }, [loadInvites]);

  function updateRow(rowId, key, value) {
    setRows((current) =>
      current.map((row) =>
        row.id === rowId
          ? {
              ...row,
              [key]: key === "email" ? normalizeInviteEmail(value) : normalizeInviteName(value)
            }
          : row
      )
    );
  }

  function addRow() {
    setRows((current) => [...current, createInviteRow()]);
  }

  function removeRow(rowId) {
    setRows((current) => {
      if (current.length <= 1) return [createInviteRow()];
      return current.filter((row) => row.id !== rowId);
    });
  }

  async function downloadTemplate() {
    setError("");
    try {
      const blob = await download("/invites/template.csv");
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "pondbridge-invites-template.csv";
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (requestError) {
      setError(requestError.message || "Unable to download invite template.");
    }
  }

  async function sendInvites(event) {
    event.preventDefault();
    setError("");
    setStatus("");
    setResult(null);

    const enteredRows = rows
      .map((row) => ({
        firstName: normalizeInviteName(row.firstName),
        lastName: normalizeInviteName(row.lastName),
        email: normalizeInviteEmail(row.email)
      }))
      .filter((row) => row.firstName || row.lastName || row.email);

    const missingEmailRows = enteredRows.filter(
      (row) => !row.email && (row.firstName || row.lastName)
    );
    if (missingEmailRows.length > 0) {
      setError("Every row with a name must include an email address.");
      return;
    }

    const invalidEmailRows = enteredRows.filter((row) => row.email && !isValidInviteEmail(row.email));
    if (invalidEmailRows.length > 0) {
      setError("One or more emails are invalid. Please fix and retry.");
      return;
    }

    const dedupedRecipients = Array.from(
      enteredRows
        .filter((row) => row.email)
        .reduce((map, row) => {
          const existing = map.get(row.email);
          if (!existing) {
            map.set(row.email, row);
            return map;
          }
          map.set(row.email, {
            email: row.email,
            firstName: existing.firstName || row.firstName,
            lastName: existing.lastName || row.lastName
          });
          return map;
        }, new Map())
        .values()
    );

    if (!file && dedupedRecipients.length === 0) {
      setError("Add at least one invite row or upload a CSV file.");
      return;
    }

    setSending(true);
    try {
      const formData = new FormData();
      formData.append("roleToAssign", "user");
      if (dedupedRecipients.length > 0) {
        formData.append("recipients", JSON.stringify(dedupedRecipients));
      }
      if (file) {
        formData.append("file", file);
      }

      const response = await request("/invites/send", {
        method: "POST",
        body: formData
      });

      setResult(response);
      setStatus(
        `Invites processed. Created ${response.createdCount || 0}, sent ${response.sentCount || 0}, skipped ${
          Array.isArray(response.skipped) ? response.skipped.length : 0
        }.`
      );
      setRows([createInviteRow()]);
      setFile(null);
      setFileInputKey((value) => value + 1);
      await loadInvites();
    } catch (requestError) {
      setError(requestError.message || "Failed to send invites.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="director-admin-stack">
      <Card>
        <AdminPageHeader
          title="Invite Members"
          subtitle="Invite people with first name, last name, and email. Accounts are created only when they accept and sign up."
          actions={
            <Button variant="secondary" onClick={downloadTemplate}>
              Download Template CSV
            </Button>
          }
        />
        <form onSubmit={sendInvites}>
          <div className="director-admin-table-wrap">
            <table className="director-admin-table" style={{ minWidth: 720 }}>
              <thead>
                <tr>
                  <th>First Name</th>
                  <th>Last Name</th>
                  <th>Email</th>
                  <th aria-label="Row actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Input
                        value={row.firstName}
                        placeholder="First name"
                        onChange={(event) => updateRow(row.id, "firstName", event.target.value)}
                      />
                    </td>
                    <td>
                      <Input
                        value={row.lastName}
                        placeholder="Last name"
                        onChange={(event) => updateRow(row.id, "lastName", event.target.value)}
                      />
                    </td>
                    <td>
                      <Input
                        type="email"
                        value={row.email}
                        placeholder="name@email.com"
                        onChange={(event) => updateRow(row.id, "email", event.target.value)}
                      />
                    </td>
                    <td>
                      <Button type="button" variant="secondary" size="sm" onClick={() => removeRow(row.id)}>
                        Remove
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="inline-actions">
            <Button type="button" variant="secondary" onClick={addRow}>
              Add Row
            </Button>
            <Button type="button" variant="secondary" onClick={() => setRows([createInviteRow()])}>
              Clear Rows
            </Button>
          </div>

          <div className="director-admin-upload-box">
            <p>Optional: upload CSV with `firstName`, `lastName`, and `email` columns.</p>
            <Input
              key={fileInputKey}
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => setFile(event.target.files?.[0] || null)}
            />
            {file ? (
              <p className="muted">
                CSV selected: <strong>{file.name}</strong>
              </p>
            ) : null}
          </div>

          <div className="inline-actions">
            <Button type="submit" disabled={sending}>
              {sending ? "Sending Invites..." : "Send Invites"}
            </Button>
            <Link className="link-button secondary" to={`/t/${slug}/admin/members`}>
              View Members
            </Link>
          </div>
        </form>
        {error ? <p className="error-text">{error}</p> : null}
        {status ? <p className="success-text">{status}</p> : null}
      </Card>

      {result?.skipped?.length ? (
        <Card>
          <h2 className="pb-section-title">Skipped Invites</h2>
          <div className="director-admin-table-wrap">
            <table className="director-admin-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {result.skipped.map((item) => (
                  <tr key={`${item.email}_${item.reason}`}>
                    <td>{item.email || "-"}</td>
                    <td>{item.reason || "Skipped"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      <Card>
        <div className="director-admin-page-actions">
          <h2 className="pb-section-title">Invite Status</h2>
          <Select value={inviteStatusFilter} onChange={(event) => setInviteStatusFilter(event.target.value)}>
            <option value="pending">Pending</option>
            <option value="used">Used</option>
            <option value="expired">Expired</option>
            <option value="all">All</option>
          </Select>
        </div>
        {loadingInvites ? (
          <p className="muted">Loading invites...</p>
        ) : invites.length === 0 ? (
          <p className="muted">No invites found for this filter.</p>
        ) : (
          <div className="director-admin-table-wrap">
            <table className="director-admin-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Created</th>
                  <th>Expires</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {invites.map((invite) => {
                  const expired = invite?.expiresAt ? new Date(invite.expiresAt) <= new Date() : false;
                  const inviteStatus = invite?.usedAt ? "used" : expired ? "expired" : "pending";
                  return (
                    <tr key={invite.id}>
                      <td>{invite.email || "-"}</td>
                      <td>{invite.roleToAssign === "tenant_admin" ? "Admin" : "Member"}</td>
                      <td>{formatDateTime(invite.createdAt)}</td>
                      <td>{formatDateTime(invite.expiresAt)}</td>
                      <td>
                        <Badge tone={statusTone(inviteStatus)}>
                          {inviteStatus.charAt(0).toUpperCase() + inviteStatus.slice(1)}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
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
        <LoadingSkeleton lines={3} />
      </Card>
    );
  }

  const moduleColumns = [[], []];
  (payload.modules || []).forEach((module, index) => {
    moduleColumns[index % 2].push(module);
  });

  function renderModuleCard(module) {
    return (
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
    );
  }

  return (
    <Card>
      <AdminPageHeader
        title="Features & Modules"
        subtitle="Control which features are active in your network. Changes apply immediately."
        className="director-admin-page-head"
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
      <div className="director-admin-modules-columns">
        {moduleColumns.map((column, index) => (
          <div key={`module-column-${index}`} className="director-admin-modules-column">
            {column.map((module) => renderModuleCard(module))}
          </div>
        ))}
      </div>
    </Card>
  );
}

export function DirectorAdminBillingPage() {
  const { slug, request } = useAdminApi();
  const [searchParams] = useSearchParams();
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [selectedPlanCode, setSelectedPlanCode] = useState("legacy");
  const [startingCheckout, setStartingCheckout] = useState(false);

  const checkoutQueryState = String(searchParams.get("checkout") || "").trim().toLowerCase();

  const loadBilling = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await request("/billing");
      setPayload(response);
      const livePlanCode = String(
        response?.tenant?.billingPlan || response?.billing?.billingPlan || "legacy"
      )
        .trim()
        .toLowerCase();
      if (livePlanCode) {
        setSelectedPlanCode(livePlanCode);
      }
    } catch (requestError) {
      setError(requestError.message || "Failed to load billing.");
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    loadBilling();
  }, [loadBilling]);

  useEffect(() => {
    if (checkoutQueryState === "success") {
      setStatus("Stripe checkout completed. Billing activation may take a few seconds.");
      setError("");
    } else if (checkoutQueryState === "cancel") {
      setError("Stripe checkout was canceled.");
      setStatus("");
    }
  }, [checkoutQueryState]);

  async function startCheckout() {
    setStartingCheckout(true);
    setError("");
    setStatus("");

    try {
      const successUrl = `${window.location.origin}/t/${slug}/admin/billing?checkout=success`;
      const cancelUrl = `${window.location.origin}/t/${slug}/admin/billing?checkout=cancel`;
      const response = await request("/billing/checkout", {
        method: "POST",
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
  const lifecycleStatus = String(tenant.billingLifecycleStatus || "").toLowerCase();
  const currentPlanCode = String(tenant.billingPlan || "legacy").trim().toLowerCase();
  const showTrialBanner = billingStatus === "trialing";
  const showPastDueBanner = billingStatus === "past_due";
  const showCheckoutBanner = lifecycleStatus === "checkout_started";

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

      {showCheckoutBanner ? (
        <Card className="director-admin-banner tone-info">
          <p>Stripe checkout is in progress. Complete payment to activate launch readiness.</p>
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
          {status ? <p className="success-text">{status}</p> : null}
          <p>
            <strong>Plan:</strong> {billingPlanLabel(currentPlanCode)}
          </p>
          <p>
            <strong>Status:</strong>{" "}
            <span className={`director-admin-status-badge tone-${statusTone(tenant.billingStatus)}`.trim()}>
              {String(tenant.billingStatus || "trialing").replace(/_/g, " ")}
            </span>
          </p>
          <p>
            <strong>Lifecycle:</strong> {tenant.billingLifecycleStatus || "uninitialized"}
          </p>
          <p>
            <strong>Onboarding fee:</strong> {formatMoney(tenant.onboardingFeeAmount)}
          </p>
          <p>
            <strong>Onboarding status:</strong> {tenant.onboardingFeeStatus || (tenant.onboardingFeePaid ? "paid" : "unpaid")}
          </p>
          <p>
            <strong>Launch ready:</strong> {payload?.billing?.launchReady ? "Yes" : "No"}
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

        <Card>
          <h2 className="pb-section-title">Plan & Checkout</h2>
          <p className="muted">
            Choose Legacy, Founders, or Institutional and continue in Stripe Checkout.
          </p>
          {Array.isArray(payload?.catalog?.plans) && payload.catalog.plans.length ? (
            <label>
              Select billing plan
              <Select
                value={selectedPlanCode}
                onChange={(event) => setSelectedPlanCode(event.target.value)}
              >
                {payload.catalog.plans.map((plan) => (
                  <option key={plan.code} value={plan.code}>
                    {plan.label} · {formatMoney(plan.annualAmount)}/yr
                    {plan.onboardingFeeAmount > 0
                      ? ` + ${formatMoney(plan.onboardingFeeAmount)} onboarding`
                      : " · no onboarding fee"}
                  </option>
                ))}
              </Select>
            </label>
          ) : null}
          {payload?.foundersAvailability ? (
            <p className="muted">
              Founders slots: {payload.foundersAvailability.reserved}/{payload.foundersAvailability.max} reserved
              {" · "}
              {payload.foundersAvailability.remaining} remaining
            </p>
          ) : null}
          <div className="inline-actions">
            <Button onClick={startCheckout} disabled={startingCheckout}>
              {startingCheckout
                ? "Redirecting..."
                : selectedPlanCode === currentPlanCode
                ? "Start Stripe Checkout"
                : "Switch Plan & Checkout"}
            </Button>
            <Button variant="secondary" onClick={loadBilling}>
              Refresh Billing
            </Button>
          </div>
        </Card>
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
    campName: "",
    networkName: "",
    tagline: "",
    aboutText: "",
    contactEmail: "",
    websiteUrl: ""
  });

  useEffect(() => {
    if (!payload?.identity) return;
    const campName = String(payload.identity.campName || payload.tenant?.name || "").trim();
    setForm({
      campName,
      networkName: payload.identity.networkName || (campName ? `${campName} Alumni Network` : ""),
      tagline: payload.identity.tagline || "",
      aboutText: payload.identity.aboutText || "",
      contactEmail: payload.identity.contactEmail || "",
      websiteUrl: payload.identity.websiteUrl || payload.tenant?.appUrl || ""
    });
  }, [payload?.identity, payload?.tenant?.name, payload?.tenant?.appUrl]);

  async function saveIdentity(event) {
    event.preventDefault();
    setSaving(true);
    setStatus("");
    try {
      const { campName: _unusedCampName, ...identityPayload } = form;
      await request("/settings/identity", { method: "PATCH", body: identityPayload });
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
          Camp Name
          <Input value={form.campName} readOnly />
        </label>
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
    brandPrimary: DEFAULT_BRAND_PRIMARY,
    logoUrl: "",
    heroImageUrl: ""
  });

  useEffect(() => {
    if (!payload?.branding) return;
    setForm({
      brandPrimary: normalizeBrandHex(payload.branding.brandPrimary, DEFAULT_BRAND_PRIMARY),
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

    const presign = await requestJson(`/api/t/${slug}/uploads/presign`, {
      method: "POST",
      token,
      body: {
        fileName: `${scope}-${Date.now()}.${extension}`,
        fileType: fileType || "image/jpeg",
        fileSize: Number(blob?.size || 0),
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
      payloadToSave.brandPrimary = normalizeBrandHex(payloadToSave.brandPrimary, DEFAULT_BRAND_PRIMARY);
      const currentBrandPrimary = normalizeBrandHex(payload?.branding?.brandPrimary, DEFAULT_BRAND_PRIMARY);
      const brandColorChanged = currentBrandPrimary !== payloadToSave.brandPrimary;
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
      if (brandColorChanged) {
        window.location.reload();
        return;
      }
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
  const previewBrandPrimary = normalizeBrandHex(form.brandPrimary, DEFAULT_BRAND_PRIMARY);

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
          <div className="director-admin-color-field">
            <span
              className="director-admin-color-swatch"
              style={{ background: previewBrandPrimary }}
              aria-hidden="true"
            />
            <Input
              type="color"
              className="director-admin-color-picker"
              value={previewBrandPrimary}
              aria-label="Pick primary color"
              onChange={(event) =>
                setForm((prev) => ({ ...prev, brandPrimary: normalizeBrandHex(event.target.value, DEFAULT_BRAND_PRIMARY) }))
              }
            />
            <span className="director-admin-color-value">{previewBrandPrimary.toUpperCase()}</span>
          </div>
        </label>
        <label>
          Primary Color Hex
          <Input
            value={form.brandPrimary}
            placeholder={DEFAULT_BRAND_PRIMARY}
            onChange={(event) => setForm((prev) => ({ ...prev, brandPrimary: event.target.value }))}
            onBlur={() =>
              setForm((prev) => ({ ...prev, brandPrimary: normalizeBrandHex(prev.brandPrimary, DEFAULT_BRAND_PRIMARY) }))
            }
          />
        </label>
        <div className="director-admin-brand-preview full-width" style={{ borderColor: previewBrandPrimary }}>
          <div className="director-admin-brand-preview-head" style={{ background: previewBrandPrimary }}>
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
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(true);
  const [promotingUserId, setPromotingUserId] = useState("");
  const [removing, setRemoving] = useState(false);
  const [adminToRemove, setAdminToRemove] = useState(null);
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

  useEffect(() => {
    const term = String(query || "").trim();
    if (!term) {
      setResults([]);
      setSearching(false);
      return undefined;
    }
    let active = true;
    const timerId = window.setTimeout(async () => {
      setSearching(true);
      try {
        const response = await request(`/settings/admins/search?q=${encodeURIComponent(term)}&limit=8`);
        if (!active) return;
        setResults(Array.isArray(response?.items) ? response.items : []);
      } catch (requestError) {
        if (!active) return;
        setResults([]);
        setError(requestError.message || "Failed to search members.");
      } finally {
        if (active) setSearching(false);
      }
    }, 180);

    return () => {
      active = false;
      window.clearTimeout(timerId);
    };
  }, [query, request]);

  async function grantAdmin(member) {
    if (!member?.userId && !member?.email) return;
    setPromotingUserId(String(member.userId || member.email || ""));
    setStatus("");
    setError("");
    try {
      await request("/settings/admins/grant", {
        method: "POST",
        body: {
          userId: member.userId,
          email: member.email
        }
      });
      setStatus(`${member.fullName || member.email || "Member"} now has admin access.`);
      setResults((prev) =>
        prev.map((item) =>
          String(item.userId || "") === String(member.userId || "")
            ? { ...item, isAdmin: true }
            : item
        )
      );
      await loadAdmins();
    } catch (requestError) {
      setError(requestError.message || "Failed to grant admin access.");
    } finally {
      setPromotingUserId("");
    }
  }

  async function removeAdmin(userId) {
    setError("");
    setRemoving(true);
    try {
      await request(`/settings/admins/${userId}`, { method: "DELETE" });
      setAdminToRemove(null);
      await loadAdmins();
    } catch (requestError) {
      setError(requestError.message || "Failed to remove admin.");
    } finally {
      setRemoving(false);
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
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Added</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="muted">
                  Loading admins...
                </td>
              </tr>
            ) : (
              payload.admins.map((item) => (
                <tr key={item.id}>
                  <td>{item.name || "-"}</td>
                  <td>{item.email}</td>
                  <td>{item.role}</td>
                  <td>{formatDate(item.addedAt)}</td>
                  <td>
                    {item.role === "Director" ? (
                      <span className="muted">Protected</span>
                    ) : (
                      <button
                        type="button"
                        className="director-admin-inline-link"
                        onClick={() => setAdminToRemove(item)}
                      >
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

      <div className="director-admin-admin-search">
        <h3 className="pb-section-title">Add Admin</h3>
        <p className="muted">Search any member in this network and grant admin access.</p>
        <Input
          value={query}
          placeholder="Search by name or email"
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="director-admin-admin-search-results">
          {searching ? <p className="muted">Searching members...</p> : null}
          {!searching && query.trim() && results.length === 0 ? (
            <p className="muted">No matching members found.</p>
          ) : null}
          {!searching && results.length > 0 ? (
            <ul className="director-admin-simple-list">
              {results.map((item) => {
                const rowKey = String(item.userId || item.email || item.id || "");
                const alreadyAdmin = Boolean(item.isAdmin);
                const busy = promotingUserId === rowKey;
                return (
                  <li key={rowKey}>
                    <div className="director-admin-search-item-main">
                      <strong>{item.fullName || "-"}</strong>
                      <span>{item.email || "-"}</span>
                    </div>
                    {alreadyAdmin ? (
                      <Badge tone="success">Admin</Badge>
                    ) : (
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => grantAdmin(item)}
                      >
                        {busy ? "Adding..." : "Make Admin"}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      </div>

      <ModalConfirm
        open={Boolean(adminToRemove)}
        title="Remove Admin Access?"
        description={`This will revoke director-level access for ${adminToRemove?.email || "this user"}.`}
        confirmLabel="Remove Admin"
        cancelLabel="Cancel"
        busy={removing}
        onCancel={() => setAdminToRemove(null)}
        onConfirm={() => {
          if (!adminToRemove?.id) return;
          removeAdmin(adminToRemove.id);
        }}
      />
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
