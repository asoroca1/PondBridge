import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  defaultNetworkDisplayNameForCamp,
  normalizeCampType,
  normalizeHeroImagePosition,
  normalizeHeroImageSize,
  replaceAlumniForCampType
} from "@pondbridge/shared";
import { Badge, Button, Card, Input, Select, Textarea } from "@pondbridge/ui";
import {
  ArrowUpRight,
  CheckCircle2,
  RefreshCw,
  Send,
  Sparkles,
  UserPlus,
  Users
} from "lucide-react";
import { requestBlob, requestJson } from "../../lib/http.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { useTenant } from "../../context/TenantContext.jsx";
import { resolveCampAiName } from "../../lib/campLabels.js";
import HeroImageEditor from "../../components/HeroImageEditor.jsx";
import BrandImageColorPicker from "../../components/BrandImageColorPicker.jsx";
import {
  LoadingSkeleton,
  ModalConfirm,
  PageHeader
} from "../../components/admin/AdminUi.jsx";
import { useConfirmDialog } from "../../components/admin/useConfirmDialog.js";
import {
  IMAGE_OPTIMIZATION_PRESETS,
  optimizeImageFile
} from "../../lib/imageOptimization.js";

function getNiceTickStep(maxValue = 1, targetTickCount = 5) {
  const safeMax = Math.max(1, Number(maxValue || 0));
  const roughStep = safeMax / Math.max(1, targetTickCount - 1);
  const exponent = Math.floor(Math.log10(roughStep));
  const base = 10 ** exponent;
  const fraction = roughStep / base;

  let niceFraction = 1;
  if (fraction <= 1) {
    niceFraction = 1;
  } else if (fraction <= 2) {
    niceFraction = 2;
  } else if (fraction <= 2.5) {
    niceFraction = 2.5;
  } else if (fraction <= 5) {
    niceFraction = 5;
  } else {
    niceFraction = 10;
  }

  return niceFraction * base;
}

function formatChartTickValue(value = 0) {
  const n = Number(value || 0);
  if (Number.isInteger(n)) return String(n);
  const rounded = Math.abs(n) < 1 ? n.toFixed(2) : n.toFixed(1);
  return rounded.replace(/\.0$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
}

const DEFAULT_BRAND_PRIMARY = "#002b5c";
const DEFAULT_AGE_GROUPS = [
  "Super Warrior",
  "Warrior",
  "Freshman",
  "Sophomore",
  "Junior",
  "Intermediate",
  "Senior I",
  "Senior II"
];
const DEFAULT_STAFF_ROLES = ["Camper", "Counselor", "JC", "CIT", "Admin"];
function normalizeAdminLabelList(value = [], fallback = []) {
  const source = Array.isArray(value)
    ? value
    : String(value || "")
        .split(/\r?\n|,/)
        .map((item) => String(item || "").trim());
  const seen = new Set();
  const cleaned = [];

  for (const raw of source) {
    const label = String(raw || "").trim();
    const key = label.toLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    cleaned.push(label);
    if (cleaned.length >= 20) break;
  }

  if (cleaned.length) return cleaned;
  return Array.isArray(fallback) ? fallback.slice(0, 20) : [];
}

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

function isHexColor(value = "") {
  return /^#([0-9a-fA-F]{6})$/.test(String(value || "").trim());
}

function darkenHex(hex, factor = 0.18) {
  if (!isHexColor(hex)) return "#0b1e37";
  const clean = String(hex).replace("#", "");
  const channels = [0, 2, 4].map((index) => Number.parseInt(clean.slice(index, index + 2), 16));
  const darkened = channels.map((value) => Math.max(0, Math.min(255, Math.round(value * (1 - factor)))));
  return `#${darkened.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function deriveSecondaryHex(hex, blend = 0.82) {
  if (!isHexColor(hex)) return "#d3dde8";
  const clean = String(hex).replace("#", "");
  const channels = [0, 2, 4].map((index) => Number.parseInt(clean.slice(index, index + 2), 16));
  const lightened = channels.map((value) => Math.min(255, Math.round(value + (255 - value) * blend)));
  return `#${lightened.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error("No file selected."));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Unable to read file."));
    reader.readAsDataURL(file);
  });
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

function StatIcon({ kind = "members" }) {
  if (kind === "active") {
    return (
      <svg viewBox="0 0 20 20" role="img" aria-hidden="true">
        <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="M6.8 10.1 9.2 12.4 13.4 7.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (kind === "signups") {
    return (
      <svg viewBox="0 0 20 20" role="img" aria-hidden="true">
        <path d="M5.8 13.8 14.2 5.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M9.5 5.8h4.7v4.7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M5.8 5.8v8h8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === "completion") {
    return (
      <svg viewBox="0 0 20 20" role="img" aria-hidden="true">
        <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="M10 3v7h6.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 20 20" role="img" aria-hidden="true">
      <circle cx="7.2" cy="7.4" r="2.3" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="13.1" cy="8.2" r="1.8" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3.8 14.2c.5-2.3 2-3.5 4.4-3.5s3.9 1.2 4.4 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M11.4 14.2c.4-1.4 1.4-2.1 2.8-2.1 1.2 0 2.1.6 2.6 1.8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function StatCard({ label, value, hint = "", tone = "neutral", icon = "members" }) {
  return (
    <article className={`director-admin-stat-card tone-${tone}`.trim()}>
      <div className="director-admin-stat-card-top">
        <span className="director-admin-stat-icon" aria-hidden="true">
          <StatIcon kind={icon} />
        </span>
        <span className="director-admin-stat-label">{label}</span>
      </div>
      <strong className="director-admin-stat-value">{value}</strong>
      {hint ? (
        <div className="director-admin-stat-footer">
          <small>{hint}</small>
          <span aria-hidden="true" />
        </div>
      ) : null}
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
  const todayKey = new Date().toISOString().slice(0, 10);
  const latestObservedIndex = weekSeries.reduce(
    (latestIndex, point, index) => (point.date <= todayKey ? index : latestIndex),
    -1
  );
  const defaultHoverIndex = latestObservedIndex >= 0
    ? latestObservedIndex
    : weekSeries.length
      ? weekSeries.length - 1
      : null;
  const [hoverIndex, setHoverIndex] = useState(defaultHoverIndex);

  useEffect(() => {
    setHoverIndex(defaultHoverIndex);
  }, [defaultHoverIndex, selectedWeekKey]);

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
  const tickStep = getNiceTickStep(maxObservedValue, 5);
  const maxValue = Math.max(tickStep, Math.ceil(Math.max(1, maxObservedValue) / tickStep) * tickStep);
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
  const yTicks = [];
  for (let value = 0; value <= maxValue + tickStep * 0.5; value += tickStep) {
    yTicks.push(Number(value.toFixed(4)));
  }
  const minorGridYs =
    yTicks.length >= 2
      ? yTicks.slice(0, -1).map((value) => {
          const midpoint = value + tickStep / 2;
          return padding.top + (1 - midpoint / maxValue) * plotHeight;
        })
      : [];
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
    const scaleX = bounds.width > 0 ? chartWidth / bounds.width : 1;
    const localX = (event.clientX - bounds.left) * scaleX - padding.left;
    const ratio = plotWidth <= 0 ? 0 : Math.max(0, Math.min(1, localX / plotWidth));
    const nextIndex = Math.round(ratio * (weekSeries.length - 1));
    setHoverIndex(nextIndex);
  };

  return (
    <Card className="director-admin-chart-card">
      <div className="director-admin-chart-head">
        <div>
          <p className="director-admin-eyebrow">Seven-day activity</p>
          <h2 className="pb-section-title">{title}</h2>
        </div>
        {activePoint ? (
          <div className="director-admin-chart-highlight" aria-live="polite">
            <strong>{formatChartTickValue(activePoint.value)}</strong>
            <span>{activePoint.label}</span>
          </div>
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
          onMouseLeave={() => setHoverIndex(defaultHoverIndex)}
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
                  {formatChartTickValue(value)}
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

function TopProfileBreakdownCard({
  title,
  columnLabel = "Category",
  countLabel = "Members",
  items = []
}) {
  const rows = (Array.isArray(items) ? items : []).slice(0, 5);
  return (
    <Card className="director-admin-breakdown-card">
      <div className="director-admin-breakdown-head">
        <h3 className="pb-section-title">{title}</h3>
        <span>{rows.length ? `Top ${rows.length}` : "No data"}</span>
      </div>
      <div className="director-admin-breakdown-table-head">
        <span>{columnLabel}</span>
        <span>{countLabel}</span>
      </div>
      <div className="director-admin-breakdown-list">
        {rows.length ? (
          rows.map((item, index) => (
            <div key={`${item.label}-${index}`} className="director-admin-breakdown-row-item">
              <span className="director-admin-breakdown-label">
                <span className="director-admin-breakdown-rank">{index + 1}</span>
                {item.label}
              </span>
              <strong>{Number(item.count || 0)}</strong>
            </div>
          ))
        ) : (
          <p className="director-admin-breakdown-empty">No profile data yet.</p>
        )}
      </div>
    </Card>
  );
}

export function DirectorAdminDashboardPage() {
  const { slug, request } = useAdminApi();
  const { tenant } = useTenant();
  const aiName = resolveCampAiName(tenant);
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await request(`/dashboard?ts=${Date.now()}`);
      setPayload(data);
      setLastUpdatedAt(new Date());
    } catch (requestError) {
      setError(requestError.message || "Failed to load dashboard.");
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    const refreshIntervalMs = 60000;
    const intervalId = window.setInterval(() => {
      loadDashboard();
    }, refreshIntervalMs);

    const handleWindowFocus = () => {
      loadDashboard();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        loadDashboard();
      }
    };

    window.addEventListener("focus", handleWindowFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleWindowFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [loadDashboard]);

  const stats = payload?.stats || {};
  const isLive = tenant?.onboardingStatus === "live";
  const communityName = String(tenant?.name || tenant?.networkName || "Your camp").trim();
  const lastUpdatedLabel = lastUpdatedAt
    ? `Updated ${lastUpdatedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
    : "Updating dashboard";
  const actionQueue = Array.isArray(payload?.actionQueue) ? payload.actionQueue : [];
  const totalMembers = Number(stats.totalMembers || 0);
  const activeMembers = Number(stats.activeMembers ?? totalMembers);
  const recentSignups = Number(stats.newThisWeek || 0);
  const profileCompletion = Number(stats.profileCompletion || 0);
  const newUsersSeries = payload?.charts?.newUsers || [];
  const signInsSeries = payload?.charts?.signIns || [];
  const topLocations = payload?.profileBreakdowns?.topLocations || [];
  const topRoles = payload?.profileBreakdowns?.topRoles || [];
  const topActiveMembers = (payload?.profileBreakdowns?.topActiveMembers || []).map((item) => ({
    label: String(item?.fullName || "Member"),
    count: Number(item?.logins || 0)
  }));
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
      tone: "success",
      icon: "members"
    },
    {
      key: "active-members",
      label: "Active Members",
      value: activeMembers,
      hint: `${totalMembers ? Math.round((activeMembers / totalMembers) * 100) : 0}% currently active`,
      tone: "neutral",
      icon: "active"
    },
    {
      key: "recent-signups",
      label: "Recent Signups",
      value: recentSignups,
      hint: "Last 7 days",
      tone: recentSignups > 0 ? "success" : "neutral",
      icon: "signups"
    },
    {
      key: "profile-completion",
      label: "Profile Completion",
      value: `${profileCompletion}%`,
      hint: "Average across members",
      tone: profileCompletion >= 70 ? "success" : "neutral",
      icon: "completion"
    }
  ];

  return (
    <div className="director-admin-stack">
      <section className="director-command-hero" aria-labelledby="director-command-title">
        <div className="director-command-hero-copy">
          <div className="director-command-hero-kicker-row">
            <p className="director-command-kicker">Camp control room</p>
            <span className={`director-command-status ${isLive ? "is-live" : "is-setup"}`}>
              <span aria-hidden="true" />
              {isLive ? "Community live" : "Setup in progress"}
            </span>
          </div>
          <h1 id="director-command-title">{communityName} at a glance</h1>
          <p>
            See what needs attention, understand community momentum, and take the next best action from one place.
          </p>
        </div>
        <div className="director-command-refresh-wrap">
          <button
            type="button"
            className="director-command-refresh"
            onClick={loadDashboard}
            disabled={loading}
          >
            <RefreshCw className={loading ? "is-spinning" : ""} size={15} aria-hidden="true" />
            {loading ? "Refreshing…" : "Refresh status"}
          </button>
          <span>{lastUpdatedLabel}</span>
        </div>
        <nav className="director-command-actions" aria-label="Director quick actions">
          <Link className="is-primary" to={`/t/${slug}/onboarding`}>
            <Sparkles size={17} aria-hidden="true" />
            <span>
              <strong>{aiName}</strong>
              <small>Get guided help</small>
            </span>
            <ArrowUpRight size={15} aria-hidden="true" />
          </Link>
          <Link to={`/t/${slug}/admin/people/add`}>
            <UserPlus size={17} aria-hidden="true" />
            <span>
              <strong>Invite members</strong>
              <small>Grow your network</small>
            </span>
            <ArrowUpRight size={15} aria-hidden="true" />
          </Link>
          <Link to={`/t/${slug}/admin/email/compose`}>
            <Send size={17} aria-hidden="true" />
            <span>
              <strong>Send an update</strong>
              <small>Email the community</small>
            </span>
            <ArrowUpRight size={15} aria-hidden="true" />
          </Link>
          <Link to={`/t/${slug}/admin/people/member`}>
            <Users size={17} aria-hidden="true" />
            <span>
              <strong>Manage people</strong>
              <small>Review member records</small>
            </span>
            <ArrowUpRight size={15} aria-hidden="true" />
          </Link>
        </nav>
      </section>
      {error ? <p className="error-text">{error}</p> : null}
      <Card className="director-admin-action-queue">
        <div className="director-admin-action-queue-head">
          <div>
            <p className="director-admin-eyebrow">Today</p>
            <h2>Director action queue</h2>
          </div>
          <Badge tone={actionQueue.length ? "warning" : "success"}>
            {actionQueue.length ? `${actionQueue.length} to review` : "All caught up"}
          </Badge>
        </div>
        {actionQueue.length ? (
          <ol className="director-admin-action-queue-list">
            {actionQueue.map((item) => (
              <li key={item.id} className={`priority-${item.priority || "low"}`}>
                <span className="director-admin-action-priority" aria-label={`${item.priority || "low"} priority`} />
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.detail}</p>
                </div>
                <Link className="link-button secondary" to={item.href}>
                  {item.actionLabel}
                  <ArrowUpRight size={14} aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ol>
        ) : (
          <div className="director-admin-action-empty">
            <span className="director-admin-action-empty-icon" aria-hidden="true">
              <CheckCircle2 size={20} />
            </span>
            <div>
              <strong>Everything is in good shape</strong>
              <p>No access, communication, setup, or billing issues need your attention right now.</p>
            </div>
          </div>
        )}
      </Card>
      <div className="director-admin-stat-grid director-admin-stat-grid-hero">
        {statCards.map((item) => (
          <StatCard
            key={item.key}
            label={item.label}
            value={item.value}
            hint={item.hint}
            tone={item.tone}
            icon={item.icon}
          />
        ))}
      </div>

      <section className="director-admin-dashboard-section" aria-labelledby="director-trends-title">
        <header className="director-admin-section-head">
          <div>
            <p className="director-admin-eyebrow">Community analytics</p>
            <h2 id="director-trends-title">Community trends</h2>
            <p>Track new registrations and repeat engagement across the selected week.</p>
          </div>
          <span>Last 7 days</span>
        </header>
        <div className="director-admin-dashboard-charts">
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
      </section>

      <section className="director-admin-dashboard-section" aria-labelledby="director-insights-title">
        <header className="director-admin-section-head">
          <div>
            <p className="director-admin-eyebrow">Member insights</p>
            <h2 id="director-insights-title">Know your community</h2>
            <p>See where members live, how they participated at camp, and who is returning most often.</p>
          </div>
          <Link to={`/t/${slug}/admin/people/member`}>
            View all members
            <ArrowUpRight size={14} aria-hidden="true" />
          </Link>
        </header>
        <div className="director-admin-breakdown-grid">
          <TopProfileBreakdownCard
            title="Top Locations"
            columnLabel="Location"
            items={topLocations}
          />
          <TopProfileBreakdownCard
            title="Top Roles At Camp"
            columnLabel="Role"
            items={topRoles}
          />
          <TopProfileBreakdownCard
            title="Top Active Members"
            columnLabel="Member"
            countLabel="Logins"
            items={topActiveMembers}
          />
        </div>
      </section>
    </div>
  );
}

function modulePreviewPath(slug, key) {
  const map = {
    directory: `/t/${slug}/search`,
    search: `/t/${slug}/search`,
    events: `/t/${slug}/events`,
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

const MODULE_LAYOUT_HINTS = {
  newsletter: {
    row: "bottom"
  },
  merchShop: {
    row: "bottom"
  }
};

export function DirectorAdminFeaturesPage() {
  const { slug, request } = useAdminApi();
  const { tenant } = useTenant();
  const { confirm, confirmDialogProps } = useConfirmDialog();
  const [payload, setPayload] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [moduleDisplayNames, setModuleDisplayNames] = useState({ newsletter: "Newsletter" });
  const [moduleSettings, setModuleSettings] = useState({ merchShopUrl: "" });
  const [showAllCapabilities, setShowAllCapabilities] = useState(false);
  const demoAccessEnabled = Boolean(tenant?.accessSettings?.demoAccessEnabled);

  const loadFeatures = useCallback(async () => {
    setError("");
    try {
      const response = await request("/features");
      setPayload(response);
      setModuleDisplayNames(response.moduleDisplayNames || { newsletter: "Newsletter" });
      setModuleSettings(response.moduleSettings || { merchShopUrl: "" });
    } catch (requestError) {
      setError(requestError.message || "Failed to load features.");
    }
  }, [request]);

  useEffect(() => {
    loadFeatures();
  }, [loadFeatures]);

  async function saveModules(
    nextModules,
    nextNames = moduleDisplayNames,
    nextSettings = payload?.moduleSettings || moduleSettings
  ) {
    setSaving(true);
    setError("");
    setStatus("");
    try {
      await request("/features", {
        method: "PATCH",
        body: {
          modules: nextModules,
          moduleDisplayNames: nextNames,
          moduleSettings: nextSettings
        }
      });
      setStatus("Features updated.");
      await loadFeatures();
    } catch (requestError) {
      const message = requestError.message || "Failed to update features.";
      await loadFeatures();
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  const orderedModules = useMemo(() => {
    const source = Array.isArray(payload?.modules) ? payload.modules : [];
    if (!source.length) return [];
    const topModules = [];
    const bottomModules = [];
    source.forEach((module) => {
      const hint = MODULE_LAYOUT_HINTS[String(module?.key || "").trim()] || null;
      if (hint?.row === "bottom") {
        bottomModules.push(module);
      } else {
        topModules.push(module);
      }
    });
    return [...topModules, ...bottomModules];
  }, [payload?.modules]);

  if (!payload) {
    return (
      <Card>
        <LoadingSkeleton lines={3} />
      </Card>
    );
  }

  const capabilities = Array.isArray(payload?.capabilities) ? payload.capabilities : [];
  const attentionCapabilities = capabilities.filter((capability) =>
    ["setup_required", "limited"].includes(capability.status)
  );
  const planTier = String(payload?.tenant?.planTier || "base").trim().toLowerCase();
  const planLabel = `${planTier.charAt(0).toUpperCase()}${planTier.slice(1)}`;
  const totalAttention = Number(payload?.summary?.moduleAttention || 0) + Number(payload?.summary?.attention || 0);

  function capabilityTone(capability) {
    if (capability.status === "active") return "success";
    if (capability.status === "locked" || capability.status === "pilot") return "neutral";
    return "warning";
  }

  function capabilityCategoryLabel(capability) {
    if (capability.category === "ai") return "AI service";
    if (capability.category === "plan") return "Plan feature";
    return "Camp operations";
  }

  function renderModuleRow(module) {
    const isUnavailable = Boolean(module.locked || module.platformDisabled);
    return (
      <article
        key={module.key}
        className={`director-admin-module-row ${module.enabled ? "is-enabled" : ""} ${isUnavailable ? "is-unavailable" : ""} ${
          module.setupRequired ? "needs-setup" : ""
        }`.trim()}
      >
        <div className="director-admin-module-main">
          <div className="director-admin-module-copy">
            <div className="director-admin-module-title-row">
              <h3>{module.label}</h3>
              <span className={`director-admin-module-state status-${module.status}`}>
                {module.status === "active" ? "Live" : module.statusLabel}
              </span>
            </div>
            <p>{module.description}</p>
            <div className="director-admin-module-meta">
              {module.externalHref ? (
                <a
                  className="director-admin-inline-link"
                  href={module.externalHref}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open storefront <ArrowUpRight size={14} aria-hidden="true" />
                </a>
              ) : !module.platformDisabled ? (
                <Link className="director-admin-inline-link" to={module.href || modulePreviewPath(slug, module.key)}>
                  Preview in network <ArrowUpRight size={14} aria-hidden="true" />
                </Link>
              ) : null}
              {Array.isArray(module.dependsOn) && module.dependsOn.length ? (
                <span>
                  Requires {module.dependsOn.map((key) => payload.modules.find((item) => item.key === key)?.label || key).join(", ")}
                </span>
              ) : null}
            </div>
          </div>
          {isUnavailable ? (
            <div className="director-admin-module-availability">
              <span>{module.locked ? "Available on Premium" : "Not currently available"}</span>
            </div>
          ) : (
            <label className="director-admin-switch">
              <input
                type="checkbox"
                checked={Boolean(module.enabled)}
                aria-label={`${module.label}: ${module.enabled ? "live" : "hidden"}`}
                onChange={async (event) => {
                  const nextEnabled = Boolean(event.target.checked);
                  if (!nextEnabled && module.enabled) {
                    const confirmed = await confirm({
                      title: `Turn off ${module.label}?`,
                      description: "Members will no longer see this module, but its existing data will be preserved.",
                      confirmLabel: "Turn off module",
                    });
                    if (!confirmed) return;
                  }
                  const nextModules = Object.fromEntries(
                    payload.modules.map((item) => [item.key, item.key === module.key ? nextEnabled : item.enabled])
                  );
                  if (module.key === "directory" && !nextEnabled) {
                    nextModules.search = false;
                    nextModules.relatedProfiles = false;
                  }
                  if ((module.key === "search" || module.key === "relatedProfiles") && nextEnabled) {
                    nextModules.directory = true;
                  }
                  setPayload((prev) => ({
                    ...prev,
                    modules: prev.modules.map((item) => ({
                      ...item,
                      enabled: Boolean(nextModules[item.key])
                    }))
                  }));
                  saveModules(nextModules);
                }}
                disabled={saving}
              />
              <span>{module.enabled ? "Live" : "Hidden"}</span>
            </label>
          )}
        </div>
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
              Save name
            </Button>
          </div>
        ) : null}
        {module.key === "merchShop" && !module.locked ? (
          <div className="director-admin-module-settings">
            <label>
              Storefront URL
              <Input
                type="url"
                value={moduleSettings.merchShopUrl || ""}
                onChange={(event) =>
                  setModuleSettings((prev) => ({ ...prev, merchShopUrl: event.target.value }))
                }
                placeholder="https://shop.examplecamp.org"
                aria-describedby="director-merch-shop-help"
              />
            </label>
            <small id="director-merch-shop-help" className={module.enabled && !moduleSettings.merchShopUrl ? "error-text" : "muted"}>
              {module.enabled && !moduleSettings.merchShopUrl
                ? "Members will not see this module until a storefront URL is saved."
                : "PondBridge opens this external store in a separate browser view."}
            </small>
            <Button
              variant="secondary"
              onClick={() => {
                const nextModules = Object.fromEntries(
                  payload.modules.map((item) => [item.key, item.enabled])
                );
                saveModules(nextModules, moduleDisplayNames, moduleSettings);
              }}
              disabled={saving}
            >
              Save storefront
            </Button>
          </div>
        ) : null}
        {module.locked ? (
          <p className="director-admin-module-note">Upgrade to Premium to make this available to members.</p>
        ) : module.platformDisabled ? (
          <p className="director-admin-module-note">{module.disabledReason || "Temporarily hidden from members across all networks."}</p>
        ) : module.setupRequired ? (
          <p className="director-admin-module-note is-warning">{module.disabledReason}</p>
        ) : null}
      </article>
    );
  }

  return (
    <>
      <Card className="director-admin-features-card">
        <AdminPageHeader
          title="Features & services"
          subtitle="Choose what members can use, then finish any services that still need setup."
          className="director-admin-page-head"
          actions={
            planTier === "base" && !demoAccessEnabled ? (
              <Link className="link-button secondary" to={`/t/${slug}/admin/billing`}>
                View plans
              </Link>
            ) : null
          }
        />
        <div className="director-admin-feature-overview" aria-label="Feature status overview">
          <div>
            <span>Community features</span>
            <strong>{payload?.summary?.activeModules || 0} of {payload?.summary?.totalModules || 0} live</strong>
          </div>
          <div className={totalAttention ? "needs-attention" : "is-ready"}>
            <span>Needs attention</span>
            <strong>{totalAttention ? `${totalAttention} item${totalAttention === 1 ? "" : "s"}` : "Nothing"}</strong>
          </div>
          <div>
            <span>Current plan</span>
            <strong>{planLabel}</strong>
          </div>
        </div>
        <div className="director-admin-feature-feedback" aria-live="polite">
          {error ? <p className="error-text">{error}</p> : null}
          {status ? <p className="success-text">{status}</p> : null}
        </div>
        <section className="director-admin-feature-section" aria-labelledby="community-features-heading">
          <div className="director-admin-section-heading">
            <div>
              <p className="director-admin-section-kicker">Member experience</p>
              <h2 id="community-features-heading">Community features</h2>
              <p>Turn member-facing areas on or off. Existing content is preserved when a feature is hidden.</p>
            </div>
            <Badge tone="neutral">Changes are immediate</Badge>
          </div>
          <div className="director-admin-module-list">
            {orderedModules.map((module) => renderModuleRow(module))}
          </div>
        </section>
      </Card>
      <Card className="director-admin-capabilities-card director-admin-services-card">
        <AdminPageHeader
          title="Services & plan"
          subtitle="Check the systems behind your network. Setup items are surfaced first; the full inventory stays out of the way until you need it."
        />
        <div className="director-admin-service-summary" aria-label="Service status">
          <div className="is-ready">
            <CheckCircle2 size={19} aria-hidden="true" />
            <span><strong>{payload?.summary?.ready || 0}</strong> ready</span>
          </div>
          <div className={payload?.summary?.attention ? "needs-attention" : "is-ready"}>
            <span className="director-admin-service-summary-mark" aria-hidden="true">!</span>
            <span><strong>{payload?.summary?.attention || 0}</strong> need setup</span>
          </div>
          <div>
            <Sparkles size={19} aria-hidden="true" />
            <span><strong>{payload?.summary?.lockedOrPilot || 0}</strong> plan or pilot</span>
          </div>
        </div>

        {attentionCapabilities.length ? (
          <section className="director-admin-service-attention" aria-labelledby="service-attention-heading">
            <div className="director-admin-service-attention-head">
              <div>
                <p className="director-admin-section-kicker">Action recommended</p>
                <h2 id="service-attention-heading">Finish setup</h2>
                <p>These services are available, but one more step will make them fully operational.</p>
              </div>
            </div>
            <div className="director-admin-service-action-list">
              {attentionCapabilities.map((capability) => (
                <article key={capability.key}>
                  <div>
                    <h3>{capability.label}</h3>
                    <p>{capability.description}</p>
                  </div>
                  <div className="director-admin-service-action">
                    <Badge tone="warning">{capability.statusLabel}</Badge>
                    {capability.href ? (
                      <Link className="director-admin-inline-link" to={capability.href}>
                        Open setup <ArrowUpRight size={14} aria-hidden="true" />
                      </Link>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : (
          <div className="director-admin-services-ready">
            <CheckCircle2 size={20} aria-hidden="true" />
            <div>
              <strong>All active services are ready</strong>
              <p>There are no provider or operational setup tasks for this camp.</p>
            </div>
          </div>
        )}

        <div className="director-admin-service-inventory-toggle">
          <div>
            <strong>Full service inventory</strong>
            <span>{capabilities.length} operational, plan, and AI services</span>
          </div>
          <Button
            variant="secondary"
            onClick={() => setShowAllCapabilities((current) => !current)}
            aria-expanded={showAllCapabilities}
            aria-controls="director-admin-service-inventory"
          >
            {showAllCapabilities ? "Hide all services" : "Show all services"}
          </Button>
        </div>

        {showAllCapabilities ? (
          <div className="director-admin-capability-list" id="director-admin-service-inventory">
            {capabilities.map((capability) => (
              <article className={`director-admin-capability-row status-${capability.status}`} key={capability.key}>
                <div>
                  <p className="director-admin-capability-category">{capabilityCategoryLabel(capability)}</p>
                  <h3>{capability.label}</h3>
                  <p>{capability.description}</p>
                </div>
                <div className="director-admin-capability-row-actions">
                  <Badge tone={capabilityTone(capability)}>{capability.statusLabel}</Badge>
                  {capability.href ? (
                    <Link className="director-admin-inline-link" to={capability.href}>
                      {capability.status === "locked" || capability.status === "pilot" ? "View details" : "Open"}
                      <ArrowUpRight size={14} aria-hidden="true" />
                    </Link>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </Card>
      <ModalConfirm {...confirmDialogProps} />
    </>
  );
}


// Shared by the two settings pages that read the whole /settings payload.
function useSettingsLoader() {
  const { request } = useAdminApi();
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setPayload(await request("/settings"));
    } catch (requestError) {
      setError(requestError.message || "Failed to load settings.");
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => { load(); }, [load]);

  return { payload, setPayload, loading, error, load };
}

export function DirectorAdminSettingsNetworkPage() {
  const { request, slug } = useAdminApi();
  const { refreshTenant } = useTenant();
  const { payload, loading, error, load } = useSettingsLoader();
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const [ageGroupDraft, setAgeGroupDraft] = useState("");
  const [staffRoleDraft, setStaffRoleDraft] = useState("");
  const [listErrors, setListErrors] = useState({ ageGroups: "", staffRoles: "" });
  const [taxonomyExpanded, setTaxonomyExpanded] = useState({ ageGroups: false, staffRoles: false });
  const [form, setForm] = useState({
    campName: "",
    campType: "coed",
    networkName: "",
    homepageQuote: "",
    contactEmail: "",
    websiteUrl: "",
    ageGroups: DEFAULT_AGE_GROUPS,
    staffRoles: DEFAULT_STAFF_ROLES
  });

  useEffect(() => {
    if (!payload?.identity) return;
    const campName = String(payload.identity.campName || payload.tenant?.name || "").trim();
    const campType = normalizeCampType(payload?.identity?.campType || payload?.tenant?.content?.campType || "coed");
    setForm({
      campName,
      campType,
      networkName:
        payload.identity.networkName ||
        (campName ? defaultNetworkDisplayNameForCamp(campName, campType) : ""),
      homepageQuote: payload.identity.homepageQuote || payload.identity.tagline || "",
      contactEmail: payload.identity.contactEmail || "",
      websiteUrl: payload.identity.websiteUrl || payload.tenant?.appUrl || "",
      ageGroups: normalizeAdminLabelList(
        payload?.identity?.ageGroups || payload?.tenant?.content?.ageGroups,
        DEFAULT_AGE_GROUPS
      ),
      staffRoles: normalizeAdminLabelList(
        payload?.identity?.staffRoles || payload?.tenant?.content?.staffRoles,
        DEFAULT_STAFF_ROLES
      )
    });
    setAgeGroupDraft("");
    setStaffRoleDraft("");
    setListErrors({ ageGroups: "", staffRoles: "" });
  }, [payload?.identity, payload?.tenant?.name, payload?.tenant?.appUrl, payload?.tenant?.content?.ageGroups, payload?.tenant?.content?.staffRoles]);

  function addLabel(field, rawValue) {
    const nextLabel = String(rawValue || "").trim();
    if (!nextLabel) return;
    setForm((prev) => {
      const current = Array.isArray(prev[field]) ? prev[field] : [];
      const exists = current.some((item) => String(item || "").trim().toLowerCase() === nextLabel.toLowerCase());
      if (exists || current.length >= 20) return prev;
      return { ...prev, [field]: [...current, nextLabel] };
    });
    setListErrors((prev) => ({ ...prev, [field]: "" }));
  }

  function removeLabel(field, index) {
    setForm((prev) => {
      const current = Array.isArray(prev[field]) ? prev[field] : [];
      return { ...prev, [field]: current.filter((_, itemIndex) => itemIndex !== index) };
    });
  }

  function toggleTaxonomySection(section) {
    setTaxonomyExpanded((prev) => ({ ...prev, [section]: !prev[section] }));
  }

  async function saveIdentity(event) {
    event.preventDefault();
    const nextAgeGroups = normalizeAdminLabelList(form.ageGroups, []);
    const nextStaffRoles = normalizeAdminLabelList(form.staffRoles, []);
    const nextErrors = {
      ageGroups: nextAgeGroups.length ? "" : "Add at least one camper age group.",
      staffRoles: nextStaffRoles.length ? "" : "Add at least one staff role."
    };
    setListErrors(nextErrors);
    if (nextErrors.ageGroups || nextErrors.staffRoles) {
      setTaxonomyExpanded((prev) => ({
        ...prev,
        ageGroups: nextErrors.ageGroups ? true : prev.ageGroups,
        staffRoles: nextErrors.staffRoles ? true : prev.staffRoles
      }));
      return;
    }

    setSaving(true);
    setStatus("");
    try {
      const { campName: _unusedCampName, ...identityPayload } = {
        ...form,
        ageGroups: nextAgeGroups,
        staffRoles: nextStaffRoles
      };
      await request("/settings/identity", { method: "PATCH", body: identityPayload });
      try {
        await refreshTenant(slug);
      } catch {
        // Identity save already succeeded; skip blocking UI on tenant-config refresh.
      }
      setStatus("Network identity saved.");
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function copyMobileAppCode() {
    const code = String(payload?.access?.mobileAppCode || "").trim().toUpperCase();
    if (!code) return;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
      }
      setCopyStatus("Copied");
    } catch {
      setCopyStatus("Copy failed");
    }
    window.setTimeout(() => setCopyStatus(""), 1800);
  }

  if (loading && !payload) return <Card><p className="muted">Loading settings...</p></Card>;

  return (
    <Card className="director-admin-network-identity-card">
      <div className="director-admin-network-identity-head">
        <h2 className="pb-section-title">Network Identity</h2>
        <p>Control how your camp appears across login, homepage, and emails.</p>
      </div>
      {error ? <p className="error-text">{error}</p> : null}
      {status ? <p className="success-text">{status}</p> : null}
      <form className="director-admin-form-grid director-admin-network-identity-form" onSubmit={saveIdentity}>
        <label>
          Camp Name
          <Input value={form.campName} readOnly />
        </label>
        <label>
          Camp Type
          <Select
            value={normalizeCampType(form.campType || "coed")}
            onChange={(event) => {
              const nextCampType = normalizeCampType(event.target.value || "coed");
              setForm((prev) => ({
                ...prev,
                campType: nextCampType,
                networkName: replaceAlumniForCampType(prev.networkName, nextCampType),
                homepageQuote: replaceAlumniForCampType(prev.homepageQuote, nextCampType)
              }));
            }}
          >
            <option value="coed">Co-ed camp</option>
            <option value="all_girls">All-girls camp</option>
            <option value="all_boys">All-boys camp</option>
          </Select>
        </label>
        <label className="full-width">
          Network Name
          <Input value={form.networkName} onChange={(event) => setForm((prev) => ({ ...prev, networkName: event.target.value }))} />
        </label>
        <div className="full-width director-admin-mobile-app-card">
          <div className="director-admin-mobile-app-card-head">
            <div>
              <p className="director-admin-mobile-app-eyebrow">iPhone App</p>
              <h3>Camp code</h3>
              <p className="muted">
                Families enter this code in the iPhone app to reach your camp login page.
              </p>
            </div>
            <div className="director-admin-mobile-app-actions">
              <Button
                type="button"
                variant="secondary"
                onClick={copyMobileAppCode}
                disabled={!payload?.access?.mobileAppCode}
              >
                {copyStatus || "Copy Code"}
              </Button>
              <Link className="link-button secondary" to={`/t/${slug}/admin/settings/access`}>
                Access Settings
              </Link>
            </div>
          </div>
          <div className="director-admin-mobile-app-code-row">
            <div className="director-admin-mobile-app-code">
              {payload?.access?.mobileAppCode || "Generating..."}
            </div>
            <span className="director-admin-mobile-app-hint">
              {payload?.access?.mobileAppCodeHint || "Auto-generated for your camp"}
            </span>
          </div>
        </div>
        <label className="full-width director-admin-network-quote-field">
          Homepage quote (before login)
          <Textarea
            value={form.homepageQuote}
            maxLength={220}
            onChange={(event) => setForm((prev) => ({ ...prev, homepageQuote: event.target.value }))}
          />
          <span className="muted director-admin-network-quote-help">Displayed on the public homepage hero before login.</span>
        </label>
        <div className="full-width director-admin-network-taxonomy">
          <section className="director-admin-network-taxonomy-card">
            <button
              type="button"
              className="director-admin-network-taxonomy-toggle"
              onClick={() => toggleTaxonomySection("ageGroups")}
              aria-expanded={taxonomyExpanded.ageGroups}
              aria-controls="director-admin-age-groups-panel"
            >
              <span className="director-admin-network-taxonomy-toggle-copy">
                <h3>Camper Age Groups</h3>
                <small>Used in camper year start/end age-group selectors.</small>
              </span>
              <span className="director-admin-network-taxonomy-toggle-meta">
                <span className="director-admin-network-taxonomy-count">{form.ageGroups.length}/20</span>
                <span
                  className={`director-admin-network-taxonomy-caret ${taxonomyExpanded.ageGroups ? "is-open" : ""}`.trim()}
                  aria-hidden="true"
                >
                  ▾
                </span>
              </span>
            </button>
            {taxonomyExpanded.ageGroups ? (
              <div className="director-admin-network-taxonomy-body" id="director-admin-age-groups-panel">
                <div className="director-admin-network-taxonomy-input-row">
                  <Input
                    value={ageGroupDraft}
                    placeholder="Add age group (ex: Senior I)"
                    onChange={(event) => setAgeGroupDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") return;
                      event.preventDefault();
                      addLabel("ageGroups", ageGroupDraft);
                      setAgeGroupDraft("");
                    }}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      addLabel("ageGroups", ageGroupDraft);
                      setAgeGroupDraft("");
                    }}
                  >
                    Add
                  </Button>
                </div>
                {listErrors.ageGroups ? <p className="error-text">{listErrors.ageGroups}</p> : null}
                <div className="director-admin-network-chip-list">
                  {form.ageGroups.map((label, index) => (
                    <span className="director-admin-network-chip" key={`${label}_${index}`}>
                      <span>{label}</span>
                      <button
                        type="button"
                        className="director-admin-network-chip-remove"
                        onClick={() => removeLabel("ageGroups", index)}
                        aria-label={`Remove age group ${label}`}
                      >
                        Remove
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </section>
          <section className="director-admin-network-taxonomy-card">
            <button
              type="button"
              className="director-admin-network-taxonomy-toggle"
              onClick={() => toggleTaxonomySection("staffRoles")}
              aria-expanded={taxonomyExpanded.staffRoles}
              aria-controls="director-admin-staff-roles-panel"
            >
              <span className="director-admin-network-taxonomy-toggle-copy">
                <h3>Staff Roles</h3>
                <small>Used in member role-at-camp forms and filters.</small>
              </span>
              <span className="director-admin-network-taxonomy-toggle-meta">
                <span className="director-admin-network-taxonomy-count">{form.staffRoles.length}/20</span>
                <span
                  className={`director-admin-network-taxonomy-caret ${taxonomyExpanded.staffRoles ? "is-open" : ""}`.trim()}
                  aria-hidden="true"
                >
                  ▾
                </span>
              </span>
            </button>
            {taxonomyExpanded.staffRoles ? (
              <div className="director-admin-network-taxonomy-body" id="director-admin-staff-roles-panel">
                <div className="director-admin-network-taxonomy-input-row">
                  <Input
                    value={staffRoleDraft}
                    placeholder="Add role (ex: Waterfront Director)"
                    onChange={(event) => setStaffRoleDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") return;
                      event.preventDefault();
                      addLabel("staffRoles", staffRoleDraft);
                      setStaffRoleDraft("");
                    }}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      addLabel("staffRoles", staffRoleDraft);
                      setStaffRoleDraft("");
                    }}
                  >
                    Add
                  </Button>
                </div>
                {listErrors.staffRoles ? <p className="error-text">{listErrors.staffRoles}</p> : null}
                <div className="director-admin-network-chip-list">
                  {form.staffRoles.map((label, index) => (
                    <span className="director-admin-network-chip" key={`${label}_${index}`}>
                      <span>{label}</span>
                      <button
                        type="button"
                        className="director-admin-network-chip-remove"
                        onClick={() => removeLabel("staffRoles", index)}
                        aria-label={`Remove role ${label}`}
                      >
                        Remove
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </section>
        </div>
        <label>
          Contact Email
          <Input type="email" value={form.contactEmail} onChange={(event) => setForm((prev) => ({ ...prev, contactEmail: event.target.value }))} />
        </label>
        <label>
          Website URL
          <Input type="url" value={form.websiteUrl} onChange={(event) => setForm((prev) => ({ ...prev, websiteUrl: event.target.value }))} />
        </label>
        <div className="director-admin-form-actions full-width director-admin-network-form-actions">
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
  const { refreshTenant } = useTenant();
  const { payload, setPayload, loading, error, load } = useSettingsLoader();
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [uploadingField, setUploadingField] = useState("");
  const [logoFileName, setLogoFileName] = useState("");
  const [heroFileName, setHeroFileName] = useState("");
  const [pendingLogoFile, setPendingLogoFile] = useState(null);
  const [pendingHeroFile, setPendingHeroFile] = useState(null);
  const [pendingLogoPreviewUrl, setPendingLogoPreviewUrl] = useState("");
  const [pendingHeroPreviewUrl, setPendingHeroPreviewUrl] = useState("");
  const [form, setForm] = useState({
    brandPrimary: DEFAULT_BRAND_PRIMARY,
    logoUrl: "",
    heroImageUrl: "",
    heroImagePosition: "center center",
    heroImageSize: "cover",
    heroImagePositionLanding: "center center",
    heroImageSizeLanding: "cover",
    heroImagePositionMember: "center center",
    heroImageSizeMember: "cover"
  });

  useEffect(() => {
    if (!payload?.branding) return;
    // Do not clobber in-progress local media edits with background payload refresh.
    if (
      pendingLogoFile ||
      pendingHeroFile ||
      String(form.logoUrl || "").startsWith("data:") ||
      String(form.heroImageUrl || "").startsWith("data:")
    ) {
      return;
    }
    setForm({
      brandPrimary: normalizeBrandHex(payload.branding.brandPrimary, DEFAULT_BRAND_PRIMARY),
      logoUrl: payload.branding.logoUrl || "",
      heroImageUrl: payload.branding.heroImageUrl || "",
      heroImagePosition: normalizeHeroImagePosition(payload.branding.heroImagePosition || "center center"),
      heroImageSize: normalizeHeroImageSize(payload.branding.heroImageSize || "cover"),
      heroImagePositionLanding: normalizeHeroImagePosition(
        payload.branding.heroImagePositionLanding || payload.branding.heroImagePosition || "center center"
      ),
      heroImageSizeLanding: normalizeHeroImageSize(
        payload.branding.heroImageSizeLanding || payload.branding.heroImageSize || "cover"
      ),
      heroImagePositionMember: normalizeHeroImagePosition(
        payload.branding.heroImagePositionMember || payload.branding.heroImagePosition || "center center"
      ),
      heroImageSizeMember: normalizeHeroImageSize(
        payload.branding.heroImageSizeMember || payload.branding.heroImageSize || "cover"
      )
    });
    setPendingLogoFile(null);
    setPendingHeroFile(null);
    setPendingLogoPreviewUrl("");
    setPendingHeroPreviewUrl("");
  }, [
    form.heroImageUrl,
    form.logoUrl,
    payload?.branding,
    pendingHeroFile,
    pendingLogoFile
  ]);

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
      payloadToSave.heroImagePositionLanding = normalizeHeroImagePosition(
        payloadToSave.heroImagePositionLanding || payloadToSave.heroImagePosition || "center center"
      );
      payloadToSave.heroImageSizeLanding = normalizeHeroImageSize(
        payloadToSave.heroImageSizeLanding || payloadToSave.heroImageSize || "cover"
      );
      payloadToSave.heroImagePositionMember = normalizeHeroImagePosition(
        payloadToSave.heroImagePositionMember || payloadToSave.heroImagePosition || "center center"
      );
      payloadToSave.heroImageSizeMember = normalizeHeroImageSize(
        payloadToSave.heroImageSizeMember || payloadToSave.heroImageSize || "cover"
      );
      // Backward-compatible shared fields mirror the landing framing.
      payloadToSave.heroImagePosition = payloadToSave.heroImagePositionLanding;
      payloadToSave.heroImageSize = payloadToSave.heroImageSizeLanding;
      if (pendingLogoFile) {
        payloadToSave.logoUrl = await uploadBrandingBlob({
          blob: pendingLogoFile,
          fileType: pendingLogoFile.type || "image/jpeg",
          scope: "branding-logo"
        });
      } else if (String(payloadToSave.logoUrl || "").startsWith("data:")) {
        const blob = await fetch(payloadToSave.logoUrl).then((response) => response.blob());
        payloadToSave.logoUrl = await uploadBrandingBlob({
          blob,
          fileType: blob.type || "image/jpeg",
          scope: "branding-logo"
        });
      }
      if (pendingHeroFile) {
        payloadToSave.heroImageUrl = await uploadBrandingBlob({
          blob: pendingHeroFile,
          fileType: pendingHeroFile.type || "image/jpeg",
          scope: "branding-hero"
        });
      } else if (String(payloadToSave.heroImageUrl || "").startsWith("data:")) {
        const blob = await fetch(payloadToSave.heroImageUrl).then((response) => response.blob());
        payloadToSave.heroImageUrl = await uploadBrandingBlob({
          blob,
          fileType: blob.type || "image/jpeg",
          scope: "branding-hero"
        });
      }

      await request("/settings/branding", { method: "PATCH", body: payloadToSave });
      setForm(payloadToSave);
      setPayload((previous) => {
        if (!previous || typeof previous !== "object") return previous;
        const nextBranding = {
          ...(previous.branding || {}),
          logoUrl: String(payloadToSave.logoUrl || ""),
          heroImageUrl: String(payloadToSave.heroImageUrl || ""),
          heroImagePosition: String(payloadToSave.heroImagePosition || "center center"),
          heroImageSize: String(payloadToSave.heroImageSize || "cover"),
          heroImagePositionLanding: String(payloadToSave.heroImagePositionLanding || "center center"),
          heroImageSizeLanding: String(payloadToSave.heroImageSizeLanding || "cover"),
          heroImagePositionMember: String(payloadToSave.heroImagePositionMember || "center center"),
          heroImageSizeMember: String(payloadToSave.heroImageSizeMember || "cover"),
          brandPrimary: normalizeBrandHex(payloadToSave.brandPrimary, DEFAULT_BRAND_PRIMARY)
        };
        return {
          ...previous,
          branding: nextBranding
        };
      });
      setPendingLogoFile(null);
      setPendingHeroFile(null);
      setPendingLogoPreviewUrl("");
      setPendingHeroPreviewUrl("");
      try {
        await refreshTenant(slug);
      } catch {
        // Branding save already succeeded; skip blocking UI on tenant-config refresh.
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
    const maxBytes = field === "logoUrl" ? 12 * 1024 * 1024 : 15 * 1024 * 1024;
    if (Number(file.size || 0) > maxBytes) {
      setUploadError(
        field === "logoUrl"
          ? "Logo file must be under 12MB."
          : "Main photo file must be under 15MB."
      );
      return;
    }
    setUploadError("");
    setStatus("");
    setUploadingField(field);

    try {
      const preset =
        field === "logoUrl"
          ? IMAGE_OPTIMIZATION_PRESETS.logo
          : IMAGE_OPTIMIZATION_PRESETS.hero;
      const optimizedFile = await optimizeImageFile(file, preset);
      const previewDataUrl = await fileToDataUrl(optimizedFile);
      setForm((prev) => ({ ...prev, [field]: previewDataUrl }));
      if (field === "logoUrl") {
        setPendingLogoFile(optimizedFile);
        setPendingLogoPreviewUrl(previewDataUrl);
      } else {
        setPendingHeroFile(optimizedFile);
        setPendingHeroPreviewUrl(previewDataUrl);
      }
      const savings =
        file.size > 0 && optimizedFile.size < file.size
          ? ` (${Math.round((1 - optimizedFile.size / file.size) * 100)}% smaller)`
          : "";
      setStatus(
        `Image preview optimized for fast loading${savings}. Click Save Branding to publish this change.`
      );
    } catch (uploadErrorState) {
      setUploadError(uploadErrorState.message || "Unable to process image.");
    } finally {
      setUploadingField("");
    }

    if (field === "logoUrl") {
      setLogoFileName(String(file?.name || "").trim());
    }
    if (field === "heroImageUrl") {
      setHeroFileName(String(file?.name || "").trim());
    }
  }

  if (loading && !payload) return <Card><p className="muted">Loading settings...</p></Card>;
  const previewBrandPrimary = normalizeBrandHex(form.brandPrimary, DEFAULT_BRAND_PRIMARY);
  const paletteSwatches = [
    { label: "Primary", color: previewBrandPrimary },
    { label: "Action", color: darkenHex(previewBrandPrimary, 0.12) },
    { label: "Soft", color: deriveSecondaryHex(previewBrandPrimary, 0.72) },
    { label: "Surface", color: deriveSecondaryHex(previewBrandPrimary, 0.9) }
  ];
  const currentLogoUrl = String(payload?.branding?.logoUrl || "").trim();
  const currentHeroUrl = String(payload?.branding?.heroImageUrl || "").trim();
  const draftLogoUrl = String(form.logoUrl || "").trim();
  const draftHeroUrl = String(form.heroImageUrl || "").trim();
  const liveLogoPreviewUrl = pendingLogoPreviewUrl || draftLogoUrl || currentLogoUrl;
  const liveHeroPreviewUrl = pendingHeroPreviewUrl || draftHeroUrl || currentHeroUrl;
  const hasPendingLogoUpdate = Boolean(pendingLogoFile) || (Boolean(draftLogoUrl) && draftLogoUrl !== currentLogoUrl);
  const hasPendingHeroUpdate = Boolean(pendingHeroFile) || (Boolean(draftHeroUrl) && draftHeroUrl !== currentHeroUrl);

  return (
    <Card>
      <h2 className="pb-section-title">Branding</h2>
      {error ? <p className="error-text">{error}</p> : null}
      {uploadError ? <p className="error-text">{uploadError}</p> : null}
      {status ? <p className="success-text">{status}</p> : null}
      <form className="director-admin-form-grid" onSubmit={saveBranding}>
        <div className="full-width director-admin-upload-field">
          <label htmlFor="director-admin-logo-upload">Logo Upload</label>
          <label className="director-upload-control" htmlFor="director-admin-logo-upload">
            <span className="director-upload-button">Upload logo</span>
            <span className="director-upload-name">
              {logoFileName || "PNG or JPG"}
            </span>
          </label>
          <input
            id="director-admin-logo-upload"
            type="file"
            accept="image/*"
            className="director-upload-input"
            onClick={(event) => {
              event.currentTarget.value = "";
            }}
            onChange={(event) => onFilePick("logoUrl", event.target.files?.[0] || null)}
          />
          <div className="director-admin-branding-current-media">
            <small>{hasPendingLogoUpdate ? "Preview (pending save)" : "Currently in use"}</small>
            {liveLogoPreviewUrl ? (
              <img src={liveLogoPreviewUrl} alt="Current logo" className="director-admin-branding-current-logo" />
            ) : (
              <p className="muted">No logo currently set.</p>
            )}
            {hasPendingLogoUpdate ? <p className="muted">Saving will replace the current logo.</p> : null}
          </div>
        </div>
        <div className="full-width director-admin-upload-field">
          <label htmlFor="director-admin-hero-upload">Hero Image Upload</label>
          <label className="director-upload-control" htmlFor="director-admin-hero-upload">
            <span className="director-upload-button">Upload main photo</span>
            <span className="director-upload-name">
              {heroFileName || "Used on login and home pages. PNG or JPG"}
            </span>
          </label>
          <input
            id="director-admin-hero-upload"
            type="file"
            accept="image/*"
            className="director-upload-input"
            onClick={(event) => {
              event.currentTarget.value = "";
            }}
            onChange={(event) => onFilePick("heroImageUrl", event.target.files?.[0] || null)}
          />
          <div className="director-admin-branding-current-media">
            <small>{hasPendingHeroUpdate ? "Preview (pending save)" : "Currently in use"}</small>
            {liveHeroPreviewUrl ? (
              <img src={liveHeroPreviewUrl} alt="Current hero image" className="director-admin-branding-current-hero" />
            ) : (
              <p className="muted">No hero image currently set.</p>
            )}
            {hasPendingHeroUpdate ? <p className="muted">Saving will replace the current main photo.</p> : null}
          </div>
        </div>
        <div className="full-width">
          <label htmlFor="director-admin-brand-primary">Main color</label>
          <div className="director-color-row">
            <input
              id="director-admin-brand-primary"
              type="color"
              className="director-color-swatch"
              value={previewBrandPrimary}
              aria-label="Main color picker"
              onChange={(event) =>
                setForm((prev) => ({ ...prev, brandPrimary: normalizeBrandHex(event.target.value, DEFAULT_BRAND_PRIMARY) }))
              }
            />
            <Input
              value={form.brandPrimary}
              placeholder={DEFAULT_BRAND_PRIMARY.toUpperCase()}
              onChange={(event) => setForm((prev) => ({ ...prev, brandPrimary: event.target.value }))}
              onBlur={() =>
                setForm((prev) => ({ ...prev, brandPrimary: normalizeBrandHex(prev.brandPrimary, DEFAULT_BRAND_PRIMARY) }))
              }
            />
          </div>
          <BrandImageColorPicker
            value={form.brandPrimary}
            onPickColor={(nextHex) =>
              setForm((prev) => ({ ...prev, brandPrimary: normalizeBrandHex(nextHex, DEFAULT_BRAND_PRIMARY) }))
            }
          />
          <div className="director-palette-preview" aria-label="Brand palette preview">
            {paletteSwatches.map((swatch) => (
              <div className="director-palette-swatch" key={swatch.label}>
                <span
                  className="director-palette-chip"
                  style={{ backgroundColor: swatch.color }}
                  aria-hidden="true"
                />
                <span>{swatch.label}</span>
                <code>{swatch.color.toUpperCase()}</code>
              </div>
            ))}
          </div>
        </div>
        <div className="full-width">
          <HeroImageEditor
            label="Live preview"
            variant="admin"
            heroImageUrl={liveHeroPreviewUrl}
            landingImagePosition={form.heroImagePositionLanding}
            landingImageSize={form.heroImageSizeLanding}
            memberImagePosition={form.heroImagePositionMember}
            memberImageSize={form.heroImageSizeMember}
            logoUrl={liveLogoPreviewUrl}
            brandPrimary={previewBrandPrimary}
            campName={payload?.identity?.campName || payload?.tenant?.name || "Your Camp"}
            campType={payload?.tenant?.content?.campType || "coed"}
            welcomeBody={payload?.identity?.homepageQuote || payload?.identity?.tagline || ""}
            onChangeLandingPosition={(nextValue) =>
              setForm((prev) => ({
                ...prev,
                heroImagePosition: normalizeHeroImagePosition(nextValue || "center center"),
                heroImagePositionLanding: normalizeHeroImagePosition(nextValue || "center center")
              }))
            }
            onChangeLandingSize={(nextValue) =>
              setForm((prev) => ({
                ...prev,
                heroImageSize: normalizeHeroImageSize(nextValue || "cover"),
                heroImageSizeLanding: normalizeHeroImageSize(nextValue || "cover")
              }))
            }
            onChangeMemberPosition={(nextValue) =>
              setForm((prev) => ({
                ...prev,
                heroImagePositionMember: normalizeHeroImagePosition(nextValue || "center center")
              }))
            }
            onChangeMemberSize={(nextValue) =>
              setForm((prev) => ({
                ...prev,
                heroImageSizeMember: normalizeHeroImageSize(nextValue || "cover")
              }))
            }
          />
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
