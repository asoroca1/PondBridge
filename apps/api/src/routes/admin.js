import { Router } from "express";
import { buildEmailPalette } from "../services/brandPalette.js";
import crypto from "crypto";
import multer from "multer";
import rateLimit from "express-rate-limit";
import PDFDocument from "pdfkit";
import { stringify } from "csv-stringify/sync";
import { parse as parseCsv } from "csv-parse/sync";
import {
  alumniPluralForCampType,
  hasFeature,
  MEMBER_EVENTS_PAGES_ENABLED,
  TENANT_MODULE_CATALOG as MODULE_CATALOG,
  listFeaturesForPlan,
  normalizeCampType,
  normalizeHomeQuickActions,
  replaceAlumniForCampType,
  resolveTenantModules
} from "@pondbridge/shared";
import { requireTenantRoleScope } from "../middleware/tenantAccess.js";
import { requireFeature } from "../middleware/requireFeature.js";
import {
  ProfileModel,
  TenantModel,
  UserModel,
  InviteModel,
  AlumniContactModel,
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
  ContentReportModel,
  ResumeParseResultModel,
  ActivityItemModel,
  MobileNotificationTemplateModel,
  MobileNotificationScheduleModel,
  AiGenerationModel
} from "../db/models/index.js";
import { findImportReportForTenant } from "../services/csvImport.js";
import { env } from "../config/env.js";
import {
  buildTenantEmailBranding,
  cancelScheduledTransactionalEmail,
  getEmailSchedulingStatus,
  sendBulkTransactionalEmail,
  sendInviteEmail,
  sendTransactionalEmail,
  sendAccessDecisionEmail
} from "../services/email.js";
import { ACTIVE_ALUMNI_FILTER, countActiveAlumni } from "../services/alumniTotals.js";
import { clearMemberDirectoryCaches } from "../services/memberDirectoryCache.js";
import { getTenantAnalyticsSnapshot, logTenantEvent } from "../services/analytics.js";
import { createInviteRecord } from "../services/invites.js";
import {
  buildSettingsStorePayload,
  resolveDraft,
  resolveTheme,
  resolveContent,
  resolveModules,
  normalizeSignupMode,
  normalizeEmailRecipientGroups,
  normalizeEmailTemplates,
  normalizeMemberExportPresets,
  resolveSettings,
  getReadinessChecklist,
  getBillingReadiness
} from "../services/onboarding.js";
import {
  buildBillingPublicSnapshot,
  cancelTenantSubscription,
  createBillingPortalUrl,
  createTenantCheckoutSession,
  getBillingCatalog,
  getBillingMode,
  getTenantSubscriptionStatus,
  listRecentTenantInvoices,
  resumeTenantSubscription,
  syncStripeCustomerContact
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
import { invalidatePublicTenantCache } from "../utils/publicResponseCache.js";
import { createTtlCache } from "../utils/ttlCache.js";
import {
  listRecentMobileNotificationBatches,
  normalizeTenantMobileNotificationPrefs,
  notifyTenantAdmins,
  resolveAudienceUserIds,
  sendMobileNotificationBatch
} from "../services/mobileNotifications.js";
import {
  normalizeReportReviewInput,
  reportPreview,
  resolveReportTarget
} from "../services/memberSafety.js";
import {
  buildEmailPreferenceUrls,
  COMMUNITY_UPDATES_TOPIC,
  resolveEmailRecipientEligibility
} from "../services/emailPreferences.js";
import {
  assertEmailDraftReady,
  resolveCampPostalAddress
} from "../services/emailCompliance.js";
import {
  canonicalizeCityName,
  canonicalizeCountryName,
  composeCityState,
  parseCityStateDetailed
} from "../utils/location.js";
import { emitRealtime } from "../services/socketServer.js";
import { buildTenantFeatureInventory } from "../services/tenantFeatureInventory.js";
import { removeTenantMembershipIdentityLink } from "../services/identityUsers.js";
import { deleteClerkAccountForTenantUser } from "../services/clerkAccountDeletion.js";
import { matchesMemberQuery } from "../utils/memberSearch.js";
import {
  GROWTH_EMAIL_SEGMENTS,
  LIVE_PROFILE_STATUS_FILTER,
  LIVE_USER_STATUS_FILTER,
  buildAlumniGrowthSnapshot,
  buildPeopleDirectory,
  filterHeldAlumniRecipients,
  hasRequiredEmailTargetingSelection,
  isAlumniGrowthStorageUnavailable,
  isRemovedUser,
  normalizeAlumniContactInput,
  resolveGrowthEmailSegment,
  trackInvitedAlumniContact,
  upsertAlumniContact
} from "../services/alumniGrowth.js";

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
const VALID_BILLING_PLAN_CODES = new Set(["flagship", "test"]);
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
// A composite audience is the union of individual rules ("To:" chips in the
// director mail composer). Bounded so one request cannot fan out unboundedly.
const MAX_TARGETING_GROUPS = 25;
const MAX_EMAIL_RECIPIENT_GROUPS = 60;
const MAX_EMAIL_TEMPLATES = 40;
const MAX_MEMBER_EXPORT_PRESETS = 30;

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
const MOBILE_NOTIFICATION_AUDIENCES = new Set([
  "all_active_members",
  "admins",
  "all_users",
  "flagged_members",
  "pending_members",
  "specific_members"
]);
const MOBILE_NOTIFICATION_CATEGORIES = new Set([
  "announcements",
  "events",
  "community",
  "account",
  "admin"
]);

function normalizeMobileNotificationCategory(value = "") {
  const category = String(value || "announcements").trim().toLowerCase();
  return MOBILE_NOTIFICATION_CATEGORIES.has(category) ? category : "announcements";
}

function normalizeMobileNotificationUserIds(value = []) {
  const list = Array.isArray(value) ? value : [];
  const seen = new Set();
  const out = [];
  for (const entry of list) {
    const normalized = String(entry || "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
    if (out.length >= 500) break;
  }
  return out;
}

function resolveSupportContactEmail() {
  return SUPPORT_CONTACT_EMAIL;
}

function normalizeMobileNotificationAudience(value = "") {
  const audience = String(value || "all_active_members").trim().toLowerCase();
  return MOBILE_NOTIFICATION_AUDIENCES.has(audience) ? audience : "all_active_members";
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

function buildDirectorBroadcastEmailContent({
  tenant,
  subject = "",
  preheader = "",
  bodyHtml = "",
  footer = {},
  campaignType = "marketing",
  postalAddress = "",
  unsubscribeUrl = "{{unsubscribeUrl}}"
}) {
  const theme = resolveTheme(tenant);
  const content = resolveContent(tenant);
  const safeSubject = sanitizeText(String(subject || "").trim()).slice(0, 160) || "Update from your network";
  const safePreheader = sanitizeText(String(preheader || "").trim()).slice(0, 160);
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
  const brandPrimary = String(theme.brandPrimary || "#252525").trim() || "#252525";
  const bodyText = toPlainTextFromHtml(safeBodyHtml);
  const footerContactParts = [normalizedFooter.senderEmail, normalizedFooter.senderPhone].filter(Boolean);
  const footerContact = escapeEmailHtml(footerContactParts.join("  •  "));
  const safeSignOff = escapeEmailHtml(normalizedFooter.signOff || "Warmly,");
  const safeSenderName = escapeEmailHtml(normalizedFooter.senderName || "");
  const safeSenderRole = escapeEmailHtml(normalizedFooter.senderRole || "");
  const safeHeaderTagline = escapeEmailHtml(normalizedFooter.headerTagline || "Community update");
  const emailPalette = buildEmailPalette(brandPrimary);
  const headerLogoUrl = normalizeHttpUrl(theme.logoUrl || "");
  const footerLogoUrl = normalizedFooter.showLogo
    ? normalizeHttpUrl(theme.logoUrl || normalizedFooter.logoUrl || "")
    : "";
  const headerLogoMarkup = headerLogoUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="width:42px;height:42px;border-radius:10px;overflow:hidden;border:1px solid rgba(255,255,255,0.28);background:rgba(255,255,255,0.14);"><tr><td align="center" valign="middle" style="width:42px;height:42px;line-height:0;"><img src="${escapeEmailHtml(headerLogoUrl)}" alt="" style="display:block;max-width:38px;max-height:38px;width:auto;height:auto;border:0;outline:none;text-decoration:none;" /></td></tr></table>`
    : `<div style="width:42px;height:42px;border-radius:10px;background:rgba(255,255,255,0.18);color:#ffffff;font-family:Arial,sans-serif;font-size:12px;font-weight:700;line-height:42px;text-align:center;">PB</div>`;
  const footerLogoMarkup = footerLogoUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="width:52px;height:52px;border-radius:10px;overflow:hidden;border:1px solid ${emailPalette.border};background:${emailPalette.surface};"><tr><td align="center" valign="middle" style="width:52px;height:52px;line-height:0;"><img src="${escapeEmailHtml(footerLogoUrl)}" alt="" style="display:block;max-width:46px;max-height:46px;width:auto;height:auto;border:0;outline:none;text-decoration:none;" /></td></tr></table>`
    : "";
  const safeBodyForEmail = safeBodyHtml || "<p style=\"margin:0;\">&nbsp;</p>";
  const isMarketing = campaignType !== "transactional";
  const safePostalAddress = escapeEmailHtml(String(postalAddress || "").trim());
  const safeUnsubscribeUrl = escapeEmailHtml(String(unsubscribeUrl || "{{unsubscribeUrl}}").trim());
  const preheaderMarkup = safePreheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">${escapeEmailHtml(safePreheader)}</div>`
    : "";
  const preferenceMarkup = isMarketing
    ? `<tr><td style="padding:16px 22px 22px 22px;border-top:1px solid ${emailPalette.borderSoft};font-family:Arial,sans-serif;color:${emailPalette.textMuted};font-size:11px;line-height:1.6;text-align:center;">${safePostalAddress ? `<div>${safePostalAddress}</div>` : ""}<div style="margin-top:4px;"><a href="${safeUnsubscribeUrl}" style="color:${emailPalette.primary};text-decoration:underline;">Manage email preferences</a></div></td></tr>`
    : "";

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:${emailPalette.page};">
    ${preheaderMarkup}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${emailPalette.page};padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;border-radius:18px;overflow:hidden;background:${emailPalette.surface};border:1px solid ${emailPalette.border};">
            <tr>
              <td style="padding:18px 20px;background:${escapeEmailHtml(brandPrimary)};color:${emailPalette.onPrimary};">
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
              <td style="padding:24px 22px 18px 22px;font-family:Arial,sans-serif;color:#242424;">
                <h1 style="margin:0 0 14px 0;font-size:24px;line-height:1.28;color:#242424;">${escapeEmailHtml(safeSubject)}</h1>
                <div style="font-size:15px;line-height:1.65;color:#323232;">${safeBodyForEmail}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:0 22px 22px 22px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #eaeaea;margin-top:6px;">
                  <tr>
                    <td style="padding-top:16px;font-family:Arial,sans-serif;color:#4c4c4c;font-size:14px;line-height:1.6;vertical-align:top;">
                      <div>${safeSignOff}</div>
                      ${safeSenderName ? `<div style="margin-top:6px;font-weight:700;color:#303030;">${safeSenderName}</div>` : ""}
                      ${safeSenderRole ? `<div style="color:#616161;">${safeSenderRole}</div>` : ""}
                      ${footerContact ? `<div style="margin-top:4px;color:#616161;">${footerContact}</div>` : ""}
                    </td>
                    ${footerLogoMarkup ? `<td style="padding-top:16px;width:64px;vertical-align:top;text-align:right;">${footerLogoMarkup}</td>` : ""}
                  </tr>
                </table>
              </td>
            </tr>
            ${preferenceMarkup}
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
  const complianceText = isMarketing
    ? [String(postalAddress || "").trim(), `Manage email preferences: ${String(unsubscribeUrl || "{{unsubscribeUrl}}").trim()}`]
        .filter(Boolean)
        .join("\n")
    : "";
  const text = [bodyText, footerTextLines.join("\n"), complianceText].filter(Boolean).join("\n\n");

  return {
    html,
    text: text || " ",
    footer: normalizedFooter,
    preheader: safePreheader,
    campaignType: isMarketing ? "marketing" : "transactional"
  };
}

function normalizeInviteName(value = "") {
  return sanitizeText(String(value || "").trim()).slice(0, 80);
}

function normalizeInviteEmailSubject(value = "") {
  return sanitizeText(String(value || "").replace(/\s+/g, " ").trim()).slice(0, 160);
}

function normalizeInviteEmailMessage(value = "") {
  const normalized = String(value || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => sanitizeText(line))
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return normalized.slice(0, 2000).trim();
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

function analyzeInviteRowsFromCsv(csvBuffer) {
  if (!csvBuffer) return { rows: [], errors: [], rowsRead: 0 };
  const csvText = Buffer.isBuffer(csvBuffer) ? csvBuffer.toString("utf8") : String(csvBuffer);
  const rows = parseCsv(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
    relax_column_count: true
  });

  const inviteRows = [];
  const errors = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
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
      if (isEmail(fromEmailHeader)) {
        inviteRows.push({ firstName, lastName, email: fromEmailHeader });
      } else {
        errors.push({
          rowNumber: index + 2,
          email: fromEmailHeader,
          code: "INVALID_EMAIL",
          message: "Email address is invalid."
        });
      }
      continue;
    }

    let fallbackEmail = "";
    for (const value of Object.values(row || {})) {
      const candidate = normalizeEmail(value);
      if (candidate && isEmail(candidate)) {
        fallbackEmail = candidate;
        break;
      }
    }
    if (fallbackEmail) {
      inviteRows.push({ firstName, lastName, email: fallbackEmail });
    } else {
      errors.push({
        rowNumber: index + 2,
        email: "",
        code: "EMAIL_REQUIRED",
        message: "No valid email address was found in this row."
      });
    }
  }

  return { rows: inviteRows, errors, rowsRead: rows.length };
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

function invitePreviewFingerprint({ tenantId, actorUserId, roleToAssign, recipients, customSubject, customMessage }) {
  const normalizedRecipients = [...(recipients || [])]
    .map((row) => ({
      email: normalizeEmail(row?.email || ""),
      firstName: normalizeInviteName(row?.firstName || ""),
      lastName: normalizeInviteName(row?.lastName || "")
    }))
    .sort((left, right) => left.email.localeCompare(right.email));
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({
      tenantId: String(tenantId || ""),
      actorUserId: String(actorUserId || ""),
      roleToAssign: String(roleToAssign || "user"),
      recipients: normalizedRecipients,
      customSubject: normalizeInviteEmailSubject(customSubject || ""),
      customMessage: normalizeInviteEmailMessage(customMessage || "")
    }))
    .digest("hex");
}

function createInvitePreviewToken(payload) {
  const expiresAt = Date.now() + 15 * 60 * 1000;
  const fingerprint = invitePreviewFingerprint(payload);
  const signature = crypto
    .createHmac("sha256", env.JWT_SECRET)
    .update(`${expiresAt}.${fingerprint}`)
    .digest("base64url");
  return `${expiresAt}.${signature}`;
}

function verifyInvitePreviewToken(token, payload) {
  const [expiresRaw, providedSignature] = String(token || "").trim().split(".", 2);
  const expiresAt = Number(expiresRaw);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() || !providedSignature) return false;
  const fingerprint = invitePreviewFingerprint(payload);
  const expectedSignature = crypto
    .createHmac("sha256", env.JWT_SECRET)
    .update(`${expiresAt}.${fingerprint}`)
    .digest("base64url");
  const provided = Buffer.from(providedSignature);
  const expected = Buffer.from(expectedSignature);
  return provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
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
  "socials",
  "avatarUrl",
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

function clearAdminReadCaches(tenantId = "") {
  clearAdminMembersCache();
  clearAdminDashboardCache();
  // Member writes change the headcount the member-facing home page and map
  // show, so their caches have to go with the admin ones.
  clearMemberDirectoryCaches(tenantId);
}
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
    description: "Profile object for full fidelity export.",
    getValue: (profile) => {
      const visibleProfile = { ...(profile || {}) };
      delete visibleProfile.bio;
      return toExportJsonCell(visibleProfile);
    }
  }
];
const MEMBER_EXPORT_DEFAULT_FIELDS = [
  "firstName",
  "lastName",
  "primaryEmail"
];
const MEMBER_EXPORT_FIELD_MAP = new Map(MEMBER_EXPORT_FIELDS.map((field) => [field.key, field]));



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
        ...metadata,
        requestId: String(req.requestId || ""),
        route: String(req.originalUrl || req.path || ""),
        method: String(req.method || "").toUpperCase()
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
    Array.isArray(profile?.currentJobs) && profile.currentJobs.length > 0
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
    yearsAtCamp: resolveMemberCampYears(profile),
    location: profile.cityState || "",
    completionScore: score,
    completionBucket: completionBucket(score),
    joinDate: toIso(profile.createdAt),
    lastActiveAt: toIso(user?.lastLoginAt),
    status: profile.status || (user?.status === "inactive" ? "removed" : "active"),
    flaggedReason: profile.flaggedReason || "",
    phone: profile?.phones?.find(Boolean) || ""
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

function parseMemberFilterYear(value = "") {
  const match = String(value || "").match(/\b\d{4}\b/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeMemberYearBounds(minValue, maxValue) {
  const minYear = parseMemberFilterYear(minValue);
  const maxYear = parseMemberFilterYear(maxValue);
  if (minYear === null && maxYear === null) {
    return { minYear: null, maxYear: null };
  }
  if (minYear !== null && maxYear !== null) {
    return {
      minYear: Math.min(minYear, maxYear),
      maxYear: Math.max(minYear, maxYear)
    };
  }
  return {
    minYear: minYear ?? maxYear,
    maxYear: maxYear ?? minYear
  };
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

function resolveMemberSocials(profile = {}) {
  return profile?.socials && typeof profile.socials === "object" ? profile.socials : {};
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

function resolveMemberCamperYearsSource(profile = {}) {
  const socials = resolveMemberSocials(profile);
  if (socials?.camperYears && typeof socials.camperYears === "object") {
    return socials.camperYears;
  }
  if (profile?.camperYears && typeof profile.camperYears === "object") {
    return profile.camperYears;
  }
  return {};
}

function resolveMemberStaffYearsSource(profile = {}) {
  const socials = resolveMemberSocials(profile);
  if (socials?.staffYears && typeof socials.staffYears === "object") {
    return socials.staffYears;
  }
  if (profile?.staffYears && typeof profile.staffYears === "object") {
    return profile.staffYears;
  }
  return {};
}

// Widest span a single stint may expand to, so a typo like 1900-2100 cannot
// flood the year filter with entries.
const MAX_CAMP_YEAR_SPAN = 80;

/**
 * Every year a member was actually at camp, expanded from their camper and
 * staff stints. College years belong to the education rows, not camp history,
 * so they are deliberately not part of this list.
 */
function resolveMemberCampYears(profile = {}) {
  const stints = [
    ...normalizeMemberYearStints(resolveMemberCamperYearsSource(profile)),
    ...normalizeMemberYearStints(resolveMemberStaffYearsSource(profile))
  ];
  const years = new Set();
  for (const stint of stints) {
    const startYear = Number(stint.startYear);
    const endYear = Number(stint.endYear);
    if (!Number.isFinite(startYear) || !Number.isFinite(endYear)) continue;
    const lastYear = Math.min(endYear, startYear + MAX_CAMP_YEAR_SPAN);
    for (let year = startYear; year <= lastYear; year += 1) years.add(String(year));
  }
  return [...years].sort();
}

function rangesOverlap(startA, endA, startB, endB) {
  return startA <= endB && startB <= endA;
}

function matchesMemberYearRange(source = {}, minYear = null, maxYear = null) {
  if (minYear === null && maxYear === null) return true;
  const targetStart = minYear ?? maxYear;
  const targetEnd = maxYear ?? minYear;
  const stints = normalizeMemberYearStints(source);
  if (!stints.length) return false;
  return stints.some((stint) =>
    rangesOverlap(
      Number(stint?.startYear || 0),
      Number(stint?.endYear || 0),
      targetStart,
      targetEnd
    )
  );
}

function compareMemberRows(left = {}, right = {}, sort = "join_desc") {
  const key = String(sort || "join_desc").trim().toLowerCase();
  if (key === "name_asc") {
    return `${left.lastName || ""} ${left.firstName || ""}`.localeCompare(
      `${right.lastName || ""} ${right.firstName || ""}`
    );
  }
  if (key === "name_desc") {
    return `${right.lastName || ""} ${right.firstName || ""}`.localeCompare(
      `${left.lastName || ""} ${left.firstName || ""}`
    );
  }
  if (key === "join_asc") {
    return new Date(left.joinDate || 0).getTime() - new Date(right.joinDate || 0).getTime();
  }
  if (key === "last_active_asc") {
    return new Date(left.lastActiveAt || 0).getTime() - new Date(right.lastActiveAt || 0).getTime();
  }
  if (key === "last_active_desc") {
    return new Date(right.lastActiveAt || 0).getTime() - new Date(left.lastActiveAt || 0).getTime();
  }
  if (key === "completion_asc") return Number(left.completionScore || 0) - Number(right.completionScore || 0);
  if (key === "completion_desc") return Number(right.completionScore || 0) - Number(left.completionScore || 0);
  return new Date(right.joinDate || 0).getTime() - new Date(left.joinDate || 0).getTime();
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

async function deleteMemberActivityItems(tenantId = "", userIds = []) {
  const safeUserIds = uniqueIdStrings(userIds);
  if (safeUserIds.length === 0) return 0;

  const filter = { actorUserId: { $in: safeUserIds } };
  const count = await ActivityItemModel.count(tenantId, filter);
  if (count > 0) {
    await ActivityItemModel.deleteMany(tenantId, filter);
  }
  return count;
}

async function deleteMemberFromTenant({
  tenantId,
  userId,
  profileId,
  email = "",
  clerkUserId = ""
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
    alumniContactsDeleted: 0,
    accessRequestsDeleted: 0,
    adminAuditLogsDeleted: 0,
    resumeParseResultsDeleted: 0,
    tenantMembershipDeleted: 0,
    globalIdentityDeleted: 0,
    clerkAccount: { status: "skipped", reason: "missing_clerk_user_id" }
  };

  const safeUserId = String(userId || "").trim();
  const safeProfileId = String(profileId || "").trim();
  const safeEmail = normalizeEmail(email);

  // Remove the login first so a Clerk failure leaves the local account intact
  // and the director can safely retry the deletion.
  summary.clerkAccount = await deleteClerkAccountForTenantUser({
    clerkUserId,
    targetUserId: safeUserId
  });

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
        const keep = !safeProfileId || String(member?.profileId || "") !== safeProfileId;
        if (!keep) changed = true;
        return keep;
      })
      .map((member) => {
        const relationships = asArray(member?.relationships);
        const nextRelationships = relationships.filter(
          (relationship) => !safeProfileId || String(relationship?.toProfileId || "") !== safeProfileId
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
  summary.activityItemsDeleted += await deleteMemberActivityItems(tenantId, [safeUserId]);

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

  if (safeEmail) {
    try {
      const alumniContactCount = await AlumniContactModel.count(tenantId, { email: safeEmail });
      if (alumniContactCount > 0) {
        await AlumniContactModel.deleteMany(tenantId, { email: safeEmail });
        summary.alumniContactsDeleted += alumniContactCount;
      }
    } catch (error) {
      if (!isAlumniGrowthStorageUnavailable(error)) throw error;
    }
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

  // 9) Delete profile + tenant membership row. A legacy removed account can
  // survive without its profile, so the People purge path may intentionally
  // call this cleanup with no profile id.
  if (safeProfileId) {
    await ProfileModel.delete(safeProfileId);
    summary.profileDeleted = 1;
  }
  const identityCleanup = await removeTenantMembershipIdentityLink({
    tenantId,
    legacyUserId: safeUserId,
    tenantMembershipId: null
  });
  summary.tenantMembershipDeleted = identityCleanup.membershipDeleted;
  summary.globalIdentityDeleted = identityCleanup.identityDeleted;
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

function normalizeTargeting(input = {}, { allowComposite = true } = {}) {
  const mode = String(input.mode || "all").trim().toLowerCase();
  const allowedModes = allowComposite
    ? ["all", "role", "year", "custom", "segment", "composite"]
    : ["all", "role", "year", "custom", "segment"];
  const safeMode = allowedModes.includes(mode) ? mode : "all";
  const requestedSegment = String(input.segment || "").trim().toLowerCase();
  const groups = safeMode === "composite"
    ? asArray(input.groups)
        .slice(0, MAX_TARGETING_GROUPS)
        .map((group) => normalizeTargeting(group, { allowComposite: false }))
        .filter((group) => hasRequiredEmailTargetingSelection(group))
    : [];
  return {
    mode: safeMode,
    roles: asArray(input.roles).map((item) => String(item || "").trim()).filter(Boolean),
    years: asArray(input.years).map((item) => String(item || "").trim()).filter(Boolean),
    profileIds: parseIds(input.profileIds || []),
    segment: GROWTH_EMAIL_SEGMENTS.has(requestedSegment) ? requestedSegment : "",
    groups,
    label: sanitizeText(String(input.label || "").trim()).slice(0, 240)
  };
}

function serializeEmailBroadcast(item) {
  const rawStats = item?.stats && typeof item.stats === "object" ? item.stats : {};
  const rawProviderSchedule = rawStats?.providerSchedule && typeof rawStats.providerSchedule === "object"
    ? rawStats.providerSchedule
    : null;
  const stats = rawProviderSchedule
    ? {
        ...rawStats,
        providerSchedule: {
          ...rawProviderSchedule,
          messageCount: Array.isArray(rawProviderSchedule.messageIds)
            ? rawProviderSchedule.messageIds.length
            : Number(rawProviderSchedule.messageCount || 0),
          messageIds: undefined
        }
      }
    : rawStats;
  return {
    id: toObjectIdString(item?._id),
    subject: item?.subject || "",
    preheader: item?.preheader || "",
    body: item?.body || "",
    campaignType: item?.campaignType || "marketing",
    aiGenerationId: item?.aiGenerationId || null,
    complianceSnapshot: item?.complianceSnapshot || {},
    status: item?.status || "draft",
    recipientCount: Number(item?.recipientCount || 0),
    excludedCount: Number(item?.excludedCount || 0),
    targeting: item?.targeting || {},
    scheduledFor: toIso(item?.scheduledFor),
    sentAt: toIso(item?.sentAt),
    createdAt: toIso(item?.createdAt),
    updatedAt: toIso(item?.updatedAt),
    stats
  };
}

async function resolveProfilesForTargeting(tenantId, normalized) {
  if (!hasRequiredEmailTargetingSelection(normalized)) return [];

  if (normalized.mode === "composite") {
    const resolved = await Promise.all(
      normalized.groups.map((group) => resolveProfilesForTargeting(tenantId, group))
    );
    const byId = new Map();
    for (const group of resolved) {
      for (const profile of group) {
        byId.set(toObjectIdString(profile._id), profile);
      }
    }
    return [...byId.values()];
  }

  const filter = { status: { $ne: "removed" } };

  if (normalized.mode === "year" && normalized.years.length > 0) {
    filter.collegeYears = { $contains: normalized.years };
  }

  if (normalized.mode === "custom" && normalized.profileIds.length > 0) {
    filter._id = { $in: normalized.profileIds };
  }

  let profiles = await ProfileModel.find(tenantId, filter);

  if (normalized.mode === "segment" && normalized.segment) {
    const userIds = [...new Set(
      profiles.map((profile) => String(profile?.userId || "").trim()).filter(Boolean)
    )];
    const [users, analyticsEvents] = userIds.length
      ? await Promise.all([
          UserModel.find(tenantId, { _id: { $in: userIds } }, {
            select: ["id", "createdAt", "lastLoginAt"]
          }),
          normalized.segment.startsWith("inactive_")
            ? AnalyticsEventModel.find(tenantId, {
                userId: { $in: userIds },
                createdAt: { $gte: new Date(Date.now() - 90 * DAY_MS) }
              }, {
                select: ["userId", "createdAt"],
                limit: 10000
              })
            : Promise.resolve([])
        ])
      : [[], []];
    profiles = resolveGrowthEmailSegment({
      segment: normalized.segment,
      profiles,
      users,
      analyticsEvents
    });
  }

  // Role filtering with case-insensitive matching (done JS-side)
  if (normalized.mode === "role" && normalized.roles.length > 0) {
    const lowerRoles = normalized.roles.map((r) => r.toLowerCase());
    profiles = profiles.filter((p) =>
      lowerRoles.includes((p.roleAtCamp || "").toLowerCase())
    );
  }

  return profiles;
}

async function resolveRecipientsForTargeting(tenantId, targeting) {
  const normalized = normalizeTargeting(targeting);
  const profiles = await resolveProfilesForTargeting(tenantId, normalized);
  if (profiles.length === 0) {
    return { profiles: [], recipients: [], heldRecipients: [], matchedRecipientCount: 0 };
  }

  const matchedRecipients = [...new Set(
    profiles
      .map((profile) => String(profile?.emails?.[0] || "").trim().toLowerCase())
      .filter((email) => isEmail(email))
  )];
  let heldRecipients = [];
  if (matchedRecipients.length) {
    try {
      const heldContacts = await AlumniContactModel.find(tenantId, {
        email: { $in: matchedRecipients },
        contactStatus: "do_not_contact"
      }, { select: ["email"] });
      heldRecipients = [...new Set(
        heldContacts.map((item) => normalizeEmail(item.email)).filter(Boolean)
      )];
    } catch (error) {
      if (!isAlumniGrowthStorageUnavailable(error)) throw error;
    }
  }
  const filteredRecipients = filterHeldAlumniRecipients(matchedRecipients, heldRecipients.map((email) => ({
    email,
    contactStatus: "do_not_contact"
  })));
  heldRecipients = filteredRecipients.heldRecipients;
  const recipients = filteredRecipients.deliverableRecipients;

  return {
    profiles,
    recipients,
    heldRecipients,
    matchedRecipientCount: matchedRecipients.length
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
      recentSignIns,
      failedBroadcasts,
      scheduledBroadcasts,
      openSafetyReports
    ] =
      await Promise.all([
        countActiveAlumni(tenantId),
        ProfileModel.count(tenantId, {
          ...ACTIVE_ALUMNI_FILTER,
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
            "currentJobs"
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
        ),
        EmailBroadcastModel.count(tenantId, { status: "failed" }),
        EmailBroadcastModel.count(tenantId, { status: "scheduled" }),
        ContentReportModel.count(tenantId, { status: { $in: ["open", "reviewing"] } })
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
      ...ACTIVE_ALUMNI_FILTER,
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

    const readiness = getReadinessChecklist(req.tenant, { importedCount: activeMembers });
    const billingReadiness = getBillingReadiness(req.tenant);
    const actionQueue = [];
    const tenantAdminBase = `/t/${encodeURIComponent(String(req.tenant.slug || ""))}/admin`;

    if (pendingApprovals > 0) {
      actionQueue.push({
        id: "pending-approvals",
        priority: "high",
        title: `${pendingApprovals} access ${pendingApprovals === 1 ? "request" : "requests"} waiting`,
        detail: "Review member access before applicants are left waiting.",
        actionLabel: "Review requests",
        href: `${tenantAdminBase}/people/request`
      });
    }
    if (failedBroadcasts > 0) {
      actionQueue.push({
        id: "failed-communications",
        priority: "high",
        title: `${failedBroadcasts} failed ${failedBroadcasts === 1 ? "email" : "emails"}`,
        detail: "Inspect delivery details and resend only after correcting the cause.",
        actionLabel: "See what failed",
        href: `${tenantAdminBase}/email/sent`
      });
    }
    if (!billingReadiness.ok) {
      actionQueue.push({
        id: "billing-readiness",
        priority: "high",
        title: "Billing needs attention",
        detail: "Resolve billing or onboarding-fee requirements to protect network access.",
        actionLabel: "Review billing",
        href: `${tenantAdminBase}/billing`
      });
    }
    if (req.tenant.onboardingStatus !== "live" && !readiness.isReady) {
      const remaining = readiness.checks.filter((item) => !item.ok);
      actionQueue.push({
        id: "launch-readiness",
        priority: "medium",
        title: `${remaining.length} required launch ${remaining.length === 1 ? "step" : "steps"} left`,
        detail: remaining.map((item) => item.label).join(" · "),
        actionLabel: "Finish setup",
        href: `/t/${encodeURIComponent(String(req.tenant.slug || ""))}/onboarding`
      });
    }
    if (scheduledBroadcasts > 0) {
      actionQueue.push({
        id: "scheduled-communications",
        priority: "medium",
        title: `${scheduledBroadcasts} scheduled ${scheduledBroadcasts === 1 ? "email" : "emails"}`,
        detail: "Confirm timing and recipient choices before the provider sends them.",
        actionLabel: "Review schedule",
        href: `${tenantAdminBase}/email/scheduled`
      });
    }
    if (activeMembers > 0 && completionAverage < 70) {
      actionQueue.push({
        id: "profile-completion",
        priority: "low",
        title: `Member profiles average ${completionAverage}% complete`,
        detail: "Consider a focused reminder to help members finish useful directory details.",
        actionLabel: "Review members",
        href: `${tenantAdminBase}/people/member`
      });
    }

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
        // A percentage off a near-empty baseline is arithmetic, not information:
        // one member growing to 316 by import reads as "up 31500%". Below a
        // handful of prior members there is no trend to report, so send null and
        // let the page say nothing rather than something absurd.
        totalMembersDelta:
          priorWindowCount >= 5
            ? Math.round(((activeMembers - priorWindowCount) / priorWindowCount) * 100)
            : null,
        newThisWeek,
        pendingApprovals,
        openSafetyReports,
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
      actionQueue,
      recentActivity: activity
    };
    adminDashboardResponseCache.set(cacheKey, payload);
    res.set("Cache-Control", ADMIN_DASHBOARD_CACHE_CONTROL);
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get("/safety/reports", async (req, res, next) => {
  try {
    const requestedStatus = String(req.query.status || "active").trim().toLowerCase();
    const where = requestedStatus === "all"
      ? {}
      : requestedStatus === "active"
      ? { status: { $in: ["open", "reviewing"] } }
      : { status: requestedStatus };
    const reports = await ContentReportModel.find(req.tenant._id, where, {
      sort: { createdAt: -1 },
      limit: 250
    });
    const userIds = [
      ...new Set(
        reports
          .flatMap((report) => [
            report.reporterUserId,
            report.targetAuthorUserId,
            report.reviewedByUserId
          ])
          .map((value) => String(value || "").trim())
          .filter(Boolean)
      )
    ];
    const profiles = userIds.length
      ? await ProfileModel.find(req.tenant._id, { userId: { $in: userIds } }, {
          select: ["id", "userId", "firstName", "lastName", "avatarUrl"],
          limit: userIds.length
        })
      : [];
    const profileByUserId = new Map(
      profiles.map((profile) => [String(profile.userId || ""), profile])
    );
    const displayUser = (userId) => {
      const profile = profileByUserId.get(String(userId || ""));
      return {
        userId: String(userId || ""),
        profileId: String(profile?._id || profile?.id || ""),
        name: [profile?.firstName, profile?.lastName].filter(Boolean).join(" ").trim() || "Member"
      };
    };

    const items = await Promise.all(
      reports.map(async (report) => {
        const target = await resolveReportTarget(req.tenant._id, report).catch(() => null);
        return {
          id: String(report._id || report.id || ""),
          targetType: String(report.targetType || ""),
          targetId: String(report.targetId || ""),
          targetContextId: String(target?.contextId || ""),
          targetAvailable: Boolean(target),
          targetPreview: target ? reportPreview(target.preview) : "Reported item is no longer available.",
          reason: String(report.reason || "other"),
          details: String(report.details || ""),
          status: String(report.status || "open"),
          resolutionNote: String(report.resolutionNote || ""),
          reporter: displayUser(report.reporterUserId),
          targetAuthor: report.targetAuthorUserId ? displayUser(report.targetAuthorUserId) : null,
          reviewer: report.reviewedByUserId ? displayUser(report.reviewedByUserId) : null,
          reviewedAt: toIso(report.reviewedAt),
          createdAt: toIso(report.createdAt),
          updatedAt: toIso(report.updatedAt)
        };
      })
    );
    return res.json({ items, status: requestedStatus });
  } catch (error) {
    return next(error);
  }
});

router.patch("/safety/reports/:reportId", async (req, res, next) => {
  try {
    const reportId = String(req.params.reportId || "").trim();
    const report = await ContentReportModel.findOne(req.tenant._id, { _id: reportId });
    if (!report) {
      return res.status(404).json({
        error: { code: "REPORT_NOT_FOUND", message: "Safety report not found." }
      });
    }

    const review = normalizeReportReviewInput(req.body);
    const isClosed = review.status === "resolved" || review.status === "dismissed";
    const updated = await ContentReportModel.updateScoped(req.tenant._id, report._id, {
      status: review.status,
      resolutionNote: isClosed ? review.resolutionNote : "",
      reviewedByUserId: review.status === "open" ? null : req.user.id,
      reviewedAt: review.status === "open" ? null : new Date()
    });
    adminDashboardResponseCache.clear();
    await writeAdminAudit(req, "safety_report_status_changed", {
      reportId,
      targetType: report.targetType,
      targetId: report.targetId,
      before: { status: report.status, resolutionNote: report.resolutionNote || "" },
      after: { status: updated.status, resolutionNote: updated.resolutionNote || "" }
    });
    return res.json({
      report: {
        id: String(updated._id || updated.id || ""),
        status: updated.status,
        resolutionNote: updated.resolutionNote || "",
        reviewedAt: toIso(updated.reviewedAt)
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.delete("/safety/reports/:reportId/target", async (req, res, next) => {
  try {
    const reportId = String(req.params.reportId || "").trim();
    const report = await ContentReportModel.findOne(req.tenant._id, { _id: reportId });
    if (!report) {
      return res.status(404).json({
        error: { code: "REPORT_NOT_FOUND", message: "Safety report not found." }
      });
    }

    const targetType = String(report.targetType || "").trim();
    if (!new Set(["message", "forum_post"]).has(targetType)) {
      return res.status(400).json({
        error: {
          code: "UNSUPPORTED_MODERATION_TARGET",
          message: "This content type cannot be removed from the messaging moderation flow."
        }
      });
    }

    const resolutionNote = sanitizeText(String(req.body?.resolutionNote || "").trim()).slice(0, 1200);
    if (!resolutionNote) {
      return res.status(400).json({
        error: { code: "RESOLUTION_NOTE_REQUIRED", message: "Document why this content is being removed." }
      });
    }

    const deletedAt = new Date();
    let realtimeEvent = null;
    if (targetType === "message") {
      const message = await MessageModel.findOne(req.tenant._id, {
        _id: report.targetId,
        deletedAt: null
      });
      if (!message) {
        return res.status(404).json({
          error: { code: "REPORT_TARGET_NOT_FOUND", message: "The reported message is no longer available." }
        });
      }
      await MessageModel.updateScoped(req.tenant._id, message._id, { deletedAt });

      const conversation = await ConversationModel.findOne(req.tenant._id, {
        _id: message.conversationId
      });
      if (conversation) {
        const latest = await MessageModel.find(
          req.tenant._id,
          { conversationId: conversation._id, deletedAt: null },
          { sort: { createdAt: -1 }, limit: 1 }
        );
        const latestMessage = latest[0] || null;
        const lastMessageAt = latestMessage?.createdAt || conversation.createdAt || deletedAt;
        await ConversationModel.updateScoped(req.tenant._id, conversation._id, {
          lastMessageAt,
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
                createdAt: latestMessage.createdAt || lastMessageAt
              }
            : null
        });
      }
      realtimeEvent = {
        room: `conversation:${String(message.conversationId)}`,
        name: "message:deleted",
        payload: { id: String(message._id), conversationId: String(message.conversationId) }
      };
    } else {
      const post = await ForumPostModel.findOne(req.tenant._id, {
        _id: report.targetId,
        deletedAt: null
      });
      if (!post) {
        return res.status(404).json({
          error: { code: "REPORT_TARGET_NOT_FOUND", message: "The reported forum post is no longer available." }
        });
      }
      await ForumPostModel.updateScoped(req.tenant._id, post._id, { deletedAt });
      const forum = await ForumModel.findOne(req.tenant._id, { _id: post.forumId });
      if (forum) {
        const latestPosts = await ForumPostModel.find(
          req.tenant._id,
          { forumId: forum._id, deletedAt: null },
          { sort: { createdAt: -1 }, limit: 1 }
        );
        await ForumModel.updateScoped(req.tenant._id, forum._id, {
          postsCount: Math.max(0, Number(forum.postsCount || 0) - 1),
          lastActivityAt: latestPosts[0]?.createdAt || forum.createdAt || deletedAt
        });
      }
      realtimeEvent = {
        room: `forum:${String(post.forumId)}`,
        name: "forum:post:deleted",
        payload: { id: String(post._id), forumId: String(post.forumId) }
      };
    }

    const updatedReport = await ContentReportModel.updateScoped(req.tenant._id, report._id, {
      status: "resolved",
      resolutionNote,
      reviewedByUserId: req.user.id,
      reviewedAt: deletedAt
    });
    if (realtimeEvent) {
      emitRealtime(realtimeEvent.room, realtimeEvent.name, realtimeEvent.payload);
    }
    adminDashboardResponseCache.clear();
    await writeAdminAudit(req, "reported_messaging_content_removed", {
      reportId,
      targetType,
      targetId: report.targetId,
      resolutionNote
    });

    return res.json({
      ok: true,
      report: {
        id: String(updatedReport._id || updatedReport.id || ""),
        status: updatedReport.status,
        resolutionNote: updatedReport.resolutionNote || "",
        reviewedAt: toIso(updatedReport.reviewedAt)
      }
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
    const sort = String(req.query.sort || "join_desc").trim().toLowerCase();
    const { minYear: camperMinYear, maxYear: camperMaxYear } = normalizeMemberYearBounds(
      req.query.camperMin,
      req.query.camperMax
    );
    const { minYear: staffMinYear, maxYear: staffMaxYear } = normalizeMemberYearBounds(
      req.query.staffMin,
      req.query.staffMax
    );
    const hasNestedYearFilters =
      camperMinYear !== null ||
      camperMaxYear !== null ||
      staffMinYear !== null ||
      staffMaxYear !== null;
    // Camp years live inside the camper/staff stints, which Supabase cannot
    // filter on directly, so this narrows JS-side like the range filters do.
    const campYear = year && year !== "all" ? year : "";
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

    // "All statuses" means every status a member can hold, not every row ever
    // written. Removed members stay out unless they are asked for by name --
    // otherwise someone a director deleted comes back as a mail recipient.
    filter.status = status && status !== "all" ? status : LIVE_PROFILE_STATUS_FILTER;

    let mongoSort = sortForMembers(sort);
    if (completionRange || hasNestedYearFilters || campYear) {
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
      allProfiles = allProfiles.filter((p) => matchesMemberQuery(p, q));
    }

    if (campYear) {
      allProfiles = allProfiles.filter((profile) => resolveMemberCampYears(profile).includes(campYear));
    }

    if (hasNestedYearFilters) {
      allProfiles = allProfiles.filter((profile) =>
        matchesMemberYearRange(resolveMemberCamperYearsSource(profile), camperMinYear, camperMaxYear) &&
        matchesMemberYearRange(resolveMemberStaffYearsSource(profile), staffMinYear, staffMaxYear)
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
          return matchesMemberQuery(p, q);
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

      mapped.sort((a, b) => compareMemberRows(a, b, sort));

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
  const updated = await ProfileModel.updateScoped(req.tenant._id, profile._id, cleanPatch);

  if (cleanPatch.status && userId) {
    const nextUserStatus = cleanPatch.status === "removed" ? "inactive" : "active";
    await UserModel.updateScoped(req.tenant._id, userId, { status: nextUserStatus });
    if (cleanPatch.status === "removed") {
      await deleteMemberActivityItems(req.tenant._id, [userId]);
    }
  }

  await writeAdminAudit(req, "admin_member_full_profile_updated", {
    profileId: toObjectIdString(updated._id),
    userId,
    changedFields: Object.keys(cleanPatch)
  });
  clearAdminReadCaches(req.tenant._id);

  if (cleanPatch.status === "flagged") {
    await notifyTenantAdmins({
      tenant: req.tenant,
      createdByUserId: req.user.id,
      kind: "member_flagged",
      title: "Member flagged",
      body: `${updated.firstName || "A member"} ${updated.lastName || ""}`.trim()
        ? `${`${updated.firstName || "A member"} ${updated.lastName || ""}`.trim()} was flagged for director follow-up.`
        : "A member was flagged for director follow-up.",
      deepLink: "/admin/members",
      data: {
        profileId: toObjectIdString(updated._id),
        userId
      }
    }).catch(() => {});
  }

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

  const updated = await ProfileModel.updateScoped(req.tenant._id, profile._id, patch);

  if (patch.status) {
    const nextUserStatus = patch.status === "removed" ? "inactive" : "active";
    await UserModel.updateScoped(req.tenant._id, updated.userId, { status: nextUserStatus });
    if (patch.status === "removed") {
      await deleteMemberActivityItems(req.tenant._id, [updated.userId]);
    }
  }

  const user = await UserModel.findOne(req.tenant._id, { _id: updated.userId });
  await writeAdminAudit(req, "admin_member_updated", {
    profileId: toObjectIdString(updated._id),
    userId: toObjectIdString(updated.userId),
    changedFields: Object.keys(patch)
  });
  clearAdminReadCaches(req.tenant._id);

  if (patch.status === "flagged") {
    await notifyTenantAdmins({
      tenant: req.tenant,
      createdByUserId: req.user.id,
      kind: "member_flagged",
      title: "Member flagged",
      body: `${updated.firstName || "A member"} ${updated.lastName || ""}`.trim()
        ? `${`${updated.firstName || "A member"} ${updated.lastName || ""}`.trim()} was flagged for director follow-up.`
        : "A member was flagged for director follow-up.",
      deepLink: "/admin/members",
      data: {
        profileId: toObjectIdString(updated._id),
        userId: toObjectIdString(updated.userId)
      }
    }).catch(() => {});
  }

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
      const identityCleanup = await removeTenantMembershipIdentityLink({
        tenantId: req.tenant._id,
        legacyUserId: userId,
        tenantMembershipId: profile.tenantMembershipId
      });
      await deleteMemberActivityItems(req.tenant._id, [userId]);
      await ProfileModel.delete(profile._id);
      await writeAdminAudit(req, "admin_member_hard_deleted", {
        profileId: toObjectIdString(profile._id),
        userId,
        summary: {
          profileDeleted: 1,
          userDeleted: 0,
          tenantMembershipDeleted: identityCleanup.membershipDeleted,
          globalIdentityDeleted: identityCleanup.identityDeleted
        }
      });
      clearAdminReadCaches(req.tenant._id);
      return res.json({
        ok: true,
        deletedProfileId: profileId,
        deletedUserId: userId,
        summary: {
          profileDeleted: 1,
          userDeleted: 0,
          tenantMembershipDeleted: identityCleanup.membershipDeleted,
          globalIdentityDeleted: identityCleanup.identityDeleted
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
      email: profile?.emails?.[0] || user?.email || "",
      clerkUserId: user?.clerkUserId || ""
    });
    await writeAdminAudit(req, "admin_member_hard_deleted", {
      profileId: toObjectIdString(profile._id),
      userId,
      summary
    });
    clearAdminReadCaches(req.tenant._id);

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
      await deleteMemberActivityItems(req.tenant._id, userIds);
    }
    await writeAdminAudit(req, "admin_members_bulk_action", {
      action,
      affected: profiles.length
    });
    clearAdminReadCaches(req.tenant._id);
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
    clearAdminReadCaches(req.tenant._id);
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
    clearAdminReadCaches(req.tenant._id);
    await notifyTenantAdmins({
      tenant: req.tenant,
      createdByUserId: req.user.id,
      kind: "member_flagged",
      title: "Members flagged",
      body: `${profiles.length} member${profiles.length === 1 ? "" : "s"} were flagged for director follow-up.`,
      deepLink: "/admin/members",
      data: {
        affected: profiles.length,
        reason
      }
    }).catch(() => {});
    return res.json({ ok: true, action, affected: profiles.length });
  }

  if (action === "export") {
    const records = profiles.map((profile) => ({
      firstName: profile.firstName || "",
      lastName: profile.lastName || "",
      email: profile.emails?.[0] || "",
      role: profile.roleAtCamp || "",
      yearsAtCamp: resolveMemberCampYears(profile).join("; "),
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

// A bulk decision has to stay inside one request, so the batch is capped and
// the client sends the next chunk. 250 keeps the slowest part — one decision
// email per person — comfortably under the request timeout.
const APPROVAL_BULK_MAX = 250;
const APPROVAL_SIDE_EFFECT_CONCURRENCY = 8;

/**
 * Runs queued jobs a few at a time. Approving 250 people means 250 emails; all
 * at once would hammer the mail provider, one at a time would time out.
 */
async function runWithConcurrency(jobs = [], limit = 8) {
  const queue = [...jobs];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length > 0) {
      const job = queue.shift();
      if (job) await job().catch(() => {});
    }
  });
  await Promise.all(workers);
}

/**
 * Turns one pending request into a member.
 *
 * Approving from the row and approving 400 at once must produce identical
 * records, so both paths run this. Pass a `collector` to have the email and
 * push deferred to the caller — a bulk run sends one push for everyone rather
 * than one per person.
 */
async function approveAccessRequest(req, request, { collector = null, audit = true } = {}) {
  const email = normalizeEmail(request.email || request.profilePayload?.emails?.[0] || "");
  if (!isEmail(email)) {
    return { ok: false, requestId: toObjectIdString(request._id), code: "INVALID_EMAIL" };
  }

  const firstName = String(request.firstName || request.profilePayload?.firstName || "").trim();
  const existingUser = await UserModel.findOne(req.tenant._id, { email });

  if (existingUser) {
    // Someone removed earlier still has their records, just switched off.
    // Approving them has to switch them back on, or the decision silently does
    // nothing and they stay locked out of the network they were let into.
    const wasInactive = String(existingUser.status || "") !== "active";
    let restoredProfile = null;
    if (wasInactive) {
      await UserModel.update(existingUser._id, { status: "active" });
      const previousProfile = await ProfileModel.findOne(req.tenant._id, { userId: existingUser._id });
      if (previousProfile) {
        restoredProfile = await ProfileModel.updateScoped(req.tenant._id, previousProfile._id, {
          status: "active"
        });
      }
    }

    await AccessRequestModel.update(request._id, {
      status: "approved",
      reviewedAt: new Date(),
      reviewedByUserId: req.user.id,
      approvedUserId: existingUser._id
    });
    if (audit) {
      await writeAdminAudit(req, "admin_access_request_approved", {
        requestId: toObjectIdString(request._id),
        approvedUserId: toObjectIdString(existingUser._id),
        existingUser: true,
        reactivated: wasInactive
      });
    }

    const userId = toObjectIdString(existingUser._id);
    // Coming back counts as joining, same as arriving for the first time.
    if (wasInactive) {
      const profileForFeed = restoredProfile || null;
      const returningName =
        [profileForFeed?.firstName, profileForFeed?.lastName].filter(Boolean).join(" ").trim() ||
        [request.firstName, request.lastName].filter(Boolean).join(" ").trim() ||
        "Someone";
      await ActivityItemModel.create({
        tenantId: req.tenant._id,
        actorUserId: existingUser._id,
        actor: { id: userId, name: returningName },
        type: "user.join",
        target: profileForFeed
          ? { href: `/profile/${toObjectIdString(profileForFeed._id)}`, label: "profile" }
          : {},
        ts: new Date()
      }).catch(() => {});
      await logTenantEvent({
        tenantId: req.tenant._id,
        userId: existingUser._id,
        eventType: "signup_created",
        metadata: { method: "director_approval", reactivated: true }
      }).catch(() => {});
    }

    if (collector) {
      collector.approvedUserIds.push(userId);
      collector.requestIds.push(toObjectIdString(request._id));
      if (wasInactive) {
        const email = normalizeEmail(request.email || existingUser.email || "");
        const firstName = String(request.firstName || request.profilePayload?.firstName || "").trim();
        if (isEmail(email)) {
          collector.emails.push(() =>
            sendAccessDecisionEmail({ tenant: req.tenant, email, firstName, approved: true })
          );
        }
      }
    } else {
      await notifyAccessApproved(req, [userId], toObjectIdString(request._id));
      // A returning member is told the same way a new one is. Someone who was
      // already active never asked, so they get nothing.
      if (wasInactive) {
        const email = normalizeEmail(request.email || existingUser.email || "");
        const firstName = String(request.firstName || request.profilePayload?.firstName || "").trim();
        if (isEmail(email)) {
          await sendAccessDecisionEmail({
            tenant: req.tenant,
            email,
            firstName,
            approved: true
          }).catch((error) => {
            console.warn("[email] approval notification failed", {
              tenantId: String(req.tenant._id || ""),
              email,
              message: String(error?.message || "")
            });
          });
        }
      }
    }

    return {
      ok: true,
      requestId: toObjectIdString(request._id),
      existingUser: true,
      reactivated: wasInactive,
      userId
    };
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
    // Carries the terms the person accepted at signup, so approval never
    // produces a member who agreed to nothing.
    socials: profileSeed.socials || {},
    avatarUrl: String(profileSeed.avatarUrl || "").trim(),
    bio: String(profileSeed.bio || "").trim(),
    status: "active"
  });

  await UserModel.update(user._id, { profileId: profile._id });

  // Approving someone is how they join, so it has to leave the same trail an
  // ordinary signup does. Without these the new member is real but invisible:
  // absent from the home feed and from every count built on signup events.
  const actorName =
    [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim() || "Someone";
  await ActivityItemModel.create({
    tenantId: req.tenant._id,
    actorUserId: user._id,
    actor: { id: toObjectIdString(user._id), name: actorName },
    type: "user.join",
    target: {
      href: `/profile/${toObjectIdString(profile._id)}`,
      label: "profile"
    },
    ts: new Date()
  }).catch(() => {});
  await logTenantEvent({
    tenantId: req.tenant._id,
    userId: user._id,
    eventType: "signup_created",
    metadata: { method: "director_approval" }
  }).catch(() => {});

  await AccessRequestModel.update(request._id, {
    status: "approved",
    reviewedAt: new Date(),
    reviewedByUserId: req.user.id,
    approvedUserId: user._id
  });
  if (audit) {
    await writeAdminAudit(req, "admin_access_request_approved", {
      requestId: toObjectIdString(request._id),
      approvedUserId: toObjectIdString(user._id),
      existingUser: false
    });
  }

  const userId = toObjectIdString(user._id);
  const requestId = toObjectIdString(request._id);
  if (collector) {
    collector.approvedUserIds.push(userId);
    collector.requestIds.push(requestId);
    collector.emails.push(() =>
      sendAccessDecisionEmail({ tenant: req.tenant, email, firstName, approved: true })
    );
  } else {
    await notifyAccessApproved(req, [userId], requestId);
    await sendAccessDecisionEmail({
      tenant: req.tenant,
      email,
      firstName,
      approved: true
    }).catch((error) => {
      console.warn("[email] approval notification failed", {
        tenantId: String(req.tenant._id || ""),
        email,
        message: String(error?.message || "")
      });
    });
  }

  return {
    ok: true,
    requestId,
    existingUser: false,
    userId,
    member: mapMemberRow(profile, user)
  };
}

async function notifyAccessApproved(req, userIds = [], requestId = "") {
  if (!userIds.length) return;
  await sendMobileNotificationBatch({
    tenant: req.tenant,
    userIds,
    createdByUserId: req.user.id,
    kind: "access_request_approved",
    category: "account",
    title: "Access approved",
    body: `Your access to ${req.tenant.name || "your camp network"} was approved.`,
    deepLink: "/home",
    data: requestId ? { requestId } : {}
  }).catch(() => {});
}

/**
 * Marks one pending request denied. Shared by the row action and the bulk run
 * for the same reason approval is.
 */
async function denyAccessRequest(req, pending, reason = "", { collector = null, audit = true } = {}) {
  const request = await AccessRequestModel.update(pending._id, {
    status: "denied",
    reviewedAt: new Date(),
    reviewedByUserId: req.user.id,
    denialReason: reason
  });
  const requestId = toObjectIdString(request._id);
  if (audit) {
    await writeAdminAudit(req, "admin_access_request_denied", {
      requestId,
      reasonLength: reason.length
    });
  }

  if (isEmail(request.email)) {
    const firstName = String(request.firstName || request.profilePayload?.firstName || "").trim();
    const send = () =>
      sendAccessDecisionEmail({
        tenant: req.tenant,
        email: request.email,
        firstName,
        approved: false,
        reason
      });
    if (collector) {
      collector.emails.push(send);
    } else {
      await send().catch((error) => {
        console.warn("[email] denial notification failed", {
          tenantId: String(req.tenant._id || ""),
          email: request.email,
          message: String(error?.message || "")
        });
      });
    }
  }

  return { ok: true, requestId };
}

/**
 * Works out which pending requests a bulk decision applies to.
 *
 * A director looking at 400 requests should not have to tick 400 boxes, so the
 * scope can be "everyone waiting" or "everyone waiting who was on the invite
 * list" — resolved here from the same signals the queue shows.
 */
async function resolvePendingRequestTargets(req, { ids = [], scope = "selected", match = "any" } = {}) {
  const tenantId = req.tenant._id;
  const pending = await AccessRequestModel.find(tenantId, { status: "pending" }, {
    sort: { requestedAt: -1 },
    limit: 5000
  });

  const wanted = new Set(ids.map((id) => String(id || "").trim()).filter(Boolean));
  let targets = scope === "all" ? pending : pending.filter((row) => wanted.has(toObjectIdString(row._id)));

  if (match !== "any") {
    const [invites, contactResult] = await Promise.all([
      InviteModel.find(tenantId, { roleToAssign: "user" }, { sort: { createdAt: -1 }, limit: 5000 }),
      loadAlumniContactsForGrowth(tenantId).catch(() => ({ contacts: [] }))
    ]);
    const invitedEmails = new Set(
      invites.map((invite) => normalizeEmail(invite?.email)).filter(Boolean)
    );
    const knownEmails = new Set(
      (contactResult.contacts || []).map((contact) => normalizeEmail(contact?.email)).filter(Boolean)
    );
    // Same precedence the queue badge uses, so "approve the 388 invited" acts on
    // exactly the 388 rows the director was shown.
    targets = targets.filter((row) => {
      const email = normalizeEmail(row.email || row.profilePayload?.emails?.[0] || "");
      const recognition = invitedEmails.has(email)
        ? "invited"
        : knownEmails.has(email)
          ? "known"
          : "unrecognized";
      return recognition === match;
    });
  }

  return targets;
}

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

  const result = await approveAccessRequest(req, request);
  if (!result.ok) {
    return res.status(400).json({
      error: {
        code: result.code || "ACCESS_REQUEST_NOT_APPROVED",
        message: "Access request is missing a valid email."
      }
    });
  }
  clearAdminReadCaches(req.tenant._id);

  return res.json({
    ok: true,
    requestId: result.requestId,
    ...(result.existingUser ? { existingUser: true } : { member: result.member })
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

  const result = await denyAccessRequest(req, pending, reason);
  clearAdminReadCaches(req.tenant._id);
  return res.json({ ok: true, requestId: result.requestId });
});

/**
 * One decision applied to many people. A network that invited thousands can
 * produce hundreds of requests in a weekend; deciding them one HTTP call at a
 * time is not a workflow anyone completes.
 */
router.post("/members/approvals/bulk", async (req, res) => {
  const action = String(req.body?.action || "").trim().toLowerCase();
  if (!["approve", "deny"].includes(action)) {
    return res.status(400).json({
      error: { code: "INVALID_ACTION", message: "Action must be approve or deny." }
    });
  }

  const scope = String(req.body?.scope || "selected").trim().toLowerCase() === "all" ? "all" : "selected";
  const match = ["invited", "known", "unrecognized"].includes(
    String(req.body?.match || "").trim().toLowerCase()
  )
    ? String(req.body.match).trim().toLowerCase()
    : "any";
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const reason = sanitizeText(String(req.body?.reason || "").trim());

  if (scope === "selected" && ids.length === 0) {
    return res.status(400).json({
      error: { code: "NO_REQUESTS_SELECTED", message: "Select at least one request." }
    });
  }

  const matched = await resolvePendingRequestTargets(req, { ids, scope, match });
  const targets = matched.slice(0, APPROVAL_BULK_MAX);
  const remaining = Math.max(0, matched.length - targets.length);

  const collector = { approvedUserIds: [], requestIds: [], emails: [] };
  const failed = [];
  let succeeded = 0;

  for (const request of targets) {
    // Sequential so a mid-batch failure leaves every earlier person correctly
    // decided rather than half-written.
    try {
      const result =
        action === "approve"
          ? await approveAccessRequest(req, request, { collector, audit: false })
          : await denyAccessRequest(req, request, reason, { collector, audit: false });
      if (result.ok) succeeded += 1;
      else failed.push({ requestId: result.requestId, code: result.code || "FAILED" });
    } catch (error) {
      failed.push({
        requestId: toObjectIdString(request._id),
        code: String(error?.code || "FAILED")
      });
    }
  }

  await notifyAccessApproved(req, collector.approvedUserIds);
  await runWithConcurrency(collector.emails, APPROVAL_SIDE_EFFECT_CONCURRENCY);

  await writeAdminAudit(req, `admin_access_requests_bulk_${action}`, {
    scope,
    match,
    requestedCount: scope === "all" ? matched.length : ids.length,
    decidedCount: succeeded,
    failedCount: failed.length,
    remaining
  });
  clearAdminReadCaches(req.tenant._id);

  return res.json({
    ok: true,
    action,
    decided: succeeded,
    failed,
    // Anything past the per-request cap is still waiting; the client sends the
    // next chunk rather than silently dropping people.
    remaining
  });
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
  const preheader = sanitizeText(String(req.body?.preheader || "").trim()).slice(0, 160);
  const body = sanitizeHtmlContent(String(req.body?.body || "").trim());
  const targeting = normalizeTargeting(req.body?.targeting || {});

  const draft = await EmailBroadcastModel.create({
    tenantId: req.tenant._id,
    subject,
    preheader,
    body,
    campaignType: "marketing",
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
  if (req.body?.preheader !== undefined) updates.preheader = sanitizeText(String(req.body.preheader || "").trim()).slice(0, 160);
  if (req.body?.body !== undefined) updates.body = sanitizeHtmlContent(String(req.body.body || "").trim());
  if (req.body?.targeting !== undefined) updates.targeting = normalizeTargeting(req.body.targeting);

  await EmailBroadcastModel.updateScoped(req.tenant._id, item._id, updates);
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
  const currentStats = item?.stats && typeof item.stats === "object" ? item.stats : {};
  const providerSchedule = currentStats?.providerSchedule && typeof currentStats.providerSchedule === "object"
    ? currentStats.providerSchedule
    : {};
  const messageIds = Array.isArray(providerSchedule.messageIds)
    ? [...new Set(providerSchedule.messageIds.map((id) => String(id || "").trim()).filter(Boolean))]
    : [];

  // Broadcasts created before provider-backed scheduling never left PondBridge,
  // so they can be canceled locally without a provider call.
  if (messageIds.length === 0 && !providerSchedule.provider) {
    await EmailBroadcastModel.updateScoped(req.tenant._id, item._id, {
      status: "canceled",
      updatedAt: new Date(),
      stats: {
        ...currentStats,
        cancellation: {
          canceledAt: new Date().toISOString(),
          legacyLocalOnly: true
        }
      }
    });
    await writeAdminAudit(req, "admin_email_schedule_canceled", {
      broadcastId,
      legacyLocalOnly: true
    });
    return res.json({ ok: true });
  }

  if (messageIds.length === 0) {
    return res.status(409).json({
      error: {
        code: "EMAIL_SCHEDULE_PROVIDER_IDS_MISSING",
        message: "This scheduled email is missing its provider references. Contact PondBridge support before changing it."
      }
    });
  }

  const results = await Promise.allSettled(
    messageIds.map((messageId) => cancelScheduledTransactionalEmail(messageId))
  );
  const failedMessageIds = results
    .map((result, index) => (result.status === "rejected" ? messageIds[index] : ""))
    .filter(Boolean);
  const cancellation = {
    attemptedAt: new Date().toISOString(),
    attemptedCount: messageIds.length,
    canceledCount: messageIds.length - failedMessageIds.length,
    failedCount: failedMessageIds.length,
    failedMessageIds
  };

  if (failedMessageIds.length > 0) {
    await EmailBroadcastModel.updateScoped(req.tenant._id, item._id, {
      updatedAt: new Date(),
      stats: { ...currentStats, cancellation }
    });
    return res.status(502).json({
      error: {
        code: "EMAIL_SCHEDULE_CANCEL_INCOMPLETE",
        message: "The email provider did not confirm every cancellation. The broadcast is still marked scheduled; retry or contact PondBridge support."
      }
    });
  }

  await EmailBroadcastModel.updateScoped(req.tenant._id, item._id, {
    status: "canceled",
    updatedAt: new Date(),
    stats: {
      ...currentStats,
      cancellation: {
        ...cancellation,
        canceledAt: new Date().toISOString()
      }
    }
  });
  await writeAdminAudit(req, "admin_email_schedule_canceled", {
    broadcastId,
    provider: providerSchedule.provider || "resend",
    canceledCount: messageIds.length
  });
  return res.json({ ok: true });
});

router.patch("/email/scheduled/:broadcastId", async (req, res) => {
  const broadcastId = String(req.params.broadcastId || "").trim();
  const item = await EmailBroadcastModel.findOne(req.tenant._id, { _id: broadcastId, status: "scheduled" });
  if (!item) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Scheduled email not found." } });
  }

  return res.status(409).json({
    error: {
      code: "EMAIL_SCHEDULE_RECREATE_REQUIRED",
      message: "To change a scheduled email, cancel it first and create a replacement. This prevents the provider copy from diverging from PondBridge."
    }
  });
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
  await EmailSuppressionModel.updateScoped(req.tenant._id, item._id, { status: "lifted", updatedAt: new Date() });
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

// Writes a partial patch onto both live content and the onboarding draft so a
// tenant still in setup keeps the same values once it goes live.
async function saveTenantContentFields(req, fields = {}) {
  const draft = resolveDraft(req.tenant);
  const content = draft.content || resolveContent(req.tenant);
  return TenantModel.update(req.tenant._id, {
    content: { ...content, ...fields },
    onboardingDraft: {
      ...draft,
      content: { ...draft.content, ...fields },
      updatedAt: new Date(),
      updatedByUserId: req.user.id
    }
  });
}

// Saved groups only ever carry leaf rules; the composer unions them at send time.
function toAudienceRule(value = {}) {
  const { mode, roles, years, profileIds, segment } = normalizeTargeting(value, { allowComposite: false });
  return { mode, roles, years, profileIds, segment };
}

function serializeRecipientGroup(group = {}) {
  return {
    id: String(group.id || ""),
    name: String(group.name || ""),
    description: String(group.description || ""),
    rules: (Array.isArray(group.rules) ? group.rules : [])
      .map(toAudienceRule)
      .filter((rule) => hasRequiredEmailTargetingSelection(rule)),
    updatedAt: String(group.updatedAt || "")
  };
}

router.get("/email/groups", async (req, res) => {
  const content = resolveContent(req.tenant);
  return res.json({
    groups: normalizeEmailRecipientGroups(content.emailRecipientGroups || []).map(serializeRecipientGroup)
  });
});

router.put("/email/groups", async (req, res) => {
  const incoming = Array.isArray(req.body?.groups) ? req.body.groups : [];
  if (incoming.length > MAX_EMAIL_RECIPIENT_GROUPS) {
    return res.status(400).json({
      error: {
        code: "TOO_MANY_RECIPIENT_GROUPS",
        message: `You can save up to ${MAX_EMAIL_RECIPIENT_GROUPS} recipient groups.`
      }
    });
  }

  const groups = normalizeEmailRecipientGroups(
    incoming.map((group) => ({
      ...group,
      name: sanitizeText(String(group?.name || "")),
      description: sanitizeText(String(group?.description || "")),
      // Reuse the send-path normalizer so a saved group can never describe an
      // audience the composer is not allowed to target.
      rules: (Array.isArray(group?.rules) ? group.rules : [])
        .map(toAudienceRule)
        .filter((rule) => hasRequiredEmailTargetingSelection(rule))
    }))
  );

  const tenant = await saveTenantContentFields(req, { emailRecipientGroups: groups });
  await writeAdminAudit(req, "admin_email_groups_updated", { groupCount: groups.length });
  return res.json({
    ok: true,
    groups: normalizeEmailRecipientGroups(resolveContent(tenant).emailRecipientGroups || [])
      .map(serializeRecipientGroup)
  });
});

router.get("/export/presets", async (req, res) => {
  const content = resolveContent(req.tenant);
  return res.json({ presets: normalizeMemberExportPresets(content.memberExportPresets || []) });
});

router.put("/export/presets", async (req, res) => {
  const incoming = Array.isArray(req.body?.presets) ? req.body.presets : [];
  if (incoming.length > MAX_MEMBER_EXPORT_PRESETS) {
    return res.status(400).json({
      error: {
        code: "TOO_MANY_EXPORT_PRESETS",
        message: `You can save up to ${MAX_MEMBER_EXPORT_PRESETS} export presets.`
      }
    });
  }

  const presets = normalizeMemberExportPresets(
    incoming.map((preset) => ({ ...preset, name: sanitizeText(String(preset?.name || "")) }))
  );
  const tenant = await saveTenantContentFields(req, { memberExportPresets: presets });
  return res.json({
    ok: true,
    presets: normalizeMemberExportPresets(resolveContent(tenant).memberExportPresets || [])
  });
});

router.get("/email/templates", async (req, res) => {
  const content = resolveContent(req.tenant);
  return res.json({ templates: normalizeEmailTemplates(content.emailTemplates || []) });
});

router.put("/email/templates", async (req, res) => {
  const incoming = Array.isArray(req.body?.templates) ? req.body.templates : [];
  if (incoming.length > MAX_EMAIL_TEMPLATES) {
    return res.status(400).json({
      error: {
        code: "TOO_MANY_EMAIL_TEMPLATES",
        message: `You can save up to ${MAX_EMAIL_TEMPLATES} templates.`
      }
    });
  }

  const templates = normalizeEmailTemplates(
    incoming.map((template) => ({
      ...template,
      name: sanitizeText(String(template?.name || "")),
      subject: sanitizeText(String(template?.subject || "")),
      preheader: sanitizeText(String(template?.preheader || "")),
      body: sanitizeHtmlContent(String(template?.body || ""))
    }))
  );

  const tenant = await saveTenantContentFields(req, { emailTemplates: templates });
  await writeAdminAudit(req, "admin_email_templates_updated", { templateCount: templates.length });
  return res.json({
    ok: true,
    templates: normalizeEmailTemplates(resolveContent(tenant).emailTemplates || [])
  });
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

  const tenant = await saveTenantContentFields(req, {
    emailFooterPresets: presets,
    defaultEmailFooterPresetId: defaultPresetId
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
  const { profiles, recipients, heldRecipients } = await resolveRecipientsForTargeting(
    req.tenant._id,
    targeting
  );
  const eligibility = await resolveEmailRecipientEligibility({
    tenantId: req.tenant._id,
    recipients,
    topicKey: COMMUNITY_UPDATES_TOPIC
  });
  const deliverableSet = new Set(eligibility.deliverableRecipients);
  const previewProfiles = profiles.filter((profile) =>
    deliverableSet.has(String(profile?.emails?.[0] || "").trim().toLowerCase())
  );

  return res.json({
    count: eligibility.deliverableRecipients.length,
    excludedCount: eligibility.excludedRecipients.length + heldRecipients.length,
    exclusionBreakdown: {
      suppressed: eligibility.suppressedRecipients.length,
      unsubscribed: eligibility.unsubscribedRecipients.length,
      onHold: heldRecipients.length
    },
    preview: previewProfiles.slice(0, 5).map((profile) => ({
      id: toObjectIdString(profile._id),
      name: `${profile.firstName || ""} ${profile.lastName || ""}`.trim() || "Member",
      email: String(profile?.emails?.[0] || "").trim().toLowerCase()
    }))
  });
});

router.post("/email/test", async (req, res) => {
  const subject = sanitizeText(String(req.body?.subject || "").trim());
  const preheader = sanitizeText(String(req.body?.preheader || "").trim()).slice(0, 160);
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
  const readiness = assertEmailDraftReady({
    tenant: req.tenant,
    subject,
    preheader,
    body,
    campaignType: "marketing",
    recipientCount: 1
  });
  const preferenceUrls = buildEmailPreferenceUrls({
    tenantId: req.tenant._id,
    email: to,
    topicKey: COMMUNITY_UPDATES_TOPIC
  });
  const composed = buildDirectorBroadcastEmailContent({
    tenant: req.tenant,
    subject,
    preheader,
    bodyHtml: body,
    footer: normalizeEmailFooterData(req.body?.footer || {}, footerSettings.activeFooter),
    campaignType: "marketing",
    postalAddress: readiness.compliance.postalAddress,
    unsubscribeUrl: preferenceUrls.manageUrl
  });

  await sendTransactionalEmail({
    from: emailBranding.from,
    to,
    subject: `[Test] ${subject}`,
    text: composed.text,
    html: composed.html,
    headers: {
      "List-Unsubscribe": `<${preferenceUrls.oneClickUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"
    },
    ...(resolvedReplyTo ? { replyTo: resolvedReplyTo } : {})
  });

  return res.json({ ok: true, sentTo: to });
});

router.post("/email/send", emailSendLimiter, async (req, res) => {
  const subject = sanitizeText(String(req.body?.subject || "").trim());
  const preheader = sanitizeText(String(req.body?.preheader || "").trim()).slice(0, 160);
  const body = sanitizeHtmlContent(String(req.body?.body || "").trim());
  const targeting = normalizeTargeting(req.body?.targeting || {});
  const scheduledForRaw = String(req.body?.scheduledFor || "").trim();
  const scheduledFor = scheduledForRaw ? new Date(scheduledForRaw) : null;
  const actorReplyTo = normalizeEmail(req.user.email || "");
  const requestedAiGenerationId = String(req.body?.aiGenerationId || "").trim();

  if (scheduledForRaw && (!scheduledFor || Number.isNaN(scheduledFor.getTime()))) {
    return res.status(400).json({
      error: {
        code: "EMAIL_SCHEDULE_INVALID",
        message: "Choose a valid date and time for the scheduled email."
      }
    });
  }

  const now = new Date();
  const isScheduled = Boolean(scheduledForRaw);
  if (isScheduled && scheduledFor <= now) {
    return res.status(400).json({
      error: {
        code: "EMAIL_SCHEDULE_IN_PAST",
        message: "Scheduled email time must be in the future."
      }
    });
  }

  const maxScheduledAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  if (isScheduled && scheduledFor > maxScheduledAt) {
    return res.status(400).json({
      error: {
        code: "EMAIL_SCHEDULE_TOO_FAR",
        message: "Scheduled emails can be created up to 30 days in advance."
      }
    });
  }

  if (isScheduled) {
    const scheduling = getEmailSchedulingStatus();
    if (!scheduling.available) {
      return res.status(503).json({
        error: {
          code: "EMAIL_SCHEDULING_UNAVAILABLE",
          message: "Scheduled email requires the configured Resend delivery service. Send now or contact PondBridge support."
        }
      });
    }
  }

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

  const {
    profiles,
    recipients,
    heldRecipients,
    matchedRecipientCount
  } = await resolveRecipientsForTargeting(req.tenant._id, targeting);
  if (recipients.length === 0) {
    return res.status(400).json({
      error: {
        code: matchedRecipientCount > 0 ? "NO_ELIGIBLE_RECIPIENTS" : "NO_RECIPIENTS",
        message: matchedRecipientCount > 0
          ? "Every matching recipient is on hold."
          : "No recipients match the selected targeting."
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

  const eligibility = await resolveEmailRecipientEligibility({
    tenantId: req.tenant._id,
    recipients,
    topicKey: COMMUNITY_UPDATES_TOPIC
  });
  const eligibleRecipients = eligibility.deliverableRecipients;
  const initiallyExcludedCount = eligibility.excludedRecipients.length + heldRecipients.length;
  if (eligibleRecipients.length === 0) {
    return res.status(400).json({
      error: {
        code: "NO_ELIGIBLE_RECIPIENTS",
        message: "Every matching recipient is suppressed, unsubscribed, or on hold."
      }
    });
  }

  const readiness = assertEmailDraftReady({
    tenant: req.tenant,
    subject,
    preheader,
    body,
    campaignType: "marketing",
    recipientCount: eligibleRecipients.length
  });
  const composed = buildDirectorBroadcastEmailContent({
    tenant: req.tenant,
    subject,
    preheader,
    bodyHtml: body,
    footer: normalizeEmailFooterData(req.body?.footer || {}, footerSettings.activeFooter),
    campaignType: "marketing",
    postalAddress: readiness.compliance.postalAddress,
    unsubscribeUrl: "{{unsubscribeUrl}}"
  });

  let linkedAiGenerationId = null;
  if (requestedAiGenerationId) {
    const linkedGeneration = await AiGenerationModel.findOne(req.tenant._id, {
      _id: requestedAiGenerationId,
      status: "succeeded",
      resourceType: "email_draft"
    });
    if (!linkedGeneration) {
      return res.status(400).json({
        error: {
          code: "EMAIL_AI_GENERATION_INVALID",
          message: "The linked AI draft could not be verified for this camp. Generate a new draft or remove the link."
        }
      });
    }
    linkedAiGenerationId = linkedGeneration._id;
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

  // Every marketing recipient gets a unique preference URL and one-click
  // unsubscribe header. Merge tags are resolved in the same per-recipient pass.
  const emailToProfile = new Map();
  for (const profile of profiles) {
    const profileEmail = String(profile?.emails?.[0] || "").trim().toLowerCase();
    if (profileEmail) emailToProfile.set(profileEmail, profile);
  }
  const personalizer = (recipientEmail) => {
    const profile = emailToProfile.get(recipientEmail) || {};
    const firstName = String(profile?.firstName || "").trim() || "there";
    const lastName = String(profile?.lastName || "").trim();
    const preferenceUrls = buildEmailPreferenceUrls({
      tenantId: req.tenant._id,
      email: recipientEmail,
      topicKey: COMMUNITY_UPDATES_TOPIC
    });
    const personalizedHtml = composed.html
      .replace(/\{\{firstName\}\}/g, escapeEmailHtml(firstName))
      .replace(/\{\{lastName\}\}/g, escapeEmailHtml(lastName))
      .replace(/\{\{unsubscribeUrl\}\}/g, escapeEmailHtml(preferenceUrls.manageUrl));
    const personalizedText = composed.text
      .replace(/\{\{firstName\}\}/g, firstName)
      .replace(/\{\{lastName\}\}/g, lastName)
      .replace(/\{\{unsubscribeUrl\}\}/g, preferenceUrls.manageUrl);
    return {
      html: personalizedHtml,
      text: personalizedText,
      headers: {
        "List-Unsubscribe": `<${preferenceUrls.oneClickUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        // Identifies the camp's community list. Receivers use it to group a
        // sender's bulk mail and score it as list traffic rather than as an
        // unrecognised one-off.
        "List-ID": `${req.tenant.slug}.community <community.${req.tenant.slug}.pondbridgealumni.com>`
      }
    };
  };

  const basePayload = {
    subject,
    preheader,
    body,
    campaignType: "marketing",
    aiGenerationId: linkedAiGenerationId,
    complianceSnapshot: readiness.compliance,
    targeting,
    recipientCount: eligibleRecipients.length,
    excludedCount: initiallyExcludedCount,
    recipientsPreview: eligibleRecipients.slice(0, 8),
    createdByUserId: req.user.id,
    // Keep this truthful until the provider accepts the delivery request.
    status: "draft",
    scheduledFor: isScheduled ? scheduledFor : null,
    sentAt: null
  };

  const broadcast = await EmailBroadcastModel.create({ ...basePayload, tenantId: req.tenant._id });

  let delivery;
  try {
    delivery = await sendBulkTransactionalEmail({
      from: emailBranding.from,
      recipients: eligibleRecipients,
      subject,
      text: composed.text,
      html: composed.html,
      ...(resolvedReplyTo ? { replyTo: resolvedReplyTo } : {}),
      tags: [
        { name: "category", value: "director_broadcast" },
        { name: "tenant", value: req.tenant.slug || "tenant" },
        { name: "pondbridge_broadcast", value: String(broadcast._id) }
      ],
      idempotencyKey: `director-broadcast/${req.tenant.slug || "tenant"}/${broadcast._id}`,
      batchSize: env.EMAIL_BROADCAST_BATCH_SIZE,
      maxRecipients: env.EMAIL_BROADCAST_MAX_RECIPIENTS,
      ...(isScheduled ? { scheduledAt: scheduledFor.toISOString() } : {}),
      personalizer
    });
  } catch (error) {
    await EmailBroadcastModel.updateScoped(req.tenant._id, broadcast._id, {
      status: "failed",
      sentAt: null,
      stats: {
        ...(broadcast.stats || {}),
        delivery: {
          attemptedCount: eligibleRecipients.length,
          sentCount: 0,
          failedCount: eligibleRecipients.length,
          failures: [{
            code: String(error?.code || "EMAIL_SEND_FAILED"),
            message: String(error?.message || "Email provider request failed.")
          }]
        }
      }
    });
    return res.status(Math.min(599, Math.max(400, Number(error?.statusCode || 502)))).json({
      error: {
        code: String(error?.code || "EMAIL_SEND_FAILED"),
        message: "The email provider did not accept this broadcast. No successful send was recorded."
      }
    });
  }

  const commonDeliveryStats = {
      attemptedCount: delivery.attemptedCount,
      failedCount: delivery.failedCount,
      suppressedCount: delivery.suppressedCount,
      preflightExcludedCount: initiallyExcludedCount,
      preferenceExcludedCount: eligibility.unsubscribedRecipients.length,
      preflightSuppressedCount: eligibility.suppressedRecipients.length,
      contactOnHoldCount: heldRecipients.length,
      batchesAttempted: delivery.batchesAttempted,
      batchesSucceeded: delivery.batchesSucceeded,
      batchesFailed: delivery.batchesFailed,
      failures: delivery.failures.slice(0, 10)
  };

  if (isScheduled) {
    const deliverableCount = Math.max(0, eligibleRecipients.length - Number(delivery.suppressedCount || 0));
    const acceptedMessageIds = [...new Set(
      (delivery.messageIds || []).map((id) => String(id || "").trim()).filter(Boolean)
    )];
    const scheduleComplete =
      deliverableCount > 0 &&
      delivery.sentCount === deliverableCount &&
      acceptedMessageIds.length === deliverableCount &&
      delivery.failures.length === 0;

    if (!scheduleComplete) {
      const compensation = await Promise.allSettled(
        acceptedMessageIds.map((messageId) => cancelScheduledTransactionalEmail(messageId))
      );
      const uncanceledMessageIds = compensation
        .map((result, index) => (result.status === "rejected" ? acceptedMessageIds[index] : ""))
        .filter(Boolean);
      await EmailBroadcastModel.updateScoped(req.tenant._id, broadcast._id, {
        status: "failed",
        sentAt: null,
        excludedCount: initiallyExcludedCount + Number(delivery.suppressedCount || 0),
        stats: {
          ...(broadcast.stats || {}),
          delivery: {
            ...commonDeliveryStats,
            acceptedCount: delivery.sentCount,
            sentCount: 0
          },
          providerSchedule: {
            provider: "resend",
            scheduledAt: scheduledFor.toISOString(),
            messageIds: uncanceledMessageIds,
            compensatedCount: acceptedMessageIds.length - uncanceledMessageIds.length,
            compensationFailedCount: uncanceledMessageIds.length
          }
        }
      });
      return res.status(502).json({
        error: {
          code: uncanceledMessageIds.length > 0
            ? "EMAIL_SCHEDULE_COMPENSATION_INCOMPLETE"
            : "EMAIL_SCHEDULE_REJECTED",
          message: uncanceledMessageIds.length > 0
            ? "The provider accepted only part of the schedule and could not cancel every accepted email. Contact PondBridge support immediately."
            : "The provider did not accept the complete schedule. Any accepted emails were canceled; review recipients and try again."
        }
      });
    }

    await EmailBroadcastModel.update(broadcast._id, {
      status: "scheduled",
      scheduledFor,
      sentAt: null,
      excludedCount: initiallyExcludedCount + Number(delivery.suppressedCount || 0),
      stats: {
        ...(broadcast.stats || {}),
        delivery: {
          ...commonDeliveryStats,
          acceptedCount: delivery.sentCount,
          sentCount: 0
        },
        providerSchedule: {
          provider: "resend",
          scheduledAt: scheduledFor.toISOString(),
          messageIds: acceptedMessageIds,
          acceptedCount: delivery.sentCount
        }
      }
    });
  } else {
    await EmailBroadcastModel.update(broadcast._id, {
      status: delivery.sentCount > 0 ? "sent" : "failed",
      sentAt: delivery.sentCount > 0 ? new Date() : null,
      excludedCount: initiallyExcludedCount + Number(delivery.suppressedCount || 0),
      stats: {
        ...(broadcast.stats || {}),
        delivery: {
          ...commonDeliveryStats,
          sentCount: delivery.sentCount,
          messageIds: delivery.messageIds.slice(0, 20)
        }
      }
    });
  }

  await writeAdminAudit(req, isScheduled ? "admin_email_scheduled" : "admin_email_sent", {
    broadcastId: String(broadcast._id),
    recipientCount: eligibleRecipients.length,
    targetedCount: matchedRecipientCount,
    excludedCount: initiallyExcludedCount + Number(delivery.suppressedCount || 0),
    unsubscribeExcludedCount: eligibility.unsubscribedRecipients.length,
    contactOnHoldCount: heldRecipients.length,
    scheduledFor: isScheduled ? scheduledFor.toISOString() : null,
    status: isScheduled ? "scheduled" : delivery.sentCount > 0 ? "sent" : "failed"
  });

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
  const features = listFeaturesForPlan(planTier, req.tenant.addOns || []);
  const inventory = await buildTenantFeatureInventory(req.tenant);

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
    modules: inventory.modules,
    capabilities: inventory.capabilities,
    summary: inventory.summary,
    moduleDisplayNames: {
      newsletter: content.newsletterName || "Newsletter"
    },
    moduleSettings: {
      merchShopUrl: content.merchShopUrl || ""
    },
    homeQuickActions: content.homeQuickActions
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
  const incomingSettings = req.body?.moduleSettings && typeof req.body.moduleSettings === "object"
    ? req.body.moduleSettings
    : {};
  const hasIncomingQuickActions = Array.isArray(req.body?.homeQuickActions);

  const current = resolveModules(req.tenant, { applyPlanGating: false });
  const nextModules = { ...current };

  for (const module of MODULE_CATALOG) {
    if (!Object.prototype.hasOwnProperty.call(incomingModules, module.key)) continue;
    const locked = module.requiredFeature
      ? !hasFeature(planTier, module.requiredFeature, req.tenant.addOns || [])
      : false;
    const platformDisabled = module.key === "events" && !MEMBER_EVENTS_PAGES_ENABLED;
    if (locked || platformDisabled) continue;
    nextModules[module.key] = Boolean(incomingModules[module.key]);
  }

  Object.assign(
    nextModules,
    resolveTenantModules(nextModules, { applyPlatformAvailability: false })
  );

  const draft = resolveDraft(req.tenant);
  const currentContent = resolveContent(req.tenant);
  const nextContent = { ...currentContent };
  let contentChanged = false;

  if (Object.prototype.hasOwnProperty.call(incomingNames, "newsletter")) {
    nextContent.newsletterName = sanitizeText(String(incomingNames.newsletter || "").trim()) || "Newsletter";
    contentChanged = true;
  }

  if (Object.prototype.hasOwnProperty.call(incomingSettings, "merchShopUrl")) {
    const rawMerchShopUrl = String(incomingSettings.merchShopUrl || "").trim();
    const merchShopUrl = normalizeHttpUrl(rawMerchShopUrl);
    if (rawMerchShopUrl && !merchShopUrl) {
      return res.status(400).json({
        error: {
          code: "INVALID_MERCH_SHOP_URL",
          message: "Provide a valid merch shop URL beginning with http:// or https://."
        }
      });
    }
    nextContent.merchShopUrl = merchShopUrl;
    contentChanged = true;
  }

  if (hasIncomingQuickActions) {
    nextContent.homeQuickActions = normalizeHomeQuickActions(req.body.homeQuickActions);
    contentChanged = true;
  }

  const update = {
    modules: nextModules,
    ...(contentChanged ? { content: nextContent } : {}),
    onboardingDraft: {
      ...draft,
      modules: nextModules,
      content: contentChanged ? { ...draft.content, ...nextContent } : draft.content,
      updatedAt: new Date(),
      updatedByUserId: req.user.id
    }
  };

  const tenant = await TenantModel.update(req.tenant._id, update);
  // Members read modules, labels and the home buttons off the public tenant
  // config, which would otherwise serve the pre-save answer for another minute.
  invalidatePublicTenantCache(tenant || req.tenant);
  const moduleChanges = MODULE_CATALOG
    .map((module) => ({
      key: module.key,
      before: Boolean(current[module.key]),
      after: Boolean(nextModules[module.key])
    }))
    .filter((change) => change.before !== change.after);
  const previousNewsletterName = currentContent.newsletterName || "Newsletter";
  const nextNewsletterName = resolveContent(tenant).newsletterName || "Newsletter";

  await writeAdminAudit(req, "admin_features_updated", {
    moduleChanges,
    moduleDisplayNameChanges:
      previousNewsletterName === nextNewsletterName
        ? []
        : [{ key: "newsletter", before: previousNewsletterName, after: nextNewsletterName }],
    moduleSettingChanges:
      String(currentContent.merchShopUrl || "") === String(resolveContent(tenant).merchShopUrl || "")
        ? []
        : [{ key: "merchShopUrl", configured: Boolean(resolveContent(tenant).merchShopUrl) }],
    homeQuickActionChange:
      (currentContent.homeQuickActions || []).join(",") ===
      (resolveContent(tenant).homeQuickActions || []).join(",")
        ? null
        : {
            before: currentContent.homeQuickActions || [],
            after: resolveContent(tenant).homeQuickActions || []
          }
  });

  const inventory = await buildTenantFeatureInventory(tenant);

  return res.json({
    ok: true,
    modules: inventory.modules,
    capabilities: inventory.capabilities,
    summary: inventory.summary,
    moduleDisplayNames: {
      newsletter: resolveContent(tenant).newsletterName
    },
    moduleSettings: {
      merchShopUrl: resolveContent(tenant).merchShopUrl || ""
    },
    homeQuickActions: resolveContent(tenant).homeQuickActions
  });
});

router.get("/billing", ensureBillingVisibleForTenant, async (req, res) => {
  const planTier = resolveTenantFeatureTier(req.tenant);
  const mode = getBillingMode();
  const [portal, billing, invoices, memberCount, subscriptionStatus] = await Promise.all([
    createBillingPortalUrl({
      tenant: req.tenant,
      returnPath: `/t/${req.tenant.slug}/admin/billing`
    }),
    Promise.resolve(buildBillingPublicSnapshot(req.tenant)),
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
      // The same resolver the send check uses, so the Billing page shows the
      // address that actually decides whether a broadcast is allowed.
      postalAddress: resolveCampPostalAddress(req.tenant),
      currentPeriodEnd: billing.currentPeriodEnd,
      initialCheckoutCompletedAt: billing.initialCheckoutCompletedAt,
      activatedAt: billing.activatedAt,
      canceledAt: billing.canceledAt,
      isComplimentary: Boolean(billing.isComplimentary)
    },
    billing,
    catalog: getBillingCatalog({ tenant: req.tenant }),
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
          message: "Billing plan must be flagship or test."
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
      catalog: getBillingCatalog({ tenant: updatedTenant })
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
  // Switching the review gate off leaves anyone already queued still waiting,
  // so the settings page has to be able to say so.
  const pendingApprovalCount = await AccessRequestModel.count(req.tenant._id, { status: "pending" }).catch(() => 0);
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
      heroImageUrlMember: theme.heroImageUrlMember,
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
      requireProfileCompletion: Boolean(settings.requireProfileCompletion),
      requireSignupApproval: Boolean(settings.requireSignupApproval),
      entryMode: settings.entryMode || settings.signupMode,
      pendingApprovalCount: Number(pendingApprovalCount || 0)
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
    notifications: normalizeTenantMobileNotificationPrefs(req.tenant.notificationPrefs || {}),
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

  const stripeContactSync = await syncStripeCustomerContact(tenant, req.user).catch(() => ({
    synced: false,
    customerId: String(tenant?.stripeCustomerId || "").trim()
  }));

  return res.json({ ok: true, identity: resolveContent(tenant), stripeContactSync });
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
      heroImageUrlMember: String(
        req.body?.heroImageUrlMember ?? (theme.heroImageUrlMember || "")
      ).trim(),
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
      iconUrls: next.iconUrls,
      heroImageUrl: next.heroImageUrl,
      heroImageUrlMember: next.heroImageUrlMember,
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
        iconUrls: next.iconUrls,
        heroImageUrl: next.heroImageUrl,
        heroImageUrlMember: next.heroImageUrlMember,
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
        allowedEmailDomains: parseList(req.body?.allowedEmailDomains || req.body?.allowedDomains || []),
        requireSignupApproval: Boolean(req.body?.requireSignupApproval)
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
    requireSignupApproval: Boolean(settings.requireSignupApproval),
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
  const updated = await UserModel.updateScoped(req.tenant._id, user._id, { roles: [...roleSet] });
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
    await UserModel.updateScoped(req.tenant._id, existing._id, { roles: [...roles] });
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
  await UserModel.updateScoped(req.tenant._id, user._id, { roles });
  await writeAdminAudit(req, "admin_role_revoked", {
    targetUserId: toObjectIdString(user._id),
    targetEmail: user.email,
    role: "tenant_admin"
  });

  return res.json({ ok: true });
});

router.patch("/settings/notifications", async (req, res) => {
  const current = normalizeTenantMobileNotificationPrefs(req.tenant.notificationPrefs || {});
  const next = normalizeTenantMobileNotificationPrefs({
    ...current,
    mobileEnabled: req.body?.mobileEnabled ?? current.mobileEnabled,
    pushEnabled: req.body?.pushEnabled ?? current.pushEnabled,
    inboxEnabled: req.body?.inboxEnabled ?? current.inboxEnabled,
    newMemberJoined: req.body?.newMemberJoined ?? current.newMemberJoined,
    approvalRequests: req.body?.approvalRequests ?? current.approvalRequests,
    memberFlagged: req.body?.memberFlagged ?? current.memberFlagged,
    weeklySummary: req.body?.weeklySummary ?? current.weeklySummary,
    eventPublished: req.body?.eventPublished ?? current.eventPublished,
    eventCanceled: req.body?.eventCanceled ?? current.eventCanceled,
    newsletterPublished: req.body?.newsletterPublished ?? current.newsletterPublished,
    customBroadcasts: req.body?.customBroadcasts ?? current.customBroadcasts,
    soundEnabled: req.body?.soundEnabled ?? current.soundEnabled
  });

  const tenant = await TenantModel.update(req.tenant._id, { notificationPrefs: next });
  await writeAdminAudit(req, "admin_mobile_notification_settings_updated", {
    changedKeys: Object.keys(next)
  });

  return res.json({ ok: true, notifications: normalizeTenantMobileNotificationPrefs(tenant.notificationPrefs || next) });
});

router.get("/notifications/history", async (req, res) => {
  const items = await listRecentMobileNotificationBatches(req.tenant._id, {
    limit: req.query.limit || 20
  });
  return res.json({ items });
});

router.post("/notifications/recipients-preview", async (req, res) => {
  const audience = normalizeMobileNotificationAudience(req.body?.audience);
  const userIds = normalizeMobileNotificationUserIds(req.body?.userIds);
  const resolvedUserIds = await resolveAudienceUserIds(req.tenant._id, audience, { userIds });

  return res.json({
    audience,
    totalRecipients: resolvedUserIds.length
  });
});

router.post("/notifications/send", async (req, res) => {
  const tenantPrefs = normalizeTenantMobileNotificationPrefs(req.tenant.notificationPrefs || {});
  if (!tenantPrefs.mobileEnabled || !tenantPrefs.customBroadcasts) {
    return res.status(400).json({
      error: {
        code: "MOBILE_NOTIFICATIONS_DISABLED",
        message: "Mobile notifications are disabled for this camp."
      }
    });
  }

  const title = sanitizeText(String(req.body?.title || "").trim()).slice(0, 120);
  const body = sanitizeText(String(req.body?.body || "").trim()).slice(0, 500);
  const category = normalizeMobileNotificationCategory(req.body?.category);
  const deepLink = String(req.body?.deepLink || "").trim();
  const audience = normalizeMobileNotificationAudience(req.body?.audience);
  const userIds = normalizeMobileNotificationUserIds(req.body?.userIds);
  const pushRequested = req.body?.pushRequested !== false;
  const scheduleAtProvided = Boolean(String(req.body?.scheduleAt || "").trim());
  const scheduleAt = scheduleAtProvided ? new Date(req.body.scheduleAt) : null;

  if (!title || !body) {
    return res.status(400).json({
      error: {
        code: "TITLE_BODY_REQUIRED",
        message: "Title and body are required."
      }
    });
  }

  if (audience === "specific_members" && !userIds.length) {
    return res.status(400).json({
      error: {
        code: "USER_IDS_REQUIRED",
        message: "Pick at least one member to send to."
      }
    });
  }

  if (scheduleAtProvided) {
    const scheduleTime = scheduleAt?.getTime?.() || 0;
    if (!scheduleTime || Number.isNaN(scheduleTime)) {
      return res.status(400).json({
        error: { code: "INVALID_SCHEDULE_TIME", message: "Choose a valid date and time." }
      });
    }
    if (scheduleTime < Date.now() + 60 * 1000) {
      return res.status(400).json({
        error: { code: "SCHEDULE_TIME_TOO_SOON", message: "Scheduled notifications must be at least one minute in the future." }
      });
    }
    if (scheduleTime > Date.now() + 30 * 24 * 60 * 60 * 1000) {
      return res.status(400).json({
        error: { code: "SCHEDULE_TIME_TOO_FAR", message: "Notifications can be scheduled up to 30 days ahead." }
      });
    }
  }

  if (scheduleAtProvided) {
    const created = await MobileNotificationScheduleModel.create({
      tenantId: req.tenant._id,
      runAt: scheduleAt,
      status: "pending",
      category,
      title,
      body,
      deepLink,
      audience,
      userIds,
      pushRequested,
      createdByUserId: req.user.id,
      batchId: "",
      error: ""
    });

    await writeAdminAudit(req, "admin_mobile_notification_scheduled", {
      scheduleId: created._id,
      runAt: created.runAt,
      audience,
      category
    });

    return res.status(201).json({
      ok: true,
      scheduled: true,
      schedule: created
    });
  }

  const resolvedUserIds = await resolveAudienceUserIds(req.tenant._id, audience, { userIds });
  const result = await sendMobileNotificationBatch({
    tenant: req.tenant,
    userIds: resolvedUserIds,
    createdByUserId: req.user.id,
    kind: "custom_admin",
    category,
    title,
    body,
    deepLink,
    data: {
      audience
    },
    pushRequested
  });

  await writeAdminAudit(req, "admin_mobile_notification_sent", {
    batchId: result.batchId,
    audience,
    category,
    recipients: result.totalRecipients
  });

  return res.status(201).json({
    ok: true,
    batchId: result.batchId,
    totalRecipients: result.totalRecipients
  });
});

router.get("/notifications/templates", async (req, res) => {
  const items = await MobileNotificationTemplateModel.find(req.tenant._id, {}, {
    sort: { updatedAt: -1 },
    limit: 100
  });
  return res.json({ items });
});

router.post("/notifications/templates", async (req, res) => {
  const name = sanitizeText(String(req.body?.name || "").trim()).slice(0, 80);
  const title = sanitizeText(String(req.body?.title || "").trim()).slice(0, 120);
  const body = sanitizeText(String(req.body?.body || "").trim()).slice(0, 500);
  const category = normalizeMobileNotificationCategory(req.body?.category);
  const deepLink = String(req.body?.deepLink || "").trim();
  const audience = normalizeMobileNotificationAudience(req.body?.audience);
  const userIds = normalizeMobileNotificationUserIds(req.body?.userIds);

  if (!name || !title || !body) {
    return res.status(400).json({
      error: {
        code: "TEMPLATE_FIELDS_REQUIRED",
        message: "Name, title, and body are required."
      }
    });
  }

  const created = await MobileNotificationTemplateModel.create({
    tenantId: req.tenant._id,
    name,
    title,
    body,
    category,
    deepLink,
    audience,
    userIds,
    createdByUserId: req.user.id
  });

  await writeAdminAudit(req, "admin_mobile_notification_template_saved", {
    templateId: created._id,
    name
  });

  return res.status(201).json({ ok: true, template: created });
});

router.delete("/notifications/templates/:id", async (req, res) => {
  const id = String(req.params.id || "").trim();
  const existing = await MobileNotificationTemplateModel.findOne(req.tenant._id, { _id: id });
  if (!existing) {
    return res.status(404).json({ error: { code: "TEMPLATE_NOT_FOUND", message: "Template not found." } });
  }
  await MobileNotificationTemplateModel.delete(id);
  await writeAdminAudit(req, "admin_mobile_notification_template_deleted", { templateId: id });
  return res.json({ ok: true });
});

router.get("/notifications/schedules", async (req, res) => {
  const items = await MobileNotificationScheduleModel.find(req.tenant._id, {}, {
    sort: { runAt: -1 },
    limit: 100
  });
  return res.json({ items });
});

router.delete("/notifications/schedules/:id", async (req, res) => {
  const id = String(req.params.id || "").trim();
  const existing = await MobileNotificationScheduleModel.findOne(req.tenant._id, { _id: id });
  if (!existing) {
    return res.status(404).json({ error: { code: "SCHEDULE_NOT_FOUND", message: "Scheduled notification not found." } });
  }
  if (existing.status !== "pending") {
    return res.status(400).json({ error: { code: "SCHEDULE_NOT_CANCELABLE", message: "Only pending schedules can be canceled." } });
  }
  await MobileNotificationScheduleModel.updateScoped(req.tenant._id, id, { status: "canceled" });
  await writeAdminAudit(req, "admin_mobile_notification_schedule_canceled", { scheduleId: id });
  return res.json({ ok: true });
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
    <div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.55;color:#171717;">
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
      <pre style="margin:0;padding:10px 12px;border:1px solid #e5e5e5;border-radius:8px;background:#f8fbff;white-space:pre-wrap;">${escapeEmailHtml(message)}</pre>
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
    profiles = profiles.filter((p) => matchesMemberQuery(p, q));
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

async function loadAlumniContactsForGrowth(tenantId) {
  try {
    const contacts = await AlumniContactModel.find(tenantId, {
      contactStatus: { $ne: "archived" }
    }, {
      sort: { updatedAt: -1 },
      limit: 5000
    });
    return { contacts, storage: { available: true } };
  } catch (error) {
    if (isAlumniGrowthStorageUnavailable(error)) {
      return {
        contacts: [],
        storage: {
          available: false,
          reason: "schema_required",
          message: "Apply the communications system schema before storing pre-member alumni records."
        }
      };
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Unified people directory (members, requests, invitations, prospects)
// ---------------------------------------------------------------------------

function personSortComparator(sort = "recent") {
  const name = (person) => (person.fullName || person.email || "").toLowerCase();
  const activity = (person) => new Date(
    person.lastActiveAt || person.joinedAt || person.requestedAt || person.lastInvitedAt || 0
  ).getTime();
  if (sort === "name_asc") return (a, b) => name(a).localeCompare(name(b));
  if (sort === "name_desc") return (a, b) => name(b).localeCompare(name(a));
  if (sort === "completion_desc") return (a, b) => b.completionScore - a.completionScore;
  if (sort === "completion_asc") return (a, b) => a.completionScore - b.completionScore;
  if (sort === "oldest") return (a, b) => activity(a) - activity(b);
  // "recent" keeps the row a director most likely wants to act on at the top.
  return (a, b) => activity(b) - activity(a);
}

// Columns available when exporting the people list itself (as opposed to the
// richer member-profile export, which only covers people who have joined).
const PEOPLE_EXPORT_COLUMNS = [
  { key: "firstName", label: "First name" },
  { key: "lastName", label: "Last name" },
  { key: "fullName", label: "Full name" },
  { key: "email", label: "Email" },
  { key: "stage", label: "Stage" },
  { key: "role", label: "Role" },
  { key: "location", label: "Location" },
  { key: "yearsAtCamp", label: "Camp years" },
  { key: "tags", label: "Tags" },
  { key: "notes", label: "Notes" },
  { key: "completionScore", label: "Profile completion" },
  { key: "joinedAt", label: "Joined" },
  { key: "lastActiveAt", label: "Last active" },
  { key: "requestedAt", label: "Requested" },
  { key: "requestMessage", label: "Request message" },
  { key: "inviteCount", label: "Invitations sent" },
  { key: "lastInvitedAt", label: "Last invited" },
  { key: "inviteExpiresAt", label: "Invite expires" },
  { key: "source", label: "Source" },
  { key: "profileId", label: "Profile ID" }
];
const PEOPLE_EXPORT_COLUMN_MAP = new Map(PEOPLE_EXPORT_COLUMNS.map((column) => [column.key, column]));
const PEOPLE_EXPORT_DEFAULT_COLUMNS = ["firstName", "lastName", "email", "stage", "role"];

const PEOPLE_STAGE_LABELS = {
  member: "Member",
  request: "Pending request",
  invited: "Invited",
  expired: "Invite expired",
  prospect: "Prospect",
  on_hold: "On hold"
};

function formatPeopleExportCell(person = {}, key = "") {
  const value = person[key];
  if (key === "stage") return PEOPLE_STAGE_LABELS[value] || String(value || "");
  if (Array.isArray(value)) return value.join(", ");
  if (key.endsWith("At") && value) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
  }
  if (value === null || value === undefined) return "";
  return String(value);
}

/**
 * Resolves the people list for a request's stage/search/filter query. Shared by
 * the list endpoint and its CSV export so what downloads is exactly what the
 * director is looking at.
 */
async function resolveFilteredPeople(req) {
  const tenantId = req.tenant._id;
  const directorUserId = await resolveDirectorUserId(req.tenant);
  const ninetyDaysAgo = new Date(Date.now() - 90 * DAY_MS);

  const [contactResult, invites, users, profiles, accessRequests, analyticsEvents] = await Promise.all([
    loadAlumniContactsForGrowth(tenantId),
    InviteModel.find(tenantId, { roleToAssign: "user" }, { sort: { createdAt: -1 }, limit: 5000 }),
    UserModel.find(tenantId, { status: LIVE_USER_STATUS_FILTER }, {
      select: ["id", "email", "status", "roles", "createdAt", "updatedAt", "lastLoginAt"]
    }),
    ProfileModel.find(tenantId, { status: LIVE_PROFILE_STATUS_FILTER }, { select: ADMIN_MEMBER_PROFILE_SELECT }),
    AccessRequestModel.find(tenantId, { status: "pending" }, { sort: { requestedAt: -1 }, limit: 5000 }),
    AnalyticsEventModel.find(tenantId, { createdAt: { $gte: ninetyDaysAgo } }, {
      select: ["userId", "eventType", "createdAt"],
      limit: 10000
    })
  ]);

  const { people, counts } = buildPeopleDirectory({
    contacts: contactResult.contacts,
    invites,
    users,
    profiles,
    accessRequests,
    analyticsEvents,
    mapMember: (profile, user) => mapMemberRow(profile, user, { directorUserId })
  });

  const stage = String(req.query.stage || "all").trim().toLowerCase();
  const q = String(req.query.q || "").trim().toLowerCase();
  const role = String(req.query.role || "all").trim().toLowerCase();
  const year = String(req.query.year || "all").trim();
  const completionRange = parseCompletionRange(req.query);
  // "Was this person invited, merely known, or a stranger?" — the filter that
  // lets a director clear the recognised bulk and hand-check the rest.
  const match = String(req.query.match || "any").trim().toLowerCase();
  // An explicit selection wins over the filters that produced it.
  const keys = new Set(
    String(req.query.keys || "")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
  );

  const filtered = people.filter((person) => {
    if (keys.size) return keys.has(person.key);
    if (stage !== "all" && person.stage !== stage) return false;
    if (match !== "any" && person.recognition !== match) return false;
    if (role !== "all" && String(person.role || "").toLowerCase() !== role) return false;
    if (year !== "all" && !person.yearsAtCamp.includes(year)) return false;
    if (completionRange && person.stage === "member"
      && !matchesCompletionRange(person.completionScore, completionRange)) return false;
    if (!q) return true;
    return [person.fullName, person.email, person.role, person.location, ...person.tags]
      .some((value) => String(value || "").toLowerCase().includes(q));
  });

  // How the waiting queue splits by recognition, independent of the current
  // page or filter — a director deciding "approve everyone we invited" needs
  // the size of that group before they commit to it.
  const recognitionCounts = { invited: 0, known: 0, unrecognized: 0 };
  for (const person of people) {
    if (person.stage !== "request") continue;
    recognitionCounts[person.recognition] = (recognitionCounts[person.recognition] || 0) + 1;
  }

  return { people, filtered, counts, recognitionCounts, storage: contactResult.storage };
}

router.get("/people/export.csv", exportLimiter, async (req, res, next) => {
  try {
    const requested = String(req.query.fields || "")
      .split(",")
      .map((item) => item.trim())
      .filter((key) => PEOPLE_EXPORT_COLUMN_MAP.has(key));
    const columns = (requested.length ? requested : PEOPLE_EXPORT_DEFAULT_COLUMNS)
      .map((key) => PEOPLE_EXPORT_COLUMN_MAP.get(key));

    const { filtered } = await resolveFilteredPeople(req);
    const records = filtered.map((person) => {
      const row = {};
      for (const column of columns) {
        row[column.key] = sanitizeCsvCell(formatPeopleExportCell(person, column.key));
      }
      return row;
    });

    const csv = stringify(records, {
      header: true,
      columns: columns.map((column) => ({ key: column.key, header: column.label }))
    });

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${req.tenant.slug}-people-export.csv"`
    );
    return res.send(csv);
  } catch (error) {
    return next(error);
  }
});

router.get("/people/export/preview", async (req, res, next) => {
  try {
    const requested = String(req.query.fields || "")
      .split(",")
      .map((item) => item.trim())
      .filter((key) => PEOPLE_EXPORT_COLUMN_MAP.has(key));
    const columns = (requested.length ? requested : PEOPLE_EXPORT_DEFAULT_COLUMNS)
      .map((key) => PEOPLE_EXPORT_COLUMN_MAP.get(key));

    const { filtered } = await resolveFilteredPeople(req);
    return res.json({
      total: filtered.length,
      columns: columns.map((column) => ({ key: column.key, label: column.label })),
      rows: filtered.slice(0, 5).map((person) => {
        const row = {};
        for (const column of columns) row[column.key] = formatPeopleExportCell(person, column.key);
        return row;
      })
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/people/export/fields", async (_req, res) => {
  return res.json({
    fields: PEOPLE_EXPORT_COLUMNS,
    defaultFields: PEOPLE_EXPORT_DEFAULT_COLUMNS
  });
});

router.get("/people", async (req, res, next) => {
  try {
    const { people, filtered, counts, recognitionCounts, storage } = await resolveFilteredPeople(req);
    const sort = String(req.query.sort || "recent").trim().toLowerCase();
    const page = Math.max(1, Number(req.query.page || 1) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 25) || 25));

    filtered.sort(personSortComparator(sort));
    const skip = (page - 1) * pageSize;

    return res.json({
      total: filtered.length,
      page,
      pageSize,
      counts,
      recognitionCounts,
      items: filtered.slice(skip, skip + pageSize),
      filters: {
        roleOptions: [...new Set(people.map((item) => item.role).filter(Boolean))].sort(),
        yearOptions: [...new Set(people.flatMap((item) => item.yearsAtCamp))].filter(Boolean).sort()
      },
      storage
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/growth", async (req, res, next) => {
  try {
    const tenantId = req.tenant._id;
    const ninetyDaysAgo = new Date(Date.now() - 90 * DAY_MS);
    const [contactResult, invites, users, profiles, analyticsEvents, broadcasts] = await Promise.all([
      loadAlumniContactsForGrowth(tenantId),
      InviteModel.find(tenantId, { roleToAssign: "user" }, {
        sort: { createdAt: -1 },
        limit: 5000
      }),
      UserModel.find(tenantId, { status: LIVE_USER_STATUS_FILTER }, {
        select: ["id", "email", "status", "createdAt", "updatedAt", "lastLoginAt"]
      }),
      ProfileModel.find(tenantId, { status: LIVE_PROFILE_STATUS_FILTER }, {
        select: [
          "id",
          "userId",
          "firstName",
          "lastName",
          "emails",
          "avatarUrl",
          "cityState",
          "industry",
          "roleAtCamp",
          "createdAt"
        ]
      }),
      AnalyticsEventModel.find(tenantId, { createdAt: { $gte: ninetyDaysAgo } }, {
        select: ["userId", "eventType", "createdAt"],
        limit: 10000
      }),
      EmailBroadcastModel.find(tenantId, { campaignType: "marketing" }, {
        sort: { createdAt: -1 },
        limit: 100
      })
    ]);
    const snapshot = buildAlumniGrowthSnapshot({
      contacts: contactResult.contacts,
      invites,
      users,
      profiles,
      analyticsEvents,
      broadcasts
    });
    const query = String(req.query.q || "").trim().toLowerCase();
    const requestedLifecycle = String(req.query.lifecycle || "all").trim().toLowerCase();
    const limit = Math.min(500, Math.max(1, Number(req.query.limit || 200) || 200));
    const filteredContacts = snapshot.contacts.filter((contact) => {
      if (requestedLifecycle !== "all" && contact.lifecycle !== requestedLifecycle) return false;
      if (!query) return true;
      return [contact.firstName, contact.lastName, contact.email, ...(contact.tags || [])]
        .some((value) => String(value || "").toLowerCase().includes(query));
    });

    return res.json({
      tenant: {
        id: toObjectIdString(req.tenant._id),
        slug: req.tenant.slug,
        name: req.tenant.name
      },
      generatedAt: snapshot.generatedAt,
      storage: contactResult.storage,
      metrics: snapshot.metrics,
      funnel: snapshot.funnel,
      opportunities: snapshot.opportunities,
      marketing: snapshot.marketing,
      contacts: {
        total: filteredContacts.length,
        items: filteredContacts.slice(0, limit)
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/growth/contacts", async (req, res, next) => {
  try {
    const rawContacts = Array.isArray(req.body?.contacts)
      ? req.body.contacts
      : req.body?.contact
        ? [req.body.contact]
        : [];
    if (!rawContacts.length) {
      return res.status(400).json({
        error: { code: "ALUMNI_CONTACTS_REQUIRED", message: "Add at least one alumni contact." }
      });
    }
    if (rawContacts.length > 500) {
      return res.status(400).json({
        error: { code: "ALUMNI_CONTACT_LIMIT", message: "Add up to 500 alumni contacts at a time." }
      });
    }

    const normalizedByEmail = new Map();
    let invalidCount = 0;
    for (const rawContact of rawContacts) {
      const normalized = normalizeAlumniContactInput(rawContact);
      if (!normalized) {
        invalidCount += 1;
        continue;
      }
      normalizedByEmail.set(normalized.email, normalized);
    }
    if (!normalizedByEmail.size) {
      return res.status(400).json({
        error: { code: "ALUMNI_CONTACT_EMAIL_INVALID", message: "No valid alumni email addresses were found." }
      });
    }

    const emails = [...normalizedByEmail.keys()];
    const existingUsers = await UserModel.find(req.tenant._id, { email: { $in: emails } }, {
      select: ["id", "email"]
    });
    const memberEmails = new Set(existingUsers.map((user) => normalizeEmail(user.email)));
    let createdCount = 0;
    let updatedCount = 0;
    let existingMemberCount = 0;
    for (const contact of normalizedByEmail.values()) {
      if (memberEmails.has(contact.email)) {
        existingMemberCount += 1;
        continue;
      }
      const result = await upsertAlumniContact({
        tenantId: req.tenant._id,
        contact,
        actorUserId: req.user.id
      });
      if (result.status === "created") createdCount += 1;
      if (result.status === "updated") updatedCount += 1;
    }

    await writeAdminAudit(req, "admin_alumni_contacts_saved", {
      submittedCount: rawContacts.length,
      uniqueValidCount: normalizedByEmail.size,
      createdCount,
      updatedCount,
      existingMemberCount,
      invalidCount
    });
    clearAdminReadCaches(req.tenant._id);
    return res.status(201).json({
      ok: true,
      submittedCount: rawContacts.length,
      uniqueValidCount: normalizedByEmail.size,
      createdCount,
      updatedCount,
      existingMemberCount,
      invalidCount
    });
  } catch (error) {
    if (isAlumniGrowthStorageUnavailable(error)) {
      return res.status(503).json({
        error: {
          code: "ALUMNI_CONTACT_STORAGE_UNAVAILABLE",
          message: "Pre-member alumni storage is not ready. Apply the communications system schema in staging first."
        }
      });
    }
    return next(error);
  }
});

router.patch("/growth/contacts/:contactId", async (req, res, next) => {
  try {
    const contact = await AlumniContactModel.findOne(req.tenant._id, {
      _id: String(req.params.contactId || "").trim()
    });
    if (!contact) {
      return res.status(404).json({
        error: { code: "ALUMNI_CONTACT_NOT_FOUND", message: "Alumni contact not found." }
      });
    }
    const normalized = normalizeAlumniContactInput({
      ...contact,
      ...req.body,
      email: contact.email
    });
    const updated = await AlumniContactModel.updateScoped(req.tenant._id, contact._id, {
      firstName: normalized.firstName,
      lastName: normalized.lastName,
      contactStatus: normalized.contactStatus,
      tags: normalized.tags,
      campYears: normalized.campYears,
      notes: normalized.notes,
      updatedAt: new Date()
    });
    await writeAdminAudit(req, "admin_alumni_contact_updated", {
      contactId: toObjectIdString(contact._id),
      contactStatus: normalized.contactStatus,
      tagCount: normalized.tags.length,
      campYearCount: normalized.campYears.length,
      noteLength: normalized.notes.length
    });
    clearAdminReadCaches(req.tenant._id);
    return res.json({
      ok: true,
      contact: {
        id: toObjectIdString(updated._id),
        firstName: updated.firstName,
        lastName: updated.lastName,
        email: updated.email,
        contactStatus: updated.contactStatus,
        tags: updated.tags || [],
        campYears: updated.campYears || [],
        notes: updated.notes || ""
      }
    });
  } catch (error) {
    if (isAlumniGrowthStorageUnavailable(error)) {
      return res.status(503).json({
        error: {
          code: "ALUMNI_CONTACT_STORAGE_UNAVAILABLE",
          message: "Pre-member alumni storage is not ready."
        }
      });
    }
    return next(error);
  }
});

/**
 * Erases a pre-member person's contact artifacts. Removed members can surface
 * here as prospects after losing access; those rows must go through the full
 * member cleanup so their local user and Clerk account are deleted too.
 */
router.delete("/growth/people/:email/purge", async (req, res, next) => {
  try {
    const email = normalizeEmail(decodeURIComponent(String(req.params.email || "")));
    if (!email) {
      return res.status(400).json({
        error: { code: "PERSON_EMAIL_REQUIRED", message: "An email address is required." }
      });
    }

    // A removed member still owns a deactivated account row. Reading that row
    // as "they have joined" sent the director back to Members to remove someone
    // who was already removed and no longer listed there, with no way out.
    const joinedUser = await UserModel.findOne(req.tenant._id, { email });
    if (joinedUser && !isRemovedUser(joinedUser)) {
      return res.status(409).json({
        error: {
          code: "PERSON_ALREADY_JOINED",
          message: "This person has joined. Remove them from Members instead."
        }
      });
    }

    const [contacts, invites, requests] = await Promise.all([
      AlumniContactModel.find(req.tenant._id, { email }),
      InviteModel.find(req.tenant._id, { email }),
      AccessRequestModel.find(req.tenant._id, { email })
    ]);

    if (!joinedUser && !contacts.length && !invites.length && !requests.length) {
      return res.status(404).json({
        error: { code: "PERSON_NOT_FOUND", message: "There is nothing left to delete for this person." }
      });
    }

    let removedMemberSummary = null;
    if (joinedUser) {
      const joinedUserId = toObjectIdString(joinedUser._id);
      const removedProfile = await ProfileModel.findOne(req.tenant._id, {
        userId: joinedUserId
      });
      removedMemberSummary = await deleteMemberFromTenant({
        tenantId: req.tenant._id,
        userId: joinedUserId,
        profileId: toObjectIdString(removedProfile?._id),
        email,
        clerkUserId: joinedUser.clerkUserId || ""
      });
    } else {
      for (const contact of contacts) await AlumniContactModel.delete(contact._id);
      for (const invite of invites) await InviteModel.delete(invite._id);
      for (const request of requests) await AccessRequestModel.delete(request._id);
    }

    await writeAdminAudit(req, "admin_person_purged", {
      email,
      contactCount: contacts.length,
      inviteCount: invites.length,
      requestCount: requests.length,
      removedMemberUserId: joinedUser ? toObjectIdString(joinedUser._id) : "",
      clerkAccount: removedMemberSummary?.clerkAccount || null
    });
    clearAdminReadCaches(req.tenant._id);

    return res.json({
      ok: true,
      deleted: {
        contacts: removedMemberSummary?.alumniContactsDeleted ?? contacts.length,
        invites: removedMemberSummary?.invitesDeleted ?? invites.length,
        requests: removedMemberSummary?.accessRequestsDeleted ?? requests.length,
        profile: removedMemberSummary?.profileDeleted || 0,
        user: removedMemberSummary?.userDeleted || 0,
        clerkAccount: removedMemberSummary?.clerkAccount || null
      }
    });
  } catch (error) {
    if (isAlumniGrowthStorageUnavailable(error)) {
      return res.status(503).json({
        error: {
          code: "ALUMNI_CONTACT_STORAGE_UNAVAILABLE",
          message: "Pre-member alumni storage is not ready."
        }
      });
    }
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

router.post("/invites/preview", inviteUpload.single("file"), async (req, res) => {
  const roleToAssign = String(req.body.roleToAssign || "user").trim();
  if (!["user", "tenant_admin"].includes(roleToAssign)) {
    return res.status(400).json({
      error: { code: "INVALID_ROLE", message: "roleToAssign must be 'user' or 'tenant_admin'." }
    });
  }

  let recipientsFromPayload = [];
  try {
    recipientsFromPayload = parseInviteRowsFromRecipientsPayload(req.body.recipients);
  } catch (parseError) {
    return res.status(400).json({
      error: { code: "INVALID_RECIPIENTS", message: parseError.message || "Invalid recipients payload." }
    });
  }

  let csvAnalysis;
  try {
    csvAnalysis = analyzeInviteRowsFromCsv(req.file?.buffer || null);
  } catch (parseError) {
    return res.status(400).json({
      error: { code: "CSV_INVALID_FORMAT", message: parseError.message || "Invalid CSV format." }
    });
  }
  const textRows = parseInviteRowsFromText(req.body.emails || "");
  const validInputCount = recipientsFromPayload.length + textRows.length + csvAnalysis.rows.length;
  const recipients = mergeInviteRows(recipientsFromPayload, textRows, csvAnalysis.rows);
  if (recipients.length === 0) {
    return res.status(400).json({
      error: { code: "RECIPIENTS_REQUIRED", message: "No valid invite recipients were found." }
    });
  }
  if (recipients.length > env.EMAIL_BROADCAST_MAX_RECIPIENTS) {
    return res.status(400).json({
      error: {
        code: "TOO_MANY_RECIPIENTS",
        message: `Invite list exceeds the ${env.EMAIL_BROADCAST_MAX_RECIPIENTS}-recipient limit.`
      }
    });
  }

  const emails = recipients.map((row) => row.email);
  const now = new Date();
  const [existingUsers, pendingInvites, heldContacts] = await Promise.all([
    UserModel.find(req.tenant._id, { email: { $in: emails } }, { select: ["id", "email"] }),
    InviteModel.find(req.tenant._id, {
      email: { $in: emails },
      usedAt: null,
      expiresAt: { $gt: now }
    }, { select: ["id", "email", "expiresAt"] }),
    AlumniContactModel.find(req.tenant._id, {
      email: { $in: emails },
      contactStatus: "do_not_contact"
    }, { select: ["id", "email"] }).catch((error) => {
      if (isAlumniGrowthStorageUnavailable(error)) return [];
      throw error;
    })
  ]);
  const existingEmails = new Set((existingUsers || []).map((item) => normalizeEmail(item.email)));
  const pendingEmails = new Set((pendingInvites || []).map((item) => normalizeEmail(item.email)));
  const heldEmails = new Set((heldContacts || []).map((item) => normalizeEmail(item.email)));
  const items = recipients.map((row) => ({
    ...row,
    status: existingEmails.has(row.email)
      ? "existing_member"
      : heldEmails.has(row.email)
      ? "contact_on_hold"
      : pendingEmails.has(row.email)
      ? "pending_invite"
      : "ready"
  }));
  const readyCount = items.filter((item) => item.status === "ready").length;
  const customSubject = normalizeInviteEmailSubject(req.body?.customSubject || "");
  const customMessage = normalizeInviteEmailMessage(req.body?.customMessage || "");
  const previewToken = createInvitePreviewToken({
    tenantId: req.tenant._id,
    actorUserId: req.user.id,
    roleToAssign,
    recipients,
    customSubject,
    customMessage
  });

  return res.json({
    ok: true,
    previewToken,
    expiresInSeconds: 15 * 60,
    summary: {
      rowsRead: recipientsFromPayload.length + textRows.length + csvAnalysis.rowsRead,
      validInputCount,
      uniqueCount: recipients.length,
      duplicateInputCount: Math.max(0, validInputCount - recipients.length),
      readyCount,
      existingMemberCount: existingEmails.size,
      pendingInviteCount: pendingEmails.size,
      contactOnHoldCount: heldEmails.size,
      invalidCount: csvAnalysis.errors.length
    },
    items: items.slice(0, 100),
    excludedRows: csvAnalysis.errors.slice(0, 100)
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
    const customSubject = normalizeInviteEmailSubject(req.body?.customSubject || "");
    const customMessage = normalizeInviteEmailMessage(req.body?.customMessage || "");

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

    let csvAnalysis;
    try {
      csvAnalysis = analyzeInviteRowsFromCsv(req.file?.buffer || null);
    } catch (parseError) {
      return res.status(400).json({
        error: { code: "CSV_INVALID_FORMAT", message: parseError.message || "Invalid CSV format." }
      });
    }
    const recipients = mergeInviteRows(
      recipientsFromPayload,
      parseInviteRowsFromText(req.body.emails || ""),
      csvAnalysis.rows
    );

    if (recipients.length === 0) {
      return res.status(400).json({
        error: {
          code: "RECIPIENTS_REQUIRED",
          message: "Provide at least one valid recipient in rows, text, or CSV."
        }
      });
    }

    if (recipients.length > env.EMAIL_BROADCAST_MAX_RECIPIENTS) {
      return res.status(400).json({
        error: {
          code: "TOO_MANY_RECIPIENTS",
          message: `Invite list exceeds the ${env.EMAIL_BROADCAST_MAX_RECIPIENTS}-recipient limit.`
        }
      });
    }

    const previewValid = verifyInvitePreviewToken(req.body?.previewToken, {
      tenantId: req.tenant._id,
      actorUserId: req.user.id,
      roleToAssign,
      recipients,
      customSubject,
      customMessage
    });
    if (!previewValid) {
      return res.status(428).json({
        error: {
          code: "INVITE_PREVIEW_REQUIRED",
          message: "Review the current recipient preview before sending invitations."
        }
      });
    }

    let createdCount = 0;
    let sentCount = 0;
    const skipped = csvAnalysis.errors.map((error) => ({
      email: error.email || "",
      rowNumber: error.rowNumber,
      reason: error.code
    }));

    for (const recipient of recipients) {
      const email = recipient.email;
      let trackedContact = null;
      try {
        trackedContact = await AlumniContactModel.findOne(req.tenant._id, { email });
      } catch (error) {
        if (!isAlumniGrowthStorageUnavailable(error)) throw error;
      }
      if (trackedContact?.contactStatus === "do_not_contact") {
        skipped.push({ email, reason: "CONTACT_ON_HOLD" });
        continue;
      }
      const existingUser = await UserModel.findOne(req.tenant._id, { email });
      if (existingUser) {
        skipped.push({ email, reason: "USER_EXISTS" });
        continue;
      }

      const pendingInvite = await InviteModel.findOne(req.tenant._id, {
        email,
        usedAt: null,
        expiresAt: { $gt: new Date() }
      });
      if (pendingInvite) {
        skipped.push({ email, reason: "INVITE_ALREADY_PENDING" });
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
          customSubject,
          customMessage,
          firstName: recipient.firstName || "",
          lastName: recipient.lastName || ""
        });
        sentCount += 1;
        await trackInvitedAlumniContact({
          tenantId: req.tenant._id,
          actorUserId: req.user.id,
          contact: {
            email,
            firstName: recipient.firstName || "",
            lastName: recipient.lastName || "",
            source: "invitation"
          },
          invitedAt: new Date()
        }).catch((trackingError) => {
          console.warn("[growth] invite contact tracking failed", {
            tenantId: String(req.tenant._id || ""),
            code: String(trackingError?.code || "GROWTH_TRACKING_FAILED")
          });
        });
      } catch (error) {
        skipped.push({ email, reason: `EMAIL_SEND_FAILED: ${error.message}` });
      }
    }

    await writeAdminAudit(req, "admin_invites_sent", {
      roleToAssign,
      attemptedCount: recipients.length,
      createdCount,
      sentCount,
      skippedCount: skipped.length,
      usedCustomSubject: Boolean(customSubject),
      customMessageLength: customMessage.length
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
      clearAdminReadCaches(req.tenant._id);
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
      await deleteMemberActivityItems(req.tenant._id, [userId]);
      await ProfileModel.delete(profile._id);
      await writeAdminAudit(req, "admin_member_hard_deleted", {
        profileId: toObjectIdString(profile._id),
        userId,
        summary: { profileDeleted: 1, userDeleted: 0 }
      });
      clearAdminReadCaches(req.tenant._id);
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
      email: profile?.emails?.[0] || user?.email || "",
      clerkUserId: user?.clerkUserId || ""
    });
    await writeAdminAudit(req, "admin_member_hard_deleted", {
      profileId: toObjectIdString(profile._id),
      userId,
      summary
    });
    clearAdminReadCaches(req.tenant._id);

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
      doc.fontSize(14).fillColor("#252525").text(letter);
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
      iconUrls: Object.keys(theme.iconUrls).length ? theme.iconUrls : currentTheme.iconUrls || {},
      heroImageUrl: String(theme.heroImageUrl || currentTheme.heroImageUrl),
      heroImageUrlMember: String(theme.heroImageUrlMember || currentTheme.heroImageUrlMember || ""),
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
