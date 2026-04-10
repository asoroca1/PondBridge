import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, Outlet, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  defaultNetworkDisplayNameForCamp,
  normalizeCampType,
  normalizeHeroImagePosition,
  normalizeHeroImageSize,
  replaceAlumniForCampType
} from "@pondbridge/shared";
import { Badge, Button, Card, Input, Select, Textarea } from "@pondbridge/ui";
import { requestBlob, requestJson } from "../../lib/http.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { useTenant } from "../../context/TenantContext.jsx";
import HeroImageEditor from "../../components/HeroImageEditor.jsx";
import BrandImageColorPicker from "../../components/BrandImageColorPicker.jsx";
import {
  DataTable,
  FilterBar,
  LoadingSkeleton,
  ModalConfirm,
  PageHeader
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
  if (normalized === "test") return "Internal Test";
  if (normalized === "founders") return "Founders";
  if (normalized === "institutional") return "Institutional";
  return "Legacy";
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
const MEMBER_COMPLETION_FILTER_OPTIONS = [
  { value: "all", label: "Profile Completion (All)" },
  { value: "100-100", label: "100% Complete" },
  { value: "90-99", label: "90-99%" },
  { value: "80-89", label: "80-89%" },
  { value: "70-79", label: "70-79%" },
  { value: "60-69", label: "60-69%" },
  { value: "50-59", label: "50-59%" },
  { value: "40-49", label: "40-49%" },
  { value: "30-39", label: "30-39%" },
  { value: "20-29", label: "20-29%" },
  { value: "10-19", label: "10-19%" },
  { value: "0-9", label: "0-9%" }
];
const BILLING_TIER_DEFINITIONS = [
  {
    code: "test",
    title: "Internal Test",
    subtitle: "Allowlisted production billing validation tier."
  },
  {
    code: "founders",
    title: "Founders",
    subtitle: "Premium features for the first 5 camps."
  },
  {
    code: "legacy",
    title: "Legacy",
    subtitle: "Base tier with core network tools."
  },
  {
    code: "institutional",
    title: "Institutional",
    subtitle: "Premium tier with institutional support."
  }
];

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

function downloadTextAsFile(text, filename, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
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

function parseIdsParam(value = "") {
  return [...new Set(
    String(value || "")
      .split(",")
      .map((item) => String(item || "").trim())
      .filter(Boolean)
  )];
}

function normalizeMemberRowId(member = null) {
  return String(member?.id || "").trim();
}

function parseCompletionRangeFilterValue(value = "all") {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized || normalized === "all") return null;
  const match = normalized.match(/^(\d{1,3})-(\d{1,3})$/);
  if (!match) return null;
  let min = Math.max(0, Math.min(100, Number(match[1] || 0)));
  let max = Math.max(0, Math.min(100, Number(match[2] || 0)));
  if (min > max) [min, max] = [max, min];
  return { min, max };
}

function useDebouncedValue(value, delayMs = 220) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), Math.max(0, Number(delayMs) || 0));
    return () => window.clearTimeout(timer);
  }, [delayMs, value]);
  return debounced;
}

const INVITE_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MEMBER_EXPORT_STORAGE_PREFIX = "pb_admin_members_export_fields";
const MEMBER_EXPORT_PRESET_STORAGE_PREFIX = "pb_admin_members_export_presets";
const INVITE_HIDDEN_STORAGE_PREFIX = "pb_admin_hidden_invites";
const EMAIL_RECIPIENT_GROUPS_STORAGE_PREFIX = "pb_admin_email_recipient_groups";
const FALLBACK_MEMBER_EXPORT_FIELDS = [
  { key: "profileId", label: "Profile ID", description: "Internal profile identifier." },
  { key: "userId", label: "User ID", description: "Account user identifier linked to this profile." },
  { key: "firstName", label: "First Name", description: "Profile first name." },
  { key: "nickname", label: "Nickname", description: "Camp nickname from profile/social fields." },
  { key: "lastName", label: "Last Name", description: "Profile last name." },
  { key: "fullName", label: "Full Name", description: "Combined first and last name." },
  { key: "status", label: "Status", description: "Member access status." },
  { key: "completionPercent", label: "Profile Completion %", description: "Calculated completion percentage." },
  { key: "primaryEmail", label: "Primary Email", description: "First email on the profile." },
  { key: "allEmails", label: "All Emails", description: "All profile emails." },
  { key: "primaryPhone", label: "Primary Phone", description: "First phone on the profile." },
  { key: "allPhones", label: "All Phones", description: "All profile phones." },
  { key: "cityState", label: "Location", description: "City and state/country value." },
  { key: "city", label: "City", description: "City parsed from location." },
  { key: "state", label: "State", description: "State/region parsed from location." },
  { key: "country", label: "Country", description: "Country parsed from location." },
  { key: "roleAtCamp", label: "Role At Camp", description: "Member's role at camp." },
  { key: "allRoles", label: "All Roles", description: "Primary role plus additional role tags." },
  { key: "industry", label: "Industry", description: "Industry from profile." },
  { key: "highSchool", label: "High School", description: "High school field from profile." },
  { key: "colleges", label: "Colleges", description: "College history from profile." },
  { key: "collegeYears", label: "College Years", description: "College graduation/class years." },
  { key: "collegeMajors", label: "College Majors", description: "Majors captured on the profile." },
  { key: "educationRows", label: "Education Rows", description: "Combined college, year, and major rows." },
  { key: "currentCompany", label: "Current Company", description: "Current company from first job entry." },
  { key: "currentTitle", label: "Current Title", description: "Current title from first job entry." },
  { key: "currentJobs", label: "Current Jobs", description: "All current job entries." },
  { key: "pastJobs", label: "Past Jobs", description: "All past job entries." },
  { key: "camperFirstYear", label: "Camper First Year", description: "First camper year from profile stints." },
  { key: "camperLastYear", label: "Camper Last Year", description: "Last camper year from profile stints." },
  { key: "camperYearStints", label: "Camper Year Stints", description: "Camper year ranges." },
  { key: "staffFirstYear", label: "Staff First Year", description: "First staff year from profile stints." },
  { key: "staffLastYear", label: "Staff Last Year", description: "Last staff year from profile stints." },
  { key: "staffYearStints", label: "Staff Year Stints", description: "Staff year ranges." },
  { key: "linkedin", label: "LinkedIn", description: "LinkedIn URL from social links." },
  { key: "instagram", label: "Instagram", description: "Instagram URL from social links." },
  { key: "facebook", label: "Facebook", description: "Facebook URL from social links." },
  { key: "avatarUrl", label: "Avatar URL", description: "Profile avatar image URL." },
  { key: "bio", label: "Bio", description: "Profile bio text." },
  { key: "joinDate", label: "Join Date", description: "Profile creation date (ISO)." },
  { key: "updatedAt", label: "Last Updated", description: "Profile last update timestamp (ISO)." },
  { key: "socialsJson", label: "Socials JSON", description: "Raw socials object for full fidelity export." },
  { key: "profileJson", label: "Profile JSON", description: "Raw profile object for full fidelity export." }
];
const FALLBACK_MEMBER_EXPORT_DEFAULT_FIELDS = [
  "firstName",
  "lastName",
  "primaryEmail"
];

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

function memberExportStorageKey(slug = "") {
  return `${MEMBER_EXPORT_STORAGE_PREFIX}:${String(slug || "").trim().toLowerCase()}`;
}

function memberExportPresetStorageKey(slug = "") {
  return `${MEMBER_EXPORT_PRESET_STORAGE_PREFIX}:${String(slug || "").trim().toLowerCase()}`;
}

function hiddenInviteStorageKey(slug = "") {
  return `${INVITE_HIDDEN_STORAGE_PREFIX}:${String(slug || "").trim().toLowerCase()}`;
}

function emailRecipientGroupStorageKey(slug = "") {
  return `${EMAIL_RECIPIENT_GROUPS_STORAGE_PREFIX}:${String(slug || "").trim().toLowerCase()}`;
}

function readSavedMemberExportFields(slug = "") {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(memberExportStorageKey(slug));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeSavedMemberExportFields(slug = "", keys = []) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(memberExportStorageKey(slug), JSON.stringify(keys));
  } catch {
    // Ignore storage failures.
  }
}

function normalizeExportPresetName(value = "") {
  return String(value || "").trim().slice(0, 64);
}

function readSavedMemberExportPresets(slug = "") {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(memberExportPresetStorageKey(slug));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeSavedMemberExportPresets(slug = "", presets = []) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(memberExportPresetStorageKey(slug), JSON.stringify(presets));
  } catch {
    // Ignore storage failures.
  }
}

function readHiddenInviteIds(slug = "") {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(hiddenInviteStorageKey(slug));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((value) => String(value || "").trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function writeHiddenInviteIds(slug = "", ids = []) {
  if (typeof window === "undefined") return;
  const normalized = [...new Set(
    (Array.isArray(ids) ? ids : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  )].slice(-5000);
  try {
    localStorage.setItem(hiddenInviteStorageKey(slug), JSON.stringify(normalized));
  } catch {
    // Ignore storage failures.
  }
}

function normalizeProfileIdList(value = []) {
  const source = Array.isArray(value)
    ? value
    : String(value || "")
        .split(",")
        .map((item) => String(item || "").trim());
  return [...new Set(
    source
      .map((item) => String(item || "").trim())
      .filter(Boolean)
  )];
}

function normalizeEmailRecipientGroupName(value = "") {
  return String(value || "").trim().slice(0, 72);
}

function readSavedEmailRecipientGroups(slug = "") {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(emailRecipientGroupStorageKey(slug));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const groups = [];
    for (const item of parsed) {
      const id = String(item?.id || "").trim();
      const name = normalizeEmailRecipientGroupName(item?.name || "");
      const profileIds = normalizeProfileIdList(item?.profileIds || []);
      if (!id || !name || !profileIds.length) continue;
      groups.push({
        id,
        name,
        profileIds,
        updatedAt: String(item?.updatedAt || "")
      });
    }
    return groups.slice(0, 60);
  } catch {
    return [];
  }
}

function writeSavedEmailRecipientGroups(slug = "", groups = []) {
  if (typeof window === "undefined") return;
  const normalized = [];
  const seen = new Set();
  for (const item of Array.isArray(groups) ? groups : []) {
    const id = String(item?.id || "").trim();
    const name = normalizeEmailRecipientGroupName(item?.name || "");
    const profileIds = normalizeProfileIdList(item?.profileIds || []);
    if (!id || !name || !profileIds.length || seen.has(id)) continue;
    seen.add(id);
    normalized.push({
      id,
      name,
      profileIds,
      updatedAt: String(item?.updatedAt || "")
    });
    if (normalized.length >= 60) break;
  }
  try {
    localStorage.setItem(emailRecipientGroupStorageKey(slug), JSON.stringify(normalized));
  } catch {
    // Ignore storage failures.
  }
}

function normalizeEmailFooterPresetName(value = "") {
  return String(value || "").trim().slice(0, 72);
}

function normalizeEmailFooterField(value = "", max = 140, options = {}) {
  const { trimMode = "both" } = options || {};
  const clipped = String(value || "").slice(0, max);
  if (trimMode === "none") return clipped;
  if (trimMode === "start") return clipped.trimStart();
  if (trimMode === "end") return clipped.trimEnd();
  return clipped.trim();
}

function normalizeEmailFooter(value = {}, fallback = {}) {
  const source = value && typeof value === "object" ? value : {};
  const base = fallback && typeof fallback === "object" ? fallback : {};
  const senderEmailRaw = normalizeEmailFooterField(source.senderEmail ?? base.senderEmail ?? "", 160).trim().toLowerCase();
  const senderEmail = INVITE_EMAIL_REGEX.test(senderEmailRaw) ? senderEmailRaw : "";
  return {
    headerTagline: normalizeEmailFooterField(source.headerTagline ?? base.headerTagline ?? "Community update", 72) || "Community update",
    signOff: normalizeEmailFooterField(source.signOff ?? base.signOff ?? "Warmly,", 80) || "Warmly,",
    senderName: normalizeEmailFooterField(source.senderName ?? base.senderName ?? "", 120, { trimMode: "start" }),
    senderRole: normalizeEmailFooterField(source.senderRole ?? base.senderRole ?? "Director", 120, { trimMode: "start" }),
    senderEmail,
    senderPhone: normalizeEmailFooterField(source.senderPhone ?? base.senderPhone ?? "", 48),
    showLogo: source.showLogo !== undefined ? Boolean(source.showLogo) : base.showLogo !== false,
    logoUrl: normalizeEmailFooterField(source.logoUrl ?? base.logoUrl ?? "", 1200)
  };
}

function normalizeEmailFooterPresets(presets = [], fallbackFooter = {}) {
  const source = Array.isArray(presets) ? presets : [];
  const fallback = normalizeEmailFooter(
    fallbackFooter,
    {
      signOff: "Warmly,",
      headerTagline: "Community update",
      senderName: "",
      senderRole: "Director",
      senderEmail: "",
      senderPhone: "",
      showLogo: true,
      logoUrl: ""
    }
  );
  const normalized = [];
  const seenIds = new Set();
  for (let index = 0; index < source.length; index += 1) {
    const item = source[index] || {};
    const id = String(item?.id || "").trim().slice(0, 90) || `footer_${index + 1}`;
    if (!id || seenIds.has(id)) continue;
    const name = normalizeEmailFooterPresetName(item?.name || "");
    if (!name) continue;
    seenIds.add(id);
    normalized.push({
      id,
      name,
      footer: normalizeEmailFooter(item?.footer || {}, fallback),
      updatedAt: String(item?.updatedAt || "")
    });
    if (normalized.length >= 20) break;
  }
  if (normalized.length === 0) {
    normalized.push({
      id: "default_footer",
      name: "Default Footer",
      footer: fallback,
      updatedAt: ""
    });
  }
  return normalized;
}

function composeName(value = {}) {
  const firstName = String(value?.firstName || "").trim();
  const lastName = String(value?.lastName || "").trim();
  const full = [firstName, lastName].filter(Boolean).join(" ").trim();
  if (full) return full;
  return String(value?.name || "").trim();
}

function createFallbackEmailFooter({ tenant = null, user = null } = {}) {
  const senderName = composeName(user);
  const senderRole = Array.isArray(user?.roles) && user.roles.some((role) => String(role || "").toLowerCase() === "tenant_admin")
    ? "Director"
    : "Admin";
  const senderEmail = String(user?.email || tenant?.content?.contactEmail || "").trim().toLowerCase();
  return normalizeEmailFooter(
    {
      signOff: "Warmly,",
      headerTagline: "Community update",
      senderName,
      senderRole,
      senderEmail,
      senderPhone: "",
      showLogo: true,
      logoUrl: String(tenant?.theme?.logoUrl || "").trim()
    },
    {}
  );
}

function previewTextFromHtmlLike(value = "") {
  return String(value || "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function normalizeExportFieldSelection(keys = [], allowedKeys = [], fallback = []) {
  const source = Array.isArray(keys) ? keys : [];
  const allowSet = new Set(Array.isArray(allowedKeys) ? allowedKeys : []);
  const normalized = [];
  for (const key of source) {
    const next = String(key || "").trim();
    if (!next || !allowSet.has(next) || normalized.includes(next)) continue;
    normalized.push(next);
  }
  if (normalized.length > 0) return normalized;
  const fallbackNormalized = [];
  for (const key of Array.isArray(fallback) ? fallback : []) {
    const next = String(key || "").trim();
    if (!next || !allowSet.has(next) || fallbackNormalized.includes(next)) continue;
    fallbackNormalized.push(next);
  }
  return fallbackNormalized;
}

function normalizeExportPresets(presets = [], allowedKeys = [], fallback = []) {
  const source = Array.isArray(presets) ? presets : [];
  const normalized = [];
  const seenIds = new Set();
  for (const preset of source) {
    const name = normalizeExportPresetName(preset?.name || "");
    if (!name) continue;
    const fields = normalizeExportFieldSelection(preset?.fields || [], allowedKeys, fallback);
    if (!fields.length) continue;
    const id = String(preset?.id || `preset_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
    if (!id || seenIds.has(id)) continue;
    seenIds.add(id);
    normalized.push({
      id,
      name,
      fields,
      updatedAt: String(preset?.updatedAt || "")
    });
  }
  return normalized.slice(0, 30);
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
        <strong>{value}</strong>
      </div>
      <span>{label}</span>
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
    const localX = event.clientX - bounds.left - padding.left;
    const ratio = plotWidth <= 0 ? 0 : Math.max(0, Math.min(1, localX / plotWidth));
    const nextIndex = Math.round(ratio * (weekSeries.length - 1));
    setHoverIndex(nextIndex);
  };

  return (
    <Card className="director-admin-chart-card">
      <div className="director-admin-chart-head">
        <h2 className="pb-section-title">{title}</h2>
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
  const { request } = useAdminApi();
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await request(`/dashboard?ts=${Date.now()}`);
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
      {error ? <p className="error-text">{error}</p> : null}
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

      <div className="director-admin-two-col director-admin-dashboard-charts">
        <div className="director-admin-dashboard-left">
          <TimeSeriesChartCard
            title="New Users"
            yLabel="New users"
            xLabel="Date"
            points={newUsersSeries}
            weekWindows={weekWindows}
            activeWeekKey={activeWeekKey}
            onWeekChange={setActiveWeekKey}
          />
          <div className="director-admin-breakdown-row">
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
          </div>
        </div>
        <div className="director-admin-dashboard-right">
          <TimeSeriesChartCard
            title="Sign-Ins"
            yLabel="Sign-ins"
            xLabel="Date"
            points={signInsSeries}
            weekWindows={weekWindows}
            activeWeekKey={activeWeekKey}
            onWeekChange={setActiveWeekKey}
          />
          <TopProfileBreakdownCard
            title="Top Active Members"
            columnLabel="Member"
            countLabel="Logins"
            items={topActiveMembers}
          />
        </div>
      </div>

    </div>
  );
}

export function DirectorAdminMembersPage() {
  const navigate = useNavigate();
  const { slug, request, download } = useAdminApi();
  const requestRef = useRef(request);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 280);
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
  const [rowMenuState, setRowMenuState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [deletingMemberId, setDeletingMemberId] = useState("");
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportFieldsCatalog, setExportFieldsCatalog] = useState(FALLBACK_MEMBER_EXPORT_FIELDS);
  const [exportDefaultFields, setExportDefaultFields] = useState(FALLBACK_MEMBER_EXPORT_DEFAULT_FIELDS);
  const [exportSelectedFields, setExportSelectedFields] = useState(FALLBACK_MEMBER_EXPORT_DEFAULT_FIELDS);
  const [exportPresets, setExportPresets] = useState([]);
  const [selectedExportPresetId, setSelectedExportPresetId] = useState("");
  const [exportPresetName, setExportPresetName] = useState("");
  const [draggingFieldKey, setDraggingFieldKey] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [previewColumns, setPreviewColumns] = useState([]);
  const [previewRows, setPreviewRows] = useState([]);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [exportCompletion, setExportCompletion] = useState("all");
  const [hasSavedExportPreset, setHasSavedExportPreset] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const rowMenuId = rowMenuState?.id || "";

  useEffect(() => {
    requestRef.current = request;
  }, [request]);

  useEffect(() => {
    let cancelled = false;
    const loadExportFieldCatalog = async () => {
      try {
        const response = await requestRef.current("/export/csv/fields");
        if (cancelled) return;
        const fields = Array.isArray(response?.fields) && response.fields.length
          ? response.fields
          : FALLBACK_MEMBER_EXPORT_FIELDS;
        const allowedKeys = fields.map((field) => String(field?.key || "").trim()).filter(Boolean);
        const defaults = normalizeExportFieldSelection(
          response?.defaultFields || [],
          allowedKeys,
          FALLBACK_MEMBER_EXPORT_DEFAULT_FIELDS
        );
        const saved = normalizeExportFieldSelection(
          readSavedMemberExportFields(slug),
          allowedKeys,
          defaults
        );
        const presets = normalizeExportPresets(
          readSavedMemberExportPresets(slug),
          allowedKeys,
          defaults
        );
        setExportFieldsCatalog(fields);
        setExportDefaultFields(defaults);
        setExportSelectedFields(saved.length ? saved : defaults);
        setExportPresets(presets);
        setSelectedExportPresetId((prev) =>
          presets.some((preset) => preset.id === prev) ? prev : presets[0]?.id || ""
        );
        setHasSavedExportPreset(readSavedMemberExportFields(slug).length > 0);
      } catch {
        if (cancelled) return;
        const allowedKeys = FALLBACK_MEMBER_EXPORT_FIELDS.map((field) => field.key);
        const defaults = normalizeExportFieldSelection(
          FALLBACK_MEMBER_EXPORT_DEFAULT_FIELDS,
          allowedKeys,
          FALLBACK_MEMBER_EXPORT_DEFAULT_FIELDS
        );
        const saved = normalizeExportFieldSelection(
          readSavedMemberExportFields(slug),
          allowedKeys,
          defaults
        );
        const presets = normalizeExportPresets(
          readSavedMemberExportPresets(slug),
          allowedKeys,
          defaults
        );
        setExportFieldsCatalog(FALLBACK_MEMBER_EXPORT_FIELDS);
        setExportDefaultFields(defaults);
        setExportSelectedFields(saved.length ? saved : defaults);
        setExportPresets(presets);
        setSelectedExportPresetId((prev) =>
          presets.some((preset) => preset.id === prev) ? prev : presets[0]?.id || ""
        );
        setHasSavedExportPreset(readSavedMemberExportFields(slug).length > 0);
      }
    };
    loadExportFieldCatalog();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const totalPages = Math.max(1, Math.ceil(Number(payload?.total || 0) / Number(payload?.pageSize || 25)));

  const loadMembers = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("pageSize", "25");
      params.set("q", debouncedQuery);
      params.set("role", filters.role);
      params.set("year", filters.year);
      params.set("status", filters.status);
      params.set("sort", filters.sort);
      const completionRange = parseCompletionRangeFilterValue(filters.completion);
      if (completionRange) {
        params.set("completionMin", String(completionRange.min));
        params.set("completionMax", String(completionRange.max));
      } else {
        params.set("completion", filters.completion);
      }
      const response = await requestRef.current(`/members?${params.toString()}`);
      setPayload(response);
    } catch (requestError) {
      setError(requestError.message || "Failed to load members.");
    } finally {
      setLoading(false);
    }
  }, [debouncedQuery, filters.completion, filters.role, filters.sort, filters.status, filters.year, page]);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  useEffect(() => {
    setSelected((prev) =>
      prev.filter((id) => payload?.items?.some((item) => normalizeMemberRowId(item) === id))
    );
  }, [payload?.items]);

  useEffect(() => {
    if (!rowMenuId) return;
    if (!payload?.items?.some((item) => normalizeMemberRowId(item) === rowMenuId)) {
      setRowMenuState(null);
    }
  }, [payload?.items, rowMenuId]);

  useEffect(() => {
    if (!rowMenuState) return;
    const closeMenu = () => setRowMenuState(null);
    const handlePointerDown = (event) => {
      if (!(event?.target instanceof Element)) return;
      if (event.target.closest(".director-admin-row-menu")) return;
      if (event.target.closest(".director-admin-row-menu-trigger")) return;
      closeMenu();
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") closeMenu();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [rowMenuState]);

  function toggleAll(event) {
    if (!payload?.items?.length) return;
    if (event.target.checked) {
      setSelected(
        [...new Set(payload.items.map((item) => normalizeMemberRowId(item)).filter(Boolean))]
      );
      return;
    }
    setSelected([]);
  }

  function toggleOne(memberId) {
    const normalizedId = String(memberId || "").trim();
    if (!normalizedId) return;
    setSelected((prev) =>
      prev.includes(normalizedId)
        ? prev.filter((id) => id !== normalizedId)
        : [...prev, normalizedId]
    );
  }

  const activeRowMenuMember = useMemo(
    () => (payload?.items || []).find((item) => normalizeMemberRowId(item) === rowMenuId) || null,
    [payload?.items, rowMenuId]
  );
  const activeRowMenuMemberId = normalizeMemberRowId(activeRowMenuMember);

  function openRowMenu(event, memberId) {
    const id = String(memberId || "").trim();
    if (!id) return;
    if (rowMenuId === id) {
      setRowMenuState(null);
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const menuWidth = 196;
    const menuHeight = 132;
    const gap = 8;
    const canOpenBelow = bounds.bottom + gap + menuHeight <= window.innerHeight - 8;
    const top = canOpenBelow ? bounds.bottom + gap : Math.max(8, bounds.top - menuHeight - gap);
    const left = Math.max(8, Math.min(bounds.right - menuWidth, window.innerWidth - menuWidth - 8));
    setRowMenuState({ id, top, left });
  }

  const loadExportPreview = useCallback(async (fieldOrder = exportSelectedFields) => {
    const allowedKeys = exportFieldsCatalog.map((field) => String(field?.key || "").trim()).filter(Boolean);
    const normalizedFields = normalizeExportFieldSelection(fieldOrder, allowedKeys, exportDefaultFields);
    if (!normalizedFields.length) {
      setPreviewColumns([]);
      setPreviewRows([]);
      setPreviewError("");
      return;
    }
    setPreviewLoading(true);
    setPreviewError("");
    try {
      const params = new URLSearchParams();
      params.set("fields", normalizedFields.join(","));
      params.set("limit", "6");
      const completionRange = parseCompletionRangeFilterValue(exportCompletion);
      if (completionRange) {
        params.set("completionMin", String(completionRange.min));
        params.set("completionMax", String(completionRange.max));
      } else {
        params.set("completion", exportCompletion);
      }
      params.set("ts", String(Date.now()));
      const response = await request(`/export/csv/preview?${params.toString()}`);
      setPreviewColumns(Array.isArray(response?.columns) ? response.columns : []);
      setPreviewRows(Array.isArray(response?.rows) ? response.rows : []);
    } catch (requestError) {
      setPreviewColumns([]);
      setPreviewRows([]);
      setPreviewError(requestError.message || "Could not load preview rows.");
    } finally {
      setPreviewLoading(false);
    }
  }, [exportCompletion, exportDefaultFields, exportFieldsCatalog, exportSelectedFields, request]);

  useEffect(() => {
    if (!exportModalOpen) return;
    loadExportPreview(exportSelectedFields);
  }, [exportModalOpen, exportSelectedFields, loadExportPreview]);

  async function downloadCsv(fieldOrder = exportSelectedFields, { closeAfter = false } = {}) {
    const allowedKeys = exportFieldsCatalog.map((field) => String(field?.key || "").trim()).filter(Boolean);
    const normalizedFields = normalizeExportFieldSelection(fieldOrder, allowedKeys, exportDefaultFields);
    if (normalizedFields.length === 0) {
      setError("Select at least one field to export.");
      return;
    }

    setExportingCsv(true);
    setError("");
    try {
      const params = new URLSearchParams();
      params.set("fields", normalizedFields.join(","));
      const completionRange = parseCompletionRangeFilterValue(exportCompletion);
      if (completionRange) {
        params.set("completionMin", String(completionRange.min));
        params.set("completionMax", String(completionRange.max));
      } else {
        params.set("completion", exportCompletion);
      }
      const blob = await download(`/export/csv?${params.toString()}`);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${slug}-members.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
      writeSavedMemberExportFields(slug, normalizedFields);
      setHasSavedExportPreset(true);
      setStatus("CSV exported.");
      if (closeAfter) {
        setExportModalOpen(false);
      }
    } catch (requestError) {
      setError(requestError.message || "Failed to export CSV.");
    } finally {
      setExportingCsv(false);
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
      setRowMenuState(null);
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
  const exportCompletionLabel =
    MEMBER_COMPLETION_FILTER_OPTIONS.find((option) => option.value === exportCompletion)?.label ||
    "Profile Completion (All)";
  const exportFieldLabelMap = useMemo(
    () => new Map(exportFieldsCatalog.map((field) => [field.key, field.label || field.key])),
    [exportFieldsCatalog]
  );
  const exportFieldDescriptionMap = useMemo(
    () => new Map(exportFieldsCatalog.map((field) => [field.key, field.description || ""])),
    [exportFieldsCatalog]
  );

  function toggleExportField(fieldKey) {
    const key = String(fieldKey || "").trim();
    if (!key) return;
    setExportSelectedFields((prev) => {
      if (prev.includes(key)) {
        if (prev.length <= 1) return prev;
        return prev.filter((item) => item !== key);
      }
      return [...prev, key];
    });
  }

  function moveExportField(fieldKey, direction = 0) {
    const delta = Number(direction || 0);
    if (!delta) return;
    setExportSelectedFields((prev) => {
      const index = prev.indexOf(fieldKey);
      if (index < 0) return prev;
      const nextIndex = index + delta;
      if (nextIndex < 0 || nextIndex >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.splice(nextIndex, 0, item);
      return next;
    });
  }

  function reorderExportField(sourceKey, targetKey) {
    const source = String(sourceKey || "").trim();
    const target = String(targetKey || "").trim();
    if (!source || !target || source === target) return;
    setExportSelectedFields((prev) => {
      const sourceIndex = prev.indexOf(source);
      const targetIndex = prev.indexOf(target);
      if (sourceIndex < 0 || targetIndex < 0) return prev;
      const next = [...prev];
      const [moved] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
  }

  function applySavedExportPreset() {
    const allowedKeys = exportFieldsCatalog.map((field) => String(field?.key || "").trim()).filter(Boolean);
    const saved = normalizeExportFieldSelection(
      readSavedMemberExportFields(slug),
      allowedKeys,
      exportDefaultFields
    );
    if (saved.length > 0) {
      setExportSelectedFields(saved);
      setHasSavedExportPreset(true);
    }
  }

  function saveNamedExportPreset() {
    const name = normalizeExportPresetName(exportPresetName);
    if (!name) {
      setError("Enter a preset name before saving.");
      return;
    }
    const allowedKeys = exportFieldsCatalog.map((field) => String(field?.key || "").trim()).filter(Boolean);
    const normalizedFields = normalizeExportFieldSelection(exportSelectedFields, allowedKeys, exportDefaultFields);
    if (!normalizedFields.length) {
      setError("Select at least one field to save a preset.");
      return;
    }
    const now = new Date().toISOString();
    const existing = exportPresets.find((preset) => preset.name.toLowerCase() === name.toLowerCase());
    const nextPresets = existing
      ? exportPresets.map((preset) =>
          preset.id === existing.id
            ? {
                ...preset,
                name,
                fields: normalizedFields,
                updatedAt: now
              }
            : preset
        )
      : [
          {
            id: `preset_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            name,
            fields: normalizedFields,
            updatedAt: now
          },
          ...exportPresets
        ].slice(0, 30);
    writeSavedMemberExportPresets(slug, nextPresets);
    setExportPresets(nextPresets);
    const selectedId = existing?.id || nextPresets[0]?.id || "";
    setSelectedExportPresetId(selectedId);
    setExportPresetName("");
    setStatus(`Saved export preset "${name}".`);
  }

  function applyNamedExportPreset() {
    if (!selectedExportPresetId) return;
    const preset = exportPresets.find((item) => item.id === selectedExportPresetId);
    if (!preset) return;
    const allowedKeys = exportFieldsCatalog.map((field) => String(field?.key || "").trim()).filter(Boolean);
    const normalizedFields = normalizeExportFieldSelection(preset.fields || [], allowedKeys, exportDefaultFields);
    if (!normalizedFields.length) return;
    setExportSelectedFields(normalizedFields);
    setStatus(`Loaded preset "${preset.name}".`);
  }

  function deleteNamedExportPreset() {
    if (!selectedExportPresetId) return;
    const preset = exportPresets.find((item) => item.id === selectedExportPresetId);
    if (!preset) return;
    const confirmed = window.confirm(`Delete export preset "${preset.name}"?`);
    if (!confirmed) return;
    const nextPresets = exportPresets.filter((item) => item.id !== selectedExportPresetId);
    writeSavedMemberExportPresets(slug, nextPresets);
    setExportPresets(nextPresets);
    setSelectedExportPresetId(nextPresets[0]?.id || "");
    setStatus(`Deleted preset "${preset.name}".`);
  }

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
              <button
                type="button"
                className="link-button secondary"
                onClick={() => {
                  setStatus("");
                  setError("");
                  setExportCompletion(filters.completion || "all");
                  setExportModalOpen(true);
                }}
              >
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
            placeholder="Search by name or email..."
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
            {MEMBER_COMPLETION_FILTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
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
                    checked={
                      (payload?.items || [])
                        .map((item) => normalizeMemberRowId(item))
                        .filter(Boolean)
                        .every((id) => selected.includes(id)) &&
                      (payload?.items || []).some((item) => Boolean(normalizeMemberRowId(item)))
                    }
                    onChange={toggleAll}
                    disabled={!(payload?.items || []).some((item) => Boolean(normalizeMemberRowId(item)))}
                  />
                </th>
                <th>Name</th>
                <th>Role</th>
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
                  <td colSpan={8} className="muted">
                    Loading members...
                  </td>
                </tr>
              ) : !payload?.items?.length ? (
                <tr>
                  <td colSpan={8} className="muted">
                    No members found.
                  </td>
                </tr>
              ) : (
                payload.items.map((item, index) => {
                  const memberId = normalizeMemberRowId(item);
                  const rowKey = memberId || String(item?.userId || item?.email || `member-row-${index}`);
                  return (
                    <tr key={rowKey}>
                    <td>
                      <input
                        type="checkbox"
                        checked={memberId ? selected.includes(memberId) : false}
                        onChange={() => toggleOne(memberId)}
                        disabled={!memberId}
                      />
                    </td>
                    <td>
                      <div className="director-admin-member-cell">
                        <strong>{item.fullName || "Unnamed Member"}</strong>
                        <small>{item.email || "No email"}</small>
                      </div>
                    </td>
                    <td>{item.role || "Member"}</td>
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
                          aria-expanded={rowMenuId === memberId}
                          disabled={!memberId}
                          onClick={(event) => openRowMenu(event, memberId)}
                        >
                          ⋯
                        </button>
                      </div>
                    </td>
                    </tr>
                  );
                })
              )}
            </tbody>
        </DataTable>
        {rowMenuState && activeRowMenuMember && typeof document !== "undefined"
          ? createPortal(
              <div
                className="director-admin-row-menu is-floating"
                style={{ top: `${rowMenuState.top}px`, left: `${rowMenuState.left}px` }}
              >
                {activeRowMenuMemberId ? (
                  <Link
                    className="director-admin-inline-link"
                    to={`/t/${slug}/profile/${activeRowMenuMemberId}`}
                    onClick={() => setRowMenuState(null)}
                  >
                    View Profile
                  </Link>
                ) : (
                  <button type="button" className="director-admin-inline-link" disabled>
                    View Profile
                  </button>
                )}
                <button
                  type="button"
                  className="director-admin-inline-link"
                  disabled={!activeRowMenuMemberId}
                  onClick={() => {
                    setRowMenuState(null);
                    navigate(`/t/${slug}/admin/members/${activeRowMenuMemberId}/edit`);
                  }}
                >
                  Edit Member
                </button>
                <button
                  type="button"
                  className="director-admin-inline-link"
                  disabled={!activeRowMenuMemberId || deletingMemberId === activeRowMenuMemberId}
                  onClick={() => hardDeleteMember({ ...activeRowMenuMember, id: activeRowMenuMemberId })}
                >
                  {deletingMemberId === activeRowMenuMemberId ? "Deleting..." : "Delete from Network"}
                </button>
              </div>,
              document.body
            )
          : null}

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

        {exportModalOpen ? (
          <div
            className="director-admin-modal-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label="Export CSV configuration"
            onClick={() => {
              if (!exportingCsv) setExportModalOpen(false);
            }}
          >
            <div className="director-admin-modal director-admin-export-modal" onClick={(event) => event.stopPropagation()}>
              <div className="director-admin-export-modal-head">
                <div>
                  <h2>Export Members CSV</h2>
                  <p>Choose fields, drag to reorder columns, preview the sheet, then export.</p>
                </div>
                <button
                  type="button"
                  className="director-admin-row-menu-trigger"
                  aria-label="Close export dialog"
                  onClick={() => {
                    if (!exportingCsv) setExportModalOpen(false);
                  }}
                >
                  ×
                </button>
              </div>

              <div className="director-admin-export-toolbar">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setExportSelectedFields(exportDefaultFields)}
                >
                  Reset to default
                </Button>
                {hasSavedExportPreset ? (
                  <Button type="button" variant="secondary" onClick={applySavedExportPreset}>
                    Use last export setup
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    const keys = exportFieldsCatalog.map((field) => field.key);
                    setExportSelectedFields(keys);
                  }}
                >
                  Select all fields
                </Button>
              </div>
              <div className="director-admin-export-filter-row">
                <label htmlFor="export-completion-filter">Member completion filter</label>
                <Select
                  id="export-completion-filter"
                  value={exportCompletion}
                  onChange={(event) => setExportCompletion(event.target.value)}
                >
                  {MEMBER_COMPLETION_FILTER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="director-admin-export-preset-bar">
                <Input
                  value={exportPresetName}
                  onChange={(event) => setExportPresetName(event.target.value)}
                  placeholder="Preset name (e.g., Reunion Outreach)"
                />
                <Button type="button" variant="secondary" onClick={saveNamedExportPreset}>
                  Save Preset
                </Button>
                <Select
                  value={selectedExportPresetId}
                  onChange={(event) => setSelectedExportPresetId(event.target.value)}
                  disabled={!exportPresets.length}
                >
                  <option value="">Select a saved preset</option>
                  {exportPresets.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.name}
                    </option>
                  ))}
                </Select>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={applyNamedExportPreset}
                  disabled={!selectedExportPresetId}
                >
                  Use Preset
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={deleteNamedExportPreset}
                  disabled={!selectedExportPresetId}
                >
                  Delete Preset
                </Button>
              </div>

              <div className="director-admin-export-grid">
                <section className="director-admin-export-panel">
                  <h3>Included Columns ({exportSelectedFields.length})</h3>
                  <div className="director-admin-export-list">
                    {exportSelectedFields.map((fieldKey, index) => (
                      <div
                        key={fieldKey}
                        className={`director-admin-export-row ${draggingFieldKey === fieldKey ? "is-dragging" : ""}`}
                        draggable
                        onDragStart={(event) => {
                          setDraggingFieldKey(fieldKey);
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("text/plain", fieldKey);
                        }}
                        onDragOver={(event) => {
                          event.preventDefault();
                          event.dataTransfer.dropEffect = "move";
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          const sourceKey = draggingFieldKey || event.dataTransfer.getData("text/plain");
                          reorderExportField(sourceKey, fieldKey);
                          setDraggingFieldKey("");
                        }}
                        onDragEnd={() => setDraggingFieldKey("")}
                      >
                        <label>
                          <input
                            type="checkbox"
                            checked
                            onChange={() => toggleExportField(fieldKey)}
                            disabled={exportSelectedFields.length <= 1}
                          />
                          <span className="director-admin-export-drag-handle" aria-hidden="true">⋮⋮</span>
                          <span>{exportFieldLabelMap.get(fieldKey) || fieldKey}</span>
                        </label>
                        <div className="director-admin-export-row-actions">
                          <button
                            type="button"
                            className="director-admin-inline-link"
                            onClick={() => moveExportField(fieldKey, -1)}
                            disabled={index === 0}
                          >
                            Up
                          </button>
                          <button
                            type="button"
                            className="director-admin-inline-link"
                            onClick={() => moveExportField(fieldKey, 1)}
                            disabled={index === exportSelectedFields.length - 1}
                          >
                            Down
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="director-admin-export-panel">
                  <h3>Available Profile Fields</h3>
                  <div className="director-admin-export-list">
                    {exportFieldsCatalog.map((field) => {
                      const key = String(field?.key || "");
                      const selectedField = exportSelectedFields.includes(key);
                      return (
                        <div key={key} className="director-admin-export-row">
                          <label>
                            <input
                              type="checkbox"
                              checked={selectedField}
                              onChange={() => toggleExportField(key)}
                              disabled={selectedField && exportSelectedFields.length <= 1}
                            />
                            <span>{field.label || key}</span>
                          </label>
                          <small>{exportFieldDescriptionMap.get(key) || ""}</small>
                        </div>
                      );
                    })}
                  </div>
                </section>
                <section className="director-admin-export-panel director-admin-export-preview-panel full-width">
                  <h3>Spreadsheet Preview</h3>
                  <small>
                    Live sample of the first members in {exportCompletionLabel} using the selected column order.
                  </small>
                  <div className="director-admin-export-preview-wrap">
                    {previewLoading ? (
                      <p className="muted">Loading preview...</p>
                    ) : previewError ? (
                      <p className="error-text">{previewError}</p>
                    ) : previewColumns.length ? (
                      <table className="director-admin-export-preview-table">
                        <thead>
                          <tr>
                            {previewColumns.map((column) => (
                              <th key={column.key}>{column.label || column.key}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {previewRows.length ? (
                            previewRows.map((row, rowIndex) => (
                              <tr key={`preview_${rowIndex}`}>
                                {previewColumns.map((column) => (
                                  <td key={`${rowIndex}_${column.key}`}>{String(row?.[column.key] || "") || "-"}</td>
                                ))}
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={previewColumns.length} className="muted">No members available for preview yet.</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    ) : (
                      <p className="muted">Select at least one column to preview.</p>
                    )}
                  </div>
                </section>
              </div>

              <div className="director-admin-modal-actions">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    if (!exportingCsv) setExportModalOpen(false);
                  }}
                  disabled={exportingCsv}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={() => downloadCsv(exportSelectedFields, { closeAfter: true })}
                  disabled={exportingCsv || exportSelectedFields.length === 0}
                >
                  {exportingCsv ? "Exporting..." : "Export CSV"}
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </Card>

    </div>
  );
}

function emptyMemberEditorYearStint() {
  return { startYear: "", endYear: "", startAgeGroup: "", endAgeGroup: "" };
}

function normalizeMemberEditorYearStints(value = []) {
  const source = Array.isArray(value) ? value : [];
  const rows = source.map((entry) => ({
    startYear: String(entry?.startYear || "").trim(),
    endYear: String(entry?.endYear || "").trim(),
    startAgeGroup: String(entry?.startAgeGroup || "").trim(),
    endAgeGroup: String(entry?.endAgeGroup || "").trim()
  }));
  return rows.length ? rows : [emptyMemberEditorYearStint()];
}

function normalizeMemberEditorEducation(value = []) {
  const rows = (Array.isArray(value) ? value : []).map((row) => ({
    college: String(row?.college || "").trim(),
    year: String(row?.year || "").trim(),
    major: String(row?.major || "").trim()
  }));
  return rows.length ? rows : [{ college: "", year: "", major: "" }];
}

function normalizeMemberEditorJobs(value = []) {
  const rows = (Array.isArray(value) ? value : []).map((row) => ({
    role: String(row?.role || "").trim(),
    company: String(row?.company || "").trim(),
    years: String(row?.years || "").trim()
  }));
  return rows.length ? rows : [{ role: "", company: "", years: "" }];
}

function normalizeMemberEditorForm(profile = null) {
  const safe = profile && typeof profile === "object" ? profile : {};
  const camperStints = normalizeMemberEditorYearStints(safe?.camperYears?.stints || []);
  const staffStints = normalizeMemberEditorYearStints(safe?.staffYears?.stints || []);
  return {
    firstName: String(safe.firstName || "").trim(),
    lastName: String(safe.lastName || "").trim(),
    nickname: String(safe.nickname || "").trim(),
    email: String(safe.email || "").trim(),
    phone: String(safe.phone || "").trim(),
    cityState: String(safe.cityState || "").trim(),
    roleAtCamp: String(safe.roleAtCamp || "").trim(),
    rolesText: (Array.isArray(safe.roles) ? safe.roles : []).join(", "),
    status: String(safe.status || "active").trim().toLowerCase() || "active",
    flaggedReason: String(safe.flaggedReason || "").trim(),
    highSchool: String(safe.highSchool || "").trim(),
    industry: String(safe.industry || "").trim(),
    bio: String(safe.bio || "").trim(),
    avatarUrl: String(safe.avatarUrl || "").trim(),
    camperYearStints: camperStints,
    staffYearStints: staffStints,
    education: normalizeMemberEditorEducation(safe.education || []),
    currentJobs: normalizeMemberEditorJobs(safe.currentJobs || []),
    pastJobs: normalizeMemberEditorJobs(safe.pastJobs || []),
    social: {
      linkedin: String(safe?.social?.linkedin || "").trim(),
      instagram: String(safe?.social?.instagram || "").trim(),
      facebook: String(safe?.social?.facebook || "").trim()
    }
  };
}

function normalizeMemberEditorPayloadYearStints(rows = [], { includeAgeGroups = false } = {}) {
  return (Array.isArray(rows) ? rows : [])
    .map((entry) => {
      const startYear = String(entry?.startYear || "").trim();
      const endYear = String(entry?.endYear || "").trim();
      if (!startYear && !endYear) return null;
      if (!/^\d{4}$/.test(startYear) || !/^\d{4}$/.test(endYear)) return null;
      const start = Number(startYear);
      const end = Number(endYear);
      const payload = {
        startYear: String(Math.min(start, end)),
        endYear: String(Math.max(start, end))
      };
      if (includeAgeGroups) {
        const startAgeGroup = String(entry?.startAgeGroup || "").trim();
        const endAgeGroup = String(entry?.endAgeGroup || "").trim();
        if (startAgeGroup) payload.startAgeGroup = startAgeGroup;
        if (endAgeGroup) payload.endAgeGroup = endAgeGroup;
        if (startAgeGroup && startAgeGroup === endAgeGroup) payload.ageGroup = startAgeGroup;
      }
      return payload;
    })
    .filter(Boolean);
}

export function DirectorAdminMemberEditPage() {
  const navigate = useNavigate();
  const { profileId = "" } = useParams();
  const { slug, request } = useAdminApi();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [form, setForm] = useState(() => normalizeMemberEditorForm(null));

  const normalizedProfileId = String(profileId || "").trim();

  const loadProfile = useCallback(async () => {
    if (!normalizedProfileId) {
      setError("Missing member id.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await request(`/members/${normalizedProfileId}/full`);
      setForm(normalizeMemberEditorForm(response?.profile || null));
    } catch (requestError) {
      setError(requestError.message || "Failed to load member profile.");
    } finally {
      setLoading(false);
    }
  }, [normalizedProfileId, request]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  function setField(patch = {}) {
    setForm((prev) => ({ ...prev, ...patch }));
  }

  function setSocial(patch = {}) {
    setForm((prev) => ({ ...prev, social: { ...(prev.social || {}), ...patch } }));
  }

  function updateRow(listKey, index, patch) {
    setForm((prev) => ({
      ...prev,
      [listKey]: (Array.isArray(prev[listKey]) ? prev[listKey] : []).map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...patch } : row
      )
    }));
  }

  function addRow(listKey, emptyRow) {
    setForm((prev) => ({
      ...prev,
      [listKey]: [...(Array.isArray(prev[listKey]) ? prev[listKey] : []), emptyRow]
    }));
  }

  function removeRow(listKey, index) {
    setForm((prev) => {
      const next = (Array.isArray(prev[listKey]) ? prev[listKey] : []).filter(
        (_row, rowIndex) => rowIndex !== index
      );
      const fallback =
        listKey === "education"
          ? [{ college: "", year: "", major: "" }]
          : listKey === "currentJobs" || listKey === "pastJobs"
          ? [{ role: "", company: "", years: "" }]
          : [emptyMemberEditorYearStint()];
      return {
        ...prev,
        [listKey]: next.length ? next : fallback
      };
    });
  }

  async function saveMember(event) {
    event.preventDefault();
    if (!normalizedProfileId) return;

    setSaving(true);
    setError("");
    setStatus("");
    try {
      const roles = [...new Set(
        String(form.rolesText || "")
          .split(",")
          .map((value) => String(value || "").trim())
          .filter(Boolean)
      )];
      const camperYearStints = normalizeMemberEditorPayloadYearStints(form.camperYearStints, {
        includeAgeGroups: true
      });
      const staffYearStints = normalizeMemberEditorPayloadYearStints(form.staffYearStints);
      const payload = {
        firstName: String(form.firstName || "").trim(),
        lastName: String(form.lastName || "").trim(),
        nickname: String(form.nickname || "").trim(),
        emails: form.email ? [String(form.email || "").trim()] : [],
        phone: String(form.phone || "").trim(),
        cityState: String(form.cityState || "").trim(),
        roleAtCamp: String(form.roleAtCamp || "").trim(),
        roles,
        status: String(form.status || "active").trim().toLowerCase(),
        flaggedReason: String(form.flaggedReason || "").trim(),
        highSchool: String(form.highSchool || "").trim(),
        industry: String(form.industry || "").trim(),
        bio: String(form.bio || "").trim(),
        avatarUrl: String(form.avatarUrl || "").trim(),
        camperYears: {
          firstYear: camperYearStints[0]?.startYear || "",
          firstGroup: camperYearStints[0]?.startAgeGroup || "",
          lastYear: camperYearStints.length ? camperYearStints[camperYearStints.length - 1]?.endYear || "" : "",
          lastGroup: camperYearStints.length
            ? camperYearStints[camperYearStints.length - 1]?.endAgeGroup || ""
            : "",
          stints: camperYearStints
        },
        staffYears: { stints: staffYearStints },
        education: (Array.isArray(form.education) ? form.education : []).filter((row) =>
          Boolean(String(row?.college || row?.year || row?.major || "").trim())
        ),
        currentJobs: (Array.isArray(form.currentJobs) ? form.currentJobs : []).filter((row) =>
          Boolean(String(row?.role || row?.company || row?.years || "").trim())
        ),
        pastJobs: (Array.isArray(form.pastJobs) ? form.pastJobs : []).filter((row) =>
          Boolean(String(row?.role || row?.company || row?.years || "").trim())
        ),
        social: {
          linkedin: String(form?.social?.linkedin || "").trim(),
          instagram: String(form?.social?.instagram || "").trim(),
          facebook: String(form?.social?.facebook || "").trim()
        }
      };
      const response = await request(`/members/${normalizedProfileId}/full`, {
        method: "PUT",
        body: payload
      });
      setForm(normalizeMemberEditorForm(response?.profile || null));
      setStatus("Member profile updated.");
    } catch (requestError) {
      setError(requestError.message || "Failed to save member profile.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <AdminPageHeader
        title="Edit Member"
        subtitle="Full profile editor for this member."
        actions={
          <>
            <Link className="link-button secondary" to={`/t/${slug}/profile/${normalizedProfileId}`}>
              View Public Profile
            </Link>
            <Link className="link-button secondary" to={`/t/${slug}/admin/members`}>
              Back to Members
            </Link>
          </>
        }
      />
      {error ? <p className="error-text">{error}</p> : null}
      {status ? <p className="success-text">{status}</p> : null}
      {loading ? (
        <LoadingSkeleton lines={8} />
      ) : (
        <form className="director-admin-form-grid" onSubmit={saveMember}>
          <h3 className="full-width pb-section-title">Identity</h3>
          <label>
            First name
            <Input value={form.firstName} onChange={(event) => setField({ firstName: event.target.value })} />
          </label>
          <label>
            Last name
            <Input value={form.lastName} onChange={(event) => setField({ lastName: event.target.value })} />
          </label>
          <label>
            Camp nickname
            <Input value={form.nickname} onChange={(event) => setField({ nickname: event.target.value })} />
          </label>
          <label>
            Avatar URL
            <Input value={form.avatarUrl} onChange={(event) => setField({ avatarUrl: event.target.value })} />
          </label>

          <h3 className="full-width pb-section-title">Contact</h3>
          <label>
            Email
            <Input value={form.email} onChange={(event) => setField({ email: event.target.value })} />
          </label>
          <label>
            Phone
            <Input value={form.phone} onChange={(event) => setField({ phone: event.target.value })} />
          </label>
          <label className="full-width">
            Current location
            <Input value={form.cityState} onChange={(event) => setField({ cityState: event.target.value })} />
          </label>

          <h3 className="full-width pb-section-title">Camp Info</h3>
          <label>
            Role at camp
            <Input value={form.roleAtCamp} onChange={(event) => setField({ roleAtCamp: event.target.value })} />
          </label>
          <label>
            Additional roles (comma-separated)
            <Input value={form.rolesText} onChange={(event) => setField({ rolesText: event.target.value })} />
          </label>
          <label>
            High school
            <Input value={form.highSchool} onChange={(event) => setField({ highSchool: event.target.value })} />
          </label>
          <label>
            Industry
            <Input value={form.industry} onChange={(event) => setField({ industry: event.target.value })} />
          </label>
          <label className="full-width">
            Bio
            <Textarea value={form.bio} onChange={(event) => setField({ bio: event.target.value })} />
          </label>

          <h3 className="full-width pb-section-title">Camper Years</h3>
          {(Array.isArray(form.camperYearStints) ? form.camperYearStints : []).map((stint, index) => (
            <div key={`camper-${index}`} className="director-admin-member-edit-block full-width">
              <div className="director-admin-member-edit-grid">
                <label>
                  Start Year
                  <Input
                    value={stint.startYear || ""}
                    onChange={(event) =>
                      updateRow("camperYearStints", index, { startYear: event.target.value })
                    }
                  />
                </label>
                <label>
                  End Year
                  <Input
                    value={stint.endYear || ""}
                    onChange={(event) =>
                      updateRow("camperYearStints", index, { endYear: event.target.value })
                    }
                  />
                </label>
                <label>
                  Start Age Group
                  <Input
                    value={stint.startAgeGroup || ""}
                    onChange={(event) =>
                      updateRow("camperYearStints", index, { startAgeGroup: event.target.value })
                    }
                  />
                </label>
                <label>
                  End Age Group
                  <Input
                    value={stint.endAgeGroup || ""}
                    onChange={(event) =>
                      updateRow("camperYearStints", index, { endAgeGroup: event.target.value })
                    }
                  />
                </label>
              </div>
              <div className="director-admin-form-actions">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => removeRow("camperYearStints", index)}
                >
                  Remove Row
                </Button>
              </div>
            </div>
          ))}
          <div className="director-admin-form-actions full-width">
            <Button
              type="button"
              variant="secondary"
              onClick={() => addRow("camperYearStints", emptyMemberEditorYearStint())}
            >
              Add Camper Row
            </Button>
          </div>

          <h3 className="full-width pb-section-title">Staff Years</h3>
          {(Array.isArray(form.staffYearStints) ? form.staffYearStints : []).map((stint, index) => (
            <div key={`staff-${index}`} className="director-admin-member-edit-block full-width">
              <div className="director-admin-member-edit-grid">
                <label>
                  Start Year
                  <Input
                    value={stint.startYear || ""}
                    onChange={(event) =>
                      updateRow("staffYearStints", index, { startYear: event.target.value })
                    }
                  />
                </label>
                <label>
                  End Year
                  <Input
                    value={stint.endYear || ""}
                    onChange={(event) =>
                      updateRow("staffYearStints", index, { endYear: event.target.value })
                    }
                  />
                </label>
              </div>
              <div className="director-admin-form-actions">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => removeRow("staffYearStints", index)}
                >
                  Remove Row
                </Button>
              </div>
            </div>
          ))}
          <div className="director-admin-form-actions full-width">
            <Button
              type="button"
              variant="secondary"
              onClick={() => addRow("staffYearStints", emptyMemberEditorYearStint())}
            >
              Add Staff Row
            </Button>
          </div>

          <h3 className="full-width pb-section-title">Education</h3>
          {(Array.isArray(form.education) ? form.education : []).map((row, index) => (
            <div key={`education-${index}`} className="director-admin-member-edit-block full-width">
              <div className="director-admin-member-edit-grid">
                <label>
                  College
                  <Input
                    value={row.college || ""}
                    onChange={(event) => updateRow("education", index, { college: event.target.value })}
                  />
                </label>
                <label>
                  Year
                  <Input
                    value={row.year || ""}
                    onChange={(event) => updateRow("education", index, { year: event.target.value })}
                  />
                </label>
                <label className="full-width">
                  Major
                  <Input
                    value={row.major || ""}
                    onChange={(event) => updateRow("education", index, { major: event.target.value })}
                  />
                </label>
              </div>
              <div className="director-admin-form-actions">
                <Button type="button" variant="secondary" onClick={() => removeRow("education", index)}>
                  Remove Row
                </Button>
              </div>
            </div>
          ))}
          <div className="director-admin-form-actions full-width">
            <Button
              type="button"
              variant="secondary"
              onClick={() => addRow("education", { college: "", year: "", major: "" })}
            >
              Add Education Row
            </Button>
          </div>

          <h3 className="full-width pb-section-title">Current Jobs</h3>
          {(Array.isArray(form.currentJobs) ? form.currentJobs : []).map((row, index) => (
            <div key={`current-job-${index}`} className="director-admin-member-edit-block full-width">
              <div className="director-admin-member-edit-grid">
                <label>
                  Role
                  <Input
                    value={row.role || ""}
                    onChange={(event) => updateRow("currentJobs", index, { role: event.target.value })}
                  />
                </label>
                <label>
                  Company
                  <Input
                    value={row.company || ""}
                    onChange={(event) => updateRow("currentJobs", index, { company: event.target.value })}
                  />
                </label>
                <label>
                  Years
                  <Input
                    value={row.years || ""}
                    onChange={(event) => updateRow("currentJobs", index, { years: event.target.value })}
                  />
                </label>
              </div>
              <div className="director-admin-form-actions">
                <Button type="button" variant="secondary" onClick={() => removeRow("currentJobs", index)}>
                  Remove Row
                </Button>
              </div>
            </div>
          ))}
          <div className="director-admin-form-actions full-width">
            <Button
              type="button"
              variant="secondary"
              onClick={() => addRow("currentJobs", { role: "", company: "", years: "" })}
            >
              Add Current Job
            </Button>
          </div>

          <h3 className="full-width pb-section-title">Past Jobs</h3>
          {(Array.isArray(form.pastJobs) ? form.pastJobs : []).map((row, index) => (
            <div key={`past-job-${index}`} className="director-admin-member-edit-block full-width">
              <div className="director-admin-member-edit-grid">
                <label>
                  Role
                  <Input
                    value={row.role || ""}
                    onChange={(event) => updateRow("pastJobs", index, { role: event.target.value })}
                  />
                </label>
                <label>
                  Company
                  <Input
                    value={row.company || ""}
                    onChange={(event) => updateRow("pastJobs", index, { company: event.target.value })}
                  />
                </label>
                <label>
                  Years
                  <Input
                    value={row.years || ""}
                    onChange={(event) => updateRow("pastJobs", index, { years: event.target.value })}
                  />
                </label>
              </div>
              <div className="director-admin-form-actions">
                <Button type="button" variant="secondary" onClick={() => removeRow("pastJobs", index)}>
                  Remove Row
                </Button>
              </div>
            </div>
          ))}
          <div className="director-admin-form-actions full-width">
            <Button
              type="button"
              variant="secondary"
              onClick={() => addRow("pastJobs", { role: "", company: "", years: "" })}
            >
              Add Past Job
            </Button>
          </div>

          <h3 className="full-width pb-section-title">Social</h3>
          <label>
            LinkedIn
            <Input
              value={form?.social?.linkedin || ""}
              onChange={(event) => setSocial({ linkedin: event.target.value })}
            />
          </label>
          <label>
            Instagram
            <Input
              value={form?.social?.instagram || ""}
              onChange={(event) => setSocial({ instagram: event.target.value })}
            />
          </label>
          <label>
            Facebook
            <Input
              value={form?.social?.facebook || ""}
              onChange={(event) => setSocial({ facebook: event.target.value })}
            />
          </label>

          <h3 className="full-width pb-section-title">Access</h3>
          <label>
            Status
            <Select value={form.status || "active"} onChange={(event) => setField({ status: event.target.value })}>
              <option value="active">Active</option>
              <option value="pending">Pending</option>
              <option value="flagged">Flagged</option>
              <option value="removed">Removed</option>
            </Select>
          </label>
          <label className="full-width">
            Flag reason
            <Textarea
              value={form.flaggedReason || ""}
              onChange={(event) => setField({ flaggedReason: event.target.value })}
            />
          </label>

          <div className="director-admin-form-actions full-width director-admin-network-form-actions">
            <Button type="button" variant="secondary" onClick={() => navigate(`/t/${slug}/admin/members`)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </form>
      )}
    </Card>
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
  const [customSubject, setCustomSubject] = useState("");
  const [customMessage, setCustomMessage] = useState("");
  const [invites, setInvites] = useState([]);
  const [hiddenInviteIds, setHiddenInviteIds] = useState([]);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [result, setResult] = useState(null);

  useEffect(() => {
    setHiddenInviteIds(readHiddenInviteIds(slug));
  }, [slug]);

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

  const visibleInvites = useMemo(() => {
    if (!invites.length) return [];
    const hiddenSet = new Set(hiddenInviteIds);
    return invites.filter((invite) => !hiddenSet.has(String(invite?.id || "")));
  }, [hiddenInviteIds, invites]);

  const hiddenInvitesInCurrentFilter = Math.max(0, invites.length - visibleInvites.length);

  function hideInviteFromView(inviteId = "") {
    const normalized = String(inviteId || "").trim();
    if (!normalized) return;
    setHiddenInviteIds((current) => {
      if (current.includes(normalized)) return current;
      const next = [...current, normalized];
      writeHiddenInviteIds(slug, next);
      return next;
    });
    setStatus("Invite removed from this view.");
  }

  function clearVisibleInvitesFromView() {
    const idsToHide = visibleInvites
      .map((invite) => String(invite?.id || "").trim())
      .filter(Boolean);
    if (!idsToHide.length) return;
    setHiddenInviteIds((current) => {
      const next = [...new Set([...current, ...idsToHide])];
      writeHiddenInviteIds(slug, next);
      return next;
    });
    setStatus(`Cleared ${idsToHide.length} invite${idsToHide.length === 1 ? "" : "s"} from this view.`);
  }

  function restoreClearedInvites() {
    setHiddenInviteIds([]);
    writeHiddenInviteIds(slug, []);
    setStatus("Restored cleared invites.");
  }

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
      if (customSubject.trim()) {
        formData.append("customSubject", customSubject);
      }
      if (customMessage.trim()) {
        formData.append("customMessage", customMessage);
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

          <div className="director-admin-upload-box">
            <p>Optional: personalize the invite email for this send.</p>
            <p className="muted">Use `{{firstName}}`, `{{lastName}}`, or `{{networkName}}` in the subject or message.</p>
            <div style={{ display: "grid", gap: 12 }}>
              <div>
                <label htmlFor="invite-custom-subject" style={{ display: "block", fontWeight: 600, marginBottom: 6 }}>
                  Email subject
                </label>
                <Input
                  id="invite-custom-subject"
                  value={customSubject}
                  placeholder="You're invited to {{networkName}}, {{firstName}}"
                  onChange={(event) => setCustomSubject(event.target.value)}
                />
              </div>
              <div>
                <label htmlFor="invite-custom-message" style={{ display: "block", fontWeight: 600, marginBottom: 6 }}>
                  Personal message
                </label>
                <Textarea
                  id="invite-custom-message"
                  rows={6}
                  value={customMessage}
                  placeholder={"Hi {{firstName}},\n\nI'd love for you to join our PondBridge community this season."}
                  onChange={(event) => setCustomMessage(event.target.value)}
                />
              </div>
            </div>
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
        <div className="director-admin-invite-toolbar">
          <div className="director-admin-invite-toolbar-left">
            <h2 className="pb-section-title">Invite Status</h2>
            <Select
              className="director-admin-invite-filter-select"
              value={inviteStatusFilter}
              onChange={(event) => setInviteStatusFilter(event.target.value)}
            >
              <option value="pending">Pending</option>
              <option value="used">Used</option>
              <option value="expired">Expired</option>
              <option value="all">All</option>
            </Select>
          </div>
          <div className="director-admin-invite-toolbar-right">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={clearVisibleInvitesFromView}
              disabled={loadingInvites || visibleInvites.length === 0}
            >
              Clear Visible
            </Button>
            {hiddenInviteIds.length ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={restoreClearedInvites}
              >
                Restore Cleared
              </Button>
            ) : null}
          </div>
        </div>
        {loadingInvites ? (
          <p className="muted">Loading invites...</p>
        ) : invites.length === 0 ? (
          <p className="muted">No invites found for this filter.</p>
        ) : visibleInvites.length === 0 ? (
          <p className="muted">All invites in this filter are cleared from view.</p>
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
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleInvites.map((invite) => {
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
                      <td>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => hideInviteFromView(invite.id)}
                        >
                          Clear
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!loadingInvites && hiddenInvitesInCurrentFilter > 0 ? (
          <p className="muted">{hiddenInvitesInCurrentFilter} invite(s) currently hidden in this filter.</p>
        ) : null}
      </Card>
    </div>
  );
}

export function DirectorAdminEmailComposePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { slug, request } = useAdminApi();
  const { tenant } = useTenant();
  const { user } = useAuth();
  const initialSelectedIds = parseIdsParam(searchParams.get("selected") || "");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [recipientPreview, setRecipientPreview] = useState({ count: 0, excludedCount: 0, preview: [] });
  const [memberQuery, setMemberQuery] = useState("");
  const [memberSearchLoading, setMemberSearchLoading] = useState(false);
  const [memberSearchResults, setMemberSearchResults] = useState([]);
  const [selectedMemberById, setSelectedMemberById] = useState({});
  const [savedRecipientGroups, setSavedRecipientGroups] = useState([]);
  const [selectedRecipientGroupId, setSelectedRecipientGroupId] = useState("");
  const [recipientGroupName, setRecipientGroupName] = useState("");
  const fallbackFooter = useMemo(
    () => createFallbackEmailFooter({ tenant, user }),
    [tenant, user]
  );
  const [footerPresets, setFooterPresets] = useState([]);
  const [selectedFooterPresetId, setSelectedFooterPresetId] = useState("");
  const [footerPresetName, setFooterPresetName] = useState("");
  const [footerDraft, setFooterDraft] = useState(fallbackFooter);
  const [footerSaving, setFooterSaving] = useState(false);
  const [loadingFooterPresets, setLoadingFooterPresets] = useState(true);
  const [footerPanelOpen, setFooterPanelOpen] = useState(false);
  const [form, setForm] = useState({
    mode: initialSelectedIds.length > 0 ? "individual" : "all",
    profileIds: initialSelectedIds,
    subject: String(searchParams.get("subject") || ""),
    body: String(searchParams.get("body") || ""),
    scheduleType: "now",
    scheduledFor: ""
  });

  useEffect(() => {
    const groups = readSavedEmailRecipientGroups(slug);
    setSavedRecipientGroups(groups);
    setSelectedRecipientGroupId(groups[0]?.id || "");
  }, [slug]);

  useEffect(() => {
    let active = true;
    setLoadingFooterPresets(true);
    request("/email/footer-presets")
      .then((payload) => {
        if (!active) return;
        const presets = normalizeEmailFooterPresets(payload?.presets || [], fallbackFooter);
        const requestedDefaultId = String(payload?.defaultPresetId || "").trim();
        const selectedId = presets.some((item) => item.id === requestedDefaultId)
          ? requestedDefaultId
          : String(presets[0]?.id || "");
        const selectedPreset = presets.find((item) => item.id === selectedId);
        const nextFooter = normalizeEmailFooter(payload?.activeFooter || {}, selectedPreset?.footer || fallbackFooter);
        setFooterPresets(presets);
        setSelectedFooterPresetId(selectedId);
        setFooterPresetName(selectedPreset?.name || "");
        setFooterDraft(nextFooter);
      })
      .catch(() => {
        if (!active) return;
        const presets = normalizeEmailFooterPresets([], fallbackFooter);
        const selectedId = String(presets[0]?.id || "");
        setFooterPresets(presets);
        setSelectedFooterPresetId(selectedId);
        setFooterPresetName(String(presets[0]?.name || ""));
        setFooterDraft(normalizeEmailFooter(presets[0]?.footer || {}, fallbackFooter));
      })
      .finally(() => {
        if (active) setLoadingFooterPresets(false);
      });

    return () => {
      active = false;
    };
  }, [fallbackFooter, request]);

  const targeting = useMemo(() => {
    const mode = form.mode === "all" ? "all" : "custom";
    const activePreset = savedRecipientGroups.find((item) => item.id === selectedRecipientGroupId);
    return {
      mode,
      roles: [],
      years: [],
      profileIds: mode === "custom" ? normalizeProfileIdList(form.profileIds) : [],
      label: form.mode === "all"
        ? "All Members"
        : form.mode === "individual"
        ? "Specific People"
        : normalizeEmailRecipientGroupName(recipientGroupName) || activePreset?.name || "Custom Group"
    };
  }, [form.mode, form.profileIds, recipientGroupName, savedRecipientGroups, selectedRecipientGroupId]);

  useEffect(() => {
    if (form.mode === "all") {
      setMemberSearchResults([]);
      setMemberSearchLoading(false);
      return;
    }
    let active = true;
    const timeout = window.setTimeout(async () => {
      setMemberSearchLoading(true);
      try {
        const params = new URLSearchParams({
          page: "1",
          pageSize: "12",
          q: String(memberQuery || "").trim(),
          role: "all",
          year: "all",
          status: "all",
          completion: "all",
          sort: "name_asc"
        });
        const payload = await request(`/members?${params.toString()}`);
        if (!active) return;
        const items = Array.isArray(payload?.items) ? payload.items : [];
        setMemberSearchResults(items.filter((item) => !form.profileIds.includes(item.id)).slice(0, 12));
      } catch {
        if (!active) return;
        setMemberSearchResults([]);
      } finally {
        if (active) setMemberSearchLoading(false);
      }
    }, 180);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [form.mode, form.profileIds, memberQuery, request]);

  useEffect(() => {
    if (!form.profileIds.length) return;
    const missing = form.profileIds.filter((id) => !selectedMemberById[id]);
    if (!missing.length) return;
    let active = true;
    request(`/members/lookup?ids=${encodeURIComponent(missing.join(","))}`)
      .then((payload) => {
        if (!active) return;
        const items = Array.isArray(payload?.items) ? payload.items : [];
        if (!items.length) return;
        setSelectedMemberById((current) => {
          const next = { ...current };
          for (const item of items) {
            const id = String(item?.id || "").trim();
            if (!id) continue;
            next[id] = {
              id,
              fullName: String(item?.fullName || "Member").trim() || "Member",
              email: String(item?.email || "").trim()
            };
          }
          return next;
        });
      })
      .catch(() => {})
      .finally(() => {});
    return () => {
      active = false;
    };
  }, [form.profileIds, request, selectedMemberById]);

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

  const selectedRecipients = useMemo(
    () =>
      normalizeProfileIdList(form.profileIds).map((id) => {
        const item = selectedMemberById[id];
        return {
          id,
          fullName: String(item?.fullName || `Member ${id.slice(0, 8)}`).trim(),
          email: String(item?.email || "").trim()
        };
      }),
    [form.profileIds, selectedMemberById]
  );

  const selectedFooterPreset = useMemo(
    () => footerPresets.find((item) => item.id === selectedFooterPresetId) || null,
    [footerPresets, selectedFooterPresetId]
  );

  const activeFooter = useMemo(
    () => normalizeEmailFooter(footerDraft, selectedFooterPreset?.footer || fallbackFooter),
    [fallbackFooter, footerDraft, selectedFooterPreset]
  );

  const networkName = String(tenant?.content?.networkDisplayName || tenant?.name || "Your Camp Network")
    .trim();
  const previewHeaderLogoUrl = String(tenant?.theme?.logoUrl || "").trim();
  const previewFooterLogoUrl = activeFooter.showLogo
    ? String(tenant?.theme?.logoUrl || activeFooter.logoUrl || "").trim()
    : "";
  const previewInitials = (networkName || "PondBridge")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((item) => item[0]?.toUpperCase() || "")
    .join("") || "PB";
  const previewBody = previewTextFromHtmlLike(form.body);
  const footerContact = [activeFooter.senderEmail, activeFooter.senderPhone].filter(Boolean).join(" • ");

  function addRecipient(member) {
    const profileId = String(member?.id || "").trim();
    if (!profileId) return;
    setForm((prev) => {
      if (prev.profileIds.includes(profileId)) return prev;
      return { ...prev, profileIds: [...prev.profileIds, profileId] };
    });
    setSelectedMemberById((prev) => ({
      ...prev,
      [profileId]: {
        id: profileId,
        fullName: String(member?.fullName || member?.name || "Member").trim() || "Member",
        email: String(member?.email || "").trim()
      }
    }));
    setMemberSearchResults((prev) => prev.filter((item) => String(item?.id || "").trim() !== profileId));
  }

  function removeRecipient(profileId = "") {
    const normalized = String(profileId || "").trim();
    if (!normalized) return;
    setForm((prev) => ({
      ...prev,
      profileIds: prev.profileIds.filter((id) => id !== normalized)
    }));
  }

  function saveRecipientGroup() {
    const name = normalizeEmailRecipientGroupName(recipientGroupName);
    const profileIds = normalizeProfileIdList(form.profileIds);
    if (!name) {
      setError("Enter a group name before saving.");
      return;
    }
    if (!profileIds.length) {
      setError("Add at least one recipient before saving a group.");
      return;
    }
    const now = new Date().toISOString();
    const existingById = savedRecipientGroups.find((item) => item.id === selectedRecipientGroupId) || null;
    const existingByName =
      savedRecipientGroups.find((item) => item.name.toLowerCase() === name.toLowerCase()) || null;
    const existing = existingById || existingByName;
    const nextGroups = existing
      ? savedRecipientGroups.map((item) =>
          item.id === existing.id
            ? { ...item, name, profileIds, updatedAt: now }
            : item
        )
      : [
          {
            id: `group_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            name,
            profileIds,
            updatedAt: now
          },
          ...savedRecipientGroups
        ].slice(0, 60);
    writeSavedEmailRecipientGroups(slug, nextGroups);
    setSavedRecipientGroups(nextGroups);
    setSelectedRecipientGroupId(existing?.id || nextGroups[0]?.id || "");
    setStatus(`Saved group "${name}".`);
    setError("");
  }

  function applyRecipientGroup() {
    if (!selectedRecipientGroupId) return;
    const group = savedRecipientGroups.find((item) => item.id === selectedRecipientGroupId);
    if (!group) return;
    setForm((prev) => ({
      ...prev,
      mode: "custom_group",
      profileIds: normalizeProfileIdList(group.profileIds || [])
    }));
    setRecipientGroupName(group.name || "");
    setStatus(`Loaded group "${group.name}".`);
    setError("");
  }

  function deleteRecipientGroup() {
    if (!selectedRecipientGroupId) return;
    const group = savedRecipientGroups.find((item) => item.id === selectedRecipientGroupId);
    if (!group) return;
    const confirmed = window.confirm(`Delete recipient group "${group.name}"?`);
    if (!confirmed) return;
    const nextGroups = savedRecipientGroups.filter((item) => item.id !== selectedRecipientGroupId);
    writeSavedEmailRecipientGroups(slug, nextGroups);
    setSavedRecipientGroups(nextGroups);
    setSelectedRecipientGroupId(nextGroups[0]?.id || "");
    if (String(recipientGroupName || "").trim().toLowerCase() === String(group.name || "").trim().toLowerCase()) {
      setRecipientGroupName("");
    }
    setStatus(`Deleted group "${group.name}".`);
    setError("");
  }

  async function persistFooterPresets(nextPresets = [], defaultPresetId = "", nextSelectedId = "") {
    setFooterSaving(true);
    setError("");
    try {
      const payload = await request("/email/footer-presets", {
        method: "PATCH",
        body: {
          presets: nextPresets,
          defaultPresetId
        }
      });
      const presets = normalizeEmailFooterPresets(payload?.presets || nextPresets, fallbackFooter);
      const selectedIdCandidate = String(nextSelectedId || payload?.defaultPresetId || "").trim();
      const selectedId = presets.some((item) => item.id === selectedIdCandidate)
        ? selectedIdCandidate
        : String(payload?.defaultPresetId || presets[0]?.id || "");
      const selectedPreset = presets.find((item) => item.id === selectedId) || presets[0];
      const activeFooterPayload = normalizeEmailFooter(payload?.activeFooter || selectedPreset?.footer || {}, fallbackFooter);
      setFooterPresets(presets);
      setSelectedFooterPresetId(selectedId);
      setFooterPresetName(selectedPreset?.name || "");
      setFooterDraft(activeFooterPayload);
      return { ok: true, presets, selectedId, activeFooterPayload };
    } catch (requestError) {
      setError(requestError.message || "Failed to save footer presets.");
      return { ok: false };
    } finally {
      setFooterSaving(false);
    }
  }

  function applyFooterPreset() {
    if (!selectedFooterPresetId) return;
    const preset = footerPresets.find((item) => item.id === selectedFooterPresetId);
    if (!preset) return;
    setFooterPresetName(preset.name || "");
    setFooterDraft(normalizeEmailFooter(preset.footer || {}, fallbackFooter));
    setStatus(`Loaded footer "${preset.name}".`);
    setError("");
  }

  async function saveFooterPreset() {
    const name = normalizeEmailFooterPresetName(footerPresetName);
    if (!name) {
      setError("Enter a footer preset name before saving.");
      return;
    }
    const now = new Date().toISOString();
    const existingById = footerPresets.find((item) => item.id === selectedFooterPresetId) || null;
    const existingByName = footerPresets.find((item) => item.name.toLowerCase() === name.toLowerCase()) || null;
    const existing = existingById || existingByName;
    const nextPreset = {
      id: existing?.id || `footer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name,
      footer: activeFooter,
      updatedAt: now
    };
    const nextPresets = existing
      ? footerPresets.map((item) => (item.id === existing.id ? nextPreset : item))
      : [nextPreset, ...footerPresets].slice(0, 20);
    const defaultId = footerPresets.some((item) => item.id === selectedFooterPresetId)
      ? selectedFooterPresetId
      : String(nextPresets[0]?.id || "");
    const result = await persistFooterPresets(nextPresets, defaultId, nextPreset.id);
    if (result.ok) {
      setStatus(`Saved footer "${name}".`);
      setError("");
    }
  }

  async function deleteFooterPreset() {
    if (!selectedFooterPresetId) return;
    const preset = footerPresets.find((item) => item.id === selectedFooterPresetId);
    if (!preset) return;
    const confirmed = window.confirm(`Delete footer "${preset.name}"?`);
    if (!confirmed) return;
    const remaining = footerPresets.filter((item) => item.id !== selectedFooterPresetId);
    const nextPresets = remaining.length
      ? remaining
      : normalizeEmailFooterPresets(
          [
            {
              id: `footer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              name: "Default Footer",
              footer: fallbackFooter,
              updatedAt: new Date().toISOString()
            }
          ],
          fallbackFooter
        );
    const nextDefaultId = String(nextPresets[0]?.id || "");
    const result = await persistFooterPresets(nextPresets, nextDefaultId, nextDefaultId);
    if (result.ok) {
      setStatus(`Deleted footer "${preset.name}".`);
      setError("");
    }
  }

  async function makeFooterDefault() {
    if (!selectedFooterPresetId) return;
    const preset = footerPresets.find((item) => item.id === selectedFooterPresetId);
    if (!preset) return;
    const result = await persistFooterPresets(footerPresets, selectedFooterPresetId, selectedFooterPresetId);
    if (result.ok) {
      setStatus(`"${preset.name}" is now the default footer.`);
      setError("");
    }
  }

  async function sendTestEmail() {
    setError("");
    setStatus("");
    try {
      await request("/email/test", {
        method: "POST",
        body: {
          subject: form.subject,
          body: form.body,
          footer: activeFooter
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
          scheduledFor: form.scheduleType === "later" ? form.scheduledFor : "",
          footer: activeFooter
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
              <option value="individual">Specific People</option>
              <option value="custom_group">Custom Group</option>
            </Select>
          </label>
          {form.mode !== "all" ? (
            <section className="director-admin-recipient-builder">
              {form.mode === "custom_group" ? (
                <div className="director-admin-email-group-bar">
                  <Input
                    value={recipientGroupName}
                    onChange={(event) => setRecipientGroupName(event.target.value)}
                    placeholder="Group name (e.g., Reunion Outreach)"
                  />
                  <Button type="button" variant="secondary" onClick={saveRecipientGroup}>
                    Save Group
                  </Button>
                  <Select
                    value={selectedRecipientGroupId}
                    onChange={(event) => {
                      const nextId = event.target.value;
                      setSelectedRecipientGroupId(nextId);
                      const group = savedRecipientGroups.find((item) => item.id === nextId);
                      if (group) setRecipientGroupName(group.name || "");
                    }}
                    disabled={!savedRecipientGroups.length}
                  >
                    <option value="">Saved groups</option>
                    {savedRecipientGroups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                  </Select>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={applyRecipientGroup}
                    disabled={!selectedRecipientGroupId}
                  >
                    Use Group
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={deleteRecipientGroup}
                    disabled={!selectedRecipientGroupId}
                  >
                    Delete Group
                  </Button>
                </div>
              ) : null}

              <label>
                Find members
                <Input
                  value={memberQuery}
                  onChange={(event) => setMemberQuery(event.target.value)}
                  placeholder="Search by name or email..."
                />
              </label>
              <div className="director-admin-member-search-results">
                {memberSearchLoading ? (
                  <p className="muted">Searching members...</p>
                ) : memberSearchResults.length ? (
                  memberSearchResults.map((member) => (
                    <div key={member.id} className="director-admin-member-search-item">
                      <div>
                        <strong>{member.fullName || "Member"}</strong>
                        <small>{member.email || "No email"}</small>
                      </div>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => addRecipient(member)}
                      >
                        Add
                      </Button>
                    </div>
                  ))
                ) : (
                  <p className="muted">No matching members found.</p>
                )}
              </div>
              <div className="director-admin-selected-recipient-head">
                <strong>Selected recipients ({selectedRecipients.length})</strong>
                {selectedRecipients.length ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setForm((prev) => ({ ...prev, profileIds: [] }))}
                  >
                    Clear Selected
                  </Button>
                ) : null}
              </div>
              {selectedRecipients.length ? (
                <div className="director-admin-selected-recipient-list">
                  {selectedRecipients.map((member) => (
                    <div key={member.id} className="director-admin-selected-chip">
                      <div>
                        <strong>{member.fullName || "Member"}</strong>
                        <small>{member.email || member.id}</small>
                      </div>
                      <button
                        type="button"
                        className="director-admin-inline-link"
                        onClick={() => removeRecipient(member.id)}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted">No members selected yet.</p>
              )}
            </section>
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

          <section className="director-admin-email-footer-builder">
            <div className="director-admin-email-footer-head">
              <div>
                <strong>Saved Footers</strong>
                <small>Personalize signature details and reuse footer presets anytime.</small>
              </div>
              <div className="director-admin-email-footer-head-actions">
                <span className="director-admin-email-footer-count">{footerPresets.length} saved</span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setFooterPanelOpen((prev) => !prev)}
                  aria-expanded={footerPanelOpen}
                >
                  {footerPanelOpen ? "Hide" : "Edit"}
                </Button>
              </div>
            </div>

            {footerPanelOpen ? (
              <>
                <div className="director-admin-email-footer-preset-bar">
                  <Input
                    value={footerPresetName}
                    onChange={(event) => setFooterPresetName(event.target.value)}
                    placeholder="Footer preset name (e.g., Director Update)"
                  />
                  <Select
                    value={selectedFooterPresetId}
                    onChange={(event) => {
                      const nextId = event.target.value;
                      setSelectedFooterPresetId(nextId);
                      const preset = footerPresets.find((item) => item.id === nextId);
                      if (preset) setFooterPresetName(preset.name || "");
                    }}
                    disabled={!footerPresets.length}
                  >
                    <option value="">Saved footers</option>
                    {footerPresets.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.name}
                      </option>
                    ))}
                  </Select>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={applyFooterPreset}
                    disabled={!selectedFooterPresetId || loadingFooterPresets}
                  >
                    Use Footer
                  </Button>
                  <Button type="button" variant="secondary" onClick={saveFooterPreset} disabled={footerSaving}>
                    Save Footer
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={deleteFooterPreset}
                    disabled={!selectedFooterPresetId || footerSaving}
                  >
                    Delete Footer
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={makeFooterDefault}
                    disabled={!selectedFooterPresetId || footerSaving}
                  >
                    Set Default
                  </Button>
                </div>

                <div className="director-admin-email-footer-grid">
                  <label>
                    Header label
                    <Input
                      value={activeFooter.headerTagline}
                      onChange={(event) =>
                        setFooterDraft((prev) => normalizeEmailFooter({ ...prev, headerTagline: event.target.value }, fallbackFooter))
                      }
                      placeholder="Community update"
                    />
                  </label>
                  <label>
                    Sign-off
                    <Input
                      value={activeFooter.signOff}
                      onChange={(event) =>
                        setFooterDraft((prev) => normalizeEmailFooter({ ...prev, signOff: event.target.value }, fallbackFooter))
                      }
                      placeholder="Warmly,"
                    />
                  </label>
                  <label>
                    Name
                    <Input
                      value={activeFooter.senderName}
                      onChange={(event) =>
                        setFooterDraft((prev) => normalizeEmailFooter({ ...prev, senderName: event.target.value }, fallbackFooter))
                      }
                      placeholder="Director name"
                    />
                  </label>
                  <label>
                    Role
                    <Input
                      value={activeFooter.senderRole}
                      onChange={(event) =>
                        setFooterDraft((prev) => normalizeEmailFooter({ ...prev, senderRole: event.target.value }, fallbackFooter))
                      }
                      placeholder="Director"
                    />
                  </label>
                  <label>
                    Email
                    <Input
                      value={activeFooter.senderEmail}
                      onChange={(event) =>
                        setFooterDraft((prev) => normalizeEmailFooter({ ...prev, senderEmail: event.target.value }, fallbackFooter))
                      }
                      placeholder="name@camp.org"
                    />
                  </label>
                  <label>
                    Phone
                    <Input
                      value={activeFooter.senderPhone}
                      onChange={(event) =>
                        setFooterDraft((prev) => normalizeEmailFooter({ ...prev, senderPhone: event.target.value }, fallbackFooter))
                      }
                      placeholder="(555) 555-5555"
                    />
                  </label>
                  <label className="inline-check director-admin-email-footer-toggle">
                    <input
                      type="checkbox"
                      checked={Boolean(activeFooter.showLogo)}
                      onChange={(event) =>
                        setFooterDraft((prev) => normalizeEmailFooter({ ...prev, showLogo: event.target.checked }, fallbackFooter))
                      }
                    />
                    Include camp logo in footer
                  </label>
                  <p className="muted director-admin-email-footer-note">Footer logo uses your active camp branding logo automatically.</p>
                </div>
              </>
            ) : (
              <p className="muted director-admin-email-footer-collapsed-note">
                Footer details hidden. Click Edit to expand.
              </p>
            )}
          </section>

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
        <aside className="director-admin-email-preview">
          <h3>Live Preview</h3>
          <div className="director-admin-email-frame">
            <div className="director-admin-email-frame-head" style={{ background: "var(--brand-primary)" }}>
              {previewHeaderLogoUrl ? (
                <img src={previewHeaderLogoUrl} alt="" />
              ) : (
                <span className="director-admin-logo-fallback">{previewInitials}</span>
              )}
              <div>
                <strong>{networkName || "Your Camp Network"}</strong>
                <small>{activeFooter.headerTagline || "Community update"}</small>
              </div>
            </div>
            <div className="director-admin-email-frame-body">
              <h4>{form.subject.trim() || "Subject line preview"}</h4>
              <p>{previewBody || "Write your message here and the preview updates in real time."}</p>
            </div>
            <div className="director-admin-email-frame-foot">
              <div className="director-admin-email-signature-preview">
                <p>{activeFooter.signOff || "Warmly,"}</p>
                {activeFooter.senderName ? <p><strong>{activeFooter.senderName}</strong></p> : null}
                {activeFooter.senderRole ? <p>{activeFooter.senderRole}</p> : null}
                {footerContact ? <p>{footerContact}</p> : null}
              </div>
              {previewFooterLogoUrl ? (
                <img className="director-admin-email-signature-logo" src={previewFooterLogoUrl} alt="" />
              ) : null}
            </div>
          </div>
        </aside>
      </form>
    </Card>
  );
}

export function DirectorAdminEmailHistoryPage() {
  const navigate = useNavigate();
  const { slug, request } = useAdminApi();
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const pageSize = 30;

  // Suppression state
  const [suppressions, setSuppressions] = useState([]);
  const [suppressionsOpen, setSuppressionsOpen] = useState(false);
  const [suppressionsLoading, setSuppressionsLoading] = useState(false);
  const [liftingId, setLiftingId] = useState("");

  // Scheduled cancel state
  const [cancelTarget, setCancelTarget] = useState(null);
  const [canceling, setCanceling] = useState(false);

  const loadHistory = useCallback(async (pageNum = 0) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ limit: String(pageSize), offset: String(pageNum * pageSize) });
      const response = await request(`/email/history?${params.toString()}`);
      setItems(response.items || []);
      setTotal(response.total || 0);
    } catch (requestError) {
      setError(requestError.message || "Failed to load sent emails.");
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    loadHistory(page);
  }, [loadHistory, page]);

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => (item.subject || "").toLowerCase().includes(q));
  }, [items, searchQuery]);

  async function loadSuppressions() {
    setSuppressionsLoading(true);
    try {
      const response = await request("/email/suppressions");
      setSuppressions(response.items || []);
    } catch {
      setSuppressions([]);
    } finally {
      setSuppressionsLoading(false);
    }
  }

  function toggleSuppressions() {
    const next = !suppressionsOpen;
    setSuppressionsOpen(next);
    if (next && suppressions.length === 0) loadSuppressions();
  }

  async function liftSuppression(id) {
    setLiftingId(id);
    try {
      await request(`/email/suppressions/${id}/lift`, { method: "PATCH" });
      setSuppressions((prev) => prev.filter((s) => s.id !== id));
    } catch { /* Ignore */ }
    finally { setLiftingId(""); }
  }

  async function cancelScheduled() {
    if (!cancelTarget) return;
    setCanceling(true);
    try {
      await request(`/email/scheduled/${cancelTarget.id}`, { method: "DELETE" });
      setCancelTarget(null);
      loadHistory(page);
    } catch (requestError) {
      setError(requestError.message || "Failed to cancel scheduled email.");
    } finally {
      setCanceling(false);
    }
  }

  function formatPercent(value) {
    if (value == null || value === "") return "-";
    return `${(Number(value) * 100).toFixed(1)}%`;
  }

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

      {/* Search */}
      <div className="director-admin-email-history-controls">
        <Input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search by subject..." />
      </div>

      <div className="director-admin-table-wrap">
        <table className="director-admin-table">
          <thead>
            <tr>
              <th>Subject</th>
              <th>Recipients</th>
              <th>Sent</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="muted">Loading sent emails...</td>
              </tr>
            ) : !filteredItems.length ? (
              <tr>
                <td colSpan={5}>
                  <div className="director-admin-empty">
                    <h3>No emails found.</h3>
                    <p>{searchQuery ? "Try a different search." : "Compose your first email to the network."}</p>
                  </div>
                </td>
              </tr>
            ) : (
              filteredItems.map((item) => (
                <tr key={item.id}>
                  <td>{item.subject}</td>
                  <td>{item.recipientCount || 0}</td>
                  <td>{formatDateTime(item.sentAt || item.scheduledFor || item.createdAt)}</td>
                  <td>
                    <span className={`director-admin-status-badge tone-${statusTone(item.status)}`.trim()}>
                      {item.status}
                    </span>
                  </td>
                  <td>
                    <button type="button" className="director-admin-inline-link" onClick={() => setSelected(item)}>
                      Details
                    </button>
                    {item.status === "scheduled" ? (
                      <>
                        {" "}
                        <button type="button" className="director-admin-inline-link" onClick={() => setCancelTarget(item)}>
                          Cancel
                        </button>
                        {" "}
                        <button
                          type="button"
                          className="director-admin-inline-link"
                          onClick={() => navigate(`/t/${slug}/admin/email/compose?subject=${encodeURIComponent(item.subject)}&body=${encodeURIComponent(item.body || "")}`)}
                        >
                          Edit
                        </button>
                      </>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="director-admin-pagination">
        <Button variant="secondary" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</Button>
        <span className="muted">Page {page + 1}{total > 0 ? ` of ${Math.ceil(total / pageSize)}` : ""}</span>
        <Button variant="secondary" size="sm" disabled={items.length < pageSize} onClick={() => setPage((p) => p + 1)}>Next</Button>
      </div>

      {/* Suppressions section */}
      <div className="director-admin-email-suppression-section">
        <button type="button" className="director-admin-inline-link" onClick={toggleSuppressions}>
          {suppressionsOpen ? "Hide Suppressions" : "View Email Suppressions"}
        </button>
        {suppressionsOpen ? (
          <div className="director-admin-email-suppression-content">
            {suppressionsLoading ? (
              <p className="muted">Loading suppressions...</p>
            ) : !suppressions.length ? (
              <p className="muted">No active suppressions.</p>
            ) : (
              <table className="director-admin-table">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Reason</th>
                    <th>Source</th>
                    <th>First Seen</th>
                    <th>Last Seen</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {suppressions.map((s) => (
                    <tr key={s.id}>
                      <td>{s.email}</td>
                      <td>{s.reason || "-"}</td>
                      <td>{s.sourceEventType || "-"}</td>
                      <td>{s.firstSeenAt ? formatDateTime(s.firstSeenAt) : "-"}</td>
                      <td>{s.lastSeenAt ? formatDateTime(s.lastSeenAt) : "-"}</td>
                      <td>
                        <button
                          type="button"
                          className="director-admin-inline-link"
                          disabled={liftingId === s.id}
                          onClick={() => liftSuppression(s.id)}
                        >
                          {liftingId === s.id ? "Lifting..." : "Lift"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : null}
      </div>

      {/* Detail modal */}
      {selected ? (
        <div className="director-admin-modal-backdrop">
          <div className="director-admin-modal director-admin-modal-wide">
            <h2>{selected.subject}</h2>
            <p className="muted">
              {selected.status} &middot; {formatDateTime(selected.sentAt || selected.scheduledFor || selected.createdAt)}
            </p>
            <p><strong>Recipients:</strong> {selected.recipientCount}</p>

            {/* Delivery stats */}
            {selected.stats?.delivery || selected.stats?.webhook ? (
              <div className="director-admin-email-stats-grid">
                {selected.stats.delivery ? (
                  <>
                    <div className="director-admin-email-stat">
                      <span className="director-admin-email-stat-value">{selected.stats.delivery.sentCount ?? "-"}</span>
                      <span className="director-admin-email-stat-label">Sent</span>
                    </div>
                    <div className="director-admin-email-stat">
                      <span className="director-admin-email-stat-value">{selected.stats.delivery.failedCount ?? "-"}</span>
                      <span className="director-admin-email-stat-label">Failed</span>
                    </div>
                  </>
                ) : null}
                {selected.stats.webhook ? (
                  <>
                    {selected.stats.webhook.delivered != null ? (
                      <div className="director-admin-email-stat">
                        <span className="director-admin-email-stat-value">{selected.stats.webhook.delivered}</span>
                        <span className="director-admin-email-stat-label">Delivered</span>
                      </div>
                    ) : null}
                    {selected.stats.webhook.bounced != null ? (
                      <div className="director-admin-email-stat">
                        <span className="director-admin-email-stat-value">{selected.stats.webhook.bounced}</span>
                        <span className="director-admin-email-stat-label">Bounced</span>
                      </div>
                    ) : null}
                    {selected.stats.webhook.clicked != null ? (
                      <div className="director-admin-email-stat">
                        <span className="director-admin-email-stat-value">{selected.stats.webhook.clicked}</span>
                        <span className="director-admin-email-stat-label">Clicked</span>
                      </div>
                    ) : null}
                    {selected.stats.webhook.openRate != null ? (
                      <div className="director-admin-email-stat">
                        <span className="director-admin-email-stat-value">{formatPercent(selected.stats.webhook.openRate)}</span>
                        <span className="director-admin-email-stat-label">Open Rate</span>
                      </div>
                    ) : null}
                    {selected.stats.webhook.clickRate != null ? (
                      <div className="director-admin-email-stat">
                        <span className="director-admin-email-stat-value">{formatPercent(selected.stats.webhook.clickRate)}</span>
                        <span className="director-admin-email-stat-label">Click Rate</span>
                      </div>
                    ) : null}
                  </>
                ) : null}
              </div>
            ) : null}

            {/* Rendered HTML body preview */}
            <div
              className="director-admin-email-body-preview"
              dangerouslySetInnerHTML={{ __html: selected.body || "" }}
            />
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

      {/* Cancel scheduled confirmation */}
      <ModalConfirm
        open={Boolean(cancelTarget)}
        title="Cancel Scheduled Email?"
        description={cancelTarget ? `Cancel the scheduled email "${cancelTarget.subject}"? This cannot be undone.` : ""}
        confirmLabel="Cancel Email"
        cancelLabel="Keep Scheduled"
        tone="danger"
        busy={canceling}
        onConfirm={cancelScheduled}
        onCancel={() => setCancelTarget(null)}
      />
    </Card>
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
    row: "bottom",
    fullWidth: true
  }
};

export function DirectorAdminFeaturesPage() {
  const { slug, request } = useAdminApi();
  const { tenant } = useTenant();
  const [payload, setPayload] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [moduleDisplayNames, setModuleDisplayNames] = useState({ newsletter: "Newsletter" });
  const demoAccessEnabled = Boolean(tenant?.accessSettings?.demoAccessEnabled);

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

  function renderModuleCard(module) {
    const hint = MODULE_LAYOUT_HINTS[String(module?.key || "").trim()] || null;
    return (
      <article
        key={module.key}
        className={`director-admin-module-card ${module.enabled ? "is-enabled" : ""} ${module.locked ? "is-locked" : ""} ${
          hint?.fullWidth ? "is-full-width" : ""
        }`.trim()}
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
            {payload?.tenant?.planTier === "base" && !demoAccessEnabled ? (
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
        {orderedModules.map((module) => renderModuleCard(module))}
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
  const catalogPlans = Array.isArray(payload?.catalog?.plans) ? payload.catalog.plans : [];
  const catalogPlansByCode = new Map(
    catalogPlans
      .map((plan) => [String(plan?.code || "").trim().toLowerCase(), plan])
      .filter(([code]) => Boolean(code))
  );
  const visibleTierDefinitions = BILLING_TIER_DEFINITIONS.filter((tier) =>
    catalogPlansByCode.has(tier.code)
  );
  const selectedPlan = catalogPlansByCode.get(String(selectedPlanCode || "").trim().toLowerCase()) || null;
  const selectedPlanIsAvailable = Boolean(selectedPlan);
  const memberUsagePercent = Math.min(100, Math.max(0, Number(usage.memberUsagePercent || 0)));
  const memberUsageLabel = usage.memberLimit
    ? `${usage.members || 0} / ${usage.memberLimit}`
    : `${usage.members || 0} (unlimited)`;

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

      <Card className="director-admin-billing-overview">
        <AdminPageHeader
          title="Billing"
          subtitle="Manage your plan, payment status, and launch readiness."
          actions={<Button variant="secondary" onClick={loadBilling}>Refresh</Button>}
        />
        {error ? <p className="error-text">{error}</p> : null}
        {status ? <p className="success-text">{status}</p> : null}

        <div className="director-admin-billing-metrics">
          <div className="director-admin-billing-metric">
            <span>Current Plan</span>
            <strong>{billingPlanLabel(currentPlanCode)}</strong>
            <small>{catalogPlansByCode.get(currentPlanCode)?.label || "Selected tenant billing tier"}</small>
          </div>
          <div className="director-admin-billing-metric">
            <span>Billing Status</span>
            <strong>
              <span className={`director-admin-status-badge tone-${statusTone(tenant.billingStatus)}`.trim()}>
                {String(tenant.billingStatus || "trialing").replace(/_/g, " ")}
              </span>
            </strong>
            <small>Lifecycle: {tenant.billingLifecycleStatus || "uninitialized"}</small>
          </div>
          <div className="director-admin-billing-metric">
            <span>Onboarding Fee</span>
            <strong>{formatMoney(tenant.onboardingFeeAmount)}</strong>
            <small>
              {tenant.onboardingFeeStatus || (tenant.onboardingFeePaid ? "paid" : "unpaid")}
            </small>
          </div>
          <div className="director-admin-billing-metric">
            <span>Member Usage</span>
            <strong>{memberUsageLabel}</strong>
            <small>{payload?.billing?.launchReady ? "Launch ready" : "Not launch ready"}</small>
          </div>
        </div>

        {usage.memberLimit ? (
          <div className="director-admin-billing-usage">
            <div className="director-admin-progress">
              <span style={{ width: `${memberUsagePercent}%` }} />
            </div>
            <small>{memberUsagePercent}% of member limit used</small>
          </div>
        ) : null}

        <div className="inline-actions">
          {payload?.manageBillingUrl ? (
            <a className="link-button" href={payload.manageBillingUrl} target="_blank" rel="noreferrer">
              Manage Billing Portal
            </a>
          ) : (
            <Button variant="secondary" disabled>
              Billing Portal Unavailable
            </Button>
          )}
        </div>
      </Card>

      <Card className="director-admin-billing-plans">
        <div className="director-admin-billing-plan-head">
          <h2 className="pb-section-title">Choose Your Plan</h2>
          <p className="muted">Available tiers are shown below for this network.</p>
        </div>

        <div className="director-admin-billing-tier-grid">
          {visibleTierDefinitions.map((tier) => {
            const plan = catalogPlansByCode.get(tier.code) || null;
            const isCurrent = currentPlanCode === tier.code;
            const isSelected = selectedPlanCode === tier.code;
            const isUnavailable = !plan;
            const foundersAvailability = tier.code === "founders" ? payload?.foundersAvailability : null;

            return (
              <article
                key={tier.code}
                className={[
                  "director-admin-billing-tier-card",
                  isCurrent ? "is-current" : "",
                  isSelected ? "is-selected" : "",
                  isUnavailable ? "is-disabled" : ""
                ].filter(Boolean).join(" ")}
              >
                <div className="director-admin-billing-tier-top">
                  <h3>{tier.title}</h3>
                  <div className="director-admin-billing-tier-badges">
                    {isCurrent ? <span className="director-admin-billing-tier-badge">Current</span> : null}
                    {isSelected && !isCurrent ? (
                      <span className="director-admin-billing-tier-badge is-selected">Selected</span>
                    ) : null}
                  </div>
                </div>
                <p className="muted">{tier.subtitle}</p>
                <p className="director-admin-billing-tier-price">
                  {plan ? `${formatMoney(plan.annualAmount)}/year` : "Not currently available"}
                </p>
                <p className="director-admin-billing-tier-detail">
                  {plan
                    ? plan.onboardingFeeAmount > 0
                      ? `${formatMoney(plan.onboardingFeeAmount)} onboarding fee`
                      : "No onboarding fee"
                    : "Contact support to enable this tier for your tenant."}
                </p>
                {foundersAvailability ? (
                  <p className="director-admin-billing-tier-detail">
                    {foundersAvailability.remaining} founders slots remaining
                  </p>
                ) : null}
                <Button
                  type="button"
                  variant={isSelected ? "primary" : "secondary"}
                  onClick={() => setSelectedPlanCode(tier.code)}
                  disabled={isUnavailable}
                >
                  {isSelected ? "Selected Plan" : "Select Plan"}
                </Button>
              </article>
            );
          })}
        </div>

        <div className="director-admin-billing-checkout-row">
          <div>
            <p className="director-admin-billing-checkout-title">
              {selectedPlan ? `Ready to checkout: ${selectedPlan.label}` : "Select a plan to continue"}
            </p>
            {selectedPlan ? (
              <p className="muted">
                {selectedPlanCode === currentPlanCode
                  ? "You are checking out on your current tier."
                  : "This will switch your tenant billing tier at checkout."}
              </p>
            ) : null}
          </div>
          <div className="inline-actions">
            <Button onClick={startCheckout} disabled={startingCheckout || !selectedPlanIsAvailable}>
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
        </div>
      </Card>

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
      const currentBrandPrimary = normalizeBrandHex(payload?.branding?.brandPrimary, DEFAULT_BRAND_PRIMARY);
      const brandColorChanged = currentBrandPrimary !== payloadToSave.brandPrimary;
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
      const previewDataUrl = await fileToDataUrl(file);
      setForm((prev) => ({ ...prev, [field]: previewDataUrl }));
      if (field === "logoUrl") {
        setPendingLogoFile(file);
        setPendingLogoPreviewUrl(previewDataUrl);
      } else {
        setPendingHeroFile(file);
        setPendingHeroPreviewUrl(previewDataUrl);
      }
      setStatus("Image preview updated. Click Save Branding to publish this change.");
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

export function DirectorAdminSettingsAccessPage() {
  const { request } = useAdminApi();
  const { payload, loading, error, load } = useSettingsLoader();
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [form, setForm] = useState({
    signupMode: "open",
    accessCode: "",
    mobileAppCode: "",
    allowedEmailDomains: "",
    requireProfileCompletion: false
  });

  useEffect(() => {
    if (!payload?.access) return;
    setForm({
      signupMode: payload.access.signupMode || "open",
      accessCode: "",
      mobileAppCode: payload.access.mobileAppCode || "",
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
          Mobile App Code
          <Input
            value={form.mobileAppCode}
            readOnly
            spellCheck={false}
            placeholder="Generating..."
          />
          <small className="muted">
            {payload?.access?.hasMobileAppCode
              ? `Auto-generated code for the iPhone app. Camp members type this code to reach your camp login. Last updated: ${payload.access.mobileAppCodeHint || "Configured"}`
              : "This code is generated automatically for your iPhone app and will appear here once ready."}
          </small>
        </label>
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
  const debouncedQuery = useDebouncedValue(query, 220);
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
    const term = String(debouncedQuery || "").trim();
    if (!term) {
      setResults([]);
      setSearching(false);
      return undefined;
    }
    let active = true;
    setSearching(true);
    request(`/settings/admins/search?q=${encodeURIComponent(term)}&limit=8`)
      .then((response) => {
        if (!active) return;
        setResults(Array.isArray(response?.items) ? response.items : []);
      })
      .catch((requestError) => {
        if (!active) return;
        setResults([]);
        setError(requestError.message || "Failed to search members.");
      })
      .finally(() => {
        if (active) setSearching(false);
      });

    return () => {
      active = false;
    };
  }, [debouncedQuery, request]);

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
  const [history, setHistory] = useState([]);
  const [sending, setSending] = useState(false);
  const [form, setForm] = useState({
    mobileEnabled: true,
    pushEnabled: true,
    inboxEnabled: true,
    soundEnabled: true,
    newMemberJoined: true,
    approvalRequests: true,
    memberFlagged: true,
    weeklySummary: false,
    eventPublished: true,
    eventCanceled: true,
    newsletterPublished: true,
    customBroadcasts: true
  });
  const [sendForm, setSendForm] = useState({
    audience: "all_active_members",
    category: "announcements",
    title: "",
    body: "",
    deepLink: "",
    pushRequested: true
  });

  useEffect(() => {
    if (!payload?.notifications) return;
    setForm({
      mobileEnabled: Boolean(payload.notifications.mobileEnabled),
      pushEnabled: Boolean(payload.notifications.pushEnabled),
      inboxEnabled: Boolean(payload.notifications.inboxEnabled),
      soundEnabled: Boolean(payload.notifications.soundEnabled),
      newMemberJoined: Boolean(payload.notifications.newMemberJoined),
      approvalRequests: Boolean(payload.notifications.approvalRequests),
      memberFlagged: Boolean(payload.notifications.memberFlagged),
      weeklySummary: Boolean(payload.notifications.weeklySummary),
      eventPublished: Boolean(payload.notifications.eventPublished),
      eventCanceled: Boolean(payload.notifications.eventCanceled),
      newsletterPublished: Boolean(payload.notifications.newsletterPublished),
      customBroadcasts: Boolean(payload.notifications.customBroadcasts)
    });
  }, [payload?.notifications]);

  const loadHistory = useCallback(async () => {
    try {
      const response = await request("/notifications/history");
      setHistory(Array.isArray(response?.items) ? response.items : []);
    } catch {
      setHistory([]);
    }
  }, [request]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

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

  async function sendMobileNotification(event) {
    event.preventDefault();
    setSending(true);
    setStatus("");
    try {
      const response = await request("/notifications/send", {
        method: "POST",
        body: sendForm
      });
      setStatus(`Mobile notification sent to ${response?.totalRecipients || 0} recipients.`);
      setSendForm({
        audience: sendForm.audience,
        category: sendForm.category,
        title: "",
        body: "",
        deepLink: sendForm.deepLink,
        pushRequested: sendForm.pushRequested
      });
      await loadHistory();
    } finally {
      setSending(false);
    }
  }

  if (loading && !payload) return <Card><p className="muted">Loading settings...</p></Card>;

  return (
    <div className="director-admin-stack">
      <Card>
        <h2 className="pb-section-title">Mobile Notification Controls</h2>
        <p className="muted">These settings drive the mobile inbox and push alerts in the iPhone app.</p>
        {error ? <p className="error-text">{error}</p> : null}
        {status ? <p className="success-text">{status}</p> : null}
        <form className="director-admin-form-grid" onSubmit={saveNotifications}>
          {[
            ["mobileEnabled", "Enable mobile notifications"],
            ["pushEnabled", "Allow push delivery"],
            ["inboxEnabled", "Keep a mobile inbox"],
            ["soundEnabled", "Play push sound"],
            ["newMemberJoined", "Notify admins when new members join"],
            ["approvalRequests", "Notify admins about approval requests"],
            ["memberFlagged", "Notify admins when a member is flagged"],
            ["eventPublished", "Notify members when events are published"],
            ["eventCanceled", "Notify members when events are canceled"],
            ["newsletterPublished", "Notify members when newsletters are published"],
            ["customBroadcasts", "Allow directors to send custom mobile notifications"],
            ["weeklySummary", "Reserve weekly summary slot"]
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
              {saving ? "Saving..." : "Save Mobile Settings"}
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        <h2 className="pb-section-title">Send Custom Mobile Notification</h2>
        <form className="director-admin-form-grid" onSubmit={sendMobileNotification}>
          <label className="full-width">
            Audience
            <Select
              value={sendForm.audience}
              onChange={(event) => setSendForm((prev) => ({ ...prev, audience: event.target.value }))}
            >
              <option value="all_active_members">All Active Members</option>
              <option value="admins">Admins Only</option>
              <option value="all_users">Everyone</option>
              <option value="flagged_members">Flagged Members</option>
              <option value="pending_members">Pending Members</option>
            </Select>
          </label>
          <label className="full-width">
            Category
            <Select
              value={sendForm.category}
              onChange={(event) => setSendForm((prev) => ({ ...prev, category: event.target.value }))}
            >
              <option value="announcements">Announcements</option>
              <option value="events">Events</option>
              <option value="community">Community</option>
              <option value="account">Account</option>
              <option value="admin">Admin</option>
            </Select>
          </label>
          <label className="full-width">
            Title
            <Input
              value={sendForm.title}
              onChange={(event) => setSendForm((prev) => ({ ...prev, title: event.target.value }))}
              maxLength={120}
            />
          </label>
          <label className="full-width">
            Body
            <Textarea
              value={sendForm.body}
              onChange={(event) => setSendForm((prev) => ({ ...prev, body: event.target.value }))}
              rows={4}
              maxLength={500}
            />
          </label>
          <label className="full-width">
            Deep Link
            <Input
              value={sendForm.deepLink}
              onChange={(event) => setSendForm((prev) => ({ ...prev, deepLink: event.target.value }))}
              placeholder="/events or /notifications"
            />
          </label>
          <label className="director-admin-inline-check full-width">
            <input
              type="checkbox"
              checked={Boolean(sendForm.pushRequested)}
              onChange={(event) => setSendForm((prev) => ({ ...prev, pushRequested: event.target.checked }))}
            />
            <span>Deliver as push notification too</span>
          </label>
          <div className="director-admin-form-actions full-width">
            <Button type="submit" disabled={sending}>
              {sending ? "Sending..." : "Send Mobile Notification"}
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        <h2 className="pb-section-title">Recent Mobile Sends</h2>
        {!history.length ? (
          <p className="muted">No mobile notification batches yet.</p>
        ) : (
          <div className="director-admin-table-wrap">
            <table className="director-admin-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Category</th>
                  <th>Recipients</th>
                  <th>Delivered</th>
                  <th>Unread</th>
                  <th>Sent</th>
                </tr>
              </thead>
              <tbody>
                {history.map((item) => (
                  <tr key={item.id}>
                    <td>{item.title}</td>
                    <td>{item.category}</td>
                    <td>{item.totalRecipients}</td>
                    <td>{item.pushDelivered}</td>
                    <td>{item.unreadCount}</td>
                    <td>{formatDateTime(item.createdAt)}</td>
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
