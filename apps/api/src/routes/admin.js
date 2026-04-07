import { Router } from "express";
import crypto from "crypto";
import multer from "multer";
import rateLimit from "express-rate-limit";
import PDFDocument from "pdfkit";
import { stringify } from "csv-stringify/sync";
import { parse as parseCsv } from "csv-parse/sync";
import {
  alumniPluralForCampType,
  hasFeature,
  listFeaturesForPlan,
  normalizeCampType,
  replaceAlumniForCampType
} from "@pondbridge/shared";
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
  EmailSuppressionModel,
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
  buildTenantEmailBranding,
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
  cancelTenantSubscription,
  createBillingPortalUrl,
  createTenantCheckoutSession,
  getBillingCatalog,
  getBillingMode,
  getFoundersAvailability,
  getTenantSubscriptionStatus,
  listRecentTenantInvoices,
  resumeTenantSubscription
} from "../services/billing.js";
import {
  normalizeBillingPlan,
  resolveTenantBilling,
  resolveTenantFeatureTier
} from "../services/billingState.js";
import { hashPassword } from "../utils/auth.js";
import { sanitizeText, sanitizeHtmlContent } from "../utils/sanitize.js";
import { buildTenantUrls } from "../utils/domainProvisioning.js";
import { ensureTenantMobileAppCode } from "../utils/mobileAppCode.js";
import { createTtlCache } from "../utils/ttlCache.js";
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
const supportRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) =>
    [
      "admin-support",
      String(req.params?.slug || req.tenant?.slug || ""),
      String(req.user?.id || ""),
      String(req.ip || "")
    ].join(":"),
  message: {
    error: {
      code: "RATE_LIMITED",
      message: "Too many support requests. Please wait before sending another."
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
const SUPPORT_REQUEST_TOPICS = new Set([
  "general",
  "billing",
  "branding",
  "members",
  "email",
  "integrations",
  "bug"
]);
const SUPPORT_REQUEST_PRIORITIES = new Set(["low", "normal", "high", "urgent"]);

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

function hasDemoAccessEnabled(tenant = null) {
  const settings = tenant?.settings && typeof tenant.settings === "object" ? tenant.settings : {};
  const demoAccess = settings.demoAccess && typeof settings.demoAccess === "object" ? settings.demoAccess : {};
  return Boolean(demoAccess.enabled && String(demoAccess.codeHash || "").trim());
}

function ensureBillingVisibleForTenant(req, res, next) {
  if (hasDemoAccessEnabled(req.tenant)) {
    return res.status(404).json({
      error: {
        code: "DEMO_BILLING_HIDDEN",
        message: "Billing is hidden for demo networks."
      }
    });
  }
  return next();
}

function normalizeEmail(value = "") {
  return String(value || "").trim().toLowerCase();
}

function isEmail(value = "") {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

const SUPPORT_CONTACT_EMAIL = "support@pondbridgealumni.com";

function resolveSupportContactEmail() {
  return SUPPORT_CONTACT_EMAIL;
}

function normalizeIdentityLabelList(value = [], fallback = []) {
  const source = Array.isArray(value)
    ? value
    : String(value || "")
        .split(/\r?\n|,/)
        .map((item) => String(item || "").trim());
  const seen = new Set();
  const labels = [];
  for (const item of source) {
    const label = sanitizeText(String(item || "").trim()).slice(0, 64);
    const key = label.toLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    labels.push(label);
    if (labels.length >= 20) break;
  }
  if (labels.length) return labels;

  const fallbackList = Array.isArray(fallback) ? fallback : [];
  return fallbackList
    .map((item) => sanitizeText(String(item || "").trim()).slice(0, 64))
    .filter(Boolean)
    .slice(0, 20);
}

const EMAIL_FOOTER_PRESET_LIMIT = 20;

function escapeEmailHtml(value = "") {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeEmailFooterPresetName(value = "") {
  return sanitizeText(String(value || "").trim()).slice(0, 72);
}

function normalizeEmailFooterField(value = "", max = 140) {
  return sanitizeText(String(value || "").trim()).slice(0, max);
}

function normalizeHttpUrl(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    return url.toString();
  } catch {
    return "";
  }
}

function normalizeEmailFooterData(value = {}, fallback = {}) {
  const source = value && typeof value === "object" ? value : {};
  const base = fallback && typeof fallback === "object" ? fallback : {};
  const senderEmailRaw = normalizeEmailFooterField(source.senderEmail ?? base.senderEmail ?? "", 160).toLowerCase();
  const logoUrlRaw = normalizeHttpUrl(source.logoUrl ?? base.logoUrl ?? "");
  const signOff = normalizeEmailFooterField(source.signOff ?? base.signOff ?? "Warmly,", 80);
  return {
    headerTagline: normalizeEmailFooterField(source.headerTagline ?? base.headerTagline ?? "Community update", 72) || "Community update",
    signOff: signOff || "Warmly,",
    senderName: normalizeEmailFooterField(source.senderName ?? base.senderName ?? "", 120),
    senderRole: normalizeEmailFooterField(source.senderRole ?? base.senderRole ?? "Director", 120),
    senderEmail: isEmail(senderEmailRaw) ? senderEmailRaw : "",
    senderPhone: normalizeEmailFooterField(source.senderPhone ?? base.senderPhone ?? "", 48),
    showLogo: source.showLogo !== undefined ? Boolean(source.showLogo) : base.showLogo !== false,
    logoUrl: logoUrlRaw
  };
}

function normalizeEmailFooterPresetList(value = [], { fallbackFooter = null } = {}) {
  const source = Array.isArray(value) ? value : [];
  const fallback = normalizeEmailFooterData(
    fallbackFooter || {},
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
  const presets = [];
  const seenIds = new Set();

  for (let index = 0; index < source.length; index += 1) {
    const item = source[index] || {};
    const id = sanitizeText(String(item?.id || "").trim()).slice(0, 90) ||
      `footer_${index + 1}`;
    if (!id || seenIds.has(id)) continue;
    const name = normalizeEmailFooterPresetName(item?.name || "");
    if (!name) continue;
    seenIds.add(id);
    presets.push({
      id,
      name,
      footer: normalizeEmailFooterData(item?.footer || {}, fallback),
      updatedAt: String(item?.updatedAt || "")
    });
    if (presets.length >= EMAIL_FOOTER_PRESET_LIMIT) break;
  }

  if (presets.length === 0) {
    return [
      {
        id: "default_footer",
        name: "Default Footer",
        footer: fallback,
        updatedAt: ""
      }
    ];
  }

  return presets;
}

function profileDisplayName(profile = null, user = null) {
  const profileName = [String(profile?.firstName || "").trim(), String(profile?.lastName || "").trim()]
    .filter(Boolean)
    .join(" ");
  if (profileName) return profileName;

  const userName = [String(user?.firstName || "").trim(), String(user?.lastName || "").trim()]
    .filter(Boolean)
    .join(" ");
  if (userName) return userName;

  return sanitizeText(String(user?.name || "").trim()).slice(0, 120);
}

async function resolveDirectorFooterDefaults({ tenant, user }) {
  const tenantId = tenant?._id;
  const userId = String(user?.id || user?._id || "").trim();
  const [userRecord, profile] = await Promise.all([
    userId ? UserModel.findOne(tenantId, { _id: userId }) : null,
    userId
      ? ProfileModel.findOne(tenantId, { userId }, {
          select: ["firstName", "lastName", "emails", "phones", "roleAtCamp"]
        })
      : null
  ]);
  const theme = resolveTheme(tenant);
  const userRoles = Array.isArray(user?.roles) ? user.roles.map((role) => String(role || "").toLowerCase()) : [];
  const defaultRole = userRoles.includes("tenant_admin") ? "Director" : "Admin";
  const senderName = profileDisplayName(profile, userRecord || user);
  const senderEmail = normalizeEmail(
    String(profile?.emails?.[0] || userRecord?.email || user?.email || "").trim()
  );
  const senderPhone = normalizeEmailFooterField(String(profile?.phones?.[0] || "").trim(), 48);
  const senderRole = normalizeEmailFooterField(String(profile?.roleAtCamp || defaultRole).trim(), 120) || defaultRole;

  return normalizeEmailFooterData(
    {
      signOff: "Warmly,",
      headerTagline: "Community update",
      senderName,
      senderRole,
      senderEmail,
      senderPhone,
      showLogo: true,
      logoUrl: theme.logoUrl || ""
    },
    {}
  );
}

async function resolveDirectorEmailFooterSettings({ tenant, user }) {
  const content = resolveContent(tenant);
  const fallbackFooter = await resolveDirectorFooterDefaults({ tenant, user });
  const presets = normalizeEmailFooterPresetList(content.emailFooterPresets || [], {
    fallbackFooter
  });
  const requestedDefaultId = sanitizeText(String(content.defaultEmailFooterPresetId || "").trim()).slice(0, 90);
  const defaultPreset = presets.find((item) => item.id === requestedDefaultId) || presets[0];
  return {
    presets,
    defaultPresetId: String(defaultPreset?.id || ""),
    activeFooter: normalizeEmailFooterData(defaultPreset?.footer || {}, fallbackFooter),
    fallbackFooter
  };
}

function toPlainTextFromHtml(html = "") {
  const withLineBreaks = String(html || "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<li>/gi, "- ")
    .replace(/<\/li>/gi, "\n");
  return sanitizeText(withLineBreaks).replace(/\n{3,}/g, "\n\n").trim();
}

function buildDirectorBroadcastEmailContent({ tenant, subject = "", bodyHtml = "", footer = {} }) {
  const theme = resolveTheme(tenant);
  const content = resolveContent(tenant);
  const safeSubject = sanitizeText(String(subject || "").trim()).slice(0, 160) || "Update from your network";
  const safeBodyHtml = sanitizeHtmlContent(String(bodyHtml || "").trim());
  const normalizedFooter = normalizeEmailFooterData(footer, {
    signOff: "Warmly,",
    headerTagline: "Community update",
    senderName: "",
    senderRole: "Director",
    senderEmail: "",
    senderPhone: "",
    showLogo: true,
    logoUrl: theme.logoUrl || ""
  });
  const tenantName = escapeEmailHtml(String(content.networkDisplayName || tenant?.name || "Your Camp").trim());
  const brandPrimary = String(theme.brandPrimary || "#002b5c").trim() || "#002b5c";
  const bodyText = toPlainTextFromHtml(safeBodyHtml);
  const footerContactParts = [normalizedFooter.senderEmail, normalizedFooter.senderPhone].filter(Boolean);
  const footerContact = escapeEmailHtml(footerContactParts.join("  •  "));
  const safeSignOff = escapeEmailHtml(normalizedFooter.signOff || "Warmly,");
  const safeSenderName = escapeEmailHtml(normalizedFooter.senderName || "");
  const safeSenderRole = escapeEmailHtml(normalizedFooter.senderRole || "");
  const safeHeaderTagline = escapeEmailHtml(normalizedFooter.headerTagline || "Community update");
  const headerLogoUrl = normalizeHttpUrl(theme.logoUrl || "");
  const footerLogoUrl = normalizedFooter.showLogo
    ? normalizeHttpUrl(theme.logoUrl || normalizedFooter.logoUrl || "")
    : "";
  const headerLogoMarkup = headerLogoUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="width:42px;height:42px;border-radius:10px;overflow:hidden;border:1px solid rgba(255,255,255,0.28);background:rgba(255,255,255,0.14);"><tr><td align="center" valign="middle" style="width:42px;height:42px;line-height:0;"><img src="${escapeEmailHtml(headerLogoUrl)}" alt="" style="display:block;max-width:38px;max-height:38px;width:auto;height:auto;border:0;outline:none;text-decoration:none;" /></td></tr></table>`
    : `<div style="width:42px;height:42px;border-radius:10px;background:rgba(255,255,255,0.18);color:#ffffff;font-family:Arial,sans-serif;font-size:12px;font-weight:700;line-height:42px;text-align:center;">PB</div>`;
  const footerLogoMarkup = footerLogoUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="width:52px;height:52px;border-radius:10px;overflow:hidden;border:1px solid #dbe6f3;background:#ffffff;"><tr><td align="center" valign="middle" style="width:52px;height:52px;line-height:0;"><img src="${escapeEmailHtml(footerLogoUrl)}" alt="" style="display:block;max-width:46px;max-height:46px;width:auto;height:auto;border:0;outline:none;text-decoration:none;" /></td></tr></table>`
    : "";
  const safeBodyForEmail = safeBodyHtml || "<p style=\"margin:0;\">&nbsp;</p>";

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#eef3fa;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef3fa;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;border-radius:18px;overflow:hidden;background:#ffffff;border:1px solid #d6e2f0;">
            <tr>
              <td style="padding:18px 20px;background:${escapeEmailHtml(brandPrimary)};color:#ffffff;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="width:52px;vertical-align:middle;">${headerLogoMarkup}</td>
                    <td style="vertical-align:middle;font-family:Arial,sans-serif;">
                      <div style="font-size:17px;font-weight:700;line-height:1.3;">${tenantName}</div>
                      <div style="font-size:13px;opacity:0.9;line-height:1.4;">${safeHeaderTagline}</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 22px 18px 22px;font-family:Arial,sans-serif;color:#13263f;">
                <h1 style="margin:0 0 14px 0;font-size:24px;line-height:1.28;color:#13263f;">${escapeEmailHtml(safeSubject)}</h1>
                <div style="font-size:15px;line-height:1.65;color:#1d3552;">${safeBodyForEmail}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:0 22px 22px 22px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e3ebf6;margin-top:6px;">
                  <tr>
                    <td style="padding-top:16px;font-family:Arial,sans-serif;color:#35506f;font-size:14px;line-height:1.6;vertical-align:top;">
                      <div>${safeSignOff}</div>
                      ${safeSenderName ? `<div style="margin-top:6px;font-weight:700;color:#143457;">${safeSenderName}</div>` : ""}
                      ${safeSenderRole ? `<div style="color:#4a6483;">${safeSenderRole}</div>` : ""}
                      ${footerContact ? `<div style="margin-top:4px;color:#4a6483;">${footerContact}</div>` : ""}
                    </td>
                    ${footerLogoMarkup ? `<td style="padding-top:16px;width:64px;vertical-align:top;text-align:right;">${footerLogoMarkup}</td>` : ""}
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const footerTextLines = [
    normalizedFooter.signOff || "Warmly,",
    normalizedFooter.senderName,
    normalizedFooter.senderRole,
    footerContactParts.join(" • ")
  ].filter(Boolean);
  const text = [bodyText, footerTextLines.join("\n")].filter(Boolean).join("\n\n");

  return {
    html,
    text: text || " ",
    footer: normalizedFooter
  };
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
const ADMIN_MEMBERS_CACHE_CONTROL = "private, max-age=10, stale-while-revalidate=30";
const adminMembersResponseCache = createTtlCache({ ttlMs: 10_000, maxEntries: 500 });
const ADMIN_DASHBOARD_CACHE_CONTROL = "private, max-age=20, stale-while-revalidate=60";
const adminDashboardResponseCache = createTtlCache({ ttlMs: 20_000, maxEntries: 250 });
const ADMIN_MEMBER_PROFILE_SELECT = [
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
  "collegeYears",
  "currentJobs",
  "industry",
  "avatarUrl",
  "bio",
  "status",
  "flaggedReason",
  "createdAt"
];

function clearAdminMembersCache() {
  adminMembersResponseCache.clear();
}

function clearAdminDashboardCache() {
  adminDashboardResponseCache.clear();
}

function clearAdminReadCaches() {
  clearAdminMembersCache();
  clearAdminDashboardCache();
}
const MODULE_CATALOG = [
  {
    key: "directory",
    label: "Directory",
    description: "Member directory and profile browsing."
  },
  {
    key: "search",
    label: "Advanced Search",
    description: "Search members by name, role, location, and industry."
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
    label: "Location Map",
    description: "Location map for member profiles."
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
    key: "userId",
    label: "User ID",
    description: "Account user identifier linked to this profile.",
    getValue: (profile) => toObjectIdString(profile?.userId)
  },
  {
    key: "firstName",
    label: "First Name",
    description: "Profile first name.",
    getValue: (profile) => String(profile?.firstName || "")
  },
  {
    key: "nickname",
    label: "Nickname",
    description: "Camp nickname from profile/social fields.",
    getValue: (profile) => resolveProfileNicknameForExport(profile)
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
    key: "completionPercent",
    label: "Profile Completion %",
    description: "Calculated completion percentage across core profile fields.",
    getValue: (profile, context = {}) => {
      if (Number.isFinite(Number(context?.completionScore))) {
        return String(Math.max(0, Math.min(100, Math.round(Number(context.completionScore)))));
      }
      return String(completionScore(profile));
    }
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
    key: "city",
    label: "City",
    description: "City parsed from location.",
    getValue: (profile) => parseExportCityState(profile?.cityState).city
  },
  {
    key: "state",
    label: "State",
    description: "State/region parsed from location.",
    getValue: (profile) => parseExportCityState(profile?.cityState).state
  },
  {
    key: "country",
    label: "Country",
    description: "Country parsed from location.",
    getValue: (profile) => parseExportCityState(profile?.cityState).country
  },
  {
    key: "roleAtCamp",
    label: "Role At Camp",
    description: "Member's role at camp.",
    getValue: (profile) => String(profile?.roleAtCamp || "")
  },
  {
    key: "allRoles",
    label: "All Roles",
    description: "Primary role plus additional role tags.",
    getValue: (profile) => listToCsvCell(resolveExportRoles(profile))
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
    key: "collegeMajors",
    label: "College Majors",
    description: "Majors captured on the profile.",
    getValue: (profile) => listToCsvCell(resolveExportCollegeMajors(profile))
  },
  {
    key: "educationRows",
    label: "Education Rows",
    description: "Combined college, year, and major rows.",
    getValue: (profile) => listToCsvCell(resolveExportEducationRows(profile))
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
    key: "pastJobs",
    label: "Past Jobs",
    description: "All past job entries.",
    getValue: (profile) => listToCsvCell((profile?.pastJobs || []).map(formatJobEntry))
  },
  {
    key: "camperFirstYear",
    label: "Camper First Year",
    description: "First camper year from profile stints.",
    getValue: (profile) => resolveExportCamperYearRange(profile).firstYear
  },
  {
    key: "camperLastYear",
    label: "Camper Last Year",
    description: "Last camper year from profile stints.",
    getValue: (profile) => resolveExportCamperYearRange(profile).lastYear
  },
  {
    key: "camperYearStints",
    label: "Camper Year Stints",
    description: "Camper year ranges.",
    getValue: (profile) => formatExportYearStints(resolveExportCamperYears(profile))
  },
  {
    key: "staffFirstYear",
    label: "Staff First Year",
    description: "First staff year from profile stints.",
    getValue: (profile) => resolveExportStaffYearRange(profile).firstYear
  },
  {
    key: "staffLastYear",
    label: "Staff Last Year",
    description: "Last staff year from profile stints.",
    getValue: (profile) => resolveExportStaffYearRange(profile).lastYear
  },
  {
    key: "staffYearStints",
    label: "Staff Year Stints",
    description: "Staff year ranges.",
    getValue: (profile) => formatExportYearStints(resolveExportStaffYears(profile))
  },
  {
    key: "linkedin",
    label: "LinkedIn",
    description: "LinkedIn URL from social links.",
    getValue: (profile) => String(resolveExportSocials(profile)?.linkedin || "")
  },
  {
    key: "instagram",
    label: "Instagram",
    description: "Instagram URL from social links.",
    getValue: (profile) => String(resolveExportSocials(profile)?.instagram || "")
  },
  {
    key: "facebook",
    label: "Facebook",
    description: "Facebook URL from social links.",
    getValue: (profile) => String(resolveExportSocials(profile)?.facebook || "")
  },
  {
    key: "avatarUrl",
    label: "Avatar URL",
    description: "Profile avatar image URL.",
    getValue: (profile) => String(profile?.avatarUrl || "")
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
  },
  {
    key: "socialsJson",
    label: "Socials JSON",
    description: "Raw socials object for full fidelity export.",
    getValue: (profile) => toExportJsonCell(resolveExportSocials(profile))
  },
  {
    key: "profileJson",
    label: "Profile JSON",
    description: "Raw profile object for full fidelity export.",
    getValue: (profile) => toExportJsonCell(profile || {})
  }
];
const MEMBER_EXPORT_DEFAULT_FIELDS = [
  "firstName",
  "lastName",
  "primaryEmail"
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

function toExportJsonCell(value = null) {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return "";
  }
}

function resolveExportSocials(profile = {}) {
  return profile?.socials && typeof profile.socials === "object" ? profile.socials : {};
}

function resolveProfileNicknameForExport(profile = {}) {
  const socials = resolveExportSocials(profile);
  return String(profile?.nickname || socials?.nickname || socials?.campNickname || "").trim();
}

function parseExportCityState(value = "") {
  const parsed = parseCityStateDetailed(String(value || "").trim());
  return {
    city: String(parsed?.city || "").trim(),
    state: String(parsed?.state || "").trim(),
    country: String(parsed?.country || "").trim()
  };
}

function normalizeExportYear(value = "") {
  return /^\d{4}$/.test(String(value || "").trim()) ? String(value || "").trim() : "";
}

function normalizeExportYearStints(value = {}) {
  const input = value && typeof value === "object" ? value : {};
  const source = Array.isArray(input.stints) ? input.stints : [];
  let stints = source
    .map((stint) => {
      const startYear = normalizeExportYear(stint?.startYear || stint?.firstYear || "");
      const endYear = normalizeExportYear(stint?.endYear || stint?.lastYear || "");
      if (!startYear && !endYear) return null;
      const normalizedStart = startYear || endYear;
      const normalizedEnd = endYear || startYear;
      if (!normalizedStart || !normalizedEnd) return null;
      const startNum = Number(normalizedStart);
      const endNum = Number(normalizedEnd);
      return {
        startYear: String(Math.min(startNum, endNum)),
        endYear: String(Math.max(startNum, endNum))
      };
    })
    .filter(Boolean);

  if (!stints.length) {
    const firstYear = normalizeExportYear(input.firstYear || "");
    const lastYear = normalizeExportYear(input.lastYear || "");
    if (firstYear || lastYear) {
      const normalizedStart = firstYear || lastYear;
      const normalizedEnd = lastYear || firstYear;
      if (normalizedStart && normalizedEnd) {
        const startNum = Number(normalizedStart);
        const endNum = Number(normalizedEnd);
        stints = [
          {
            startYear: String(Math.min(startNum, endNum)),
            endYear: String(Math.max(startNum, endNum))
          }
        ];
      }
    }
  }

  return stints.sort((left, right) => {
    const leftStart = Number(left?.startYear || 0);
    const rightStart = Number(right?.startYear || 0);
    if (leftStart !== rightStart) return leftStart - rightStart;
    return Number(left?.endYear || 0) - Number(right?.endYear || 0);
  });
}

function formatExportYearStints(value = {}) {
  return listToCsvCell(
    normalizeExportYearStints(value).map((stint) =>
      stint.startYear === stint.endYear ? stint.startYear : `${stint.startYear}-${stint.endYear}`
    )
  );
}

function resolveExportYearRange(value = {}) {
  const stints = normalizeExportYearStints(value);
  return {
    firstYear: stints[0]?.startYear || "",
    lastYear: stints.length ? stints[stints.length - 1].endYear : ""
  };
}

function resolveExportCamperYears(profile = {}) {
  const socials = resolveExportSocials(profile);
  const source = socials?.camperYears && typeof socials.camperYears === "object"
    ? socials.camperYears
    : profile?.camperYears && typeof profile.camperYears === "object"
    ? profile.camperYears
    : {};
  return source;
}

function resolveExportStaffYears(profile = {}) {
  const socials = resolveExportSocials(profile);
  const source = socials?.staffYears && typeof socials.staffYears === "object"
    ? socials.staffYears
    : profile?.staffYears && typeof profile.staffYears === "object"
    ? profile.staffYears
    : {};
  return source;
}

function resolveExportCamperYearRange(profile = {}) {
  return resolveExportYearRange(resolveExportCamperYears(profile));
}

function resolveExportStaffYearRange(profile = {}) {
  return resolveExportYearRange(resolveExportStaffYears(profile));
}

function resolveExportRoles(profile = {}) {
  const socials = resolveExportSocials(profile);
  const source = [
    String(profile?.roleAtCamp || "").trim(),
    ...(Array.isArray(socials?.roles) ? socials.roles : [])
  ];
  const seen = new Set();
  return source
    .map((value) => String(value || "").trim())
    .filter((value) => {
      if (!value) return false;
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function resolveExportCollegeMajors(profile = {}) {
  const socials = resolveExportSocials(profile);
  const majors = Array.isArray(socials?.collegeMajors)
    ? socials.collegeMajors
    : Array.isArray(socials?.educationMajors)
    ? socials.educationMajors
    : [];
  return majors.map((value) => String(value || "").trim()).filter(Boolean);
}

function resolveExportEducationRows(profile = {}) {
  const colleges = Array.isArray(profile?.colleges) ? profile.colleges : [];
  const years = Array.isArray(profile?.collegeYears) ? profile.collegeYears : [];
  const majors = resolveExportCollegeMajors(profile);
  const max = Math.max(colleges.length, years.length, majors.length);
  const rows = [];
  for (let index = 0; index < max; index += 1) {
    const college = String(colleges[index] || "").trim();
    const year = String(years[index] || "").trim();
    const major = String(majors[index] || "").trim();
    if (!college && !year && !major) continue;
    rows.push([college, year, major].filter(Boolean).join(" | "));
  }
  return rows;
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

async function buildCompletionScoreMapForProfiles(tenantId, profiles = []) {
  const source = Array.isArray(profiles) ? profiles : [];
  if (!source.length) return new Map();

  const userIds = source
    .map((item) => toObjectIdString(item?.userId))
    .filter(Boolean);
  const users = userIds.length > 0
    ? await UserModel.find(tenantId, { _id: { $in: userIds } }, {
        select: ["id", "email"]
      })
    : [];
  const usersById = new Map(users.map((item) => [toObjectIdString(item._id), item]));

  const completionByProfileId = new Map();
  for (const profile of source) {
    const profileId = toObjectIdString(profile?._id || profile?.id);
    if (!profileId) continue;
    const user = usersById.get(toObjectIdString(profile?.userId)) || null;
    completionByProfileId.set(profileId, completionScore(profile, user));
  }
  return completionByProfileId;
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
    id: toObjectIdString(profile._id || profile.id),
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

function sanitizeStringList(values = [], { lower = false } = {}) {
  const seen = new Set();
  return (Array.isArray(values) ? values : [])
    .map((value) => {
      const next = sanitizeText(String(value || "").trim());
      return lower ? next.toLowerCase() : next;
    })
    .filter((value) => {
      if (!value) return false;
      const key = lower ? value : value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function normalizeMemberYear(value = "") {
  const year = String(value || "").trim();
  return /^\d{4}$/.test(year) ? year : "";
}

function normalizeMemberYearStints(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  let stints = Array.isArray(source.stints)
    ? source.stints
        .map((stint) => {
          const startYear = normalizeMemberYear(stint?.startYear || stint?.firstYear || "");
          const endYear = normalizeMemberYear(stint?.endYear || stint?.lastYear || "");
          if (!startYear && !endYear) return null;
          const normalizedStart = startYear || endYear;
          const normalizedEnd = endYear || startYear;
          if (!normalizedStart || !normalizedEnd) return null;
          const startNum = Number(normalizedStart);
          const endNum = Number(normalizedEnd);
          const startAgeGroup = sanitizeText(String(stint?.startAgeGroup || stint?.ageGroup || "").trim());
          const endAgeGroup = sanitizeText(String(stint?.endAgeGroup || stint?.ageGroup || "").trim());
          const ageGroup = sanitizeText(String(stint?.ageGroup || "").trim());
          return {
            startYear: String(Math.min(startNum, endNum)),
            endYear: String(Math.max(startNum, endNum)),
            ...(startAgeGroup ? { startAgeGroup } : {}),
            ...(endAgeGroup ? { endAgeGroup } : {}),
            ...(ageGroup ? { ageGroup } : {})
          };
        })
        .filter(Boolean)
    : [];

  if (!stints.length) {
    const firstYear = normalizeMemberYear(source.firstYear || "");
    const lastYear = normalizeMemberYear(source.lastYear || "");
    if (firstYear || lastYear) {
      const normalizedStart = firstYear || lastYear;
      const normalizedEnd = lastYear || firstYear;
      if (normalizedStart && normalizedEnd) {
        const startNum = Number(normalizedStart);
        const endNum = Number(normalizedEnd);
        stints = [
          {
            startYear: String(Math.min(startNum, endNum)),
            endYear: String(Math.max(startNum, endNum))
          }
        ];
      }
    }
  }

  return stints.sort(
    (left, right) =>
      Number(left?.startYear || 0) - Number(right?.startYear || 0) ||
      Number(left?.endYear || 0) - Number(right?.endYear || 0)
  );
}

function normalizeMemberCamperYears(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const stints = normalizeMemberYearStints(source);
  return {
    firstYear: normalizeMemberYear(source.firstYear || "") || stints[0]?.startYear || "",
    firstGroup: sanitizeText(String(source.firstGroup || "").trim()),
    lastYear: normalizeMemberYear(source.lastYear || "") || stints[stints.length - 1]?.endYear || "",
    lastGroup: sanitizeText(String(source.lastGroup || "").trim()),
    stints
  };
}

function normalizeMemberStaffYears(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    stints: normalizeMemberYearStints(source)
  };
}

function normalizeMemberRoleList(value = []) {
  return sanitizeStringList(value);
}

function normalizeMemberEducationRows(value = []) {
  return (Array.isArray(value) ? value : [])
    .map((row) => ({
      college: sanitizeText(String(row?.college || "").trim()),
      year: sanitizeText(String(row?.year || "").trim()),
      major: sanitizeText(String(row?.major || "").trim())
    }))
    .filter((row) => row.college || row.year || row.major);
}

function mapAdminMemberProfile(profile = {}, user = null) {
  const socials = profile?.socials && typeof profile.socials === "object" ? profile.socials : {};
  const roleList = normalizeMemberRoleList([
    profile?.roleAtCamp || "",
    ...(Array.isArray(socials?.roles) ? socials.roles : [])
  ]);
  const camperYears = normalizeMemberCamperYears(
    socials?.camperYears && typeof socials.camperYears === "object" ? socials.camperYears : {}
  );
  const staffYears = normalizeMemberStaffYears(
    socials?.staffYears && typeof socials.staffYears === "object" ? socials.staffYears : {}
  );
  const colleges = Array.isArray(profile?.colleges) ? profile.colleges : [];
  const collegeYears = Array.isArray(profile?.collegeYears) ? profile.collegeYears : [];
  const collegeMajors = Array.isArray(socials?.collegeMajors)
    ? socials.collegeMajors
    : Array.isArray(socials?.educationMajors)
    ? socials.educationMajors
    : [];
  const educationRows = [];
  const rowCount = Math.max(colleges.length, collegeYears.length, collegeMajors.length, 1);
  for (let index = 0; index < rowCount; index += 1) {
    educationRows.push({
      college: sanitizeText(String(colleges[index] || "").trim()),
      year: sanitizeText(String(collegeYears[index] || "").trim()),
      major: sanitizeText(String(collegeMajors[index] || "").trim())
    });
  }

  return {
    id: toObjectIdString(profile?._id || profile?.id),
    userId: toObjectIdString(profile?.userId),
    firstName: profile?.firstName || "",
    lastName: profile?.lastName || "",
    nickname: String(profile?.nickname || socials?.nickname || socials?.campNickname || "").trim(),
    email: profile?.emails?.find(Boolean) || user?.email || "",
    emails: sanitizeStringList(profile?.emails || [], { lower: true }),
    phone: profile?.phones?.find(Boolean) || "",
    phones: sanitizeStringList(profile?.phones || []),
    cityState: profile?.cityState || "",
    roleAtCamp: profile?.roleAtCamp || "",
    roles: roleList,
    status: profile?.status || (user?.status === "inactive" ? "removed" : "active"),
    flaggedReason: profile?.flaggedReason || "",
    highSchool: profile?.highSchool || "",
    industry: profile?.industry || "",
    bio: profile?.bio || "",
    avatarUrl: profile?.avatarUrl || "",
    camperYears,
    staffYears,
    education: normalizeMemberEducationRows(educationRows),
    currentJobs: Array.isArray(profile?.currentJobs) ? profile.currentJobs : [],
    pastJobs: Array.isArray(profile?.pastJobs) ? profile.pastJobs : [],
    social: {
      linkedin: String(socials?.linkedin || "").trim(),
      instagram: String(socials?.instagram || "").trim(),
      facebook: String(socials?.facebook || "").trim()
    }
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

function clampCompletionPercent(value, fallback = null) {
  if (value === undefined || value === null || value === "") return fallback;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function parseCompletionRange(query = {}) {
  const completion = String(query.completion || "").trim().toLowerCase();
  const hasMin = query.completionMin !== undefined && String(query.completionMin || "").trim() !== "";
  const hasMax = query.completionMax !== undefined && String(query.completionMax || "").trim() !== "";

  let min = hasMin ? clampCompletionPercent(query.completionMin, 0) : null;
  let max = hasMax ? clampCompletionPercent(query.completionMax, 100) : null;

  if ((min === null || max === null) && completion && completion !== "all") {
    if (completion === "low") {
      min = 0;
      max = 39;
    } else if (completion === "medium") {
      min = 40;
      max = 79;
    } else if (completion === "high") {
      min = 80;
      max = 100;
    } else if (completion === "complete") {
      min = 100;
      max = 100;
    }
  }

  if (min === null && max === null) return null;
  if (min === null) min = 0;
  if (max === null) max = 100;
  if (min > max) [min, max] = [max, min];
  return { min, max };
}

function matchesCompletionRange(score = 0, range = null) {
  if (!range) return true;
  const value = Number(score || 0);
  return value >= range.min && value <= range.max;
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
    req.tenant = await ensureTenantMobileAppCode(req.tenant);
    const tenantId = req.tenant._id;
    const cacheKey = [
      "admin-dashboard",
      String(tenantId || ""),
      String(req.user?.id || "")
    ].join(":");
    const cachedPayload = adminDashboardResponseCache.get(cacheKey);
    if (cachedPayload) {
      res.set("Cache-Control", ADMIN_DASHBOARD_CACHE_CONTROL);
      return res.json(cachedPayload);
    }
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
          select: [
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
            "bio"
          ]
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
          profileId: toObjectIdString(profile._id || profile.id),
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

    const payload = {
      tenant: {
        id: toObjectIdString(req.tenant._id),
        slug: req.tenant.slug,
        name: req.tenant.name,
        status: statusLabel,
        onboardingStatus: req.tenant.onboardingStatus,
        launchedAt: toIso(req.tenant?.launch?.launchedAt),
        planTier: resolveTenantFeatureTier(req.tenant),
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
      mobileApp: {
        code: settings.mobileAppCodeLookup || "",
        hint: settings.mobileAppCodeHint || "",
        hasCode: Boolean(settings.hasMobileAppCode)
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
    };
    adminDashboardResponseCache.set(cacheKey, payload);
    res.set("Cache-Control", ADMIN_DASHBOARD_CACHE_CONTROL);
    return res.json(payload);
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
    const sort = String(req.query.sort || "join_desc").trim().toLowerCase();
    const completionRange = parseCompletionRange(req.query);
    const { page, pageSize, skip } = parseMemberPagination(req.query);
    const cacheKey = [
      "admin-members",
      String(tenantId || ""),
      String(req.user?.id || ""),
      String(req.originalUrl || req.url || "")
    ].join(":");
    const cachedPayload = adminMembersResponseCache.get(cacheKey);
    if (cachedPayload) {
      res.set("Cache-Control", ADMIN_MEMBERS_CACHE_CONTROL);
      return res.json(cachedPayload);
    }

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
    if (completionRange) {
      mongoSort = null;
    }
    let profiles = [];
    let total = 0;

    // Fetch profiles — apply text search JS-side since Supabase doesn't support $or regex
    const fetchOpts = mongoSort
      ? { sort: mongoSort, offset: skip, limit: pageSize, select: ADMIN_MEMBER_PROFILE_SELECT }
      : { select: ADMIN_MEMBER_PROFILE_SELECT };

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
        let countProfiles = await ProfileModel.find(tenantId, filter, {
          select: ADMIN_MEMBER_PROFILE_SELECT
        });
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

      const filteredByCompletion = mapped.filter((item) =>
        matchesCompletionRange(item.completionScore, completionRange)
      );
      total = filteredByCompletion.length;
      const paged = filteredByCompletion.slice(skip, skip + pageSize);
      const payload = {
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
      };
      adminMembersResponseCache.set(cacheKey, payload);
      res.set("Cache-Control", ADMIN_MEMBERS_CACHE_CONTROL);
      return res.json(payload);
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

    rows = rows.filter((item) => matchesCompletionRange(item.completionScore, completionRange));

    const payload = {
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
    };
    adminMembersResponseCache.set(cacheKey, payload);
    res.set("Cache-Control", ADMIN_MEMBERS_CACHE_CONTROL);
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get("/members/lookup", async (req, res, next) => {
  try {
    const ids = [...new Set(
      String(req.query.ids || "")
        .split(",")
        .map((item) => String(item || "").trim())
        .filter(Boolean)
    )].slice(0, 250);
    if (!ids.length) {
      return res.json({ items: [] });
    }

    const profiles = await ProfileModel.find(
      req.tenant._id,
      {
        _id: { $in: ids },
        status: { $ne: "removed" }
      },
      {
        select: ADMIN_MEMBER_PROFILE_SELECT
      }
    );
    if (!profiles.length) {
      return res.json({ items: [] });
    }

    const userIds = [...new Set(profiles.map((profile) => toObjectIdString(profile.userId)).filter(Boolean))];
    const users = userIds.length > 0
      ? await UserModel.find(req.tenant._id, { _id: { $in: userIds } }, {
          select: ["id", "email", "status", "lastLoginAt", "roles"]
        })
      : [];
    const usersById = new Map(users.map((item) => [toObjectIdString(item._id), item]));
    const profilesById = new Map(
      profiles.map((profile) => [toObjectIdString(profile._id || profile.id), profile])
    );

    const items = ids
      .map((id) => {
        const profile = profilesById.get(id);
        if (!profile) return null;
        const user = usersById.get(toObjectIdString(profile.userId)) || null;
        const row = mapMemberRow(profile, user, {});
        return {
          id: row.id,
          fullName: row.fullName || "Member",
          email: row.email || "",
          role: row.role || "Member",
          location: row.location || "",
          status: row.status || "active",
          avatarUrl: row.avatarUrl || ""
        };
      })
      .filter(Boolean);

    return res.json({ items });
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

router.get("/members/:profileId([a-fA-F0-9]{24})/full", async (req, res) => {
  const profileId = String(req.params.profileId || "").trim();
  const profile = await ProfileModel.findOne(req.tenant._id, { _id: profileId });
  if (!profile) {
    return res.status(404).json({
      error: { code: "PROFILE_NOT_FOUND", message: "Profile not found" }
    });
  }

  const userId = toObjectIdString(profile.userId);
  const user = userId ? await UserModel.findOne(req.tenant._id, { _id: userId }) : null;

  return res.json({
    profile: mapAdminMemberProfile(profile, user)
  });
});

router.put("/members/:profileId([a-fA-F0-9]{24})/full", async (req, res) => {
  const profileId = String(req.params.profileId || "").trim();
  const profile = await ProfileModel.findOne(req.tenant._id, { _id: profileId });
  if (!profile) {
    return res.status(404).json({
      error: { code: "PROFILE_NOT_FOUND", message: "Profile not found" }
    });
  }

  const userId = toObjectIdString(profile.userId);
  const user = userId ? await UserModel.findOne(req.tenant._id, { _id: userId }) : null;
  const incoming = req.body || {};

  const hasOwn = (key) => Object.prototype.hasOwnProperty.call(incoming, key);
  const incomingPhone = sanitizeText(String(incoming.phone || "").trim());
  const incomingRolesProvided = Array.isArray(incoming.roles) || hasOwn("roleAtCamp");
  const incomingRoles = incomingRolesProvided
    ? normalizeMemberRoleList(Array.isArray(incoming.roles) ? incoming.roles : [incoming.roleAtCamp])
    : [];
  const incomingNicknameProvided =
    hasOwn("nickname") ||
    hasOwn("campNickname") ||
    incoming?.social?.nickname !== undefined ||
    incoming?.socials?.nickname !== undefined ||
    incoming?.socials?.campNickname !== undefined;
  const incomingNickname = incomingNicknameProvided
    ? sanitizeText(
        String(
          incoming?.nickname ??
            incoming?.campNickname ??
            incoming?.social?.nickname ??
            incoming?.socials?.nickname ??
            incoming?.socials?.campNickname ??
            ""
        ).trim()
      )
    : "";
  const incomingCamperYearsProvided = incoming.camperYears !== undefined;
  const incomingStaffYearsProvided = incoming.staffYears !== undefined;
  const incomingCamperYears = incomingCamperYearsProvided ? normalizeMemberCamperYears(incoming.camperYears) : null;
  const incomingStaffYears = incomingStaffYearsProvided ? normalizeMemberStaffYears(incoming.staffYears) : null;
  const incomingEducationRows = Array.isArray(incoming.education)
    ? normalizeMemberEducationRows(incoming.education)
    : [];
  const incomingCollegeMajorsProvided =
    Array.isArray(incoming.education) ||
    Array.isArray(incoming.collegeMajors) ||
    Array.isArray(incoming?.social?.collegeMajors) ||
    Array.isArray(incoming?.socials?.collegeMajors) ||
    Array.isArray(incoming?.social?.educationMajors) ||
    Array.isArray(incoming?.socials?.educationMajors);
  const incomingCollegeMajors = sanitizeStringList(
    Array.isArray(incoming.collegeMajors)
      ? incoming.collegeMajors
      : incomingEducationRows.length
      ? incomingEducationRows.map((row) => row.major)
      : Array.isArray(incoming?.social?.collegeMajors)
      ? incoming.social.collegeMajors
      : Array.isArray(incoming?.socials?.collegeMajors)
      ? incoming.socials.collegeMajors
      : Array.isArray(incoming?.social?.educationMajors)
      ? incoming.social.educationMajors
      : Array.isArray(incoming?.socials?.educationMajors)
      ? incoming.socials.educationMajors
      : []
  );
  const hasSocialPatch = Boolean(incoming.social || incoming.socials);
  const existingSocials = profile?.socials && typeof profile.socials === "object" ? profile.socials : {};
  const nextSocials =
    hasSocialPatch ||
    incomingCamperYearsProvided ||
    incomingStaffYearsProvided ||
    incomingRolesProvided ||
    incomingNicknameProvided ||
    incomingCollegeMajorsProvided
      ? {
          ...existingSocials,
          ...(hasSocialPatch
            ? {
                linkedin: String(incoming?.social?.linkedin || incoming?.socials?.linkedin || "").trim(),
                instagram: String(incoming?.social?.instagram || incoming?.socials?.instagram || "").trim(),
                facebook: String(incoming?.social?.facebook || incoming?.socials?.facebook || "").trim()
              }
            : {}),
          ...(incomingCamperYearsProvided ? { camperYears: incomingCamperYears } : {}),
          ...(incomingStaffYearsProvided ? { staffYears: incomingStaffYears } : {}),
          ...(incomingRolesProvided ? { roles: incomingRoles } : {}),
          ...(incomingNicknameProvided ? { nickname: incomingNickname, campNickname: incomingNickname } : {}),
          ...(incomingCollegeMajorsProvided
            ? { collegeMajors: incomingCollegeMajors, educationMajors: incomingCollegeMajors }
            : {})
        }
      : undefined;
  const hasLocationFields = hasOwn("cityState") || hasOwn("city") || hasOwn("state") || hasOwn("country");
  const nextCityState = hasLocationFields
    ? (() => {
        const direct = String(incoming.cityState || "").trim();
        if (direct) return composeCityState(parseCityStateDetailed(direct));
        const state = String(incoming.state || "").trim().toUpperCase();
        const country = canonicalizeCountryName(String(incoming.country || "").trim());
        const city = canonicalizeCityName(String(incoming.city || "").trim(), { state, country });
        return composeCityState({ city, state, country });
      })()
    : undefined;

  const patch = {
    firstName: hasOwn("firstName") ? sanitizeText(String(incoming.firstName || "").trim()) : undefined,
    lastName: hasOwn("lastName") ? sanitizeText(String(incoming.lastName || "").trim()) : undefined,
    emails: Array.isArray(incoming.emails) ? sanitizeStringList(incoming.emails, { lower: true }) : undefined,
    phones:
      incoming.phone !== undefined
        ? (incomingPhone ? [incomingPhone] : [])
        : Array.isArray(incoming.phones)
        ? sanitizeStringList(incoming.phones)
        : undefined,
    cityState: nextCityState,
    roleAtCamp: incomingRolesProvided
      ? sanitizeText(String(incomingRoles[0] || "").trim())
      : hasOwn("roleAtCamp")
      ? sanitizeText(String(incoming.roleAtCamp || "").trim())
      : undefined,
    highSchool: hasOwn("highSchool") ? sanitizeText(String(incoming.highSchool || "").trim()) : undefined,
    colleges: Array.isArray(incoming.education)
      ? incomingEducationRows.map((row) => row.college)
      : Array.isArray(incoming.colleges)
      ? sanitizeStringList(incoming.colleges)
      : undefined,
    collegeYears: Array.isArray(incoming.education)
      ? incomingEducationRows.map((row) => row.year)
      : Array.isArray(incoming.collegeYears)
      ? sanitizeStringList(incoming.collegeYears)
      : undefined,
    currentJobs: Array.isArray(incoming.currentJobs)
      ? incoming.currentJobs.map((job) => ({
          role: sanitizeText(String(job?.role || "").trim()),
          company: sanitizeText(String(job?.company || "").trim()),
          years: sanitizeText(String(job?.years || "").trim())
        }))
      : undefined,
    pastJobs: Array.isArray(incoming.pastJobs)
      ? incoming.pastJobs.map((job) => ({
          role: sanitizeText(String(job?.role || "").trim()),
          company: sanitizeText(String(job?.company || "").trim()),
          years: sanitizeText(String(job?.years || "").trim())
        }))
      : undefined,
    industry: hasOwn("industry") ? sanitizeText(String(incoming.industry || "").trim()) : undefined,
    socials: nextSocials,
    avatarUrl:
      incoming?.uploads?.photoUrl !== undefined || hasOwn("photoUrl") || hasOwn("avatarUrl")
        ? String(incoming?.uploads?.photoUrl || incoming.photoUrl || incoming.avatarUrl || "").trim()
        : undefined,
    bio: hasOwn("bio") ? sanitizeText(String(incoming.bio || "").trim()) : undefined,
    flaggedReason: hasOwn("flaggedReason") ? sanitizeText(String(incoming.flaggedReason || "").trim()) : undefined
  };

  if (hasOwn("status")) {
    const nextStatus = String(incoming.status || "").trim().toLowerCase();
    if (!["active", "pending", "flagged", "removed"].includes(nextStatus)) {
      return res.status(400).json({
        error: {
          code: "INVALID_STATUS",
          message: "Status must be active, pending, flagged, or removed."
        }
      });
    }
    patch.status = nextStatus;
  }

  const cleanPatch = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined)
  );
  const updated = await ProfileModel.update(profile._id, cleanPatch);

  if (cleanPatch.status && userId) {
    const nextUserStatus = cleanPatch.status === "removed" ? "inactive" : "active";
    await UserModel.update(userId, { status: nextUserStatus });
  }

  await writeAdminAudit(req, "admin_member_full_profile_updated", {
    profileId: toObjectIdString(updated._id),
    userId,
    changedFields: Object.keys(cleanPatch)
  });
  clearAdminReadCaches();

  const refreshedUser = userId ? await UserModel.findOne(req.tenant._id, { _id: userId }) : null;
  return res.json({
    ok: true,
    profile: mapAdminMemberProfile(updated, refreshedUser || user)
  });
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
  clearAdminReadCaches();
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
      clearAdminReadCaches();
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
    clearAdminReadCaches();

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
    clearAdminReadCaches();
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
    clearAdminReadCaches();
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
    clearAdminReadCaches();
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
    clearAdminReadCaches();
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
  clearAdminReadCaches();

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
  clearAdminReadCaches();

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
  const offset = Math.max(0, Number(req.query.offset || 0) || 0);
  const statusFilter = String(req.query.status || "").trim().toLowerCase();
  const filter = statusFilter && ["sent", "scheduled", "failed", "canceled"].includes(statusFilter)
    ? { status: statusFilter }
    : { status: { $ne: "draft" } };
  const items = await EmailBroadcastModel.find(req.tenant._id, filter, {
    sort: { createdAt: -1 },
    limit,
    offset
  });
  return res.json({
    total: items._count || items.length,
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

// ---------------------------------------------------------------------------
// Draft CRUD
// ---------------------------------------------------------------------------

router.get("/email/drafts", async (req, res) => {
  const limit = Math.min(30, Math.max(1, Number(req.query.limit || 30) || 30));
  const items = await EmailBroadcastModel.find(req.tenant._id, { status: "draft" }, {
    sort: { updatedAt: -1 },
    limit
  });
  return res.json({
    total: items._count || items.length,
    items: items.map((item) => serializeEmailBroadcast(item))
  });
});

router.post("/email/draft", async (req, res) => {
  const subject = sanitizeText(String(req.body?.subject || "").trim()).slice(0, 160);
  const body = sanitizeHtmlContent(String(req.body?.body || "").trim());
  const targeting = normalizeTargeting(req.body?.targeting || {});

  const draft = await EmailBroadcastModel.create({
    tenantId: req.tenant._id,
    subject,
    body,
    targeting,
    status: "draft",
    recipientCount: 0,
    excludedCount: 0,
    recipientsPreview: [],
    createdByUserId: req.user.id
  });

  return res.status(201).json({ ok: true, item: serializeEmailBroadcast(draft) });
});

router.patch("/email/draft/:id", async (req, res) => {
  const draftId = String(req.params.id || "").trim();
  const item = await EmailBroadcastModel.findOne(req.tenant._id, { _id: draftId, status: "draft" });
  if (!item) {
    return res.status(404).json({ error: { code: "DRAFT_NOT_FOUND", message: "Draft not found." } });
  }

  const updates = { updatedAt: new Date() };
  if (req.body?.subject !== undefined) updates.subject = sanitizeText(String(req.body.subject || "").trim()).slice(0, 160);
  if (req.body?.body !== undefined) updates.body = sanitizeHtmlContent(String(req.body.body || "").trim());
  if (req.body?.targeting !== undefined) updates.targeting = normalizeTargeting(req.body.targeting);

  await EmailBroadcastModel.update(item._id, updates);
  const fresh = await EmailBroadcastModel.findOne(req.tenant._id, { _id: item._id });
  return res.json({ ok: true, item: serializeEmailBroadcast(fresh) });
});

router.delete("/email/draft/:id", async (req, res) => {
  const draftId = String(req.params.id || "").trim();
  const item = await EmailBroadcastModel.findOne(req.tenant._id, { _id: draftId, status: "draft" });
  if (!item) {
    return res.status(404).json({ error: { code: "DRAFT_NOT_FOUND", message: "Draft not found." } });
  }
  await EmailBroadcastModel.delete(item._id);
  return res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Scheduled email management
// ---------------------------------------------------------------------------

router.delete("/email/scheduled/:broadcastId", async (req, res) => {
  const broadcastId = String(req.params.broadcastId || "").trim();
  const item = await EmailBroadcastModel.findOne(req.tenant._id, { _id: broadcastId, status: "scheduled" });
  if (!item) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Scheduled email not found." } });
  }
  await EmailBroadcastModel.update(item._id, { status: "canceled", updatedAt: new Date() });
  return res.json({ ok: true });
});

router.patch("/email/scheduled/:broadcastId", async (req, res) => {
  const broadcastId = String(req.params.broadcastId || "").trim();
  const item = await EmailBroadcastModel.findOne(req.tenant._id, { _id: broadcastId, status: "scheduled" });
  if (!item) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Scheduled email not found." } });
  }

  const updates = { updatedAt: new Date() };
  if (req.body?.subject) updates.subject = sanitizeText(String(req.body.subject).trim()).slice(0, 160);
  if (req.body?.body) updates.body = sanitizeHtmlContent(String(req.body.body).trim());
  if (req.body?.scheduledFor) {
    const next = new Date(req.body.scheduledFor);
    if (!Number.isNaN(next.getTime()) && next > new Date()) updates.scheduledFor = next;
  }

  await EmailBroadcastModel.update(item._id, updates);
  const fresh = await EmailBroadcastModel.findOne(req.tenant._id, { _id: item._id });
  return res.json({ ok: true, item: serializeEmailBroadcast(fresh) });
});

// ---------------------------------------------------------------------------
// Suppression management
// ---------------------------------------------------------------------------

router.get("/email/suppressions", async (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit || 100) || 100));
  const items = await EmailSuppressionModel.find(req.tenant._id, { status: "active" }, {
    sort: { lastSeenAt: -1 },
    limit
  });
  return res.json({
    total: items._count || items.length,
    items: (items || []).map((item) => ({
      id: String(item?._id || ""),
      email: String(item?.email || ""),
      reason: String(item?.reason || ""),
      sourceEventType: String(item?.sourceEventType || ""),
      firstSeenAt: item?.firstSeenAt ? new Date(item.firstSeenAt).toISOString() : null,
      lastSeenAt: item?.lastSeenAt ? new Date(item.lastSeenAt).toISOString() : null
    }))
  });
});

router.patch("/email/suppressions/:id/lift", async (req, res) => {
  const suppressionId = String(req.params.id || "").trim();
  if (!suppressionId) {
    return res.status(400).json({ error: { code: "INVALID_ID", message: "Suppression ID is required." } });
  }
  const item = await EmailSuppressionModel.findOne(req.tenant._id, { _id: suppressionId, status: "active" });
  if (!item) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Active suppression not found." } });
  }
  await EmailSuppressionModel.update(item._id, { status: "lifted", updatedAt: new Date() });
  return res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Available roles for targeting
// ---------------------------------------------------------------------------

router.get("/email/available-roles", async (req, res) => {
  const content = resolveContent(req.tenant);
  const roles = Array.isArray(content.staffRoles) && content.staffRoles.length > 0
    ? content.staffRoles.map((r) => String(r || "").trim()).filter(Boolean)
    : DEFAULT_STAFF_ROLES;
  return res.json({ roles });
});

router.get("/email/footer-presets", async (req, res) => {
  const footerSettings = await resolveDirectorEmailFooterSettings({
    tenant: req.tenant,
    user: req.user
  });

  return res.json({
    presets: footerSettings.presets,
    defaultPresetId: footerSettings.defaultPresetId,
    activeFooter: footerSettings.activeFooter
  });
});

router.patch("/email/footer-presets", async (req, res) => {
  const footerSettings = await resolveDirectorEmailFooterSettings({
    tenant: req.tenant,
    user: req.user
  });
  const incomingPresets = Array.isArray(req.body?.presets) ? req.body.presets : [];
  const presets = normalizeEmailFooterPresetList(incomingPresets, {
    fallbackFooter: footerSettings.fallbackFooter
  });
  const requestedDefaultId = sanitizeText(String(req.body?.defaultPresetId || "").trim()).slice(0, 90);
  const defaultPresetId = presets.some((item) => item.id === requestedDefaultId)
    ? requestedDefaultId
    : String(presets[0]?.id || "");

  const draft = resolveDraft(req.tenant);
  const content = draft.content || resolveContent(req.tenant);
  const nextContent = {
    ...content,
    emailFooterPresets: presets,
    defaultEmailFooterPresetId: defaultPresetId
  };

  const tenant = await TenantModel.update(req.tenant._id, {
    content: nextContent,
    onboardingDraft: {
      ...draft,
      content: {
        ...draft.content,
        emailFooterPresets: presets,
        defaultEmailFooterPresetId: defaultPresetId
      },
      updatedAt: new Date(),
      updatedByUserId: req.user.id
    }
  });

  const resolved = await resolveDirectorEmailFooterSettings({
    tenant,
    user: req.user
  });

  return res.json({
    ok: true,
    presets: resolved.presets,
    defaultPresetId: resolved.defaultPresetId,
    activeFooter: resolved.activeFooter
  });
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

  const footerSettings = await resolveDirectorEmailFooterSettings({
    tenant: req.tenant,
    user: req.user
  });
  const emailBranding = buildTenantEmailBranding(req.tenant);
  const resolvedReplyTo = isEmail(replyTo) ? replyTo : emailBranding.replyTo;
  const composed = buildDirectorBroadcastEmailContent({
    tenant: req.tenant,
    subject,
    bodyHtml: body,
    footer: normalizeEmailFooterData(req.body?.footer || {}, footerSettings.activeFooter)
  });

  await sendTransactionalEmail({
    from: emailBranding.from,
    to,
    subject: `[Test] ${subject}`,
    text: composed.text,
    html: composed.html,
    ...(resolvedReplyTo ? { replyTo: resolvedReplyTo } : {})
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

  const footerSettings = await resolveDirectorEmailFooterSettings({
    tenant: req.tenant,
    user: req.user
  });
  const emailBranding = buildTenantEmailBranding(req.tenant);
  const resolvedReplyTo = isEmail(actorReplyTo) ? actorReplyTo : emailBranding.replyTo;
  const composed = buildDirectorBroadcastEmailContent({
    tenant: req.tenant,
    subject,
    bodyHtml: body,
    footer: normalizeEmailFooterData(req.body?.footer || {}, footerSettings.activeFooter)
  });

  const { profiles, recipients } = await resolveRecipientsForTargeting(req.tenant._id, targeting);
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

  // Duplicate broadcast warning
  if (!req.body?.confirmDuplicate) {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentDuplicates = await EmailBroadcastModel.find(req.tenant._id, {
      subject,
      status: { $in: ["sent", "scheduled"] },
      createdAt: { $gte: oneHourAgo }
    }, { limit: 1 });
    if (recentDuplicates.length > 0) {
      return res.status(409).json({
        error: {
          code: "DUPLICATE_BROADCAST_WARNING",
          message: "A broadcast with the same subject was sent within the last hour.",
          duplicate: serializeEmailBroadcast(recentDuplicates[0])
        }
      });
    }
  }

  // Merge tag personalization
  const MERGE_TAG_REGEX = /\{\{(firstName|lastName)\}\}/g;
  const hasMergeTags = MERGE_TAG_REGEX.test(body);
  let personalizer = null;
  if (hasMergeTags) {
    const emailToProfile = new Map();
    for (const profile of profiles) {
      const profileEmail = String(profile?.emails?.[0] || "").trim().toLowerCase();
      if (profileEmail) emailToProfile.set(profileEmail, profile);
    }
    personalizer = (recipientEmail) => {
      const profile = emailToProfile.get(recipientEmail) || {};
      const firstName = String(profile?.firstName || "").trim() || "there";
      const lastName = String(profile?.lastName || "").trim();
      const personalizedHtml = composed.html
        .replace(/\{\{firstName\}\}/g, escapeEmailHtml(firstName))
        .replace(/\{\{lastName\}\}/g, escapeEmailHtml(lastName));
      const personalizedText = composed.text
        .replace(/\{\{firstName\}\}/g, firstName)
        .replace(/\{\{lastName\}\}/g, lastName);
      return { html: personalizedHtml, text: personalizedText };
    };
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
      from: emailBranding.from,
      recipients,
      subject,
      text: composed.text,
      html: composed.html,
      ...(resolvedReplyTo ? { replyTo: resolvedReplyTo } : {}),
      tags: [
        { name: "category", value: "director_broadcast" },
        { name: "tenant", value: req.tenant.slug || "tenant" }
      ],
      idempotencyKey: `director-broadcast/${req.tenant.slug || "tenant"}/${broadcast._id}`,
      batchSize: env.EMAIL_BROADCAST_BATCH_SIZE,
      maxRecipients: env.EMAIL_BROADCAST_MAX_RECIPIENTS,
      ...(personalizer ? { personalizer } : {})
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
  const planTier = resolveTenantFeatureTier(req.tenant);
  const theme = resolveTheme(req.tenant);
  const content = resolveContent(req.tenant);
  const modules = resolveModules(req.tenant, { applyPlanGating: false });
  const features = listFeaturesForPlan(planTier, req.tenant.addOns || []);
  const campType = content.campType || "coed";
  const items = MODULE_CATALOG.map((module) => {
    const locked = module.requiredFeature
      ? !hasFeature(planTier, module.requiredFeature, req.tenant.addOns || [])
      : false;
    return {
      ...module,
      label: replaceAlumniForCampType(module.label, campType),
      description: replaceAlumniForCampType(module.description, campType),
      enabled: locked ? false : Boolean(modules[module.key]),
      locked
    };
  });

  return res.json({
    tenant: {
      id: toObjectIdString(req.tenant._id),
      slug: req.tenant.slug,
      name: req.tenant.name,
      planTier,
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
  const planTier = resolveTenantFeatureTier(req.tenant);
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
      ? !hasFeature(planTier, module.requiredFeature, req.tenant.addOns || [])
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

router.get("/billing", ensureBillingVisibleForTenant, async (req, res) => {
  const planTier = resolveTenantFeatureTier(req.tenant);
  const mode = getBillingMode();
  const [portal, billing, foundersAvailability, invoices, memberCount, subscriptionStatus] = await Promise.all([
    createBillingPortalUrl({
      tenant: req.tenant,
      returnPath: `/t/${req.tenant.slug}/admin/billing`
    }),
    Promise.resolve(buildBillingPublicSnapshot(req.tenant)),
    getFoundersAvailability(),
    listRecentTenantInvoices(req.tenant, { limit: 12 }),
    ProfileModel.count(req.tenant._id, { status: { $ne: "removed" } }),
    getTenantSubscriptionStatus(req.tenant)
  ]);
  const planLimit = planTier === "premium" ? null : 5000;
  const usagePct = planLimit ? Math.round((memberCount / Math.max(planLimit, 1)) * 100) : null;

  return res.json({
    tenant: {
      id: toObjectIdString(req.tenant._id),
      slug: req.tenant.slug,
      name: req.tenant.name,
      planTier,
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
      initialCheckoutCompletedAt: billing.initialCheckoutCompletedAt,
      activatedAt: billing.activatedAt,
      canceledAt: billing.canceledAt,
      foundersReserved: billing.foundersReserved,
      foundersSlot: billing.foundersSlot,
      foundersEligible: billing.foundersEligible,
      isComplimentary: Boolean(billing.isComplimentary)
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
    invoices,
    subscription: subscriptionStatus
  });
});

router.post("/billing/checkout", ensureBillingVisibleForTenant, async (req, res, next) => {
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

    const planCode = requested
      ? normalizeBillingPlan(requested, resolveTenantFeatureTier(req.tenant))
      : resolveTenantBilling(req.tenant).billingPlan;

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
      action: checkout.action || "checkout_started",
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

router.post("/billing/cancel", ensureBillingVisibleForTenant, async (req, res, next) => {
  try {
    const cancelAtPeriodEnd = req.body?.cancelAtPeriodEnd !== false;
    const result = await cancelTenantSubscription({
      tenant: req.tenant,
      billingOperator: req.user,
      cancelAtPeriodEnd
    });
    return res.json({ ok: true, ...result });
  } catch (error) {
    return next(error);
  }
});

router.post("/billing/resume", ensureBillingVisibleForTenant, async (req, res, next) => {
  try {
    const result = await resumeTenantSubscription({
      tenant: req.tenant,
      billingOperator: req.user
    });
    return res.json({ ok: true, ...result });
  } catch (error) {
    return next(error);
  }
});

router.get("/settings", async (req, res) => {
  req.tenant = await ensureTenantMobileAppCode(req.tenant);
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
      planTier: resolveTenantFeatureTier(req.tenant)
    },
    identity: {
      campName: String(req.tenant.name || ""),
      campType: normalizeCampType(content.campType || "coed"),
      networkName: content.networkDisplayName,
      homepageQuote: String(content.welcomeBody || "").trim(),
      tagline: String(content.welcomeBody || content.welcomeHeadline || "").trim(),
      aboutText: content.aboutText,
      contactEmail: content.contactEmail,
      websiteUrl,
      ageGroups: normalizeIdentityLabelList(content.ageGroups, DEFAULT_AGE_GROUPS),
      staffRoles: normalizeIdentityLabelList(content.staffRoles, DEFAULT_STAFF_ROLES)
    },
    branding: {
      logoUrl: theme.logoUrl,
      heroImageUrl: theme.heroImageUrl,
      heroImagePosition: theme.heroImagePosition,
      heroImageSize: theme.heroImageSize,
      heroImagePositionLanding: theme.heroImagePositionLanding,
      heroImageSizeLanding: theme.heroImageSizeLanding,
      heroImagePositionMember: theme.heroImagePositionMember,
      heroImageSizeMember: theme.heroImageSizeMember,
      brandPrimary: theme.brandPrimary
    },
    access: {
      signupMode: settings.signupMode,
      accessCodeHint: settings.accessCodeHint || "",
      hasAccessCode: Boolean(settings.hasAccessCode),
      mobileAppCode: settings.mobileAppCodeLookup || "",
      mobileAppCodeHint: settings.mobileAppCodeHint || "",
      hasMobileAppCode: Boolean(settings.hasMobileAppCode),
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
  const nextCampType = normalizeCampType(req.body?.campType ?? content.campType ?? "coed");
  const nextNetworkName = replaceAlumniForCampType(
    sanitizeText(String(req.body?.networkName ?? (content.networkDisplayName || "")).trim()),
    nextCampType
  );
  const nextHomepageQuote = sanitizeText(
    String(
      req.body?.homepageQuote ??
        req.body?.tagline ??
        (content.welcomeBody || content.welcomeHeadline || "")
    ).trim()
  );
  const nextAgeGroups = normalizeIdentityLabelList(
    req.body?.ageGroups,
    content.ageGroups && content.ageGroups.length ? content.ageGroups : DEFAULT_AGE_GROUPS
  );
  const nextStaffRoles = normalizeIdentityLabelList(
    req.body?.staffRoles,
    content.staffRoles && content.staffRoles.length ? content.staffRoles : DEFAULT_STAFF_ROLES
  );

  if (!nextAgeGroups.length) {
    return res.status(400).json({
      error: {
        code: "INVALID_AGE_GROUPS",
        message: "Add at least one camper age group."
      }
    });
  }
  if (!nextStaffRoles.length) {
    return res.status(400).json({
      error: {
        code: "INVALID_STAFF_ROLES",
        message: "Add at least one staff role."
      }
    });
  }

  const next = {
    campType: nextCampType,
    networkDisplayName: nextNetworkName,
    welcomeBody: replaceAlumniForCampType(nextHomepageQuote, nextCampType),
    aboutText: replaceAlumniForCampType(
      sanitizeText(String(req.body?.aboutText ?? (content.aboutText || "")).trim()),
      nextCampType
    ),
    contactEmail: normalizeEmail(req.body?.contactEmail ?? (content.contactEmail || "")),
    supportUrl: String(req.body?.websiteUrl ?? (content.supportUrl || "")).trim(),
    ageGroups: nextAgeGroups,
    staffRoles: nextStaffRoles
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
      heroImageSize: String(req.body?.heroImageSize ?? (theme.heroImageSize || "")).trim(),
      heroImagePositionLanding: String(
        req.body?.heroImagePositionLanding ??
          req.body?.heroImagePosition ??
          (theme.heroImagePositionLanding || theme.heroImagePosition || "")
      ).trim(),
      heroImageSizeLanding: String(
        req.body?.heroImageSizeLanding ??
          req.body?.heroImageSize ??
          (theme.heroImageSizeLanding || theme.heroImageSize || "")
      ).trim(),
      heroImagePositionMember: String(
        req.body?.heroImagePositionMember ??
          req.body?.heroImagePosition ??
          (theme.heroImagePositionMember || theme.heroImagePosition || "")
      ).trim(),
      heroImageSizeMember: String(
        req.body?.heroImageSizeMember ??
          req.body?.heroImageSize ??
          (theme.heroImageSizeMember || theme.heroImageSize || "")
      ).trim()
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
      heroImageSize: next.heroImageSize,
      heroImagePositionLanding: next.heroImagePositionLanding,
      heroImageSizeLanding: next.heroImageSizeLanding,
      heroImagePositionMember: next.heroImagePositionMember,
      heroImageSizeMember: next.heroImageSizeMember
    },
    onboardingDraft: {
      ...draft,
      theme: {
        ...draft.theme,
        brandPrimary: next.brandPrimary || theme.brandPrimary,
        logoUrl: next.logoUrl,
        heroImageUrl: next.heroImageUrl,
        heroImagePosition: next.heroImagePosition,
        heroImageSize: next.heroImageSize,
        heroImagePositionLanding: next.heroImagePositionLanding,
        heroImageSizeLanding: next.heroImageSizeLanding,
        heroImagePositionMember: next.heroImagePositionMember,
        heroImageSizeMember: next.heroImageSizeMember
      },
      updatedAt: new Date(),
      updatedByUserId: req.user.id
    }
  });

  return res.json({ ok: true, branding: resolveDraft(tenant).theme });
});

router.patch("/settings/access", async (req, res) => {
  req.tenant = await ensureTenantMobileAppCode(req.tenant);
  const signupMode = normalizeSignupMode(req.body?.signupMode || "open");
  const draft = resolveDraft(req.tenant);
  let settings;
  try {
    settings = await buildSettingsStorePayload(
      {
        ...draft.settings,
        signupMode,
        accessCode: req.body?.accessCode,
        mobileAppCodeLookup:
          draft.settings?.mobileAppCodeLookup || req.tenant?.settings?.mobileAppCodeLookup || "",
        mobileAppCodeHint:
          draft.settings?.mobileAppCodeHint || req.tenant?.settings?.mobileAppCodeHint || "",
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
        hasAccessCode: Boolean(settings.accessCodeHash),
        hasMobileAppCode: Boolean(settings.mobileAppCodeLookup)
      },
      updatedAt: new Date(),
      updatedByUserId: req.user.id
    }
  });

  await writeAdminAudit(req, "admin_access_settings_updated", {
    signupMode,
    requireProfileCompletion: Boolean(settings.requireProfileCompletion),
    hasAccessCode: Boolean(settings.accessCodeHash),
    hasMobileAppCode: Boolean(settings.mobileAppCodeLookup)
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
    expiresAt: invite.expiresAt,
    replyTo: normalizeEmail(req.user?.email || "")
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

router.post("/settings/support-request", supportRequestLimiter, async (req, res) => {
  const topicRaw = String(req.body?.topic || "general").trim().toLowerCase();
  const priorityRaw = String(req.body?.priority || "normal").trim().toLowerCase();
  const topic = SUPPORT_REQUEST_TOPICS.has(topicRaw) ? topicRaw : "general";
  const priority = SUPPORT_REQUEST_PRIORITIES.has(priorityRaw) ? priorityRaw : "normal";
  const subject = sanitizeText(String(req.body?.subject || "").trim()).slice(0, 160);
  const message = sanitizeText(String(req.body?.message || "").trim()).slice(0, 6000);
  const replyEmailRaw = normalizeEmail(req.body?.replyEmail || req.user?.email || "");
  const replyEmail = isEmail(replyEmailRaw) ? replyEmailRaw : "";

  if (subject.length < 3) {
    return res.status(400).json({
      error: {
        code: "SUPPORT_SUBJECT_REQUIRED",
        message: "Please add a subject (at least 3 characters)."
      }
    });
  }

  if (message.length < 10) {
    return res.status(400).json({
      error: {
        code: "SUPPORT_MESSAGE_REQUIRED",
        message: "Please add more detail so support can help."
      }
    });
  }

  if (String(req.body?.replyEmail || "").trim() && !replyEmail) {
    return res.status(400).json({
      error: {
        code: "SUPPORT_REPLY_EMAIL_INVALID",
        message: "Reply email must be valid."
      }
    });
  }

  const supportEmail = resolveSupportContactEmail();
  const tenantSlug = String(req.tenant?.slug || "").trim().toLowerCase();
  const tenantName = sanitizeText(String(req.tenant?.name || "").trim()) || "Unknown tenant";
  const actorEmail = normalizeEmail(req.user?.email || "");
  const actorId = toObjectIdString(req.user?.id || req.user?._id || "");
  const ticketId = `PB-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${crypto
    .randomBytes(3)
    .toString("hex")
    .toUpperCase()}`;
  const tenantUrls = buildTenantUrls(req.tenant);
  const requestedAt = new Date().toISOString();
  const emailBranding = buildTenantEmailBranding(req.tenant, { senderName: "PondBridge Support" });
  const resolvedReplyTo = replyEmail || (isEmail(actorEmail) ? actorEmail : emailBranding.replyTo || "");

  const lines = [
    `Support Request ID: ${ticketId}`,
    `Tenant: ${tenantName}`,
    `Tenant Slug: ${tenantSlug || "-"}`,
    `Tenant URL: ${tenantUrls.appUrl || "-"}`,
    `Submitted At: ${requestedAt}`,
    `Submitted By User ID: ${actorId || "-"}`,
    `Submitted By Email: ${actorEmail || "-"}`,
    `Reply Email: ${resolvedReplyTo || "-"}`,
    `Topic: ${topic}`,
    `Priority: ${priority}`,
    `Subject: ${subject}`,
    "",
    "Message:",
    message
  ];
  const text = lines.join("\n");
  const html = `
    <div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.55;color:#0f172a;">
      <p style="margin:0 0 10px;"><strong>Support Request ID:</strong> ${escapeEmailHtml(ticketId)}</p>
      <p style="margin:0 0 6px;"><strong>Tenant:</strong> ${escapeEmailHtml(tenantName)}</p>
      <p style="margin:0 0 6px;"><strong>Tenant Slug:</strong> ${escapeEmailHtml(tenantSlug || "-")}</p>
      <p style="margin:0 0 6px;"><strong>Tenant URL:</strong> ${escapeEmailHtml(tenantUrls.appUrl || "-")}</p>
      <p style="margin:0 0 6px;"><strong>Submitted At:</strong> ${escapeEmailHtml(requestedAt)}</p>
      <p style="margin:0 0 6px;"><strong>Submitted By User ID:</strong> ${escapeEmailHtml(actorId || "-")}</p>
      <p style="margin:0 0 6px;"><strong>Submitted By Email:</strong> ${escapeEmailHtml(actorEmail || "-")}</p>
      <p style="margin:0 0 6px;"><strong>Reply Email:</strong> ${escapeEmailHtml(resolvedReplyTo || "-")}</p>
      <p style="margin:0 0 6px;"><strong>Topic:</strong> ${escapeEmailHtml(topic)}</p>
      <p style="margin:0 0 6px;"><strong>Priority:</strong> ${escapeEmailHtml(priority)}</p>
      <p style="margin:0 0 12px;"><strong>Subject:</strong> ${escapeEmailHtml(subject)}</p>
      <p style="margin:0 0 6px;"><strong>Message</strong></p>
      <pre style="margin:0;padding:10px 12px;border:1px solid #dbe6f3;border-radius:8px;background:#f8fbff;white-space:pre-wrap;">${escapeEmailHtml(message)}</pre>
    </div>
  `;

  try {
    await sendTransactionalEmail({
      from: emailBranding.from,
      to: supportEmail,
      subject: `[Support] ${tenantName} · ${subject}`.slice(0, 190),
      text,
      html,
      ...(resolvedReplyTo ? { replyTo: resolvedReplyTo } : {})
    });
  } catch (error) {
    return res.status(error?.statusCode || 502).json({
      error: {
        code: error?.code || "SUPPORT_SEND_FAILED",
        message: String(error?.message || "Unable to send support request email.")
      }
    });
  }

  await writeAdminAudit(req, "admin_support_request_submitted", {
    ticketId,
    topic,
    priority,
    subjectLength: subject.length,
    messageLength: message.length
  });

  return res.status(201).json({
    ok: true,
    requestId: ticketId,
    sentTo: supportEmail
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
          replyTo: normalizeEmail(req.user?.email || ""),
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
      clearAdminReadCaches();
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
      clearAdminReadCaches();
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
    clearAdminReadCaches();

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

router.get("/export/csv/preview", async (req, res) => {
  const fieldOrder = normalizeMemberExportFieldOrder(req.query?.fields || "");
  const columns = fieldOrder
    .map((key) => MEMBER_EXPORT_FIELD_MAP.get(key))
    .filter(Boolean);
  const requestedLimit = Number.parseInt(String(req.query?.limit || "6"), 10);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), 20)
    : 6;
  const completionRange = parseCompletionRange(req.query);
  const needsCompletionScores =
    Boolean(completionRange) || columns.some((column) => column.key === "completionPercent");

  const profileQueryOptions = completionRange
    ? { sort: { lastName: 1, firstName: 1 } }
    : { sort: { lastName: 1, firstName: 1 }, limit };
  let profiles = await ProfileModel.find(req.tenant._id, {}, profileQueryOptions);
  let completionByProfileId = new Map();

  if (needsCompletionScores && profiles.length) {
    completionByProfileId = await buildCompletionScoreMapForProfiles(req.tenant._id, profiles);
  }

  if (completionRange) {
    profiles = profiles
      .filter((profile) => {
        const profileId = toObjectIdString(profile?._id || profile?.id);
        const score = profileId && completionByProfileId.has(profileId)
          ? Number(completionByProfileId.get(profileId) || 0)
          : completionScore(profile);
        return matchesCompletionRange(score, completionRange);
      })
      .slice(0, limit);
  }

  const rows = profiles.map((profile) => {
    const profileId = toObjectIdString(profile?._id || profile?.id);
    const completionForRow = profileId ? completionByProfileId.get(profileId) : undefined;
    const row = {};
    for (const column of columns) {
      row[column.key] = sanitizeCsvCell(
        column.getValue(profile, { completionScore: completionForRow })
      );
    }
    return row;
  });

  res.set("Cache-Control", "no-store");
  return res.json({
    columns: columns.map((column) => ({
      key: column.key,
      label: column.label
    })),
    rows
  });
});

router.get("/export/csv", exportLimiter, async (req, res) => {
  const fieldOrder = normalizeMemberExportFieldOrder(req.query?.fields || "");
  const columns = fieldOrder
    .map((key) => MEMBER_EXPORT_FIELD_MAP.get(key))
    .filter(Boolean);
  const completionRange = parseCompletionRange(req.query);
  const needsCompletionScores =
    Boolean(completionRange) || columns.some((column) => column.key === "completionPercent");
  let profiles = await ProfileModel.find(req.tenant._id, {}, {
    sort: { lastName: 1, firstName: 1 }
  });
  let completionByProfileId = new Map();

  if (needsCompletionScores && profiles.length) {
    completionByProfileId = await buildCompletionScoreMapForProfiles(req.tenant._id, profiles);
  }

  if (completionRange) {
    profiles = profiles.filter((profile) => {
      const profileId = toObjectIdString(profile?._id || profile?.id);
      const score = profileId && completionByProfileId.has(profileId)
        ? Number(completionByProfileId.get(profileId) || 0)
        : completionScore(profile);
      return matchesCompletionRange(score, completionRange);
    });
  }

  const records = profiles.map((profile) => {
    const profileId = toObjectIdString(profile?._id || profile?.id);
    const completionForRow = profileId ? completionByProfileId.get(profileId) : undefined;
    const row = {};
    for (const column of columns) {
      row[column.key] = sanitizeCsvCell(
        column.getValue(profile, { completionScore: completionForRow })
      );
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
  const content = resolveContent(req.tenant);
  const alumniWordTitle = alumniPluralForCampType(content.campType || "coed", { capitalized: true });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${req.tenant.slug}-directory-export.pdf"`
  );

  const doc = new PDFDocument({ margin: 40 });
  doc.pipe(res);

  doc.fontSize(18).text(`${req.tenant.name} ${alumniWordTitle} Directory`, { underline: true });
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
      heroImagePositionLanding: String(theme.heroImagePositionLanding || currentTheme.heroImagePositionLanding || theme.heroImagePosition || currentTheme.heroImagePosition),
      heroImageSizeLanding: String(theme.heroImageSizeLanding || currentTheme.heroImageSizeLanding || theme.heroImageSize || currentTheme.heroImageSize),
      heroImagePositionMember: String(theme.heroImagePositionMember || currentTheme.heroImagePositionMember || theme.heroImagePosition || currentTheme.heroImagePosition),
      heroImageSizeMember: String(theme.heroImageSizeMember || currentTheme.heroImageSizeMember || theme.heroImageSize || currentTheme.heroImageSize),
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
