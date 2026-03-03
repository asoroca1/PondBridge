import { Router } from "express";
import crypto from "crypto";
import multer from "multer";
import rateLimit from "express-rate-limit";
import PDFDocument from "pdfkit";
import { stringify } from "csv-stringify/sync";
import { parse as parseCsv } from "csv-parse/sync";
import { listFeaturesForPlan, hasFeature } from "@pondbridge/shared";
import { requireTenantRoleScope } from "../middleware/tenantAccess.js";
import { requireFeature } from "../middleware/requireFeature.js";
import {
  ProfileModel,
  TenantModel,
  UserModel,
  InviteModel,
  AccessRequestModel,
  AnalyticsEventModel,
  EmailBroadcastModel,
  ImportReportModel,
  MagicLinkTokenModel,
  ConversationModel,
  MessageModel,
  ForumModel,
  ForumPostModel,
  PhotoModel,
  FamilyTreeModel,
  TenantAdminAuditLogModel,
  ResumeParseResultModel,
  ActivityItemModel
} from "../db/models/index.js";
import { findImportReportForTenant } from "../services/csvImport.js";
import { env } from "../config/env.js";
import {
  sendBulkTransactionalEmail,
  sendInviteEmail,
  sendTransactionalEmail,
  sendAccessDecisionEmail
} from "../services/email.js";
import { getTenantAnalyticsSnapshot } from "../services/analytics.js";
import { createInviteRecord } from "../services/invites.js";
import {
  buildSettingsStorePayload,
  resolveDraft,
  resolveTheme,
  resolveContent,
  resolveModules,
  normalizeSignupMode,
  resolveSettings
} from "../services/onboarding.js";
import {
  buildBillingPublicSnapshot,
  createBillingPortalUrl,
  createTenantCheckoutSession,
  getBillingCatalog,
  getBillingMode,
  getFoundersAvailability
} from "../services/billing.js";
import { normalizeBillingPlan } from "../services/billingState.js";
import { hashPassword } from "../utils/auth.js";
import { sanitizeText, sanitizeHtmlContent } from "../utils/sanitize.js";
import { buildTenantUrls } from "../utils/domainProvisioning.js";
import {
  canonicalizeCityName,
  canonicalizeCountryName,
  composeCityState,
  parseCityStateDetailed
} from "../utils/location.js";

const router = Router({ mergeParams: true });
const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const isCsv =
      file.mimetype.includes("csv") || file.originalname.toLowerCase().endsWith(".csv");

    if (!isCsv) {
      const error = new Error("CSV file required");
      error.statusCode = 400;
      error.code = "CSV_REQUIRED";
      return cb(error);
    }

    return cb(null, true);
  }
});
const inviteUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const isCsv =
      file.mimetype.includes("csv") || file.originalname.toLowerCase().endsWith(".csv");
    if (!isCsv) {
      const error = new Error("CSV file required");
      error.statusCode = 400;
      error.code = "CSV_REQUIRED";
      return cb(error);
    }
    return cb(null, true);
  }
});
const emailSendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 24,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: "RATE_LIMITED",
      message: "Too many email sends. Please wait before trying again."
    }
  }
});
const inviteSendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) =>
    [
      "admin-invite",
      String(req.params?.slug || req.tenant?.slug || ""),
      String(req.user?.id || ""),
      String(req.ip || "")
    ].join(":"),
  message: {
    error: {
      code: "RATE_LIMITED",
      message: "Too many invite operations. Please wait before trying again."
    }
  }
});
const exportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: "RATE_LIMITED",
      message: "Too many export requests. Please wait before exporting again."
    }
  }
});
const VALID_BILLING_PLAN_CODES = new Set(["legacy", "founders", "institutional"]);

function toBoundedInt(value, { min = 0, max = 4, fallback = 1 } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function safeTenant(tenant) {
  if (!tenant) return tenant;
  const next = { ...tenant };
  if (next.settings) {
    const hasAccessCode = Boolean(next.settings.accessCodeHash);
    next.settings = {
      ...next.settings,
      accessCodeHash: undefined,
      hasAccessCode,
      accessCodeHint: next.settings.accessCodeHint || ""
    };
  }
  if (next.accessSettings) {
    next.accessSettings = {
      ...next.accessSettings,
      accessCode: ""
    };
  }
  return next;
}

function normalizeEmail(value = "") {
  return String(value || "").trim().toLowerCase();
}

function isEmail(value = "") {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function normalizeInviteName(value = "") {
  return sanitizeText(String(value || "").trim()).slice(0, 80);
}

function parseInviteRowsFromText(text = "") {
  return String(text || "")
    .split(/[\n,;]+/g)
    .map((entry) => ({
      firstName: "",
      lastName: "",
      email: normalizeEmail(entry)
    }))
    .filter((entry) => Boolean(entry.email));
}

function parseInviteRowsFromRecipientsPayload(rawValue) {
  if (!rawValue) return [];
  let parsedValue = rawValue;
  if (typeof parsedValue === "string") {
    const trimmed = parsedValue.trim();
    if (!trimmed) return [];
    try {
      parsedValue = JSON.parse(trimmed);
    } catch {
      throw new Error("Invalid recipients payload. Provide valid JSON rows.");
    }
  }
  if (!Array.isArray(parsedValue)) return [];

  return parsedValue
    .map((row) => {
      if (typeof row === "string") {
        return { firstName: "", lastName: "", email: normalizeEmail(row) };
      }
      if (!row || typeof row !== "object") return null;
      return {
        firstName: normalizeInviteName(
          row.firstName || row.first_name || row.givenName || row.given_name || ""
        ),
        lastName: normalizeInviteName(
          row.lastName || row.last_name || row.familyName || row.family_name || ""
        ),
        email: normalizeEmail(row.email || row.Email || row.emailAddress || row.email_address || "")
      };
    })
    .filter(Boolean)
    .filter((row) => Boolean(row.email));
}

function parseInviteRowsFromCsv(csvBuffer) {
  if (!csvBuffer) return [];
  const csvText = Buffer.isBuffer(csvBuffer) ? csvBuffer.toString("utf8") : String(csvBuffer);
  const rows = parseCsv(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
    relax_column_count: true
  });

  const inviteRows = [];
  for (const row of rows) {
    const fromEmailHeader = normalizeEmail(
      row.email || row.Email || row["Email Address"] || row["email address"]
    );
    const firstName = normalizeInviteName(
      row.firstName || row["first name"] || row["First Name"] || row.first_name || ""
    );
    const lastName = normalizeInviteName(
      row.lastName || row["last name"] || row["Last Name"] || row.last_name || ""
    );
    if (fromEmailHeader) {
      inviteRows.push({ firstName, lastName, email: fromEmailHeader });
      continue;
    }

    for (const value of Object.values(row || {})) {
      const candidate = normalizeEmail(value);
      if (candidate && isEmail(candidate)) {
        inviteRows.push({ firstName, lastName, email: candidate });
        break;
      }
    }
  }

  return inviteRows;
}

function mergeInviteRows(...groups) {
  const merged = new Map();
  for (const group of groups) {
    for (const row of Array.isArray(group) ? group : []) {
      const email = normalizeEmail(row?.email || "");
      if (!isEmail(email)) continue;
      const firstName = normalizeInviteName(row?.firstName || "");
      const lastName = normalizeInviteName(row?.lastName || "");
      const existing = merged.get(email);
      if (!existing) {
        merged.set(email, { email, firstName, lastName });
        continue;
      }
      merged.set(email, {
        email,
        firstName: existing.firstName || firstName,
        lastName: existing.lastName || lastName
      });
    }
  }
  return [...merged.values()];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DASHBOARD_CHART_DAYS = 30;
const DASHBOARD_SIGNIN_EVENT_TYPES = [
  "auth_login_password",
  "auth_login_magic_link",
  "auth_login_clerk"
];
const DEFAULT_MEMBER_PAGE_SIZE = 25;
const MAX_MEMBER_PAGE_SIZE = 100;
const MODULE_CATALOG = [
  {
    key: "directory",
    label: "Directory",
    description: "Member directory and profile browsing."
  },
  {
    key: "search",
    label: "Advanced Search",
    description: "Search alumni by name, role, location, and industry."
  },
  {
    key: "photoStream",
    label: "Photo Stream",
    description: "Shared gallery for community photos."
  },
  {
    key: "chat",
    label: "Messaging",
    description: "Direct messages and forums."
  },
  {
    key: "map",
    label: "Alumni Map",
    description: "Location map for alumni profiles."
  },
  {
    key: "familyTrees",
    label: "Family Trees",
    description: "Multi-generational camp family trees.",
    requiredFeature: "familyTrees"
  },
  {
    key: "relatedProfiles",
    label: "Related Profiles",
    description: "Recommended member connections."
  },
  {
    key: "newsletter",
    label: "Newsletter",
    description: "Camp announcements and newsletter archive."
  },
  {
    key: "merchShop",
    label: "Merch Shop",
    description: "External camp merch storefront."
  }
];
const MEMBER_EXPORT_FIELDS = [
  {
    key: "profileId",
    label: "Profile ID",
    description: "Internal profile identifier.",
    getValue: (profile) => toObjectIdString(profile?._id)
  },
  {
    key: "firstName",
    label: "First Name",
    description: "Profile first name.",
    getValue: (profile) => String(profile?.firstName || "")
  },
  {
    key: "lastName",
    label: "Last Name",
    description: "Profile last name.",
    getValue: (profile) => String(profile?.lastName || "")
  },
  {
    key: "fullName",
    label: "Full Name",
    description: "Combined first and last name.",
    getValue: (profile) => `${profile?.firstName || ""} ${profile?.lastName || ""}`.trim()
  },
  {
    key: "status",
    label: "Status",
    description: "Member access status.",
    getValue: (profile) => String(profile?.status || "")
  },
  {
    key: "primaryEmail",
    label: "Primary Email",
    description: "First email on the profile.",
    getValue: (profile) => String((profile?.emails || []).find(Boolean) || "")
  },
  {
    key: "allEmails",
    label: "All Emails",
    description: "All profile emails.",
    getValue: (profile) => listToCsvCell(profile?.emails || [])
  },
  {
    key: "primaryPhone",
    label: "Primary Phone",
    description: "First phone on the profile.",
    getValue: (profile) => String((profile?.phones || []).find(Boolean) || "")
  },
  {
    key: "allPhones",
    label: "All Phones",
    description: "All profile phones.",
    getValue: (profile) => listToCsvCell(profile?.phones || [])
  },
  {
    key: "cityState",
    label: "Location",
    description: "City and state/country value.",
    getValue: (profile) => String(profile?.cityState || "")
  },
  {
    key: "roleAtCamp",
    label: "Role At Camp",
    description: "Member's role at camp.",
    getValue: (profile) => String(profile?.roleAtCamp || "")
  },
  {
    key: "industry",
    label: "Industry",
    description: "Industry from profile.",
    getValue: (profile) => String(profile?.industry || "")
  },
  {
    key: "highSchool",
    label: "High School",
    description: "High school field from profile.",
    getValue: (profile) => String(profile?.highSchool || "")
  },
  {
    key: "colleges",
    label: "Colleges",
    description: "College history from profile.",
    getValue: (profile) => listToCsvCell((profile?.colleges || []).map(formatCollegeEntry))
  },
  {
    key: "collegeYears",
    label: "College Years",
    description: "College graduation/class years.",
    getValue: (profile) => listToCsvCell(profile?.collegeYears || [])
  },
  {
    key: "currentCompany",
    label: "Current Company",
    description: "Current company from first job entry.",
    getValue: (profile) => String(resolveJobEntry(profile?.currentJobs || [])?.company || "")
  },
  {
    key: "currentTitle",
    label: "Current Title",
    description: "Current title from first job entry.",
    getValue: (profile) => String(resolveJobEntry(profile?.currentJobs || [])?.title || "")
  },
  {
    key: "currentJobs",
    label: "Current Jobs",
    description: "All current job entries.",
    getValue: (profile) => listToCsvCell((profile?.currentJobs || []).map(formatJobEntry))
  },
  {
    key: "bio",
    label: "Bio",
    description: "Profile bio text.",
    getValue: (profile) => String(profile?.bio || "")
  },
  {
    key: "joinDate",
    label: "Join Date",
    description: "Profile creation date (ISO).",
    getValue: (profile) => toIso(profile?.createdAt)
  },
  {
    key: "updatedAt",
    label: "Last Updated",
    description: "Profile last update timestamp (ISO).",
    getValue: (profile) => toIso(profile?.updatedAt)
  }
];
const MEMBER_EXPORT_DEFAULT_FIELDS = [
  "firstName",
  "lastName",
  "primaryEmail",
  "primaryPhone",
  "cityState",
  "roleAtCamp",
  "industry"
];
const MEMBER_EXPORT_FIELD_MAP = new Map(MEMBER_EXPORT_FIELDS.map((field) => [field.key, field]));

function escapeRegex(value = "") {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sanitizeCsvCell(value = "") {
  return sanitizeText(String(value || "").trim());
}

function listToCsvCell(values = []) {
  return (Array.isArray(values) ? values : [])
    .map((item) => sanitizeCsvCell(item))
    .filter(Boolean)
    .join(" | ");
}

function formatCollegeEntry(entry) {
  if (!entry) return "";
  if (typeof entry === "string") return sanitizeCsvCell(entry);
  const name = sanitizeCsvCell(entry.name || entry.college || entry.school || "");
  const gradYear = sanitizeCsvCell(entry.gradYear || entry.year || "");
  if (name && gradYear) return `${name} (${gradYear})`;
  return name || gradYear;
}

function resolveJobEntry(currentJobs = []) {
  if (!Array.isArray(currentJobs) || currentJobs.length === 0) return null;
  const first = currentJobs[0];
  if (!first) return null;
  if (typeof first === "string") {
    return {
      title: sanitizeCsvCell(first),
      company: ""
    };
  }
  return {
    title: sanitizeCsvCell(first.title || first.role || ""),
    company: sanitizeCsvCell(first.company || first.org || "")
  };
}

function formatJobEntry(entry) {
  if (!entry) return "";
  if (typeof entry === "string") return sanitizeCsvCell(entry);
  const title = sanitizeCsvCell(entry.title || entry.role || "");
  const company = sanitizeCsvCell(entry.company || entry.org || "");
  if (title && company) return `${title} @ ${company}`;
  return title || company;
}

function normalizeMemberExportFieldOrder(input = "") {
  const requested = String(input || "")
    .split(",")
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const unique = [];
  for (const key of requested) {
    if (!MEMBER_EXPORT_FIELD_MAP.has(key)) continue;
    if (unique.includes(key)) continue;
    unique.push(key);
  }
  if (unique.length > 0) return unique;
  return MEMBER_EXPORT_DEFAULT_FIELDS.filter((key) => MEMBER_EXPORT_FIELD_MAP.has(key));
}

function toObjectIdString(value) {
  return value ? String(value) : "";
}

function toIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function utcDayStart(value = new Date()) {
  const date = new Date(value);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function utcDayKey(value) {
  if (!value) return "";
  const date = utcDayStart(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function utcDayLabel(dayKey = "") {
  if (!dayKey) return "";
  const date = new Date(`${dayKey}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return dayKey;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function buildDailyCountSeries({ startDate, days = DASHBOARD_CHART_DAYS, values = [] }) {
  const normalizedDays = Math.max(1, Number(days || 0));
  const start = utcDayStart(startDate);
  const buckets = [];
  const counts = new Map();

  for (let index = 0; index < normalizedDays; index += 1) {
    const day = new Date(start.getTime() + index * DAY_MS);
    const key = utcDayKey(day);
    buckets.push({
      date: key,
      label: utcDayLabel(key),
      value: 0
    });
    counts.set(key, 0);
  }

  for (const entry of values) {
    const key = utcDayKey(entry);
    if (!key || !counts.has(key)) continue;
    counts.set(key, Number(counts.get(key) || 0) + 1);
  }

  return buckets.map((bucket) => ({
    ...bucket,
    value: Number(counts.get(bucket.date) || 0)
  }));
}

async function writeAdminAudit(req, event, metadata = {}) {
  if (!req?.tenant?._id) return;
  try {
    await TenantAdminAuditLogModel.create({
      tenantId: req.tenant._id,
      actorUserId: req.user?.id || null,
      event,
      metadata: {
        route: String(req.originalUrl || req.path || ""),
        method: String(req.method || "").toUpperCase(),
        ...metadata
      }
    });
  } catch {
    // Never fail an admin operation because audit logging failed.
  }
}

function completionScore(profile = {}, user = null) {
  const hasEmail =
    (Array.isArray(profile?.emails) && profile.emails.some(Boolean)) || Boolean(user?.email);
  const checks = [
    Boolean(profile?.firstName),
    Boolean(profile?.lastName),
    hasEmail,
    Array.isArray(profile?.phones) && profile.phones.some(Boolean),
    Boolean(profile?.cityState),
    Boolean(profile?.roleAtCamp),
    Boolean(profile?.highSchool),
    Array.isArray(profile?.colleges) && profile.colleges.some(Boolean),
    Array.isArray(profile?.currentJobs) && profile.currentJobs.length > 0,
    Boolean(profile?.bio)
  ];

  const filled = checks.filter(Boolean).length;
  return Math.round((filled / checks.length) * 100);
}

function completionBucket(score = 0) {
  const value = Number(score || 0);
  if (value < 40) return "low";
  if (value < 80) return "medium";
  return "high";
}

function normalizeRoleLabel(roleAtCamp = "") {
  const normalized = String(roleAtCamp || "").trim();
  if (!normalized) return "Member";
  return normalized;
}

function normalizeLocationLabel(cityState = "") {
  const parsed = parseCityStateDetailed(String(cityState || "").trim());
  return composeCityState(parsed);
}

function splitRoleValues(roleAtCamp = "") {
  const source = Array.isArray(roleAtCamp) ? roleAtCamp : [roleAtCamp];
  return source
    .flatMap((entry) => String(entry || "").split(/[,;|]+/g))
    .map((entry) => sanitizeText(String(entry || "").trim()))
    .filter(Boolean);
}

function topCountBuckets(values = [], limit = 5) {
  const counts = new Map();
  for (const value of values) {
    const label = String(value || "").trim();
    if (!label) continue;
    counts.set(label, Number(counts.get(label) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => {
      const delta = Number(right[1] || 0) - Number(left[1] || 0);
      if (delta !== 0) return delta;
      return left[0].localeCompare(right[0]);
    })
    .slice(0, Math.max(1, Number(limit || 0)))
    .map(([label, count]) => ({ label, count: Number(count || 0) }));
}

function hasDirectorRole(roles = []) {
  const roleSet = new Set((Array.isArray(roles) ? roles : [roles]).map((role) => String(role || "").trim()));
  return roleSet.has("tenant_admin") || roleSet.has("super_admin") || roleSet.has("admin");
}

function resolveAccountRoleLabel(user = null, directorUserId = "") {
  if (!hasDirectorRole(user?.roles || [])) return "";
  const memberUserId = toObjectIdString(user?._id || user?.id);
  if (directorUserId && memberUserId && memberUserId === directorUserId) {
    return "Director";
  }
  return "Admin";
}

async function resolveDirectorUserId(tenant = null) {
  if (!tenant?._id) return "";
  const draftDirectorUserId = toObjectIdString(tenant?.onboardingDraft?.directorLegalAgreement?.acceptedByUserId);
  const liveDirectorUserId = toObjectIdString(tenant?.directorLegalAgreement?.acceptedByUserId);
  const candidate = draftDirectorUserId || liveDirectorUserId;
  if (candidate) {
    const matchingDirector = await UserModel.find(tenant._id, {
      _id: candidate,
      roles: { $contains: ["tenant_admin"] }
    }, {
      select: ["id"],
      limit: 1
    });
    if (matchingDirector.length > 0) return candidate;
  }

  const admins = await UserModel.find(tenant._id, { roles: { $contains: ["tenant_admin"] } }, {
    select: ["id"],
    sort: { createdAt: 1 },
    limit: 1
  });
  return toObjectIdString(admins?.[0]?._id || admins?.[0]?.id);
}

function mapMemberRow(profile = {}, user = null, { directorUserId = "" } = {}) {
  const score = completionScore(profile, user);
  const email = profile?.emails?.find(Boolean) || user?.email || "";
  const accountRoleLabel = resolveAccountRoleLabel(user, directorUserId);
  return {
    id: toObjectIdString(profile._id),
    userId: toObjectIdString(profile.userId),
    firstName: profile.firstName || "",
    lastName: profile.lastName || "",
    fullName: `${profile.firstName || ""} ${profile.lastName || ""}`.trim(),
    email,
    avatarUrl: profile.avatarUrl || "",
    role: accountRoleLabel || normalizeRoleLabel(profile.roleAtCamp || ""),
    yearsAtCamp: Array.isArray(profile.collegeYears) ? profile.collegeYears : [],
    location: profile.cityState || "",
    completionScore: score,
    completionBucket: completionBucket(score),
    joinDate: toIso(profile.createdAt),
    lastActiveAt: toIso(user?.lastLoginAt),
    status: profile.status || (user?.status === "inactive" ? "removed" : "active"),
    flaggedReason: profile.flaggedReason || "",
    phone: profile?.phones?.find(Boolean) || "",
    bio: profile?.bio || ""
  };
}

function parseIds(input) {
  if (!Array.isArray(input)) return [];
  return [...new Set(
    input
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  )];
}

function uniqueIdStrings(values = []) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  )];
}

async function collectIdsForFilters(model, tenantId, filters = []) {
  const ids = new Set();
  for (const filter of filters) {
    if (!filter || typeof filter !== "object" || Object.keys(filter).length === 0) continue;
    const rows = await model.find(tenantId, filter, { select: ["id"] });
    for (const row of rows) {
      const id = toObjectIdString(row?._id || row?.id);
      if (id) ids.add(id);
    }
  }
  return [...ids];
}

function sanitizeConversationMembers(members = [], removedUserId = "") {
  return asArray(members).filter(
    (entry) => String(entry?.userId || "").trim() !== String(removedUserId || "").trim()
  );
}

function sanitizeConversationReadBy(readBy = [], removedUserId = "") {
  return asArray(readBy).filter(
    (entry) => String(entry?.userId || "").trim() !== String(removedUserId || "").trim()
  );
}

async function deleteMemberFromTenant({
  tenantId,
  userId,
  profileId,
  email = ""
}) {
  const summary = {
    profileDeleted: 0,
    userDeleted: 0,
    messagesDeleted: 0,
    conversationsDeleted: 0,
    conversationsUpdated: 0,
    forumPostsDeleted: 0,
    forumsDeleted: 0,
    forumsUpdated: 0,
    photosDeleted: 0,
    photosUpdated: 0,
    photoLikesRemoved: 0,
    photoCommentsRemoved: 0,
    familyTreesDeleted: 0,
    familyTreesUpdated: 0,
    activityItemsDeleted: 0,
    analyticsEventsDeleted: 0,
    magicLinkTokensDeleted: 0,
    invitesDeleted: 0,
    accessRequestsDeleted: 0,
    adminAuditLogsDeleted: 0,
    resumeParseResultsDeleted: 0
  };

  const safeUserId = String(userId || "").trim();
  const safeProfileId = String(profileId || "").trim();
  const safeEmail = normalizeEmail(email);

  // 1) Remove authored messages first.
  const authoredMessageCount = await MessageModel.count(tenantId, { senderId: safeUserId });
  if (authoredMessageCount > 0) {
    await MessageModel.deleteMany(tenantId, { senderId: safeUserId });
    summary.messagesDeleted += authoredMessageCount;
  }

  // 2) Remove/update conversations where this user participated.
  const conversations = await ConversationModel.find(tenantId, {
    participantIds: { $contains: [safeUserId] }
  });
  for (const conversation of conversations) {
    const currentParticipants = uniqueIdStrings(conversation.participantIds || []);
    const nextParticipants = currentParticipants.filter((entry) => entry !== safeUserId);
    const nextMembers = sanitizeConversationMembers(conversation.members, safeUserId);
    const nextReadBy = sanitizeConversationReadBy(conversation.readBy, safeUserId);
    const shouldDeleteConversation = nextParticipants.length < 2;

    if (shouldDeleteConversation) {
      const remainingConversationMessages = await MessageModel.count(tenantId, {
        conversationId: toObjectIdString(conversation._id)
      });
      if (remainingConversationMessages > 0) {
        await MessageModel.deleteMany(tenantId, { conversationId: toObjectIdString(conversation._id) });
        summary.messagesDeleted += remainingConversationMessages;
      }
      await ConversationModel.delete(conversation._id);
      summary.conversationsDeleted += 1;
      continue;
    }

    const latestMessages = await MessageModel.find(
      tenantId,
      { conversationId: toObjectIdString(conversation._id), deletedAt: null },
      { sort: { createdAt: -1 }, limit: 1 }
    );
    const latestMessage = latestMessages[0] || null;
    const existingCreatedBy = String(conversation.createdBy || "").trim();
    const nextCreatedBy = nextParticipants.includes(existingCreatedBy)
      ? existingCreatedBy
      : nextParticipants[0];
    const nextLastMessageAt =
      latestMessage?.createdAt || conversation?.createdAt || new Date().toISOString();

    await ConversationModel.update(conversation._id, {
      participantIds: nextParticipants,
      members: nextMembers,
      readBy: nextReadBy,
      createdBy: nextCreatedBy,
      lastMessageAt: nextLastMessageAt,
      lastMessage: latestMessage
        ? {
            senderId: latestMessage.senderId,
            kind: latestMessage.kind,
            text:
              latestMessage.kind === "text"
                ? latestMessage.text || ""
                : latestMessage.kind === "image"
                ? "Photo"
                : "File attachment",
            media: latestMessage.kind !== "text" ? latestMessage.media || null : null,
            createdAt: latestMessage.createdAt || nextLastMessageAt
          }
        : null
    });
    summary.conversationsUpdated += 1;
  }

  // 3) Remove authored forum posts.
  const authoredForumPostCount = await ForumPostModel.count(tenantId, { authorId: safeUserId });
  if (authoredForumPostCount > 0) {
    await ForumPostModel.deleteMany(tenantId, { authorId: safeUserId });
    summary.forumPostsDeleted += authoredForumPostCount;
  }

  // 4) Remove/update forums where this user appears as member/moderator/creator.
  const [memberForums, moderatorForums, creatorForums] = await Promise.all([
    ForumModel.find(tenantId, { memberIds: { $contains: [safeUserId] } }),
    ForumModel.find(tenantId, { moderators: { $contains: [safeUserId] } }),
    ForumModel.find(tenantId, { creatorId: safeUserId })
  ]);
  const touchedForums = new Map();
  [...memberForums, ...moderatorForums, ...creatorForums].forEach((forum) => {
    const id = toObjectIdString(forum?._id || forum?.id);
    if (id) touchedForums.set(id, forum);
  });

  for (const forum of touchedForums.values()) {
    const nextMemberIds = uniqueIdStrings(forum.memberIds || []).filter((entry) => entry !== safeUserId);
    let nextModerators = uniqueIdStrings(forum.moderators || []).filter((entry) => entry !== safeUserId);
    if (nextMemberIds.length === 0) {
      const remainingForumPostCount = await ForumPostModel.count(tenantId, {
        forumId: toObjectIdString(forum._id)
      });
      if (remainingForumPostCount > 0) {
        await ForumPostModel.deleteMany(tenantId, { forumId: toObjectIdString(forum._id) });
        summary.forumPostsDeleted += remainingForumPostCount;
      }
      await ForumModel.delete(forum._id);
      summary.forumsDeleted += 1;
      continue;
    }

    let nextCreatorId = String(forum.creatorId || forum.createdBy || "").trim();
    if (!nextCreatorId || nextCreatorId === safeUserId || !nextMemberIds.includes(nextCreatorId)) {
      nextCreatorId = nextModerators[0] || nextMemberIds[0];
    }
    if (!nextModerators.includes(nextCreatorId)) {
      nextModerators = uniqueIdStrings([nextCreatorId, ...nextModerators]);
    }

    const livePostsCount = await ForumPostModel.count(tenantId, {
      forumId: toObjectIdString(forum._id),
      deletedAt: null
    });
    const latestForumPosts = await ForumPostModel.find(
      tenantId,
      { forumId: toObjectIdString(forum._id), deletedAt: null },
      { sort: { createdAt: -1 }, limit: 1 }
    );
    await ForumModel.update(forum._id, {
      memberIds: nextMemberIds,
      moderators: nextModerators,
      creatorId: nextCreatorId,
      createdBy: nextCreatorId,
      postsCount: livePostsCount,
      lastActivityAt: latestForumPosts[0]?.createdAt || forum.lastActivityAt || new Date().toISOString()
    });
    summary.forumsUpdated += 1;
  }

  // 5) Remove photos owned by this user.
  const ownedPhotoCount = await PhotoModel.count(tenantId, { ownerId: safeUserId });
  if (ownedPhotoCount > 0) {
    await PhotoModel.deleteMany(tenantId, { ownerId: safeUserId });
    summary.photosDeleted += ownedPhotoCount;
  }

  // 6) Strip likes/comments left by this user from remaining photos.
  const remainingPhotos = await PhotoModel.find(tenantId, {}, {
    select: ["id", "likes", "comments"]
  });
  for (const photo of remainingPhotos) {
    const likes = asArray(photo.likes);
    const comments = asArray(photo.comments);
    const nextLikes = likes.filter((entry) => String(entry || "").trim() !== safeUserId);
    const nextComments = comments.filter(
      (entry) => String(entry?.userId || "").trim() !== safeUserId
    );
    const likesRemoved = likes.length - nextLikes.length;
    const commentsRemoved = comments.length - nextComments.length;
    if (likesRemoved <= 0 && commentsRemoved <= 0) continue;

    await PhotoModel.update(photo._id, {
      likes: nextLikes,
      comments: nextComments
    });
    summary.photosUpdated += 1;
    summary.photoLikesRemoved += Math.max(0, likesRemoved);
    summary.photoCommentsRemoved += Math.max(0, commentsRemoved);
  }

  // 7) Remove this profile from family trees and relationship references.
  const familyTrees = await FamilyTreeModel.find(tenantId, {});
  for (const tree of familyTrees) {
    const originalMembers = asArray(tree.members);
    let changed = false;
    const nextMembers = originalMembers
      .filter((member) => {
        const keep = String(member?.profileId || "") !== safeProfileId;
        if (!keep) changed = true;
        return keep;
      })
      .map((member) => {
        const relationships = asArray(member?.relationships);
        const nextRelationships = relationships.filter(
          (relationship) => String(relationship?.toProfileId || "") !== safeProfileId
        );
        if (nextRelationships.length !== relationships.length) changed = true;
        return {
          ...member,
          relationships: nextRelationships
        };
      });

    if (!changed) continue;

    if (nextMembers.length < 2) {
      await FamilyTreeModel.delete(tree._id);
      summary.familyTreesDeleted += 1;
      continue;
    }

    const patch = { members: nextMembers };
    if (String(tree.createdByUserId || "") === safeUserId) {
      const replacementProfileId = String(nextMembers[0]?.profileId || "").trim();
      if (replacementProfileId) {
        const replacementProfiles = await ProfileModel.find(
          tenantId,
          { _id: replacementProfileId },
          { select: ["id", "userId"], limit: 1 }
        );
        const replacementUserId = String(replacementProfiles[0]?.userId || "").trim();
        if (replacementUserId) {
          patch.createdByUserId = replacementUserId;
        }
      }
    }

    await FamilyTreeModel.update(tree._id, patch);
    summary.familyTreesUpdated += 1;
  }

  // 8) Remove user-specific analytics/activity and auth artifacts.
  const activityItemCount = await ActivityItemModel.count(tenantId, { actorUserId: safeUserId });
  if (activityItemCount > 0) {
    await ActivityItemModel.deleteMany(tenantId, { actorUserId: safeUserId });
    summary.activityItemsDeleted += activityItemCount;
  }

  const analyticsEventCount = await AnalyticsEventModel.count(tenantId, { userId: safeUserId });
  if (analyticsEventCount > 0) {
    await AnalyticsEventModel.deleteMany(tenantId, { userId: safeUserId });
    summary.analyticsEventsDeleted += analyticsEventCount;
  }

  const magicLinkIds = await collectIdsForFilters(MagicLinkTokenModel, tenantId, [
    { userId: safeUserId },
    safeEmail ? { email: safeEmail } : null
  ]);
  if (magicLinkIds.length > 0) {
    await MagicLinkTokenModel.deleteMany(tenantId, { _id: { $in: magicLinkIds } });
    summary.magicLinkTokensDeleted += magicLinkIds.length;
  }

  const inviteIds = await collectIdsForFilters(InviteModel, tenantId, [
    { createdByUserId: safeUserId },
    { usedByUserId: safeUserId },
    safeEmail ? { email: safeEmail } : null
  ]);
  if (inviteIds.length > 0) {
    await InviteModel.deleteMany(tenantId, { _id: { $in: inviteIds } });
    summary.invitesDeleted += inviteIds.length;
  }

  const accessRequestIds = await collectIdsForFilters(AccessRequestModel, tenantId, [
    { reviewedByUserId: safeUserId },
    { approvedUserId: safeUserId },
    safeEmail ? { email: safeEmail } : null
  ]);
  if (accessRequestIds.length > 0) {
    await AccessRequestModel.deleteMany(tenantId, { _id: { $in: accessRequestIds } });
    summary.accessRequestsDeleted += accessRequestIds.length;
  }

  const adminAuditCount = await TenantAdminAuditLogModel.count(tenantId, { actorUserId: safeUserId });
  if (adminAuditCount > 0) {
    await TenantAdminAuditLogModel.deleteMany(tenantId, { actorUserId: safeUserId });
    summary.adminAuditLogsDeleted += adminAuditCount;
  }

  const resumeParseCount = await ResumeParseResultModel.count(tenantId, {
    createdByUserId: safeUserId
  });
  if (resumeParseCount > 0) {
    await ResumeParseResultModel.deleteMany(tenantId, { createdByUserId: safeUserId });
    summary.resumeParseResultsDeleted += resumeParseCount;
  }

  // 9) Delete profile + tenant membership row.
  await ProfileModel.delete(safeProfileId);
  summary.profileDeleted = 1;
  await UserModel.delete(safeUserId);
  summary.userDeleted = 1;

  return summary;
}

function parseList(value = "") {
  return [...new Set(
    String(value || "")
      .split(/[\n,;]+/g)
      .map((item) => String(item || "").trim())
      .filter(Boolean)
  )];
}

function parseMemberPagination(query = {}) {
  const page = Math.max(1, Number(query.page || 1) || 1);
  const pageSize = Math.min(
    MAX_MEMBER_PAGE_SIZE,
    Math.max(1, Number(query.pageSize || DEFAULT_MEMBER_PAGE_SIZE) || DEFAULT_MEMBER_PAGE_SIZE)
  );
  return {
    page,
    pageSize,
    skip: (page - 1) * pageSize
  };
}

function sortForMembers(sort = "join_desc") {
  const key = String(sort || "join_desc").trim().toLowerCase();
  if (key === "name_asc") return { lastName: 1, firstName: 1 };
  if (key === "name_desc") return { lastName: -1, firstName: -1 };
  if (key === "join_asc") return { createdAt: 1 };
  if (key === "last_active_desc") return null;
  if (key === "last_active_asc") return null;
  if (key === "completion_desc") return null;
  if (key === "completion_asc") return null;
  return { createdAt: -1 };
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeTargeting(input = {}) {
  const mode = String(input.mode || "all").trim().toLowerCase();
  const safeMode = ["all", "role", "year", "custom"].includes(mode) ? mode : "all";
  return {
    mode: safeMode,
    roles: asArray(input.roles).map((item) => String(item || "").trim()).filter(Boolean),
    years: asArray(input.years).map((item) => String(item || "").trim()).filter(Boolean),
    profileIds: parseIds(input.profileIds || []),
    label: String(input.label || "").trim()
  };
}

function serializeEmailBroadcast(item) {
  return {
    id: toObjectIdString(item?._id),
    subject: item?.subject || "",
    body: item?.body || "",
    status: item?.status || "draft",
    recipientCount: Number(item?.recipientCount || 0),
    excludedCount: Number(item?.excludedCount || 0),
    targeting: item?.targeting || {},
    scheduledFor: toIso(item?.scheduledFor),
    sentAt: toIso(item?.sentAt),
    createdAt: toIso(item?.createdAt),
    stats: item?.stats || {}
  };
}

async function resolveRecipientsForTargeting(tenantId, targeting) {
  const normalized = normalizeTargeting(targeting);
  const filter = { status: { $ne: "removed" } };

  if (normalized.mode === "year" && normalized.years.length > 0) {
    filter.collegeYears = { $contains: normalized.years };
  }

  if (normalized.mode === "custom" && normalized.profileIds.length > 0) {
    filter._id = { $in: normalized.profileIds };
  }

  let profiles = await ProfileModel.find(tenantId, filter);

  // Role filtering with case-insensitive matching (done JS-side)
  if (normalized.mode === "role" && normalized.roles.length > 0) {
    const lowerRoles = normalized.roles.map((r) => r.toLowerCase());
    profiles = profiles.filter((p) =>
      lowerRoles.includes((p.roleAtCamp || "").toLowerCase())
    );
  }

  const recipients = [...new Set(
    profiles
      .map((profile) => String(profile?.emails?.[0] || "").trim().toLowerCase())
      .filter((email) => isEmail(email))
  )];

  return {
    profiles,
    recipients
  };
}

async function buildRecentActivity(tenantId) {
  const [newProfiles, recentImports, recentEmails, recentEvents] = await Promise.all([
    ProfileModel.find(tenantId, { status: { $ne: "removed" } }, {
      sort: { createdAt: -1 },
      limit: 4,
      select: ["firstName", "lastName", "createdAt"]
    }),
    ImportReportModel.find(tenantId, {}, {
      sort: { createdAt: -1 },
      limit: 2,
      select: ["createdAt", "summary"]
    }),
    EmailBroadcastModel.find(tenantId, {}, {
      sort: { createdAt: -1 },
      limit: 2,
      select: ["createdAt", "sentAt", "subject", "recipientCount", "status"]
    }),
    AnalyticsEventModel.find(tenantId, {}, {
      sort: { createdAt: -1 },
      limit: 6,
      select: ["eventType", "metadata", "createdAt"]
    })
  ]);

  const profileItems = newProfiles.map((item) => ({
    id: `profile_${item._id}`,
    type: "member_joined",
    label: `${item.firstName || "A member"} ${item.lastName || ""}`.trim() + " joined the network",
    createdAt: item.createdAt
  }));
  const importItems = recentImports.map((item) => ({
    id: `import_${item._id}`,
    type: "import_completed",
    label: `Import completed: ${Number(item.summary?.createdCount || 0)} added, ${Number(item.summary?.updatedCount || 0)} updated`,
    createdAt: item.createdAt
  }));
  const emailItems = recentEmails.map((item) => ({
    id: `email_${item._id}`,
    type: "email_sent",
    label: `Email "${item.subject || "Untitled"}" ${item.status === "scheduled" ? "scheduled" : "sent"} to ${Number(item.recipientCount || 0)} members`,
    createdAt: item.sentAt || item.createdAt
  }));
  const eventItems = recentEvents.map((item) => ({
    id: `event_${item._id}`,
    type: item.eventType || "activity",
    label: String(item.metadata?.message || item.eventType || "Activity event"),
    createdAt: item.createdAt
  }));

  return [...profileItems, ...importItems, ...emailItems, ...eventItems]
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
    .slice(0, 10)
    .map((item) => ({
      ...item,
      createdAt: toIso(item.createdAt)
    }));
}

router.use(...requireTenantRoleScope("tenant_admin"));

router.get("/dashboard", async (req, res, next) => {
  try {
    const tenantId = req.tenant._id;
    const sevenDaysAgo = new Date(Date.now() - 7 * DAY_MS);
    const thirtyDaysAgo = new Date(Date.now() - 30 * DAY_MS);
    const chartEndDay = utcDayStart(new Date());
    const chartStartDay = new Date(chartEndDay.getTime() - (DASHBOARD_CHART_DAYS - 1) * DAY_MS);
    const settings = resolveSettings(req.tenant);

    const [
      activeMembers,
      newThisWeek,
      pendingApprovals,
      profiles,
      lastBroadcast,
      activity,
      recentNewUsers,
      recentSignIns
    ] =
      await Promise.all([
        ProfileModel.count(tenantId, { status: "active" }),
        ProfileModel.count(tenantId, {
          status: "active",
          createdAt: { $gte: sevenDaysAgo }
        }),
        AccessRequestModel.count(tenantId, { status: "pending" }),
        ProfileModel.find(tenantId, { status: { $ne: "removed" } }, {
          select: ["firstName", "lastName", "emails", "phones", "cityState", "roleAtCamp", "highSchool", "colleges", "currentJobs", "bio"]
        }),
        EmailBroadcastModel.find(tenantId, {}, {
          sort: { sentAt: -1, createdAt: -1 },
          limit: 1
        }),
        buildRecentActivity(tenantId),
        ProfileModel.find(
          tenantId,
          {
            status: "active",
            createdAt: { $gte: chartStartDay }
          },
          { select: ["createdAt"] }
        ),
        AnalyticsEventModel.find(
          tenantId,
          {
            createdAt: { $gte: chartStartDay },
            eventType: { $in: DASHBOARD_SIGNIN_EVENT_TYPES }
          },
          { select: ["createdAt", "userId"] }
        )
      ]);

    const completionAverage = profiles.length
      ? Math.round(
          profiles.reduce((sum, profile) => sum + completionScore(profile), 0) / profiles.length
        )
      : 0;
    const topLocations = topCountBuckets(
      profiles.map((profile) => normalizeLocationLabel(profile?.cityState || ""))
    );
    const topRoles = topCountBuckets(
      profiles.flatMap((profile) => splitRoleValues(profile?.roleAtCamp || ""))
    );

    const priorWindowCount = await ProfileModel.count(tenantId, {
      status: "active",
      createdAt: {
        $gte: new Date(thirtyDaysAgo.getTime() - 30 * DAY_MS),
        $lt: thirtyDaysAgo
      }
    });

    const statusLabel =
      req.tenant.status === "inactive"
        ? "paused"
        : req.tenant.onboardingStatus === "live"
        ? "live"
        : "in_setup";

    const newUsersSeries = buildDailyCountSeries({
      startDate: chartStartDay,
      days: DASHBOARD_CHART_DAYS,
      values: (recentNewUsers || []).map((entry) => entry?.createdAt)
    });
    const signInsSeries = buildDailyCountSeries({
      startDate: chartStartDay,
      days: DASHBOARD_CHART_DAYS,
      values: (recentSignIns || []).map((entry) => entry?.createdAt)
    });
    const profileByUserId = new Map(
      (profiles || []).map((profile) => [toObjectIdString(profile?.userId), profile])
    );
    const signInCountsByUserId = new Map();
    for (const entry of recentSignIns || []) {
      const userId = toObjectIdString(entry?.userId);
      if (!userId) continue;
      signInCountsByUserId.set(userId, Number(signInCountsByUserId.get(userId) || 0) + 1);
    }
    const topActiveMembers = [...signInCountsByUserId.entries()]
      .map(([userId, logins]) => {
        const profile = profileByUserId.get(userId) || null;
        if (!profile) return null;
        const fullName = `${profile.firstName || ""} ${profile.lastName || ""}`.trim();
        return {
          profileId: toObjectIdString(profile._id),
          userId,
          fullName: fullName || "Member",
          logins: Number(logins || 0)
        };
      })
      .filter(Boolean)
      .sort((left, right) => {
        const delta = Number(right.logins || 0) - Number(left.logins || 0);
        if (delta !== 0) return delta;
        return String(left.fullName || "").localeCompare(String(right.fullName || ""));
      })
      .slice(0, 5);

    return res.json({
      tenant: {
        id: toObjectIdString(req.tenant._id),
        slug: req.tenant.slug,
        name: req.tenant.name,
        status: statusLabel,
        onboardingStatus: req.tenant.onboardingStatus,
        launchedAt: toIso(req.tenant?.launch?.launchedAt),
        planTier: req.tenant.planTier,
        accessPolicy: settings.signupMode
      },
      stats: {
        totalMembers: activeMembers,
        totalMembersDelta:
          priorWindowCount > 0
            ? Math.round(((activeMembers - priorWindowCount) / priorWindowCount) * 100)
            : activeMembers > 0
            ? 100
            : 0,
        newThisWeek,
        pendingApprovals,
        profileCompletion: completionAverage
      },
      charts: {
        rangeDays: DASHBOARD_CHART_DAYS,
        newUsers: newUsersSeries,
        signIns: signInsSeries
      },
      profileBreakdowns: {
        topLocations,
        topRoles,
        topActiveMembers
      },
      lastEmail: lastBroadcast[0]
        ? {
            subject: lastBroadcast[0].subject,
            sentAt: toIso(lastBroadcast[0].sentAt || lastBroadcast[0].createdAt),
            status: lastBroadcast[0].status
          }
        : null,
      recentActivity: activity
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/members", async (req, res, next) => {
  try {
    const tenantId = req.tenant._id;
    const directorUserId = await resolveDirectorUserId(req.tenant);
    const q = String(req.query.q || "").trim();
    const role = String(req.query.role || "").trim();
    const year = String(req.query.year || "").trim();
    const status = String(req.query.status || "").trim().toLowerCase();
    const completion = String(req.query.completion || "").trim().toLowerCase();
    const sort = String(req.query.sort || "join_desc").trim().toLowerCase();
    const { page, pageSize, skip } = parseMemberPagination(req.query);

    const filter = {};

    if (role && role !== "all") {
      filter.roleAtCamp = { $ilike: role };
    }

    if (year && year !== "all") {
      filter.collegeYears = { $contains: [year] };
    }

    if (status && status !== "all") {
      filter.status = status;
    }

    let mongoSort = sortForMembers(sort);
    if (completion && completion !== "all") {
      mongoSort = null;
    }
    let profiles = [];
    let total = 0;

    // Fetch profiles — apply text search JS-side since Supabase doesn't support $or regex
    const fetchOpts = mongoSort
      ? { sort: mongoSort, offset: skip, limit: pageSize }
      : {};

    let allProfiles = await ProfileModel.find(tenantId, filter, fetchOpts);

    // Text search filter (JS-side)
    if (q) {
      const rx = new RegExp(escapeRegex(q), "i");
      allProfiles = allProfiles.filter((p) =>
        rx.test(p.firstName || "") ||
        rx.test(p.lastName || "") ||
        (p.emails || []).some((e) => rx.test(e)) ||
        rx.test(p.cityState || "") ||
        rx.test(p.roleAtCamp || "") ||
        (p.collegeYears || []).some((y) => rx.test(y))
      );
    }

    if (mongoSort) {
      // When text search is applied, we need to re-count (allProfiles was already paginated)
      if (q) {
        // Refetch without pagination to get proper count
        let countProfiles = await ProfileModel.find(tenantId, filter);
        countProfiles = countProfiles.filter((p) => {
          const rx = new RegExp(escapeRegex(q), "i");
          return rx.test(p.firstName || "") ||
            rx.test(p.lastName || "") ||
            (p.emails || []).some((e) => rx.test(e)) ||
            rx.test(p.cityState || "") ||
            rx.test(p.roleAtCamp || "") ||
            (p.collegeYears || []).some((y) => rx.test(y));
        });
        total = countProfiles.length;
        profiles = countProfiles.slice(skip, skip + pageSize);
      } else {
        profiles = allProfiles;
        total = allProfiles._count ?? await ProfileModel.count(tenantId, filter);
      }
    } else {
      const userIds = allProfiles
        .map((item) => toObjectIdString(item.userId))
        .filter(Boolean);
      const users = userIds.length > 0
        ? await UserModel.find(tenantId, { _id: { $in: userIds } }, {
            select: ["id", "email", "status", "lastLoginAt", "roles"]
          })
        : [];
      const usersById = new Map(users.map((item) => [toObjectIdString(item._id), item]));
      const mapped = allProfiles.map((profile) =>
        mapMemberRow(profile, usersById.get(toObjectIdString(profile.userId)) || null, { directorUserId })
      );

      mapped.sort((a, b) => {
        if (sort === "completion_asc") return a.completionScore - b.completionScore;
        if (sort === "completion_desc") return b.completionScore - a.completionScore;
        if (sort === "last_active_asc") {
          return new Date(a.lastActiveAt || 0).getTime() - new Date(b.lastActiveAt || 0).getTime();
        }
        if (sort === "last_active_desc") {
          return new Date(b.lastActiveAt || 0).getTime() - new Date(a.lastActiveAt || 0).getTime();
        }
        return new Date(b.joinDate || 0).getTime() - new Date(a.joinDate || 0).getTime();
      });

      const filteredByCompletion =
        completion && completion !== "all"
          ? mapped.filter((item) => {
              if (completion === "low") return item.completionScore < 40;
              if (completion === "medium")
                return item.completionScore >= 40 && item.completionScore < 80;
              if (completion === "high") return item.completionScore >= 80;
              if (completion === "complete") return item.completionScore >= 100;
              return true;
            })
          : mapped;
      total = filteredByCompletion.length;
      const paged = filteredByCompletion.slice(skip, skip + pageSize);
      return res.json({
        total,
        page,
        pageSize,
        items: paged,
        filters: {
          roleOptions: [...new Set(mapped.map((item) => item.role).filter(Boolean))].sort(),
          yearOptions: [
            ...new Set(
              mapped.flatMap((item) => asArray(item.yearsAtCamp)).map((value) => String(value || "").trim())
            )
          ].filter(Boolean).sort(),
          statusOptions: ["active", "pending", "flagged", "removed"]
        }
      });
    }

    const userIds = profiles.map((item) => toObjectIdString(item.userId)).filter(Boolean);
    const users = userIds.length > 0
      ? await UserModel.find(tenantId, { _id: { $in: userIds } }, {
          select: ["id", "email", "status", "lastLoginAt", "roles"]
        })
      : [];
    const usersById = new Map(users.map((item) => [toObjectIdString(item._id), item]));
    let rows = profiles.map((profile) =>
      mapMemberRow(profile, usersById.get(toObjectIdString(profile.userId)) || null, { directorUserId })
    );

    if (completion && completion !== "all") {
      rows = rows.filter((item) => {
        if (completion === "low") return item.completionScore < 40;
        if (completion === "medium") return item.completionScore >= 40 && item.completionScore < 80;
        if (completion === "high") return item.completionScore >= 80;
        if (completion === "complete") return item.completionScore >= 100;
        return true;
      });
    }

    return res.json({
      total,
      page,
      pageSize,
      items: rows,
      filters: {
        roleOptions: [...new Set(rows.map((item) => item.role).filter(Boolean))].sort(),
        yearOptions: [
          ...new Set(
            rows.flatMap((item) => asArray(item.yearsAtCamp)).map((value) => String(value || "").trim())
          )
        ].filter(Boolean).sort(),
        statusOptions: ["active", "pending", "flagged", "removed"]
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/members/template.csv", async (_req, res) => {
  const csv = stringify(
    [
      {
        firstName: "Avery",
        lastName: "Parker",
        email: "avery@example.com",
        phone: "",
        cityState: "New York, NY",
        roleAtCamp: "Camper",
        gradYear: "2021"
      }
    ],
    { header: true }
  );

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", 'attachment; filename="pondbridge-members-template.csv"');
  return res.send(csv);
});

router.get("/invites/template.csv", async (_req, res) => {
  const csv = stringify(
    [
      {
        firstName: "Avery",
        lastName: "Parker",
        email: "avery@example.com"
      }
    ],
    { header: true }
  );

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", 'attachment; filename="pondbridge-invites-template.csv"');
  return res.send(csv);
});

router.patch("/members/:profileId([a-fA-F0-9]{24})", async (req, res) => {
  const profileId = String(req.params.profileId || "").trim();
  const profile = await ProfileModel.findOne(req.tenant._id, { _id: profileId });

  if (!profile) {
    return res.status(404).json({
      error: { code: "PROFILE_NOT_FOUND", message: "Profile not found" }
    });
  }

  const incoming = req.body || {};
  const patch = {};
  const assignString = (key) => {
    if (Object.prototype.hasOwnProperty.call(incoming, key)) {
      patch[key] = sanitizeText(String(incoming[key] || "").trim());
    }
  };
  const normalizeIncomingCityState = () => {
    const hasLocationFields =
      Object.prototype.hasOwnProperty.call(incoming, "cityState") ||
      Object.prototype.hasOwnProperty.call(incoming, "city") ||
      Object.prototype.hasOwnProperty.call(incoming, "state") ||
      Object.prototype.hasOwnProperty.call(incoming, "country");
    if (!hasLocationFields) return undefined;

    const direct = String(incoming.cityState || "").trim();
    if (direct) return composeCityState(parseCityStateDetailed(direct));

    const state = String(incoming.state || "").trim().toUpperCase();
    const country = canonicalizeCountryName(String(incoming.country || "").trim());
    const city = canonicalizeCityName(String(incoming.city || "").trim(), { state, country });
    return composeCityState({ city, state, country });
  };

  assignString("firstName");
  assignString("lastName");
  const nextCityState = normalizeIncomingCityState();
  if (nextCityState !== undefined) patch.cityState = nextCityState;
  assignString("roleAtCamp");
  assignString("bio");
  assignString("flaggedReason");

  if (Array.isArray(incoming.emails)) {
    patch.emails = incoming.emails.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean);
  }

  if (Array.isArray(incoming.phones)) {
    patch.phones = incoming.phones.map((item) => String(item || "").trim()).filter(Boolean);
  }

  if (Array.isArray(incoming.collegeYears)) {
    patch.collegeYears = incoming.collegeYears.map((item) => String(item || "").trim()).filter(Boolean);
  }

  if (Object.prototype.hasOwnProperty.call(incoming, "status")) {
    const status = String(incoming.status || "").trim().toLowerCase();
    if (!["active", "pending", "flagged", "removed"].includes(status)) {
      return res.status(400).json({
        error: {
          code: "INVALID_STATUS",
          message: "Status must be active, pending, flagged, or removed."
        }
      });
    }
    patch.status = status;
  }

  const updated = await ProfileModel.update(profile._id, patch);

  if (patch.status) {
    const nextUserStatus = patch.status === "removed" ? "inactive" : "active";
    await UserModel.update(updated.userId, { status: nextUserStatus });
  }

  const user = await UserModel.findOne(req.tenant._id, { _id: updated.userId });
  await writeAdminAudit(req, "admin_member_updated", {
    profileId: toObjectIdString(updated._id),
    userId: toObjectIdString(updated.userId),
    changedFields: Object.keys(patch)
  });
  return res.json({
    ok: true,
    member: mapMemberRow(updated, user)
  });
});

router.delete("/members/:profileId([a-fA-F0-9]{24})/hard-delete", async (req, res, next) => {
  try {
    const profileId = String(req.params.profileId || "").trim();
    const profile = await ProfileModel.findOne(req.tenant._id, { _id: profileId });

    if (!profile) {
      return res.status(404).json({
        error: { code: "PROFILE_NOT_FOUND", message: "Profile not found" }
      });
    }

    const userId = toObjectIdString(profile.userId);
    if (!userId) {
      return res.status(400).json({
        error: { code: "INVALID_MEMBER", message: "Profile is missing a linked user." }
      });
    }
    if (String(userId) === String(req.user.id || "")) {
      return res.status(400).json({
        error: { code: "CANNOT_DELETE_SELF", message: "You cannot delete your own account from this network." }
      });
    }

    const user = await UserModel.findOne(req.tenant._id, { _id: userId });
    if (!user) {
      await ProfileModel.delete(profile._id);
      await writeAdminAudit(req, "admin_member_hard_deleted", {
        profileId: toObjectIdString(profile._id),
        userId,
        summary: { profileDeleted: 1, userDeleted: 0 }
      });
      return res.json({
        ok: true,
        deletedProfileId: profileId,
        deletedUserId: userId,
        summary: {
          profileDeleted: 1,
          userDeleted: 0
        }
      });
    }

    const targetIsAdmin = hasDirectorRole(user.roles || []);
    if (targetIsAdmin) {
      const tenantUsers = await UserModel.find(req.tenant._id, {}, { select: ["id", "roles"] });
      const adminCount = tenantUsers.filter((item) => hasDirectorRole(item?.roles || [])).length;
      if (adminCount <= 1) {
        return res.status(400).json({
          error: {
            code: "LAST_ADMIN_PROTECTED",
            message: "Cannot delete the last director/admin from this network."
          }
        });
      }
    }

    const summary = await deleteMemberFromTenant({
      tenantId: req.tenant._id,
      userId,
      profileId: toObjectIdString(profile._id),
      email: profile?.emails?.[0] || user?.email || ""
    });
    await writeAdminAudit(req, "admin_member_hard_deleted", {
      profileId: toObjectIdString(profile._id),
      userId,
      summary
    });

    return res.json({
      ok: true,
      deletedProfileId: toObjectIdString(profile._id),
      deletedUserId: userId,
      summary
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/members/bulk-action", async (req, res) => {
  const action = String(req.body?.action || "").trim().toLowerCase();
  const ids = parseIds(req.body?.ids || []);

  if (ids.length === 0) {
    return res.status(400).json({
      error: {
        code: "IDS_REQUIRED",
        message: "Select at least one member for bulk action."
      }
    });
  }

  const profiles = await ProfileModel.find(req.tenant._id, { _id: { $in: ids } });
  if (profiles.length === 0) {
    return res.status(404).json({
      error: { code: "MEMBERS_NOT_FOUND", message: "No matching members were found." }
    });
  }

  if (action === "remove") {
    const userIds = profiles.map((item) => item.userId).filter(Boolean);
    await ProfileModel.updateMany(
      req.tenant._id,
      { _id: { $in: ids } },
      { status: "removed" }
    );
    if (userIds.length > 0) {
      await UserModel.updateMany(
        req.tenant._id,
        { _id: { $in: userIds } },
        { status: "inactive" }
      );
    }
    await writeAdminAudit(req, "admin_members_bulk_action", {
      action,
      affected: profiles.length
    });
    return res.json({ ok: true, action, affected: profiles.length });
  }

  if (action === "approve") {
    const userIds = profiles.map((item) => item.userId).filter(Boolean);
    await ProfileModel.updateMany(
      req.tenant._id,
      { _id: { $in: ids } },
      { status: "active", flaggedReason: "" }
    );
    if (userIds.length > 0) {
      await UserModel.updateMany(
        req.tenant._id,
        { _id: { $in: userIds } },
        { status: "active" }
      );
    }
    await writeAdminAudit(req, "admin_members_bulk_action", {
      action,
      affected: profiles.length
    });
    return res.json({ ok: true, action, affected: profiles.length });
  }

  if (action === "flag") {
    const reason = sanitizeText(String(req.body?.reason || "").trim());
    await ProfileModel.updateMany(
      req.tenant._id,
      { _id: { $in: ids } },
      { status: "flagged", flaggedReason: reason }
    );
    await writeAdminAudit(req, "admin_members_bulk_action", {
      action,
      affected: profiles.length
    });
    return res.json({ ok: true, action, affected: profiles.length });
  }

  if (action === "export") {
    const records = profiles.map((profile) => ({
      firstName: profile.firstName || "",
      lastName: profile.lastName || "",
      email: profile.emails?.[0] || "",
      role: profile.roleAtCamp || "",
      yearsAtCamp: asArray(profile.collegeYears).join("; "),
      location: profile.cityState || "",
      status: profile.status || "active"
    }));
    const csv = stringify(records, { header: true });
    await writeAdminAudit(req, "admin_members_bulk_action", {
      action,
      affected: profiles.length
    });
    return res.json({
      ok: true,
      action,
      csv
    });
  }

  return res.status(400).json({
    error: {
      code: "INVALID_ACTION",
      message: "Unsupported bulk action."
    }
  });
});

router.get("/members/approvals", async (req, res) => {
  const status = String(req.query.status || "pending").trim().toLowerCase();
  const filter = {};
  if (["pending", "approved", "denied"].includes(status)) {
    filter.status = status;
  }

  const requests = await AccessRequestModel.find(req.tenant._id, filter, {
    sort: { requestedAt: -1 },
    limit: 200
  });

  return res.json({
    total: requests.length,
    items: requests.map((item) => ({
      id: toObjectIdString(item._id),
      firstName: item.firstName || item.profilePayload?.firstName || "",
      lastName: item.lastName || item.profilePayload?.lastName || "",
      email: item.email || item.profilePayload?.emails?.[0] || "",
      selfReportedRole: item.selfReportedRole || item.profilePayload?.roleAtCamp || "",
      requestMessage: item.requestMessage || "",
      status: item.status,
      requestedAt: toIso(item.requestedAt || item.createdAt),
      reviewedAt: toIso(item.reviewedAt)
    }))
  });
});

router.post("/members/approvals/:requestId/approve", async (req, res) => {
  const requestId = String(req.params.requestId || "").trim();
  const request = await AccessRequestModel.findOne(req.tenant._id, {
    _id: requestId,
    status: "pending"
  });

  if (!request) {
    return res.status(404).json({
      error: {
        code: "ACCESS_REQUEST_NOT_FOUND",
        message: "Pending access request not found."
      }
    });
  }

  const email = normalizeEmail(request.email || request.profilePayload?.emails?.[0] || "");
  if (!isEmail(email)) {
    return res.status(400).json({
      error: {
        code: "INVALID_EMAIL",
        message: "Access request is missing a valid email."
      }
    });
  }

  const existingUser = await UserModel.findOne(req.tenant._id, { email });
  if (existingUser) {
    await AccessRequestModel.update(request._id, {
      status: "approved",
      reviewedAt: new Date(),
      reviewedByUserId: req.user.id,
      approvedUserId: existingUser._id
    });
    await writeAdminAudit(req, "admin_access_request_approved", {
      requestId: toObjectIdString(request._id),
      approvedUserId: toObjectIdString(existingUser._id),
      existingUser: true
    });
    return res.json({ ok: true, requestId: toObjectIdString(request._id), existingUser: true });
  }

  const randomPassword = crypto.randomBytes(18).toString("hex");
  const user = await UserModel.create({
    tenantId: req.tenant._id,
    email,
    passwordHash: request.passwordHash || (await hashPassword(randomPassword)),
    roles: ["user"]
  });

  const profileSeed = request.profilePayload || {};
  const profile = await ProfileModel.create({
    tenantId: req.tenant._id,
    userId: user._id,
    firstName: String(profileSeed.firstName || request.firstName || "").trim() || "Member",
    lastName: String(profileSeed.lastName || request.lastName || "").trim() || "Pending",
    emails: parseList(profileSeed.emails || [email]).map((item) => normalizeEmail(item)),
    phones: parseList(profileSeed.phones || []),
    cityState: String(profileSeed.cityState || "").trim(),
    roleAtCamp: String(request.selfReportedRole || profileSeed.roleAtCamp || "").trim(),
    highSchool: String(profileSeed.highSchool || "").trim(),
    colleges: asArray(profileSeed.colleges),
    collegeYears: asArray(profileSeed.collegeYears),
    currentJobs: asArray(profileSeed.currentJobs),
    pastJobs: asArray(profileSeed.pastJobs),
    industry: String(profileSeed.industry || "").trim(),
    socials: profileSeed.socials || {},
    avatarUrl: String(profileSeed.avatarUrl || "").trim(),
    bio: String(profileSeed.bio || "").trim(),
    status: "active"
  });

  await UserModel.update(user._id, { profileId: profile._id });

  await AccessRequestModel.update(request._id, {
    status: "approved",
    reviewedAt: new Date(),
    reviewedByUserId: req.user.id,
    approvedUserId: user._id
  });
  await writeAdminAudit(req, "admin_access_request_approved", {
    requestId: toObjectIdString(request._id),
    approvedUserId: toObjectIdString(user._id),
    existingUser: false
  });

  const approvedFirstName = String(
    request.firstName || request.profilePayload?.firstName || ""
  ).trim();
  await sendAccessDecisionEmail({
    tenant: req.tenant,
    email,
    firstName: approvedFirstName,
    approved: true
  }).catch((error) => {
    console.warn("[email] approval notification failed", {
      tenantId: String(req.tenant._id || ""),
      email,
      message: String(error?.message || "")
    });
  });

  return res.json({
    ok: true,
    requestId: toObjectIdString(request._id),
    member: mapMemberRow(profile, user)
  });
});

router.post("/members/approvals/:requestId/deny", async (req, res) => {
  const requestId = String(req.params.requestId || "").trim();
  const reason = sanitizeText(String(req.body?.reason || "").trim());

  const pending = await AccessRequestModel.findOne(req.tenant._id, {
    _id: requestId,
    status: "pending"
  });

  if (!pending) {
    return res.status(404).json({
      error: {
        code: "ACCESS_REQUEST_NOT_FOUND",
        message: "Pending access request not found."
      }
    });
  }

  const request = await AccessRequestModel.update(pending._id, {
    status: "denied",
    reviewedAt: new Date(),
    reviewedByUserId: req.user.id,
    denialReason: reason
  });
  await writeAdminAudit(req, "admin_access_request_denied", {
    requestId: toObjectIdString(request._id),
    reasonLength: reason.length
  });

  if (isEmail(request.email)) {
    const deniedFirstName = String(
      request.firstName || request.profilePayload?.firstName || ""
    ).trim();
    await sendAccessDecisionEmail({
      tenant: req.tenant,
      email: request.email,
      firstName: deniedFirstName,
      approved: false,
      reason
    }).catch((error) => {
      console.warn("[email] denial notification failed", {
        tenantId: String(req.tenant._id || ""),
        email: request.email,
        message: String(error?.message || "")
      });
    });
  }

  return res.json({ ok: true, requestId: toObjectIdString(request._id) });
});

router.get("/email/history", async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 30) || 30));
  const items = await EmailBroadcastModel.find(req.tenant._id, {}, {
    sort: { createdAt: -1 },
    limit
  });
  return res.json({
    total: items.length,
    items: items.map((item) => serializeEmailBroadcast(item))
  });
});

router.get("/email/history/:broadcastId", async (req, res) => {
  const item = await EmailBroadcastModel.findOne(req.tenant._id, {
    _id: String(req.params.broadcastId || "").trim()
  });

  if (!item) {
    return res.status(404).json({
      error: {
        code: "EMAIL_NOT_FOUND",
        message: "Email broadcast not found."
      }
    });
  }

  return res.json({ item: serializeEmailBroadcast(item) });
});

router.post("/email/recipients-preview", async (req, res) => {
  const targeting = normalizeTargeting(req.body?.targeting || {});
  const { profiles, recipients } = await resolveRecipientsForTargeting(req.tenant._id, targeting);

  return res.json({
    count: recipients.length,
    excludedCount: 0,
    preview: profiles.slice(0, 5).map((profile) => ({
      id: toObjectIdString(profile._id),
      name: `${profile.firstName || ""} ${profile.lastName || ""}`.trim() || "Member",
      email: String(profile?.emails?.[0] || "").trim().toLowerCase()
    }))
  });
});

router.post("/email/test", async (req, res) => {
  const subject = sanitizeText(String(req.body?.subject || "").trim());
  const body = sanitizeHtmlContent(String(req.body?.body || "").trim());
  const user = await UserModel.findOne(req.tenant._id, { _id: req.user.id });
  const to = normalizeEmail(user?.email || req.user.email || "");
  const replyTo = normalizeEmail(user?.email || req.user.email || "");

  if (!subject || !body) {
    return res.status(400).json({
      error: {
        code: "EMAIL_CONTENT_REQUIRED",
        message: "Subject and body are required."
      }
    });
  }

  if (!isEmail(to)) {
    return res.status(400).json({
      error: {
        code: "DIRECTOR_EMAIL_MISSING",
        message: "Your admin email is unavailable for test sends."
      }
    });
  }

  await sendTransactionalEmail({
    to,
    subject: `[Test] ${subject}`,
    text: body,
    ...(isEmail(replyTo) ? { replyTo } : {})
  });

  return res.json({ ok: true, sentTo: to });
});

router.post("/email/send", emailSendLimiter, async (req, res) => {
  const subject = sanitizeText(String(req.body?.subject || "").trim());
  const body = sanitizeHtmlContent(String(req.body?.body || "").trim());
  const targeting = normalizeTargeting(req.body?.targeting || {});
  const scheduledForRaw = String(req.body?.scheduledFor || "").trim();
  const scheduledFor = scheduledForRaw ? new Date(scheduledForRaw) : null;
  const actorReplyTo = normalizeEmail(req.user.email || "");

  if (!subject || !body) {
    return res.status(400).json({
      error: {
        code: "EMAIL_CONTENT_REQUIRED",
        message: "Subject and body are required."
      }
    });
  }

  const { recipients } = await resolveRecipientsForTargeting(req.tenant._id, targeting);
  if (recipients.length === 0) {
    return res.status(400).json({
      error: {
        code: "NO_RECIPIENTS",
        message: "No recipients match the selected targeting."
      }
    });
  }

  if (recipients.length > env.EMAIL_BROADCAST_MAX_RECIPIENTS) {
    return res.status(400).json({
      error: {
        code: "TOO_MANY_RECIPIENTS",
        message: `Recipient list exceeds max size of ${env.EMAIL_BROADCAST_MAX_RECIPIENTS}. Narrow your targeting and try again.`
      }
    });
  }

  const now = new Date();
  const isScheduled = scheduledFor && !Number.isNaN(scheduledFor.getTime()) && scheduledFor > now;
  const basePayload = {
    subject,
    body,
    targeting,
    recipientCount: recipients.length,
    excludedCount: 0,
    recipientsPreview: recipients.slice(0, 8),
    createdByUserId: req.user.id,
    status: isScheduled ? "scheduled" : "sent",
    scheduledFor: isScheduled ? scheduledFor : null,
    sentAt: isScheduled ? null : now
  };

  const broadcast = await EmailBroadcastModel.create({ ...basePayload, tenantId: req.tenant._id });

  if (!isScheduled) {
    const delivery = await sendBulkTransactionalEmail({
      recipients,
      subject,
      text: body,
      ...(isEmail(actorReplyTo) ? { replyTo: actorReplyTo } : {}),
      tags: [
        { name: "category", value: "director_broadcast" },
        { name: "tenant", value: req.tenant.slug || "tenant" }
      ],
      idempotencyKey: `director-broadcast/${req.tenant.slug || "tenant"}/${broadcast._id}`,
      batchSize: env.EMAIL_BROADCAST_BATCH_SIZE,
      maxRecipients: env.EMAIL_BROADCAST_MAX_RECIPIENTS
    });
    const deliveryStats = {
      attemptedCount: delivery.attemptedCount,
      sentCount: delivery.sentCount,
      failedCount: delivery.failedCount,
      batchesAttempted: delivery.batchesAttempted,
      batchesSucceeded: delivery.batchesSucceeded,
      batchesFailed: delivery.batchesFailed,
      messageIds: delivery.messageIds.slice(0, 20),
      failures: delivery.failures.slice(0, 10)
    };
    await EmailBroadcastModel.update(broadcast._id, {
      status: delivery.sentCount > 0 ? "sent" : "failed",
      sentAt: delivery.sentCount > 0 ? new Date() : null,
      stats: {
        ...(broadcast.stats || {}),
        delivery: deliveryStats
      }
    });
  }

  const fresh = await EmailBroadcastModel.findOne(req.tenant._id, { _id: broadcast._id });
  return res.status(201).json({ ok: true, item: serializeEmailBroadcast(fresh) });
});

router.get("/analytics/network", async (req, res, next) => {
  try {
    const tenantId = req.tenant._id;
    const directorUserId = await resolveDirectorUserId(req.tenant);
    const snapshot = await getTenantAnalyticsSnapshot({ tenantId });
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY_MS);
    const sevenDaysAgo = new Date(now.getTime() - 7 * DAY_MS);

    const [events30d, users, profiles, broadcasts] = await Promise.all([
      AnalyticsEventModel.find(tenantId, { createdAt: { $gte: thirtyDaysAgo } }, {
        select: ["userId", "eventType", "createdAt", "metadata"]
      }),
      UserModel.find(tenantId, {}, {
        select: ["id", "email", "lastLoginAt", "roles"]
      }),
      ProfileModel.find(tenantId, { status: { $ne: "removed" } }, {
        // Keep this aligned with completionScore fields so percentages are not undercounted.
        select: [
          "id",
          "userId",
          "firstName",
          "lastName",
          "emails",
          "phones",
          "cityState",
          "roleAtCamp",
          "highSchool",
          "colleges",
          "currentJobs",
          "bio",
          "createdAt"
        ]
      }),
      EmailBroadcastModel.find(tenantId, { status: { $in: ["sent", "scheduled"] } }, {
        sort: { sentAt: -1, createdAt: -1 },
        limit: 5
      })
    ]);

    const activeDailyMap = new Map();
    const weeklyBuckets = new Map();
    const featureUsageMap = new Map();
    const userEventMap = new Map();

    for (const event of events30d) {
      const dayKey = toIso(new Date(event.createdAt))?.slice(0, 10);
      if (dayKey) {
        const set = activeDailyMap.get(dayKey) || new Set();
        if (event.userId) set.add(String(event.userId));
        activeDailyMap.set(dayKey, set);
      }

      const eventDate = new Date(event.createdAt);
      const weekStart = new Date(
        Date.UTC(
          eventDate.getUTCFullYear(),
          eventDate.getUTCMonth(),
          eventDate.getUTCDate() - eventDate.getUTCDay()
        )
      );
      const weekKey = weekStart.toISOString().slice(0, 10);
      const weekly = weeklyBuckets.get(weekKey) || { newMembers: 0, returningMembers: 0, users: new Set() };
      if (event.userId) weekly.users.add(String(event.userId));
      weeklyBuckets.set(weekKey, weekly);

      const moduleKey = String(event.metadata?.featureModule || event.eventType || "other").trim();
      featureUsageMap.set(moduleKey, (featureUsageMap.get(moduleKey) || 0) + 1);
      if (event.userId) {
        userEventMap.set(String(event.userId), (userEventMap.get(String(event.userId)) || 0) + 1);
      }
    }

    const usersById = new Map(users.map((item) => [String(item._id), item]));
    const profileByUserId = new Map(profiles.map((item) => [String(item.userId), item]));
    const recentCutoff = sevenDaysAgo.getTime();
    for (const bucket of weeklyBuckets.values()) {
      let newMembers = 0;
      let returningMembers = 0;
      for (const userId of bucket.users.values()) {
        const profile = profileByUserId.get(userId);
        if (profile && new Date(profile.createdAt).getTime() >= recentCutoff) newMembers += 1;
        else returningMembers += 1;
      }
      bucket.newMembers = newMembers;
      bucket.returningMembers = returningMembers;
    }

    const topActiveMembers = [...userEventMap.entries()]
      .map(([userId, count]) => {
        const profile = profileByUserId.get(userId);
        if (!profile) return null;
        return {
          profileId: toObjectIdString(profile._id),
          userId,
          name: `${profile.firstName || ""} ${profile.lastName || ""}`.trim(),
          role:
            resolveAccountRoleLabel(usersById.get(userId) || null, directorUserId) ||
            profile.roleAtCamp ||
            "Member",
          logins: count,
          completionScore: completionScore(profile, usersById.get(userId) || null),
          lastActiveAt: toIso(usersById.get(userId)?.lastLoginAt)
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.logins - a.logins)
      .slice(0, 10);

    return res.json({
      tenant: {
        id: toObjectIdString(req.tenant._id),
        slug: req.tenant.slug,
        name: req.tenant.name
      },
      generatedAt: new Date().toISOString(),
      metrics: {
        activeMembers7d: Number(snapshot?.engagement?.weeklyActiveUsers || 0),
        totalMembers: Number(snapshot?.totals?.profiles || 0),
        directorySearches30d: Number(
          events30d.filter((event) => event.eventType === "directory_search").length
        ),
        profileCompletion: Number(snapshot?.profileCompletion?.averagePercent || 0)
      },
      memberActivity30d: [...activeDailyMap.entries()]
        .map(([date, set]) => ({ date, count: set.size }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      newVsReturningByWeek: [...weeklyBuckets.entries()]
        .map(([week, bucket]) => ({
          week,
          newMembers: bucket.newMembers,
          returningMembers: bucket.returningMembers
        }))
        .sort((a, b) => a.week.localeCompare(b.week)),
      featureUsage: [...featureUsageMap.entries()]
        .map(([module, count]) => ({ module, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
      topActiveMembers,
      emailPerformance: broadcasts.map((item) => ({
        id: toObjectIdString(item._id),
        subject: item.subject,
        sentAt: toIso(item.sentAt || item.createdAt),
        recipientCount: Number(item.recipientCount || 0),
        openRate: Number(item.stats?.openRate || 0),
        clickRate: Number(item.stats?.clickRate || 0),
        deliveredCount: Number(item.stats?.webhook?.delivered || 0),
        bouncedCount: Number(item.stats?.webhook?.bounced || 0),
        complaintCount: Number(item.stats?.webhook?.complained || 0),
        clickedCount: Number(item.stats?.webhook?.clicked || 0),
        status: item.status
      }))
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/features", async (req, res) => {
  const theme = resolveTheme(req.tenant);
  const content = resolveContent(req.tenant);
  const modules = resolveModules(req.tenant, { applyPlanGating: false });
  const features = listFeaturesForPlan(req.tenant.planTier, req.tenant.addOns || []);
  const items = MODULE_CATALOG.map((module) => {
    const locked = module.requiredFeature
      ? !hasFeature(req.tenant.planTier, module.requiredFeature, req.tenant.addOns || [])
      : false;
    return {
      ...module,
      enabled: locked ? false : Boolean(modules[module.key]),
      locked
    };
  });

  return res.json({
    tenant: {
      id: toObjectIdString(req.tenant._id),
      slug: req.tenant.slug,
      name: req.tenant.name,
      planTier: req.tenant.planTier,
      features
    },
    theme: {
      brandPrimary: theme.brandPrimary,
      logoUrl: theme.logoUrl
    },
    modules: items,
    moduleDisplayNames: {
      newsletter: content.newsletterName || "Newsletter"
    }
  });
});

router.patch("/features", async (req, res) => {
  const incomingModules = req.body?.modules && typeof req.body.modules === "object"
    ? req.body.modules
    : {};
  const incomingNames = req.body?.moduleDisplayNames && typeof req.body.moduleDisplayNames === "object"
    ? req.body.moduleDisplayNames
    : {};

  const current = resolveModules(req.tenant, { applyPlanGating: false });
  const nextModules = { ...current };

  for (const module of MODULE_CATALOG) {
    if (!Object.prototype.hasOwnProperty.call(incomingModules, module.key)) continue;
    const locked = module.requiredFeature
      ? !hasFeature(req.tenant.planTier, module.requiredFeature, req.tenant.addOns || [])
      : false;
    if (locked) continue;
    nextModules[module.key] = Boolean(incomingModules[module.key]);
  }

  const update = {
    modules: nextModules
  };

  if (Object.prototype.hasOwnProperty.call(incomingNames, "newsletter")) {
    const currentContent = resolveContent(req.tenant);
    update.content = {
      ...currentContent,
      newsletterName: sanitizeText(String(incomingNames.newsletter || "").trim()) || "Newsletter"
    };
  }

  const tenant = await TenantModel.update(req.tenant._id, update);

  return res.json({
    ok: true,
    modules: resolveModules(tenant, { applyPlanGating: false }),
    moduleDisplayNames: {
      newsletter: resolveContent(tenant).newsletterName
    }
  });
});

router.get("/billing", async (req, res) => {
  const mode = getBillingMode();
  const portal = await createBillingPortalUrl({
    tenant: req.tenant,
    returnPath: `/t/${req.tenant.slug}/admin/billing`
  });
  const billing = buildBillingPublicSnapshot(req.tenant);
  const foundersAvailability = await getFoundersAvailability();

  const memberCount = await ProfileModel.count(req.tenant._id, { status: { $ne: "removed" } });
  const planLimit = req.tenant.planTier === "premium" ? null : 5000;
  const usagePct = planLimit ? Math.round((memberCount / Math.max(planLimit, 1)) * 100) : null;

  return res.json({
    tenant: {
      id: toObjectIdString(req.tenant._id),
      slug: req.tenant.slug,
      name: req.tenant.name,
      planTier: req.tenant.planTier,
      billingPlan: billing.billingPlan,
      billingStatus: billing.billingStatus,
      billingLifecycleStatus: billing.lifecycleStatus,
      onboardingFeeAmount: billing.onboardingFeeAmount,
      onboardingFeePaid: billing.onboardingFeePaid,
      onboardingFeeStatus: billing.onboardingFeeStatus,
      onboardingFeeWaived: billing.onboardingFeeWaived,
      onboardingFeeInvoiceId: req.tenant.onboardingFeeInvoiceId || "",
      billingDetails: req.tenant.billingDetails || {},
      currentPeriodEnd: billing.currentPeriodEnd,
      foundersReserved: billing.foundersReserved,
      foundersSlot: billing.foundersSlot,
      foundersEligible: billing.foundersEligible
    },
    billing,
    catalog: getBillingCatalog(),
    foundersAvailability,
    usage: {
      members: memberCount,
      memberLimit: planLimit,
      memberUsagePercent: usagePct
    },
    mode,
    manageBillingUrl: portal.url || "",
    invoices: []
  });
});

router.post("/billing/checkout", async (req, res, next) => {
  try {
    const requested = String(req.body?.planCode || req.body?.billingPlan || "").trim().toLowerCase();
    if (requested && !VALID_BILLING_PLAN_CODES.has(requested)) {
      return res.status(400).json({
        error: {
          code: "INVALID_BILLING_PLAN",
          message: "Billing plan must be legacy, founders, or institutional."
        }
      });
    }

    const planCode = normalizeBillingPlan(requested, req.tenant.planTier);

    const checkout = await createTenantCheckoutSession({
      tenant: req.tenant,
      billingOperator: req.user,
      planCode,
      successUrl: req.body?.successUrl,
      cancelUrl: req.body?.cancelUrl
    });

    const updatedTenant = checkout?.tenant || (await TenantModel.findById(req.tenant._id));

    return res.status(201).json({
      ok: true,
      mode: checkout.mode,
      checkoutUrl: checkout.checkoutUrl,
      sessionId: checkout.sessionId || "",
      notes: checkout.message || "",
      billing: buildBillingPublicSnapshot(updatedTenant),
      catalog: getBillingCatalog()
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/settings", async (req, res) => {
  const [admins, pendingAdminInvites] = await Promise.all([
    UserModel.find(req.tenant._id, { roles: { $contains: ["tenant_admin"] } }, {
      select: ["id", "email", "roles", "createdAt"],
      sort: { createdAt: 1 }
    }),
    InviteModel.find(req.tenant._id, {
      roleToAssign: "tenant_admin",
      usedAt: null,
      expiresAt: { $gt: new Date() }
    }, {
      select: ["id", "email", "createdAt", "expiresAt"],
      sort: { createdAt: -1 }
    })
  ]);

  const draft = resolveDraft(req.tenant);
  const content = draft.content;
  const theme = draft.theme;
  const settings = draft.settings;
  const tenantUrls = buildTenantUrls(req.tenant);
  const websiteUrl = String(content.supportUrl || "").trim() || tenantUrls.appUrl;
  const directorUserId = await resolveDirectorUserId(req.tenant);

  return res.json({
    tenant: {
      id: toObjectIdString(req.tenant._id),
      slug: req.tenant.slug,
      name: req.tenant.name,
      domain: tenantUrls.domain,
      appUrl: tenantUrls.appUrl,
      status: req.tenant.status,
      onboardingStatus: req.tenant.onboardingStatus,
      planTier: req.tenant.planTier
    },
    identity: {
      campName: String(req.tenant.name || ""),
      networkName: content.networkDisplayName,
      homepageQuote: String(content.welcomeBody || "").trim(),
      tagline: String(content.welcomeBody || content.welcomeHeadline || "").trim(),
      aboutText: content.aboutText,
      contactEmail: content.contactEmail,
      websiteUrl
    },
    branding: {
      logoUrl: theme.logoUrl,
      heroImageUrl: theme.heroImageUrl,
      heroImagePosition: theme.heroImagePosition,
      heroImageSize: theme.heroImageSize,
      brandPrimary: theme.brandPrimary
    },
    access: {
      signupMode: settings.signupMode,
      accessCodeHint: settings.accessCodeHint || "",
      hasAccessCode: Boolean(settings.hasAccessCode),
      allowedEmailDomains: settings.allowedEmailDomains || [],
      requireProfileCompletion: Boolean(settings.requireProfileCompletion)
    },
    admins: admins.map((item) => ({
      id: toObjectIdString(item._id),
      email: item.email,
      role: toObjectIdString(item._id) === directorUserId ? "Director" : "Admin",
      addedAt: toIso(item.createdAt)
    })),
    pendingAdminInvites: pendingAdminInvites.map((item) => ({
      id: toObjectIdString(item._id),
      email: item.email,
      createdAt: toIso(item.createdAt),
      expiresAt: toIso(item.expiresAt)
    })),
    notifications: req.tenant.notificationPrefs || {},
    deletionRequest: req.tenant.deletionRequest || { status: "none" }
  });
});

router.patch("/settings/identity", async (req, res) => {
  const draft = resolveDraft(req.tenant);
  const content = draft.content || resolveContent(req.tenant);
  const nextHomepageQuote = sanitizeText(
    String(
      req.body?.homepageQuote ??
        req.body?.tagline ??
        (content.welcomeBody || content.welcomeHeadline || "")
    ).trim()
  );
  const next = {
    networkDisplayName: sanitizeText(String(req.body?.networkName ?? (content.networkDisplayName || "")).trim()),
    welcomeBody: nextHomepageQuote,
    aboutText: sanitizeText(String(req.body?.aboutText ?? (content.aboutText || "")).trim()),
    contactEmail: normalizeEmail(req.body?.contactEmail ?? (content.contactEmail || "")),
    supportUrl: String(req.body?.websiteUrl ?? (content.supportUrl || "")).trim()
  };

  if (next.contactEmail && !isEmail(next.contactEmail)) {
    return res.status(400).json({
      error: {
        code: "INVALID_CONTACT_EMAIL",
        message: "Provide a valid contact email."
      }
    });
  }

  const tenant = await TenantModel.update(req.tenant._id, {
    content: { ...content, ...next },
    onboardingDraft: {
      ...draft,
      content: { ...draft.content, ...next },
      updatedAt: new Date(),
      updatedByUserId: req.user.id
    }
  });

  return res.json({ ok: true, identity: resolveContent(tenant) });
});

router.patch("/settings/branding", async (req, res) => {
  const draft = resolveDraft(req.tenant);
  const theme = draft.theme || resolveTheme(req.tenant);
  const next = resolveTheme({
    theme: {
      ...theme,
      ...req.body,
      brandPrimary: String(req.body?.brandPrimary ?? (theme.brandPrimary || "")).trim(),
      logoUrl: String(req.body?.logoUrl ?? (theme.logoUrl || "")).trim(),
      heroImageUrl: String(req.body?.heroImageUrl ?? (theme.heroImageUrl || "")).trim(),
      heroImagePosition: String(req.body?.heroImagePosition ?? (theme.heroImagePosition || "")).trim(),
      heroImageSize: String(req.body?.heroImageSize ?? (theme.heroImageSize || "")).trim()
    }
  });

  const currentTheme = req.tenant.theme || {};
  const tenant = await TenantModel.update(req.tenant._id, {
    theme: {
      ...currentTheme,
      brandPrimary: next.brandPrimary || theme.brandPrimary,
      logoUrl: next.logoUrl,
      heroImageUrl: next.heroImageUrl,
      heroImagePosition: next.heroImagePosition,
      heroImageSize: next.heroImageSize
    },
    onboardingDraft: {
      ...draft,
      theme: {
        ...draft.theme,
        brandPrimary: next.brandPrimary || theme.brandPrimary,
        logoUrl: next.logoUrl,
        heroImageUrl: next.heroImageUrl,
        heroImagePosition: next.heroImagePosition,
        heroImageSize: next.heroImageSize
      },
      updatedAt: new Date(),
      updatedByUserId: req.user.id
    }
  });

  return res.json({ ok: true, branding: resolveDraft(tenant).theme });
});

router.patch("/settings/access", async (req, res) => {
  const signupMode = normalizeSignupMode(req.body?.signupMode || "open");
  const draft = resolveDraft(req.tenant);
  let settings;
  try {
    settings = await buildSettingsStorePayload(
      {
        ...draft.settings,
        signupMode,
        accessCode: req.body?.accessCode,
        allowedEmailDomains: parseList(req.body?.allowedEmailDomains || req.body?.allowedDomains || [])
      },
      req.tenant
    );
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      error: {
        code: error.code || "INVALID_ACCESS_SETTINGS",
        message: error.message
      }
    });
  }

  settings.requireProfileCompletion = Boolean(req.body?.requireProfileCompletion);
  const currentAccessSettings = req.tenant.accessSettings || {};
  const tenant = await TenantModel.update(req.tenant._id, {
    settings,
    accessSettings: {
      ...currentAccessSettings,
      signupMode,
      accessCode: ""
    },
    onboardingDraft: {
      ...draft,
      settings: {
        ...draft.settings,
        ...settings,
        signupMode,
        requireProfileCompletion: settings.requireProfileCompletion,
        hasAccessCode: Boolean(settings.accessCodeHash)
      },
      updatedAt: new Date(),
      updatedByUserId: req.user.id
    }
  });

  await writeAdminAudit(req, "admin_access_settings_updated", {
    signupMode,
    requireProfileCompletion: Boolean(settings.requireProfileCompletion),
    hasAccessCode: Boolean(settings.accessCodeHash)
  });
  return res.json({ ok: true, access: resolveDraft(tenant).settings });
});

router.get("/settings/admins", async (req, res) => {
  const [admins, pending] = await Promise.all([
    UserModel.find(req.tenant._id, { roles: { $contains: ["tenant_admin"] } }, {
      select: ["id", "email", "createdAt"],
      sort: { createdAt: 1 }
    }),
    InviteModel.find(req.tenant._id, {
      roleToAssign: "tenant_admin",
      usedAt: null,
      expiresAt: { $gt: new Date() }
    }, {
      select: ["id", "email", "createdAt", "expiresAt"],
      sort: { createdAt: -1 }
    })
  ]);

  const adminUserIds = admins.map((item) => toObjectIdString(item._id)).filter(Boolean);
  const adminProfiles = adminUserIds.length
    ? await ProfileModel.find(req.tenant._id, { userId: { $in: adminUserIds } }, {
        select: ["id", "userId", "firstName", "lastName"]
      })
    : [];
  const profileByUserId = new Map(
    adminProfiles.map((profile) => [toObjectIdString(profile.userId), profile])
  );
  const directorUserId = await resolveDirectorUserId(req.tenant);

  return res.json({
    admins: admins.map((item) => ({
      id: toObjectIdString(item._id),
      name:
        `${profileByUserId.get(toObjectIdString(item._id))?.firstName || ""} ${
          profileByUserId.get(toObjectIdString(item._id))?.lastName || ""
        }`.trim() || "",
      email: item.email,
      role: toObjectIdString(item._id) === directorUserId ? "Director" : "Admin",
      addedAt: toIso(item.createdAt)
    })),
    pendingInvites: pending.map((item) => ({
      id: toObjectIdString(item._id),
      email: item.email,
      createdAt: toIso(item.createdAt),
      expiresAt: toIso(item.expiresAt)
    }))
  });
});

router.get("/settings/admins/search", async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q) return res.json({ items: [] });
  const limit = toBoundedInt(req.query.limit, { min: 1, max: 25, fallback: 8 });
  const profiles = await ProfileModel.search(req.tenant._id, q, { limit: Math.max(limit * 3, 24) });
  const userIds = [...new Set(profiles.map((profile) => toObjectIdString(profile.userId)).filter(Boolean))];
  if (!userIds.length) return res.json({ items: [] });

  const users = await UserModel.find(req.tenant._id, { _id: { $in: userIds } }, {
    select: ["id", "email", "roles", "status", "createdAt"]
  });
  const usersById = new Map(users.map((user) => [toObjectIdString(user._id), user]));
  const seen = new Set();
  const items = [];

  for (const profile of profiles) {
    const userId = toObjectIdString(profile.userId);
    if (!userId || seen.has(userId)) continue;
    const user = usersById.get(userId);
    if (!user) continue;
    seen.add(userId);
    items.push({
      id: toObjectIdString(profile._id),
      userId,
      fullName: `${profile.firstName || ""} ${profile.lastName || ""}`.trim() || user.email || "Member",
      email: profile?.emails?.find(Boolean) || user.email || "",
      roleAtCamp: profile.roleAtCamp || "",
      location: profile.cityState || "",
      avatarUrl: profile.avatarUrl || "",
      status: profile.status || user.status || "active",
      isAdmin: hasDirectorRole(user.roles || [])
    });
    if (items.length >= limit) break;
  }

  return res.json({ items });
});

router.post("/settings/admins/grant", async (req, res) => {
  const userId = String(req.body?.userId || "").trim();
  const email = normalizeEmail(req.body?.email || "");
  if (!userId && !email) {
    return res.status(400).json({
      error: {
        code: "USER_REQUIRED",
        message: "Select a network member to grant admin access."
      }
    });
  }

  const user =
    (userId ? await UserModel.findOne(req.tenant._id, { _id: userId }) : null) ||
    (email ? await UserModel.findOne(req.tenant._id, { email }) : null);

  if (!user) {
    return res.status(404).json({
      error: {
        code: "USER_NOT_FOUND",
        message: "That member could not be found in this network."
      }
    });
  }

  const roleSet = new Set((user.roles || []).map((role) => String(role || "").trim()).filter(Boolean));
  roleSet.add("tenant_admin");
  roleSet.add("user");
  const updated = await UserModel.update(user._id, { roles: [...roleSet] });
  await writeAdminAudit(req, "admin_role_granted", {
    targetUserId: toObjectIdString(updated._id),
    targetEmail: updated.email,
    role: "tenant_admin"
  });

  return res.status(201).json({
    ok: true,
    admin: {
      id: toObjectIdString(updated._id),
      email: updated.email,
      roles: updated.roles || [...roleSet]
    }
  });
});

router.post("/settings/admins/invite", inviteSendLimiter, async (req, res) => {
  const email = normalizeEmail(req.body?.email || "");
  if (!isEmail(email)) {
    return res.status(400).json({
      error: { code: "INVALID_EMAIL", message: "Provide a valid email address." }
    });
  }

  const existing = await UserModel.findOne(req.tenant._id, { email });
  if (existing) {
    const roles = new Set(existing.roles || []);
    roles.add("tenant_admin");
    roles.add("user");
    await UserModel.update(existing._id, { roles: [...roles] });
    await writeAdminAudit(req, "admin_role_granted", {
      targetUserId: toObjectIdString(existing._id),
      targetEmail: existing.email,
      role: "tenant_admin",
      promotedExistingUser: true
    });
    return res.status(201).json({ ok: true, promotedExistingUser: true });
  }

  const expiresInDays = toBoundedInt(req.body?.expiresInDays, {
    min: 1,
    max: 30,
    fallback: env.INVITE_EXPIRES_DAYS
  });
  const { invite, token } = await createInviteRecord({
    tenantId: req.tenant._id,
    email,
    roleToAssign: "tenant_admin",
    createdByUserId: req.user.id,
    expiresInDays
  });

  await sendInviteEmail({
    tenant: req.tenant,
    email,
    token,
    roleToAssign: "tenant_admin",
    expiresAt: invite.expiresAt
  }).catch((error) => {
    console.warn("[email] director invite failed", {
      tenantId: String(req.tenant._id || ""),
      email,
      message: String(error?.message || "")
    });
  });
  await writeAdminAudit(req, "admin_invite_created", {
    inviteId: toObjectIdString(invite._id),
    email: invite.email,
    roleToAssign: "tenant_admin"
  });

  return res.status(201).json({
    ok: true,
    invite: {
      id: toObjectIdString(invite._id),
      email: invite.email,
      expiresAt: toIso(invite.expiresAt)
    }
  });
});

router.delete("/settings/admins/:userId", async (req, res) => {
  const userId = String(req.params.userId || "").trim();
  const admins = await UserModel.find(req.tenant._id, { roles: { $contains: ["tenant_admin"] } }, {
    select: ["id"]
  });
  if (admins.length <= 1) {
    return res.status(400).json({
      error: {
        code: "LAST_DIRECTOR_PROTECTED",
        message: "Cannot remove the last director/admin from this network."
      }
    });
  }

  const user = await UserModel.findOne(req.tenant._id, { _id: userId });
  if (!user) {
    return res.status(404).json({
      error: { code: "USER_NOT_FOUND", message: "Admin user not found." }
    });
  }

  let roles = (user.roles || []).filter((role) => role !== "tenant_admin");
  if (!roles.includes("user")) roles.push("user");
  await UserModel.update(user._id, { roles });
  await writeAdminAudit(req, "admin_role_revoked", {
    targetUserId: toObjectIdString(user._id),
    targetEmail: user.email,
    role: "tenant_admin"
  });

  return res.json({ ok: true });
});

router.patch("/settings/notifications", async (req, res) => {
  const current = req.tenant.notificationPrefs || {};
  const next = {
    newMemberJoined:
      req.body?.newMemberJoined !== undefined
        ? Boolean(req.body.newMemberJoined)
        : Boolean(current.newMemberJoined),
    approvalRequests:
      req.body?.approvalRequests !== undefined
        ? Boolean(req.body.approvalRequests)
        : Boolean(current.approvalRequests),
    memberFlagged:
      req.body?.memberFlagged !== undefined
        ? Boolean(req.body.memberFlagged)
        : Boolean(current.memberFlagged),
    weeklySummary:
      req.body?.weeklySummary !== undefined
        ? Boolean(req.body.weeklySummary)
        : Boolean(current.weeklySummary)
  };

  const tenant = await TenantModel.update(req.tenant._id, { notificationPrefs: next });

  return res.json({ ok: true, notifications: tenant.notificationPrefs || next });
});

router.post("/settings/pause", async (req, res) => {
  const paused = Boolean(req.body?.paused !== false);
  const tenant = await TenantModel.update(req.tenant._id, {
    status: paused ? "inactive" : "active"
  });
  await writeAdminAudit(req, "admin_network_paused_toggled", {
    paused,
    nextStatus: tenant.status
  });

  return res.json({
    ok: true,
    status: tenant.status
  });
});

router.post("/settings/delete-request", async (req, res) => {
  const note = sanitizeText(String(req.body?.note || "").trim());
  const currentDeletionRequest = req.tenant.deletionRequest || {};
  const tenant = await TenantModel.update(req.tenant._id, {
    deletionRequest: {
      ...currentDeletionRequest,
      status: "requested",
      requestedAt: new Date(),
      requestedByUserId: req.user.id,
      note
    }
  });
  await writeAdminAudit(req, "admin_delete_request_submitted", {
    noteLength: note.length
  });

  return res.json({
    ok: true,
    deletionRequest: tenant.deletionRequest || {}
  });
});

router.get("/overview", async (req, res) => {
  const tenantId = req.tenant._id;
  const [userCount, profileCount] = await Promise.all([
    UserModel.count(tenantId),
    ProfileModel.count(tenantId)
  ]);

  res.json({
    tenant: safeTenant(req.tenant),
    counts: { users: userCount, profiles: profileCount }
  });
});

router.get("/profiles", async (req, res) => {
  const q = String(req.query.q || "").trim();

  let profiles = await ProfileModel.find(req.tenant._id, {}, {
    sort: { lastName: 1, firstName: 1 }
  });

  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    profiles = profiles.filter((p) =>
      rx.test(p.firstName || "") ||
      rx.test(p.lastName || "") ||
      (p.emails || []).some((e) => rx.test(e))
    );
  }

  res.json({ total: profiles.length, items: profiles });
});

router.get("/analytics", async (req, res, next) => {
  try {
    const snapshot = await getTenantAnalyticsSnapshot({ tenantId: req.tenant._id });
    return res.json({
      tenant: {
        id: String(req.tenant._id),
        slug: req.tenant.slug,
        name: req.tenant.name
      },
      analytics: snapshot
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/invites", async (req, res) => {
  const status = String(req.query.status || "pending").trim().toLowerCase();
  const now = new Date();
  const filter = {};

  if (status === "pending") {
    filter.usedAt = null;
    filter.expiresAt = { $gt: now };
  } else if (status === "used") {
    filter.usedAt = { $ne: null };
  } else if (status === "expired") {
    filter.usedAt = null;
    filter.expiresAt = { $lte: now };
  }

  const invites = await InviteModel.find(req.tenant._id, filter, {
    sort: { createdAt: -1 },
    limit: 500
  });

  return res.json({
    total: invites.length,
    items: invites.map((invite) => ({
      id: String(invite._id),
      email: invite.email,
      roleToAssign: invite.roleToAssign,
      expiresAt: invite.expiresAt,
      usedAt: invite.usedAt,
      createdAt: invite.createdAt
    }))
  });
});

router.post("/invites/send", inviteSendLimiter, inviteUpload.single("file"), async (req, res, next) => {
  try {
    const roleToAssign = String(req.body.roleToAssign || "user").trim();
    if (!["user", "tenant_admin"].includes(roleToAssign)) {
      return res.status(400).json({
        error: {
          code: "INVALID_ROLE",
          message: "roleToAssign must be 'user' or 'tenant_admin'."
        }
      });
    }

    const expiresInDays = toBoundedInt(req.body.expiresInDays, {
      min: 1,
      max: 30,
      fallback: env.INVITE_EXPIRES_DAYS
    });

    let recipientsFromPayload = [];
    try {
      recipientsFromPayload = parseInviteRowsFromRecipientsPayload(req.body.recipients);
    } catch (parseError) {
      return res.status(400).json({
        error: {
          code: "INVALID_RECIPIENTS",
          message: parseError.message || "Invalid recipients payload."
        }
      });
    }

    const recipients = mergeInviteRows(
      recipientsFromPayload,
      parseInviteRowsFromText(req.body.emails || ""),
      parseInviteRowsFromCsv(req.file?.buffer || null)
    );

    if (recipients.length === 0) {
      return res.status(400).json({
        error: {
          code: "RECIPIENTS_REQUIRED",
          message: "Provide at least one valid recipient in rows, text, or CSV."
        }
      });
    }

    let createdCount = 0;
    let sentCount = 0;
    const skipped = [];

    for (const recipient of recipients) {
      const email = recipient.email;
      const existingUser = await UserModel.findOne(req.tenant._id, { email });
      if (existingUser) {
        skipped.push({ email, reason: "USER_EXISTS" });
        continue;
      }

      const { invite, token } = await createInviteRecord({
        tenantId: req.tenant._id,
        email,
        roleToAssign,
        createdByUserId: req.user.id,
        expiresInDays
      });
      createdCount += 1;

      try {
        await sendInviteEmail({
          tenant: req.tenant,
          email,
          token,
          roleToAssign,
          expiresAt: invite.expiresAt,
          firstName: recipient.firstName || "",
          lastName: recipient.lastName || ""
        });
        sentCount += 1;
      } catch (error) {
        skipped.push({ email, reason: `EMAIL_SEND_FAILED: ${error.message}` });
      }
    }

    await writeAdminAudit(req, "admin_invites_sent", {
      roleToAssign,
      attemptedCount: recipients.length,
      createdCount,
      sentCount,
      skippedCount: skipped.length
    });

    return res.status(201).json({
      ok: true,
      attemptedCount: recipients.length,
      createdCount,
      sentCount,
      skipped
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/import-csv", csvUpload.single("file"), async (req, res) => {
  return res.status(410).json({
    error: {
      code: "MEMBER_IMPORT_DISABLED",
      message:
        "Member import is disabled. Use Invite Members so people create their own accounts."
    }
  });
});

router.get("/imports/:reportId/failures.csv", async (req, res) => {
  const report = await findImportReportForTenant({
    tenantId: req.tenant._id,
    reportId: req.params.reportId
  });

  if (!report) {
    return res.status(404).json({
      error: {
        code: "IMPORT_REPORT_NOT_FOUND",
        message: "Import report not found"
      }
    });
  }

  if (!report.failureCsv) {
    return res.status(404).json({
      error: {
        code: "IMPORT_FAILURES_NOT_FOUND",
        message: "This import report has no failure CSV."
      }
    });
  }

  res.setHeader("Content-Type", "text/csv");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${req.tenant.slug}-import-failures-${report._id}.csv"`
  );
  return res.send(report.failureCsv);
});

router.delete("/profiles/:profileId", async (req, res, next) => {
  try {
    const profileId = String(req.params.profileId || "").trim();
    const profile = await ProfileModel.findOne(req.tenant._id, {
      _id: profileId
    });

    if (!profile) {
      return res.status(404).json({
        error: { code: "PROFILE_NOT_FOUND", message: "Profile not found" }
      });
    }

    const userId = toObjectIdString(profile.userId);
    if (!userId) {
      await ProfileModel.delete(profile._id);
      await writeAdminAudit(req, "admin_member_hard_deleted", {
        profileId: toObjectIdString(profile._id),
        userId: "",
        summary: { profileDeleted: 1, userDeleted: 0 }
      });
      return res.json({ ok: true, deletedProfileId: profileId, deletedUserId: "" });
    }

    if (String(userId) === String(req.user.id || "")) {
      return res.status(400).json({
        error: {
          code: "CANNOT_DELETE_SELF",
          message: "You cannot delete your own account from this network."
        }
      });
    }

    const user = await UserModel.findOne(req.tenant._id, { _id: userId });
    if (!user) {
      await ProfileModel.delete(profile._id);
      await writeAdminAudit(req, "admin_member_hard_deleted", {
        profileId: toObjectIdString(profile._id),
        userId,
        summary: { profileDeleted: 1, userDeleted: 0 }
      });
      return res.json({
        ok: true,
        deletedProfileId: profileId,
        deletedUserId: userId,
        summary: {
          profileDeleted: 1,
          userDeleted: 0
        }
      });
    }

    if (hasDirectorRole(user.roles || [])) {
      const tenantUsers = await UserModel.find(req.tenant._id, {}, { select: ["id", "roles"] });
      const adminCount = tenantUsers.filter((item) => hasDirectorRole(item?.roles || [])).length;
      if (adminCount <= 1) {
        return res.status(400).json({
          error: {
            code: "LAST_ADMIN_PROTECTED",
            message: "Cannot delete the last director/admin from this network."
          }
        });
      }
    }

    const summary = await deleteMemberFromTenant({
      tenantId: req.tenant._id,
      userId,
      profileId: toObjectIdString(profile._id),
      email: profile?.emails?.[0] || user?.email || ""
    });
    await writeAdminAudit(req, "admin_member_hard_deleted", {
      profileId: toObjectIdString(profile._id),
      userId,
      summary
    });

    return res.json({
      ok: true,
      deletedProfileId: profileId,
      deletedUserId: userId,
      summary
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/export/csv/fields", async (_req, res) => {
  return res.json({
    defaultFields: MEMBER_EXPORT_DEFAULT_FIELDS,
    fields: MEMBER_EXPORT_FIELDS.map((field) => ({
      key: field.key,
      label: field.label,
      description: field.description
    }))
  });
});

router.get("/export/csv", exportLimiter, async (req, res) => {
  const profiles = await ProfileModel.find(req.tenant._id, {}, {
    sort: { lastName: 1, firstName: 1 }
  });
  const fieldOrder = normalizeMemberExportFieldOrder(req.query?.fields || "");
  const columns = fieldOrder
    .map((key) => MEMBER_EXPORT_FIELD_MAP.get(key))
    .filter(Boolean);

  const records = profiles.map((profile) => {
    const row = {};
    for (const column of columns) {
      row[column.key] = sanitizeCsvCell(column.getValue(profile));
    }
    return row;
  });

  const csv = stringify(records, {
    header: true,
    columns: columns.map((column) => ({
      key: column.key,
      header: column.label
    }))
  });

  res.setHeader("Content-Type", "text/csv");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${req.tenant.slug}-directory-export.csv"`
  );
  return res.send(csv);
});

router.get("/export/pdf", exportLimiter, requireFeature("pdfExport"), async (req, res) => {
  const profiles = await ProfileModel.find(req.tenant._id, {}, {
    sort: { lastName: 1, firstName: 1 }
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${req.tenant.slug}-directory-export.pdf"`
  );

  const doc = new PDFDocument({ margin: 40 });
  doc.pipe(res);

  doc.fontSize(18).text(`${req.tenant.name} Alumni Directory`, { underline: true });
  doc.moveDown(0.8);

  let currentLetter = "";
  for (const profile of profiles) {
    const letter = (profile.lastName?.[0] || "#").toUpperCase();
    if (letter !== currentLetter) {
      currentLetter = letter;
      doc.moveDown(0.6);
      doc.fontSize(14).fillColor("#002b5c").text(letter);
      doc.fillColor("black");
    }

    doc
      .fontSize(10)
      .text(
        `${profile.lastName}, ${profile.firstName} | ${profile.emails?.[0] || ""} | ${
          profile.cityState || ""
        } | ${profile.roleAtCamp || ""}`
      );
  }

  doc.end();
});

router.put("/access-settings", async (req, res) => {
  const signupMode = normalizeSignupMode(req.body.signupMode || "open");

  let nextSettings;
  try {
    nextSettings = await buildSettingsStorePayload(
      { ...resolveSettings(req.tenant), ...req.body, signupMode },
      req.tenant
    );
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      error: {
        code: error.code || "INVALID_SETTINGS",
        message: error.message
      }
    });
  }

  const currentAccessSettings = req.tenant.accessSettings || {};
  const tenant = await TenantModel.update(req.tenant._id, {
    settings: nextSettings,
    accessSettings: {
      ...currentAccessSettings,
      signupMode: signupMode === "invite" ? "invite_only" : signupMode,
      accessCode: ""
    }
  });

  res.json({ tenant: safeTenant(tenant) });
});

router.put("/branding", async (req, res) => {
  const theme = resolveTheme({ theme: req.body.theme || {} });

  const currentTheme = req.tenant.theme || {};
  const tenant = await TenantModel.update(req.tenant._id, {
    theme: {
      ...currentTheme,
      brandPrimary: String(theme.brandPrimary || currentTheme.brandPrimary),
      brandSecondary: String(theme.brandSecondary || currentTheme.brandSecondary),
      bg: String(theme.bg || currentTheme.bg),
      text: String(theme.text || currentTheme.text),
      card: String(theme.card || currentTheme.card),
      logoUrl: String(theme.logoUrl || currentTheme.logoUrl),
      heroImageUrl: String(theme.heroImageUrl || currentTheme.heroImageUrl),
      heroImagePosition: String(theme.heroImagePosition || currentTheme.heroImagePosition),
      heroImageSize: String(theme.heroImageSize || currentTheme.heroImageSize),
      typography: String(theme.typography || currentTheme.typography)
    },
    onboardingStatus: "in_progress"
  });

  res.json({ tenant: safeTenant(tenant) });
});

router.put("/onboarding/publish", async (req, res) => {
  const tenant = await TenantModel.update(req.tenant._id, {
    onboardingStatus: "live"
  });

  res.json({ tenant: safeTenant(tenant) });
});

export default router;
