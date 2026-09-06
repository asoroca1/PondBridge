import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  defaultNetworkDisplayNameForCamp,
  HOME_QUICK_ACTION_CATALOG,
  HOME_QUICK_ACTION_SLOTS,
  normalizeCampType,
  normalizeHeroImagePosition,
  normalizeHeroImageSize,
  replaceAlumniForCampType,
  resolveTenantModules
} from "@pondbridge/shared";
import { Badge, Button, Card, Input, Select, Textarea } from "@pondbridge/ui";
import {
  ArrowUpRight,
  CheckCircle2,
  GripVertical,
  RefreshCw,
  Send,
  Sparkles,
  UserPlus,
  Users
} from "lucide-react";
import { requestBlob, requestJson } from "../../lib/http.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { useTenant } from "../../context/TenantContext.jsx";
import { resolveAlumniWord, resolveCampAiName } from "../../lib/campLabels.js";
import { HIDE_CAMP_AI, HIDE_MOBILE_APP, isHiddenCapability } from "../../lib/directorHiddenFeatures.js";
import HeroImageEditor from "../../components/HeroImageEditor.jsx";
import BrandImageColorPicker from "../../components/BrandImageColorPicker.jsx";
import {
  LoadingSkeleton,
  ModalConfirm,
  WorkspaceHeader
} from "../../components/admin/AdminUi.jsx";
import {
  SettingActions,
  SettingField,
  SettingRow,
  SettingTabs
} from "../../components/admin/SettingControls.jsx";
import { useConfirmDialog } from "../../components/admin/useConfirmDialog.js";
import {
  IMAGE_OPTIMIZATION_PRESETS,
  optimizeImageFile,
  renderAppIconPng
} from "../../lib/imageOptimization.js";
import { APP_ICON_SIZES, campNetworkTitle } from "../../lib/tenantBrandAssets.js";
import "./director-admin-today.css";
import "../../styles/productOnboarding.css";

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

const DEFAULT_BRAND_PRIMARY = "#303030";
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
  if (!isHexColor(hex)) return "#1c1c1c";
  const clean = String(hex).replace("#", "");
  const channels = [0, 2, 4].map((index) => Number.parseInt(clean.slice(index, index + 2), 16));
  const darkened = channels.map((value) => Math.max(0, Math.min(255, Math.round(value * (1 - factor)))));
  return `#${darkened.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function deriveSecondaryHex(hex, blend = 0.82) {
  if (!isHexColor(hex)) return "#e6e6e6";
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
  // Reserve room for the axis titles only when there are axis titles.
  const padding = {
    top: 16,
    right: 16,
    bottom: xLabel ? 38 : 30,
    left: yLabel ? 52 : 40
  };
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
                  <text key={index} className="director-admin-chart-xtick" x={point.x} y={chartHeight - padding.bottom + 16}>
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

const TODAY_SHORTCUTS = [
  { key: "invite", to: "admin/people/add", icon: UserPlus, label: "Add people" },
  { key: "email", to: "admin/email/compose", icon: Send, label: "Write an email" },
  { key: "people", to: "admin/people/all", icon: Users, label: "Browse people" }
];

function priorityLabel(priority) {
  if (priority === "high") return "Do this first";
  if (priority === "medium") return "Worth doing";
  return "When you have time";
}

function deltaHint(delta) {
  if (delta === null || delta === undefined) return "In your network";
  const value = Number(delta);
  if (!Number.isFinite(value) || !value) return "No change in 30 days";
  const magnitude = Math.abs(value);
  const direction = value > 0 ? "Up" : "Down";
  // A camp importing its back catalogue grows by thousands of percent, and "Up 7659%"
  // tells a director nothing. Past 10x, a multiple is the readable form.
  if (magnitude >= 1000) {
    return `${direction} ${Math.round(magnitude / 100)}x in 30 days`;
  }
  return `${direction} ${Math.round(magnitude)}% in 30 days`;
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
      setPayload(await request(`/dashboard?ts=${Date.now()}`));
      setLastUpdatedAt(new Date());
    } catch (requestError) {
      setError(requestError.message || "Could not load today's summary.");
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => { loadDashboard(); }, [loadDashboard]);

  // Refresh when the director comes back to the tab. The old page also polled
  // on a timer, which meant the queue could reshuffle under the cursor
  // mid-click; coming back to the tab is the moment the data actually matters.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") loadDashboard();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [loadDashboard]);

  const stats = payload?.stats || {};
  const actionQueue = Array.isArray(payload?.actionQueue) ? payload.actionQueue : [];
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
    return <Card><LoadingSkeleton lines={4} /></Card>;
  }

  const totalMembers = Number(stats.totalMembers || 0);
  const recentSignups = Number(stats.newThisWeek || 0);
  const signInsThisWeek = normalizedSignInsSeries
    .slice(-7)
    .reduce((sum, point) => sum + Number(point?.value || 0), 0);
  const profileCompletion = Number(stats.profileCompletion || 0);
  const urgent = actionQueue.filter((item) => item.priority === "high").length;

  const statCards = [
    {
      key: "total-members",
      label: "Members",
      value: totalMembers,
      hint: deltaHint(stats.totalMembersDelta),
      tone: "success",
      icon: "members"
    },
    {
      key: "sign-ins",
      label: "Sign-ins",
      value: signInsThisWeek,
      hint: "In the last 7 days",
      tone: signInsThisWeek > 0 ? "success" : "neutral",
      icon: "active"
    },
    {
      key: "recent-signups",
      label: "Joined",
      value: recentSignups,
      hint: "In the last 7 days",
      tone: recentSignups > 0 ? "success" : "neutral",
      icon: "signups"
    },
    {
      key: "profile-completion",
      label: "Profiles filled in",
      value: `${profileCompletion}%`,
      hint: "Averaged across members",
      tone: profileCompletion >= 70 ? "success" : "neutral",
      icon: "completion"
    }
  ];

  return (
    <div className="pb-workspace pb-today">
      <WorkspaceHeader
        eyebrow="Control room"
        title="Today"
        subtitle="What needs you, and how your network is doing."
        meta={
          <>
            <span className={`pb-today-state ${tenant?.onboardingStatus === "live" ? "is-live" : "is-setup"}`}>
              <i aria-hidden="true" />
              {tenant?.onboardingStatus === "live" ? "Community live" : "Setup in progress"}
            </span>
            {lastUpdatedAt ? (
              <span className="pb-today-updated">
                Updated {lastUpdatedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              </span>
            ) : null}
          </>
        }
        actions={
          <Button variant="secondary" size="sm" onClick={loadDashboard} loading={loading}>
            <RefreshCw size={15} aria-hidden="true" />
            Refresh
          </Button>
        }
      />

      {error ? <p className="error-text" role="alert">{error}</p> : null}

      {/* The queue is the page. It used to sit under a hero of quick links,
          which put the generic actions above the specific ones. */}
      <Card className="pb-today-queue">
        {actionQueue.length ? (
          <div className="pb-today-queue-head">
            <h2 className="pb-section-title">What needs you</h2>
            <Badge tone={urgent ? "warning" : "neutral"}>
              {urgent ? `${urgent} urgent` : `${actionQueue.length} to look at`}
            </Badge>
          </div>
        ) : null}

        {actionQueue.length ? (
          <ol className="pb-today-queue-list">
            {actionQueue.map((item) => (
              <li key={item.id} className={`is-${item.priority || "low"}`}>
                <span className="pb-today-priority">{priorityLabel(item.priority)}</span>
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
          <p className="pb-today-clear">
            <CheckCircle2 size={18} aria-hidden="true" />
            <strong>Nothing needs you.</strong>
            No access requests, failed emails, or billing problems are waiting.
          </p>
        )}

        <nav className="pb-today-shortcuts" aria-label="Common tasks">
          {HIDE_CAMP_AI ? null : (
            <Link to={`/t/${slug}/onboarding`} className="is-primary">
              <Sparkles size={16} aria-hidden="true" />
              Ask {aiName}
            </Link>
          )}
          {TODAY_SHORTCUTS.map((item) => {
            const Icon = item.icon;
            return (
              <Link key={item.key} to={`/t/${slug}/${item.to}`}>
                <Icon size={16} aria-hidden="true" />
                {item.label}
              </Link>
            );
          })}
        </nav>
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
        <Card className="pb-today-section">
        <header className="pb-today-section-head">
          <div>
            <h2 id="director-trends-title">Joining and signing in</h2>
            <p>New members and repeat visits across the week you pick.</p>
          </div>
        </header>
        <div className="director-admin-dashboard-charts">
          <TimeSeriesChartCard
            title="Joined"
            yLabel=""
            xLabel=""
            points={newUsersSeries}
            weekWindows={weekWindows}
            activeWeekKey={activeWeekKey}
            onWeekChange={setActiveWeekKey}
          />
          <TimeSeriesChartCard
            title="Signed in"
            yLabel=""
            xLabel=""
            points={signInsSeries}
            weekWindows={weekWindows}
            activeWeekKey={activeWeekKey}
            onWeekChange={setActiveWeekKey}
          />
        </div>
        </Card>
      </section>

      <section className="director-admin-dashboard-section" aria-labelledby="director-insights-title">
        <Card className="pb-today-section">
        <header className="pb-today-section-head">
          <div>
            <h2 id="director-insights-title">Who is in your network</h2>
            <p>Where members live, what they did at camp, and who comes back most.</p>
          </div>
          <Link to={`/t/${slug}/admin/people/member`}>
            See everyone
            <ArrowUpRight size={14} aria-hidden="true" />
          </Link>
        </header>
        <div className="director-admin-breakdown-grid">
          <TopProfileBreakdownCard title="Where they live" columnLabel="Location" items={topLocations} />
          <TopProfileBreakdownCard title="What they did at camp" columnLabel="Role" items={topRoles} />
          <TopProfileBreakdownCard
            title="Who comes back most"
            columnLabel="Member"
            countLabel="Sign-ins"
            items={topActiveMembers}
          />
        </div>
        </Card>
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

// The saved list is a compact array of chosen keys; the editor wants one value
// per slot, with "" standing for a slot the director has left on automatic.
function toQuickActionSlots(value = []) {
  const source = Array.isArray(value) ? value : [];
  return Array.from({ length: HOME_QUICK_ACTION_SLOTS }, (_, index) =>
    String(source[index] || "")
  );
}

// Mirrors the two labels the member home page customises per camp.
function quickActionOptionLabel(action, { alumniWordTitle, newsletterLabel, mediaStreamLabel }) {
  if (action.key === "photoStream") return mediaStreamLabel;
  if (action.key === "map") return `${alumniWordTitle} Map`;
  if (action.key === "newsletter") return newsletterLabel;
  return action.label;
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
  const { tenant, refreshTenant } = useTenant();
  const { confirm, confirmDialogProps } = useConfirmDialog();
  const [payload, setPayload] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [moduleDisplayNames, setModuleDisplayNames] = useState({
    newsletter: "Newsletter",
    photoStream: "Media Stream"
  });
  const [moduleSettings, setModuleSettings] = useState({ merchShopUrl: "", sideNavEnabled: false });
  const [showAllCapabilities, setShowAllCapabilities] = useState(false);
  // One entry per home-page button slot; "" means "let PondBridge choose".
  const [homeQuickActions, setHomeQuickActions] = useState(() =>
    Array(HOME_QUICK_ACTION_SLOTS).fill("")
  );
  const [savingQuickActions, setSavingQuickActions] = useState(false);
  const demoAccessEnabled = Boolean(tenant?.accessSettings?.demoAccessEnabled);
  const alumniWordTitle = resolveAlumniWord(tenant, { capitalized: true });

  const loadFeatures = useCallback(async () => {
    setError("");
    try {
      const response = await request("/features");
      setPayload(response);
      setModuleDisplayNames(
        response.moduleDisplayNames || { newsletter: "Newsletter", photoStream: "Media Stream" }
      );
      setModuleSettings(response.moduleSettings || { merchShopUrl: "", sideNavEnabled: false });
      setHomeQuickActions(toQuickActionSlots(response.homeQuickActions));
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
      // The rest of the app reads these labels from the cached tenant config,
      // which otherwise keeps the old newsletter name for a further 5 minutes
      // and makes a successful save look like it did nothing.
      await refreshTenant?.();
    } catch (requestError) {
      const message = requestError.message || "Failed to update features.";
      await loadFeatures();
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  async function saveHomeQuickActions() {
    setSavingQuickActions(true);
    setError("");
    setStatus("");
    try {
      const response = await request("/features", {
        method: "PATCH",
        body: { homeQuickActions: homeQuickActions.filter(Boolean) }
      });
      setHomeQuickActions(toQuickActionSlots(response.homeQuickActions));
      setStatus("Home page buttons updated.");
      // The member home reads this off the cached tenant config, so the refresh
      // has to skip that cache or the director keeps seeing the old buttons.
      await refreshTenant?.(undefined, { bypassCache: true });
    } catch (requestError) {
      setError(requestError.message || "Failed to update home page buttons.");
      await loadFeatures();
    } finally {
      setSavingQuickActions(false);
    }
  }

  const quickActionOptions = useMemo(() => {
    const modules = resolveTenantModules(
      Object.fromEntries((payload?.modules || []).map((item) => [item.key, item.enabled]))
    );
    const merchShopUrl = String(moduleSettings.merchShopUrl || "").trim();

    return HOME_QUICK_ACTION_CATALOG.filter((action) => {
      if (action.moduleKey && modules[action.moduleKey] === false) return false;
      if (action.key === "merchShop" && !merchShopUrl) return false;
      return true;
    }).map((action) => ({
      key: action.key,
      label: quickActionOptionLabel(action, {
        alumniWordTitle,
        newsletterLabel: String(moduleDisplayNames.newsletter || "").trim() || "Newsletter",
        mediaStreamLabel: String(moduleDisplayNames.photoStream || "").trim() || "Media Stream"
      })
    }));
  }, [
    payload?.modules,
    moduleSettings.merchShopUrl,
    moduleDisplayNames.newsletter,
    moduleDisplayNames.photoStream,
    alumniWordTitle
  ]);

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

  // Camp AI and mobile-app services stay out of the inventory for now, so the
  // counts below are recomputed from what actually renders rather than reusing
  // the API summary, which still counts everything.
  const capabilities = (Array.isArray(payload?.capabilities) ? payload.capabilities : [])
    .filter((capability) => !isHiddenCapability(capability));
  const attentionCapabilities = capabilities.filter((capability) =>
    ["setup_required", "limited"].includes(capability.status)
  );
  const capabilitySummary = {
    ready: capabilities.filter((capability) => capability.status === "active").length,
    attention: attentionCapabilities.length,
    lockedOrPilot: capabilities.filter((capability) => ["locked", "pilot"].includes(capability.status)).length
  };
  const planTier = String(payload?.tenant?.planTier || "base").trim().toLowerCase();
  const planLabel = `${planTier.charAt(0).toUpperCase()}${planTier.slice(1)}`;
  const totalAttention = Number(payload?.summary?.moduleAttention || 0) + capabilitySummary.attention;

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
        {module.key === "photoStream" && !module.locked ? (
          <div className="director-admin-module-settings">
            <label>
              Media Stream display name
              <Input
                value={moduleDisplayNames.photoStream || ""}
                onChange={(event) =>
                  setModuleDisplayNames((prev) => ({ ...prev, photoStream: event.target.value }))
                }
                placeholder="Media Stream"
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
            {planTier === "base" && !demoAccessEnabled ? (
              <Link to={`/t/${slug}/admin/billing`}>View plans</Link>
            ) : null}
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
        <section className="director-admin-feature-section" aria-labelledby="home-buttons-heading">
          <div className="director-admin-section-heading">
            <div>
              <p className="director-admin-section-kicker">Member home</p>
              <h2 id="home-buttons-heading">Home page buttons</h2>
              <p>
                Choose the four shortcuts members see under the welcome banner. Leave a slot on
                automatic and PondBridge fills it with the next available page.
              </p>
            </div>
            <Badge tone="neutral">{HOME_QUICK_ACTION_SLOTS} buttons</Badge>
          </div>
          <div className="director-admin-home-buttons">
            {homeQuickActions.map((selectedKey, index) => {
              const takenElsewhere = new Set(
                homeQuickActions.filter((key, slot) => key && slot !== index)
              );
              const options = quickActionOptions.filter(
                (option) => option.key === selectedKey || !takenElsewhere.has(option.key)
              );
              const isStale = Boolean(selectedKey) && !options.some((o) => o.key === selectedKey);

              return (
                <SettingField
                  key={`home-button-${index}`}
                  label={`Button ${index + 1}`}
                  hint={isStale ? "This page is turned off, so the button falls back to automatic." : ""}
                >
                  <Select
                    value={isStale ? "" : selectedKey}
                    onChange={(event) => {
                      const nextKey = event.target.value;
                      setHomeQuickActions((prev) =>
                        prev.map((key, slot) => (slot === index ? nextKey : key))
                      );
                    }}
                    disabled={savingQuickActions}
                  >
                    <option value="">Automatic</option>
                    {options.map((option) => (
                      <option key={option.key} value={option.key}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </SettingField>
              );
            })}
          </div>
          <SettingActions note="Members see the new buttons the next time they open the home page.">
            <Button
              variant="secondary"
              onClick={() => setHomeQuickActions(Array(HOME_QUICK_ACTION_SLOTS).fill(""))}
              disabled={savingQuickActions || homeQuickActions.every((key) => !key)}
            >
              Reset to automatic
            </Button>
            <Button onClick={saveHomeQuickActions} disabled={savingQuickActions}>
              {savingQuickActions ? "Saving…" : "Save buttons"}
            </Button>
          </SettingActions>
        </section>
        <section className="director-admin-feature-section" aria-labelledby="member-navigation-heading">
          <div className="director-admin-section-heading">
            <div>
              <p className="director-admin-section-kicker">Member navigation</p>
              <h2 id="member-navigation-heading">Sidebar navigation</h2>
              <p>
                Show every feature in a permanent bar down the left of the page instead of hiding
                them behind the menu button. Members on phones and narrow windows keep the menu
                button either way, and can collapse the bar to icons.
              </p>
            </div>
            <Badge tone="neutral">Wide screens only</Badge>
          </div>
          <div className="director-admin-module-list">
            <article className={`director-admin-module-row ${moduleSettings.sideNavEnabled ? "is-enabled" : ""}`.trim()}>
              <div className="director-admin-module-main">
                <div className="director-admin-module-copy">
                  <div className="director-admin-module-title-row">
                    <h3>Left sidebar</h3>
                    <span className={`director-admin-module-state status-${moduleSettings.sideNavEnabled ? "active" : "off"}`}>
                      {moduleSettings.sideNavEnabled ? "Live" : "Off"}
                    </span>
                  </div>
                  <p>
                    The sidebar lists the same pages as the menu button and follows the features you
                    turned on above, so nothing needs to be configured twice.
                  </p>
                </div>
                <label className="director-admin-switch">
                  <input
                    type="checkbox"
                    checked={Boolean(moduleSettings.sideNavEnabled)}
                    aria-label={`Sidebar navigation: ${moduleSettings.sideNavEnabled ? "on" : "off"}`}
                    onChange={(event) => {
                      const nextSettings = {
                        ...moduleSettings,
                        sideNavEnabled: Boolean(event.target.checked)
                      };
                      setModuleSettings(nextSettings);
                      const nextModules = Object.fromEntries(
                        payload.modules.map((item) => [item.key, item.enabled])
                      );
                      saveModules(nextModules, moduleDisplayNames, nextSettings);
                    }}
                    disabled={saving}
                  />
                  <span>{moduleSettings.sideNavEnabled ? "On" : "Off"}</span>
                </label>
              </div>
            </article>
          </div>
        </section>
      </Card>
      <Card className="director-admin-capabilities-card director-admin-services-card">
        <h2 className="pb-section-title">Services &amp; plan</h2>
        <p className="muted">
          The systems behind your network. Anything needing setup is surfaced first; the full inventory stays
          out of the way until you need it.
        </p>
        <div className="director-admin-service-summary" aria-label="Service status">
          <div className="is-ready">
            <CheckCircle2 size={19} aria-hidden="true" />
            <span><strong>{capabilitySummary.ready}</strong> ready</span>
          </div>
          <div className={capabilitySummary.attention ? "needs-attention" : "is-ready"}>
            <span className="director-admin-service-summary-mark" aria-hidden="true">!</span>
            <span><strong>{capabilitySummary.attention}</strong> need setup</span>
          </div>
          <div>
            <Sparkles size={19} aria-hidden="true" />
            <span><strong>{capabilitySummary.lockedOrPilot}</strong> plan or pilot</span>
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


/**
 * A named list a director maintains — age groups, roles at camp. These used to be
 * collapsed accordions, which meant a validation error had to force one open to
 * be readable. They are short lists; showing them costs nothing.
 */
function LabelListEditor({
  label,
  hint,
  placeholder,
  values = [],
  draft,
  error = "",
  onDraftChange,
  onAdd,
  onRemove,
  onReorder
}) {
  const [dragIndex, setDragIndex] = useState(-1);
  const [overIndex, setOverIndex] = useState(-1);
  const sortable = typeof onReorder === "function" && values.length > 1;

  function move(from, to) {
    if (!sortable || from === to) return;
    if (from < 0 || to < 0 || from >= values.length || to >= values.length) return;
    onReorder(from, to);
  }

  function endDrag() {
    setDragIndex(-1);
    setOverIndex(-1);
  }

  return (
    <div className="pb-set-labels">
      <div className="pb-set-labels-head">
        <span>{label}</span>
        <em>{values.length} of 20</em>
      </div>
      <p>{hint}</p>
      <div className="pb-set-labels-add">
        <Input
          value={draft}
          placeholder={placeholder}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            onAdd();
          }}
        />
        <Button type="button" variant="secondary" onClick={onAdd} disabled={!draft.trim() || values.length >= 20}>
          Add
        </Button>
      </div>
      {error ? <p className="error-text">{error}</p> : null}
      {sortable ? (
        <p className="pb-set-labels-reorder-hint">
          Drag to reorder, or use the arrows. Members see them in this order.
        </p>
      ) : null}
      <div className="pb-set-labels-chips">
        {values.length ? values.map((item, index) => (
          <span
            key={`${item}_${index}`}
            className={[
              sortable ? "is-sortable" : "",
              dragIndex === index ? "is-dragging" : "",
              overIndex === index && dragIndex >= 0 && dragIndex !== index ? "is-drop-target" : ""
            ].filter(Boolean).join(" ")}
            draggable={sortable}
            onDragStart={sortable ? () => setDragIndex(index) : undefined}
            onDragOver={sortable ? (event) => {
              if (dragIndex < 0) return;
              event.preventDefault();
              setOverIndex(index);
            } : undefined}
            onDrop={sortable ? (event) => {
              event.preventDefault();
              move(dragIndex, index);
              endDrag();
            } : undefined}
            onDragEnd={sortable ? endDrag : undefined}
          >
            {sortable ? (
              <GripVertical size={13} className="pb-set-label-grip" aria-hidden="true" />
            ) : null}
            {item}
            {sortable ? (
              <>
                {/* Keyboard equivalent for the drag, so this is not mouse-only. */}
                <button
                  type="button"
                  className="pb-set-label-move"
                  onClick={() => move(index, index - 1)}
                  disabled={index === 0}
                  aria-label={`Move ${item} earlier`}
                >
                  ‹
                </button>
                <button
                  type="button"
                  className="pb-set-label-move"
                  onClick={() => move(index, index + 1)}
                  disabled={index === values.length - 1}
                  aria-label={`Move ${item} later`}
                >
                  ›
                </button>
              </>
            ) : null}
            <button type="button" onClick={() => onRemove(index)} aria-label={`Remove ${item}`}>×</button>
          </span>
        )) : <small className="muted">Nothing here yet — add at least one.</small>}
      </div>
    </div>
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

  /**
   * Age groups are read in order (Warrior, Freshman, ...), so the director's
   * arrangement is the data, not a display preference. Order is saved as-is.
   */
  function reorderLabel(field, from, to) {
    setForm((prev) => {
      const current = Array.isArray(prev[field]) ? prev[field] : [];
      if (from === to || from < 0 || to < 0 || from >= current.length || to >= current.length) return prev;
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return { ...prev, [field]: next };
    });
  }

  function removeLabel(field, index) {
    setForm((prev) => {
      const current = Array.isArray(prev[field]) ? prev[field] : [];
      return { ...prev, [field]: current.filter((_, itemIndex) => itemIndex !== index) };
    });
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
    if (nextErrors.ageGroups || nextErrors.staffRoles) return;

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

  if (loading && !payload) return <Card><p className="muted">Loading settings…</p></Card>;

  const mobileCode = String(payload?.access?.mobileAppCode || "").trim();

  return (
    <form onSubmit={saveIdentity} className="pb-set-stack">
      {error ? <p className="error-text" role="alert">{error}</p> : null}
      {status ? <p className="success-text" role="status">{status}</p> : null}

      <Card>
        <h2 className="pb-section-title">What your network is called</h2>
        <p className="muted">Members see these on the login page, the homepage, and in every email you send.</p>

        <div className="pb-set-form">
          <SettingRow>
            <SettingField label="Camp name" hint="Message support if this needs to change.">
              <Input value={form.campName} readOnly />
            </SettingField>
            <SettingField label="Camp type" hint="Sets whether members are called alumni, alumnae, or alumni/ae.">
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
            </SettingField>
          </SettingRow>

          <SettingField label="Network name" hint="The title across the top of every page.">
            <Input
              value={form.networkName}
              onChange={(event) => setForm((prev) => ({ ...prev, networkName: event.target.value }))}
            />
          </SettingField>

          <SettingField
            label="Homepage welcome"
            hint={`Shown to visitors before they log in. ${form.homepageQuote.length}/220 characters.`}
          >
            <Textarea
              value={form.homepageQuote}
              rows={2}
              maxLength={220}
              placeholder="A line that sounds like your camp."
              onChange={(event) => setForm((prev) => ({ ...prev, homepageQuote: event.target.value }))}
            />
          </SettingField>
        </div>
      </Card>

      <Card>
        <h2 className="pb-section-title">How members reach you</h2>
        <p className="muted">Shown on your homepage and used as the reply address on the emails you send.</p>
        <div className="pb-set-form">
          <SettingRow>
            <SettingField label="Contact email">
              <Input
                type="email"
                value={form.contactEmail}
                placeholder="office@yourcamp.org"
                onChange={(event) => setForm((prev) => ({ ...prev, contactEmail: event.target.value }))}
              />
            </SettingField>
            <SettingField label="Camp website" optional>
              <Input
                type="url"
                value={form.websiteUrl}
                placeholder="https://yourcamp.org"
                onChange={(event) => setForm((prev) => ({ ...prev, websiteUrl: event.target.value }))}
              />
            </SettingField>
          </SettingRow>
        </div>
      </Card>

      <Card>
        <h2 className="pb-section-title">The words your camp uses</h2>
        <p className="muted">
          These fill the dropdowns members pick from on their profile, and the filters you search by. Use whatever
          your camp actually calls things.
        </p>

        <div className="pb-set-form">
          <LabelListEditor
            label="Camper age groups"
            hint="Members choose a starting and ending group on their profile."
            placeholder="Senior I"
            values={form.ageGroups}
            draft={ageGroupDraft}
            error={listErrors.ageGroups}
            onDraftChange={setAgeGroupDraft}
            onAdd={() => { addLabel("ageGroups", ageGroupDraft); setAgeGroupDraft(""); }}
            onRemove={(index) => removeLabel("ageGroups", index)}
            onReorder={(from, to) => reorderLabel("ageGroups", from, to)}
          />
          <LabelListEditor
            label="Roles at camp"
            hint="Camper, counselor, and any staff roles. Used on profiles and in the People filters."
            placeholder="Waterfront Director"
            values={form.staffRoles}
            draft={staffRoleDraft}
            error={listErrors.staffRoles}
            onDraftChange={setStaffRoleDraft}
            onAdd={() => { addLabel("staffRoles", staffRoleDraft); setStaffRoleDraft(""); }}
            onRemove={(index) => removeLabel("staffRoles", index)}
            onReorder={(from, to) => reorderLabel("staffRoles", from, to)}
          />
        </div>
      </Card>

      {HIDE_MOBILE_APP ? null : (
        <Card>
          <h2 className="pb-section-title">iPhone app code</h2>
          <p className="muted">
            Families type this into the PondBridge app to find your camp. It is generated for you and cannot be changed.
          </p>
          <div className="pb-set-code-row">
            <code>{mobileCode || "Generating…"}</code>
            <div>
              <Button type="button" variant="secondary" onClick={copyMobileAppCode} disabled={!mobileCode}>
                {copyStatus || "Copy code"}
              </Button>
              <Link className="link-button secondary" to={`/t/${slug}/admin/settings/access`}>
                Who can join
              </Link>
            </div>
          </div>
          {payload?.access?.mobileAppCodeHint ? (
            <p className="muted pb-set-code-hint">{payload.access.mobileAppCodeHint}</p>
          ) : null}
        </Card>
      )}

      <Card>
        <SettingActions note="Changes go live for members as soon as you save.">
          <Button type="submit" loading={saving}>Save changes</Button>
        </SettingActions>
      </Card>
    </form>
  );
}

export function DirectorAdminSettingsBrandingPage() {
  const { request, slug, token } = useAdminApi();
  const { refreshTenant, tenant } = useTenant();
  const { payload, setPayload, loading, error, load } = useSettingsLoader();
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [uploadingField, setUploadingField] = useState("");
  const [section, setSection] = useState("logo");
  const [logoFileName, setLogoFileName] = useState("");
  const [faviconFileName, setFaviconFileName] = useState("");
  const [heroFileName, setHeroFileName] = useState("");
  const [memberHeroFileName, setMemberHeroFileName] = useState("");
  const [pendingLogoFile, setPendingLogoFile] = useState(null);
  const [pendingFaviconFile, setPendingFaviconFile] = useState(null);
  const [pendingHeroFile, setPendingHeroFile] = useState(null);
  const [pendingMemberHeroFile, setPendingMemberHeroFile] = useState(null);
  const [pendingLogoPreviewUrl, setPendingLogoPreviewUrl] = useState("");
  const [pendingFaviconPreviewUrl, setPendingFaviconPreviewUrl] = useState("");
  // The tab icon is judged at 16px against whatever the browser chrome is, so the
  // preview has to be switchable rather than fixed to one background.
  const [iconPreviewTheme, setIconPreviewTheme] = useState("light");
  const [pendingHeroPreviewUrl, setPendingHeroPreviewUrl] = useState("");
  const [pendingMemberHeroPreviewUrl, setPendingMemberHeroPreviewUrl] = useState("");
  const [form, setForm] = useState({
    brandPrimary: DEFAULT_BRAND_PRIMARY,
    logoUrl: "",
    faviconUrl: "",
    heroImageUrl: "",
    heroImageUrlMember: "",
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
      pendingFaviconFile ||
      pendingHeroFile ||
      pendingMemberHeroFile ||
      String(form.logoUrl || "").startsWith("data:") ||
      String(form.faviconUrl || "").startsWith("data:") ||
      String(form.heroImageUrl || "").startsWith("data:") ||
      String(form.heroImageUrlMember || "").startsWith("data:")
    ) {
      return;
    }
    setForm({
      brandPrimary: normalizeBrandHex(payload.branding.brandPrimary, DEFAULT_BRAND_PRIMARY),
      logoUrl: payload.branding.logoUrl || "",
      faviconUrl: payload.branding.faviconUrl || "",
      heroImageUrl: payload.branding.heroImageUrl || "",
      heroImageUrlMember: payload.branding.heroImageUrlMember || "",
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
    setPendingFaviconFile(null);
    setPendingHeroFile(null);
    setPendingMemberHeroFile(null);
    setPendingLogoPreviewUrl("");
    setPendingFaviconPreviewUrl("");
    setPendingHeroPreviewUrl("");
    setPendingMemberHeroPreviewUrl("");
  }, [
    form.faviconUrl,
    form.heroImageUrl,
    form.heroImageUrlMember,
    form.logoUrl,
    payload?.branding,
    pendingFaviconFile,
    pendingHeroFile,
    pendingMemberHeroFile,
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

  /**
   * The tab icon, iOS home screen, and installed-app tile are all served from these
   * derivatives, so a failure here must not leave the previous camp's icons pointing
   * at a logo that no longer exists — returning {} makes the edge fall back to the
   * logo that was just uploaded.
   */
  async function uploadAppIcons(sourceFile, { required = false } = {}) {
    try {
      const entries = await Promise.all(
        APP_ICON_SIZES.map(async (size) => [
          String(size),
          await uploadBrandingBlob({
            blob: await renderAppIconPng(sourceFile, size),
            fileType: "image/png",
            scope: "branding-logo"
          })
        ])
      );
      return Object.fromEntries(entries);
    } catch {
      // A dedicated tab icon upload has to report its own failure; when the icons are
      // a by-product of a logo save, the edge falls back to the logo and the director
      // should not be blocked on it.
      if (required) {
        throw new Error("That image could not be turned into a tab icon. Try a PNG or JPG.");
      }
      return {};
    }
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
      // The tab icon is resolved before the logo, because whether the camp has one
      // decides if the logo is allowed to regenerate the icon derivatives below.
      // Carrying the saved derivatives forward keeps a branding save that never
      // touched the icon (a new hero photo, say) from wiping them.
      payloadToSave.iconUrls = payload?.branding?.iconUrls || {};
      const faviconSource =
        pendingFaviconFile ||
        (String(payloadToSave.faviconUrl || "").startsWith("data:")
          ? await fetch(payloadToSave.faviconUrl).then((response) => response.blob())
          : null);
      const clearedFavicon =
        Boolean(String(payload?.branding?.faviconUrl || "").trim()) &&
        !String(payloadToSave.faviconUrl || "").trim();

      if (faviconSource) {
        const iconUrls = await uploadAppIcons(faviconSource, { required: true });
        payloadToSave.iconUrls = iconUrls;
        payloadToSave.faviconUrl = iconUrls["512"] || iconUrls["192"] || "";
      } else if (clearedFavicon) {
        // Dropping the derivatives too sends the edge back to the logo rather than
        // leaving it serving the icon the director just removed.
        payloadToSave.faviconUrl = "";
        payloadToSave.iconUrls = {};
      }

      // A camp that has chosen its own tab icon keeps it when they later swap their
      // logo; only camps riding on the logo let a new logo regenerate the icons.
      const keepsCustomIcon = Boolean(String(payloadToSave.faviconUrl || "").trim());

      if (pendingLogoFile) {
        payloadToSave.logoUrl = await uploadBrandingBlob({
          blob: pendingLogoFile,
          fileType: pendingLogoFile.type || "image/jpeg",
          scope: "branding-logo"
        });
        if (!keepsCustomIcon) payloadToSave.iconUrls = await uploadAppIcons(pendingLogoFile);
      } else if (String(payloadToSave.logoUrl || "").startsWith("data:")) {
        const blob = await fetch(payloadToSave.logoUrl).then((response) => response.blob());
        payloadToSave.logoUrl = await uploadBrandingBlob({
          blob,
          fileType: blob.type || "image/jpeg",
          scope: "branding-logo"
        });
        if (!keepsCustomIcon) payloadToSave.iconUrls = await uploadAppIcons(blob);
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
      if (pendingMemberHeroFile) {
        payloadToSave.heroImageUrlMember = await uploadBrandingBlob({
          blob: pendingMemberHeroFile,
          fileType: pendingMemberHeroFile.type || "image/jpeg",
          scope: "branding-hero"
        });
      } else if (String(payloadToSave.heroImageUrlMember || "").startsWith("data:")) {
        const blob = await fetch(payloadToSave.heroImageUrlMember).then((response) => response.blob());
        payloadToSave.heroImageUrlMember = await uploadBrandingBlob({
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
          faviconUrl: String(payloadToSave.faviconUrl || ""),
          iconUrls: payloadToSave.iconUrls || {},
          heroImageUrl: String(payloadToSave.heroImageUrl || ""),
          heroImageUrlMember: String(payloadToSave.heroImageUrlMember || ""),
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
      setPendingFaviconFile(null);
      setPendingHeroFile(null);
      setPendingMemberHeroFile(null);
      setPendingLogoPreviewUrl("");
      setPendingFaviconPreviewUrl("");
      setPendingHeroPreviewUrl("");
      setPendingMemberHeroPreviewUrl("");
      try {
        await refreshTenant(slug, { bypassCache: true });
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
    const maxBytes =
      field === "faviconUrl" ? 5 * 1024 * 1024 : field === "logoUrl" ? 12 * 1024 * 1024 : 15 * 1024 * 1024;
    if (Number(file.size || 0) > maxBytes) {
      setUploadError(
        field === "faviconUrl"
          ? "Tab icon file must be under 5MB."
          : field === "logoUrl"
            ? "Logo file must be under 12MB."
            : "Main photo file must be under 15MB."
      );
      return;
    }
    setUploadError("");
    setStatus("");
    setUploadingField(field);

    try {
      // The tab icon skips the shared optimizer: that produces a WebP, which iOS
      // refuses as an apple-touch-icon. Square PNG straight away, and the preview is
      // then exactly the file that gets served.
      if (field === "faviconUrl") {
        const squarePng = await renderAppIconPng(file, 512);
        const previewDataUrl = await fileToDataUrl(squarePng);
        // The original is kept for upload so every size is drawn from full resolution
        // rather than resampled out of the 512 preview.
        setPendingFaviconFile(file);
        setPendingFaviconPreviewUrl(previewDataUrl);
        setForm((prev) => ({ ...prev, faviconUrl: previewDataUrl }));
        setFaviconFileName(String(file?.name || "").trim());
        setStatus("Tab icon ready. Click Save Branding to publish this change.");
        return;
      }

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
      } else if (field === "heroImageUrlMember") {
        setPendingMemberHeroFile(optimizedFile);
        setPendingMemberHeroPreviewUrl(previewDataUrl);
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
    if (field === "heroImageUrlMember") {
      setMemberHeroFileName(String(file?.name || "").trim());
    }
  }

  // Dropping the tab icon sends every icon surface back to the camp logo.
  function clearFavicon() {
    setPendingFaviconFile(null);
    setPendingFaviconPreviewUrl("");
    setFaviconFileName("");
    setForm((prev) => ({ ...prev, faviconUrl: "" }));
    setStatus("Tab icon cleared. Click Save Branding to go back to your logo.");
  }

  // Dropping the member photo sends the logged-in home back to the main photo.
  function clearMemberHeroPhoto() {
    setPendingMemberHeroFile(null);
    setPendingMemberHeroPreviewUrl("");
    setMemberHeroFileName("");
    setForm((prev) => ({ ...prev, heroImageUrlMember: "" }));
    setStatus("Member home photo cleared. Click Save Branding to publish this change.");
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
  const currentFaviconUrl = String(payload?.branding?.faviconUrl || "").trim();
  const currentHeroUrl = String(payload?.branding?.heroImageUrl || "").trim();
  const currentMemberHeroUrl = String(payload?.branding?.heroImageUrlMember || "").trim();
  const draftLogoUrl = String(form.logoUrl || "").trim();
  // Empty stays empty: a cleared icon has to preview as the logo fallback, not as the
  // icon the director just removed.
  const draftFaviconUrl = String(form.faviconUrl || "").trim();
  const draftHeroUrl = String(form.heroImageUrl || "").trim();
  const draftMemberHeroUrl = String(form.heroImageUrlMember || "").trim();
  const liveLogoPreviewUrl = pendingLogoPreviewUrl || draftLogoUrl || currentLogoUrl;
  const liveHeroPreviewUrl = pendingHeroPreviewUrl || draftHeroUrl || currentHeroUrl;
  // Empty stays empty here: the preview has to show the fallback to the main
  // photo, not a stale member photo the director just cleared.
  const liveMemberHeroPreviewUrl = pendingMemberHeroPreviewUrl || draftMemberHeroUrl;
  const hasPendingLogoUpdate = Boolean(pendingLogoFile) || (Boolean(draftLogoUrl) && draftLogoUrl !== currentLogoUrl);
  const liveFaviconPreviewUrl = pendingFaviconPreviewUrl || draftFaviconUrl;
  const hasPendingFaviconUpdate = Boolean(pendingFaviconFile) || draftFaviconUrl !== currentFaviconUrl;
  // What the tab actually shows: the camp's own icon when they have set one, their
  // logo when they have not, and the platform mark when they have neither.
  const effectiveIconUrl = liveFaviconPreviewUrl || liveLogoPreviewUrl;
  const usingLogoAsIcon = !liveFaviconPreviewUrl && Boolean(liveLogoPreviewUrl);
  const iconPreviewTabTitle = campNetworkTitle(tenant?.name || "");
  const hasPendingHeroUpdate = Boolean(pendingHeroFile) || (Boolean(draftHeroUrl) && draftHeroUrl !== currentHeroUrl);
  const hasPendingMemberHeroUpdate =
    Boolean(pendingMemberHeroFile) || draftMemberHeroUrl !== currentMemberHeroUrl;

  return (
    <form onSubmit={saveBranding} className="pb-set-stack">
      {error ? <p className="error-text" role="alert">{error}</p> : null}
      {uploadError ? <p className="error-text" role="alert">{uploadError}</p> : null}
      {status ? <p className="success-text" role="status">{status}</p> : null}

      <SettingTabs
        tabs={[
          { key: "logo", label: "Logo" },
          { key: "icon", label: "Tab icon" },
          { key: "photo", label: "Main photo" },
          { key: "color", label: "Color" },
          { key: "preview", label: "Preview" }
        ]}
        active={section}
        onChange={setSection}
      />

      {section === "logo" ? (
      <Card>
        <h2 className="pb-section-title">Your logo</h2>
        <p className="muted">Sits in the top-left of every page, and at the top of the emails you send.</p>
        <div className="pb-set-upload">
              <h3 className="pb-set-subsection">Upload a new logo</h3>
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
              <h3 className="pb-set-subsection">
                {hasPendingLogoUpdate ? "Waiting to be saved" : "Currently in use"}
              </h3>
              <div className="director-admin-branding-current-media">
                {liveLogoPreviewUrl ? (
                  <img src={liveLogoPreviewUrl} alt="Current logo" className="director-admin-branding-current-logo" />
                ) : (
                  <p className="muted">No logo currently set.</p>
                )}
                {hasPendingLogoUpdate ? <p className="muted">Saving will replace the current logo.</p> : null}
              </div>
        </div>
      </Card>
      ) : null}

      {section === "icon" ? (
      <Card>
        <h2 className="pb-section-title">Your tab icon</h2>
        <p className="muted">
          The small square that shows in the browser tab, in bookmarks, and on a phone home
          screen. Optional &mdash; leave it empty and your logo is used instead. A wide logo gets
          squeezed into a 16-pixel square, so a simple square mark usually reads better.
        </p>
        <div className="pb-set-upload">
          <h3 className="pb-set-subsection">Upload a tab icon</h3>
          <label className="director-upload-control" htmlFor="director-admin-favicon-upload">
            <span className="director-upload-button">Upload tab icon</span>
            <span className="director-upload-name">
              {faviconFileName || "Square PNG or JPG"}
            </span>
          </label>
          <input
            id="director-admin-favicon-upload"
            type="file"
            accept="image/*"
            className="director-upload-input"
            onClick={(event) => {
              event.currentTarget.value = "";
            }}
            onChange={(event) => onFilePick("faviconUrl", event.target.files?.[0] || null)}
          />

          <h3 className="pb-set-subsection">
            {hasPendingFaviconUpdate ? "Waiting to be saved" : "How it looks"}
          </h3>

          {effectiveIconUrl ? (
            <>
              <div
                className="pb-icon-preview"
                data-theme={iconPreviewTheme}
              >
                <div className="pb-icon-preview__chrome">
                  <div className="pb-icon-preview__tab">
                    <img src={effectiveIconUrl} alt="" className="pb-icon-preview__tab-icon" />
                    <span className="pb-icon-preview__tab-title">{iconPreviewTabTitle}</span>
                    <span className="pb-icon-preview__tab-close" aria-hidden="true">&times;</span>
                  </div>
                  <div className="pb-icon-preview__tab pb-icon-preview__tab--idle" aria-hidden="true">
                    <span className="pb-icon-preview__tab-ghost" />
                    <span className="pb-icon-preview__tab-title" />
                  </div>
                </div>
                <div className="pb-icon-preview__bar" aria-hidden="true">
                  <span className="pb-icon-preview__bar-dot" />
                  <span className="pb-icon-preview__bar-url" />
                </div>
              </div>

              <div className="pb-icon-preview__sizes">
                <figure className="pb-icon-preview__size">
                  <img src={effectiveIconUrl} alt="" width="16" height="16" />
                  <figcaption>16px &middot; tab</figcaption>
                </figure>
                <figure className="pb-icon-preview__size">
                  <img src={effectiveIconUrl} alt="" width="32" height="32" />
                  <figcaption>32px &middot; bookmark</figcaption>
                </figure>
                <figure className="pb-icon-preview__size">
                  <img
                    src={effectiveIconUrl}
                    alt=""
                    width="60"
                    height="60"
                    className="pb-icon-preview__tile"
                  />
                  <figcaption>Home screen</figcaption>
                </figure>
              </div>

              {/* A separate control from the page's section tabs on purpose: two
                  identical tab bars on one screen read as one broken control. */}
              <div className="pb-icon-preview__controls" role="group" aria-label="Preview background">
                {[
                  { key: "light", label: "Light tabs" },
                  { key: "dark", label: "Dark tabs" }
                ].map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    className={iconPreviewTheme === option.key ? "is-active" : ""}
                    aria-pressed={iconPreviewTheme === option.key}
                    onClick={() => setIconPreviewTheme(option.key)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              <p className="muted">
                {usingLogoAsIcon
                  ? "This is your logo, squared off. Upload a tab icon above if it looks cramped."
                  : "Your uploaded tab icon."}
              </p>

              {liveFaviconPreviewUrl ? (
                <Button type="button" variant="secondary" onClick={clearFavicon}>
                  Use my logo instead
                </Button>
              ) : null}
            </>
          ) : (
            <p className="muted">
              No logo or tab icon set yet, so tabs show the PondBridge mark. Upload either one to
              change it.
            </p>
          )}
        </div>
      </Card>
      ) : null}

      {section === "photo" ? (
      <Card>
        <h2 className="pb-section-title">Your main photo</h2>
        <p className="muted">
          The big image behind your login page and your members&apos; home page. Landscape photos work best.
        </p>
        <div className="pb-set-upload">
              <h3 className="pb-set-subsection">Upload a new photo</h3>
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
              <h3 className="pb-set-subsection">
                {hasPendingHeroUpdate ? "Waiting to be saved" : "Currently in use"}
              </h3>
              <div className="director-admin-branding-current-media">
                {liveHeroPreviewUrl ? (
                  <img src={liveHeroPreviewUrl} alt="Current hero image" className="director-admin-branding-current-hero" />
                ) : (
                  <p className="muted">No hero image currently set.</p>
                )}
                {hasPendingHeroUpdate ? <p className="muted">Saving will replace the current main photo.</p> : null}
              </div>
        </div>

        <div className="pb-set-upload">
              <h3 className="pb-set-subsection">A different photo once members log in (optional)</h3>
              <p className="muted">
                By default the same photo runs behind the login page and the members&apos; home page.
                Upload a second photo here if you want the logged-in home to look different.
              </p>
              <label className="director-upload-control" htmlFor="director-admin-member-hero-upload">
                <span className="director-upload-button">Upload member home photo</span>
                <span className="director-upload-name">
                  {memberHeroFileName || "Optional. PNG or JPG"}
                </span>
              </label>
              <input
                id="director-admin-member-hero-upload"
                type="file"
                accept="image/*"
                className="director-upload-input"
                onClick={(event) => {
                  event.currentTarget.value = "";
                }}
                onChange={(event) => onFilePick("heroImageUrlMember", event.target.files?.[0] || null)}
              />
              <h3 className="pb-set-subsection">
                {hasPendingMemberHeroUpdate ? "Waiting to be saved" : "Currently in use"}
              </h3>
              <div className="director-admin-branding-current-media">
                {liveMemberHeroPreviewUrl ? (
                  <img
                    src={liveMemberHeroPreviewUrl}
                    alt="Current member home photo"
                    className="director-admin-branding-current-hero"
                  />
                ) : (
                  <p className="muted">No separate member home photo. The main photo is used.</p>
                )}
                {liveMemberHeroPreviewUrl ? (
                  <Button type="button" variant="ghost" onClick={clearMemberHeroPhoto}>
                    Use the main photo instead
                  </Button>
                ) : null}
              </div>
        </div>
      </Card>
      ) : null}

      {section === "color" ? (
      <Card>
        <h2 className="pb-section-title">Your color</h2>
        <p className="muted">
          Used for buttons, links, and highlights. Pick it from your logo if you want an exact match.
        </p>
        <div className="pb-set-color">
              <h3 className="pb-set-subsection">
                <label htmlFor="director-admin-brand-primary">Main color</label>
              </h3>
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
              <h3 className="pb-set-subsection">The rest of your palette</h3>
              <p className="pb-set-subsection-note">Worked out from your main color. These are what members actually see.</p>
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
      </Card>
      ) : null}

      {section === "preview" ? (
      <Card>
        <h2 className="pb-section-title">How it looks</h2>
        <p className="muted">Drag the photo to choose what stays in frame on each page.</p>
          <HeroImageEditor
            label="Live preview"
            variant="admin"
            heroImageUrl={liveHeroPreviewUrl}
            memberImageUrl={liveMemberHeroPreviewUrl}
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
      </Card>
      ) : null}

      <Card>
        <SettingActions note="Uploads are only stored once you save.">
          <Button type="submit" loading={saving} disabled={Boolean(uploadingField)}>
            {uploadingField ? "Uploading…" : "Save branding"}
          </Button>
        </SettingActions>
      </Card>
    </form>
  );
}
