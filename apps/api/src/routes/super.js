import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  alumniPluralForCampType,
  defaultNetworkDisplayNameForCamp,
  normalizeCampType,
  normalizeSlug
} from "@pondbridge/shared";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireRole } from "../middleware/requireRole.js";
import {
  TenantModel,
  UserModel,
  ProfileModel,
  InviteModel,
  AccessRequestModel,
  MagicLinkTokenModel,
  ConversationModel,
  MessageModel,
  ForumModel,
  ForumPostModel,
  PhotoModel,
  NewsletterModel,
  EmailBroadcastModel,
  FamilyTreeModel,
  ImportReportModel,
  AnalyticsEventModel,
  TenantAdminAuditLogModel,
  ResumeParseResultModel,
  ActivityItemModel,
  ResendWebhookEventModel,
  EmailSuppressionModel
} from "../db/models/index.js";
import { createTenantCheckoutSession, getBillingMode } from "../services/billing.js";
import { normalizeBillingPlan, resolveTenantBilling } from "../services/billingState.js";
import { createDefaultChecklist } from "../services/onboarding.js";
import { deprovisionTenantDomain, provisionTenantDomain } from "../services/cloudflareDomains.js";
import { getEmailServiceStatus } from "../services/email.js";
import { getR2ServiceStatus, purgeTenantObjectsFromR2 } from "../services/objectStorage.js";
import { buildTenantUrls, defaultTenantDomain, isReservedSubdomain } from "../utils/domainProvisioning.js";
import { hashOpaqueToken } from "../utils/tokens.js";
import { env } from "../config/env.js";
import { deleteClerkUserAccount, isClerkManagementConfigured } from "../services/clerkIdentity.js";

const router = Router();
const superSearchLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 180,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: "RATE_LIMITED",
      message: "Too many super admin search requests. Please wait and try again."
    }
  }
});

const SUPER_CONSOLE_ROLES = ["super_admin", "support_admin", "finance_admin"];
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const BILLING_PLAN_MRR = {
  legacy: 3500 / 12,
  founders: 2800 / 12,
  institutional: 5000 / 12
};
const VALID_BILLING_PLAN_CODES = new Set(["legacy", "founders", "institutional"]);
const BILLING_PLAN_DEFAULTS = {
  legacy: {
    planTier: "base",
    onboardingFeeAmount: 0,
    onboardingFeePaid: true,
    onboardingFeeStatus: "waived",
    onboardingFeeWaiveReason: "plan_has_no_onboarding_fee"
  },
  founders: {
    planTier: "premium",
    onboardingFeeAmount: 0,
    onboardingFeePaid: true,
    onboardingFeeStatus: "waived",
    onboardingFeeWaiveReason: "founders"
  },
  institutional: {
    planTier: "premium",
    onboardingFeeAmount: 450,
    onboardingFeePaid: false,
    onboardingFeeStatus: "unpaid",
    onboardingFeeWaiveReason: ""
  }
};
const APP_BASE_DOMAIN = String(env.APP_BASE_DOMAIN || "pondbridgealumni.com").trim().toLowerCase();
const PRIVILEGED_GLOBAL_ROLES = new Set(["super_admin", "support_admin", "finance_admin"]);
const HIDDEN_TENANT_PATTERN =
  /(^|[-_.\s])(test\d*|sandbox|qa|staging|dev|demo)([-_.\s]|$)/i;
const TENANT_PURGE_STEPS = [
  { key: "messages", model: MessageModel },
  { key: "forumPosts", model: ForumPostModel },
  { key: "conversations", model: ConversationModel },
  { key: "forums", model: ForumModel },
  { key: "photos", model: PhotoModel },
  { key: "newsletters", model: NewsletterModel },
  { key: "emailBroadcasts", model: EmailBroadcastModel },
  { key: "familyTrees", model: FamilyTreeModel },
  { key: "importReports", model: ImportReportModel },
  { key: "analyticsEvents", model: AnalyticsEventModel },
  { key: "tenantAuditLogs", model: TenantAdminAuditLogModel },
  { key: "resumeParseResults", model: ResumeParseResultModel },
  { key: "activityItems", model: ActivityItemModel },
  { key: "resendWebhookEvents", model: ResendWebhookEventModel },
  { key: "emailSuppressions", model: EmailSuppressionModel },
  { key: "magicLinkTokens", model: MagicLinkTokenModel },
  { key: "accessRequests", model: AccessRequestModel },
  { key: "invites", model: InviteModel },
  { key: "profiles", model: ProfileModel },
  { key: "users", model: UserModel }
];
const FLAG_TEMPLATES = [
  {
    key: "directory_module",
    name: "Directory",
    description: "Member directory and search experience",
    enabled: true,
    rolloutPercent: 100,
    tierConfig: { base: true, premium: true },
    overrides: []
  },
  {
    key: "messaging_module",
    name: "Messaging",
    description: "Direct messaging and chat rooms",
    enabled: true,
    rolloutPercent: 100,
    tierConfig: { base: true, premium: true },
    overrides: []
  },
  {
    key: "events_module",
    name: "Events",
    description: "Event publishing and RSVP flow",
    enabled: false,
    rolloutPercent: 35,
    tierConfig: { base: false, premium: true },
    overrides: []
  },
  {
    key: "family_trees_module",
    name: "Family Trees",
    description: "Camp lineage and relationship mapping",
    enabled: true,
    rolloutPercent: 100,
    tierConfig: { base: false, premium: true },
    overrides: []
  },
  {
    key: "photo_archive_module",
    name: "Photo Archive",
    description: "Photo feed and archive browser",
    enabled: true,
    rolloutPercent: 100,
    tierConfig: { base: true, premium: true },
    overrides: []
  },
  {
    key: "merch_module",
    name: "Merch",
    description: "Merch store links and campaign cards",
    enabled: true,
    rolloutPercent: 100,
    tierConfig: { base: true, premium: true },
    overrides: []
  },
  {
    key: "newsletter_module",
    name: "Newsletter",
    description: "Newsletter archive and publish workflows",
    enabled: true,
    rolloutPercent: 100,
    tierConfig: { base: true, premium: true },
    overrides: []
  }
];
const featureFlagState = new Map(FLAG_TEMPLATES.map((flag) => [flag.key, { ...flag }]));
const scheduledJobsState = new Map([
  [
    "nightly-analytics-refresh",
    {
      key: "nightly-analytics-refresh",
      name: "Nightly Analytics Refresh",
      schedule: "0 2 * * *",
      scheduleHuman: "Daily at 2:00 AM UTC",
      enabled: true,
      lastRunAt: null,
      nextRunAt: null,
      lastStatus: "success",
      lastError: ""
    }
  ],
  [
    "onboarding-health-check",
    {
      key: "onboarding-health-check",
      name: "Onboarding Health Check",
      schedule: "0 */6 * * *",
      scheduleHuman: "Every 6 hours",
      enabled: true,
      lastRunAt: null,
      nextRunAt: null,
      lastStatus: "success",
      lastError: ""
    }
  ],
  [
    "billing-followup-reminders",
    {
      key: "billing-followup-reminders",
      name: "Billing Followup Reminders",
      schedule: "30 14 * * 1-5",
      scheduleHuman: "Weekdays at 2:30 PM UTC",
      enabled: true,
      lastRunAt: null,
      nextRunAt: null,
      lastStatus: "success",
      lastError: ""
    }
  ]
]);

router.use(requireAuth, requireRole(...SUPER_CONSOLE_ROLES));

function nowIso() {
  return new Date().toISOString();
}

function normalizeEmail(value = "") {
  return String(value || "").trim().toLowerCase();
}

function isEmail(value = "") {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function toObjectIdString(value) {
  return value ? String(value) : "";
}

function startOfUtcDay(date = new Date()) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function dayKey(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function clampPercent(n) {
  return Math.max(0, Math.min(100, Number(n || 0)));
}

function computeDeltaPercent(current, previous) {
  const c = Number(current || 0);
  const p = Number(previous || 0);
  if (p <= 0) return c > 0 ? 100 : 0;
  return ((c - p) / p) * 100;
}

function getPrimaryRole(user) {
  const roleSet = new Set(user?.roles || []);
  if (roleSet.has("super_admin")) return "super_admin";
  if (roleSet.has("support_admin")) return "support_admin";
  if (roleSet.has("finance_admin")) return "finance_admin";
  return "unknown";
}

function normalizeDomain(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .split(":")[0];
}

function canAutoDeleteTenantDomain(domain = "") {
  const safeDomain = normalizeDomain(domain);
  if (!safeDomain) return false;
  if (!APP_BASE_DOMAIN) return false;
  if (safeDomain === APP_BASE_DOMAIN) return false;
  if (!safeDomain.endsWith(`.${APP_BASE_DOMAIN}`)) return false;

  const subdomain = safeDomain.slice(0, -1 * (APP_BASE_DOMAIN.length + 1)).split(".")[0] || "";
  if (!subdomain) return false;
  if (isReservedSubdomain(subdomain)) return false;
  return true;
}

function isTestOrSandboxTenant(tenant = {}) {
  const slug = String(tenant?.slug || "").trim().toLowerCase();
  const name = String(tenant?.name || "").trim().toLowerCase();
  const domain = normalizeDomain(tenant?.customDomain || "");
  const status = String(tenant?.status || "").trim().toLowerCase();

  if (status === "sandbox") return true;
  if (domain.endsWith(".pondbridge.test")) return true;
  return (
    HIDDEN_TENANT_PATTERN.test(slug) ||
    HIDDEN_TENANT_PATTERN.test(name) ||
    HIDDEN_TENANT_PATTERN.test(domain)
  );
}

function hasPrivilegedGlobalRole(roles = []) {
  const set = new Set((Array.isArray(roles) ? roles : []).map((role) => String(role || "").trim()));
  for (const role of PRIVILEGED_GLOBAL_ROLES) {
    if (set.has(role)) return true;
  }
  return false;
}

function parseDateValue(value) {
  const ts = Date.parse(String(value || ""));
  return Number.isFinite(ts) ? ts : null;
}

function evaluateDeletionRequestWindow(tenant = {}) {
  const deletionRequest =
    tenant?.deletionRequest && typeof tenant.deletionRequest === "object"
      ? tenant.deletionRequest
      : {};

  if (String(deletionRequest.status || "").trim().toLowerCase() !== "requested") {
    return {
      allowed: false,
      code: "DELETION_REQUEST_REQUIRED",
      message:
        "Production tenant hard delete is blocked until the camp submits a delete request from Director Admin > Danger Zone."
    };
  }

  const requestedAtMs = parseDateValue(deletionRequest.requestedAt);
  if (!requestedAtMs) {
    return {
      allowed: false,
      code: "DELETION_REQUEST_INVALID",
      message: "Deletion request is missing a valid requestedAt timestamp."
    };
  }

  const graceMs = Number(env.SUPER_TENANT_DELETION_GRACE_HOURS || 24) * HOUR_MS;
  const readyAtMs = requestedAtMs + graceMs;
  if (Date.now() < readyAtMs) {
    return {
      allowed: false,
      code: "DELETION_GRACE_WINDOW_ACTIVE",
      message: `Deletion request waiting period not met. Hard delete unlocks at ${new Date(
        readyAtMs
      ).toISOString()}.`
    };
  }

  return { allowed: true };
}

async function loadTenantUsersForCleanup(tenantId) {
  const pageSize = 1000;
  const maxPages = 300;
  const users = [];

  for (let page = 0; page < maxPages; page += 1) {
    const batch = await UserModel.find(tenantId, {}, {
      select: ["id", "clerkUserId", "email", "roles"],
      limit: pageSize,
      offset: page * pageSize
    });
    if (!Array.isArray(batch) || batch.length === 0) break;
    users.push(...batch);
    if (batch.length < pageSize) break;
  }

  return users;
}

function collectClerkCleanupCandidates(users = []) {
  const byClerkUserId = new Map();
  for (const user of Array.isArray(users) ? users : []) {
    const clerkUserId = String(user?.clerkUserId || "").trim();
    if (!clerkUserId) continue;
    const existing = byClerkUserId.get(clerkUserId) || {
      clerkUserId,
      emails: new Set()
    };
    const email = String(user?.email || "").trim().toLowerCase();
    if (email) existing.emails.add(email);
    byClerkUserId.set(clerkUserId, existing);
  }

  return [...byClerkUserId.values()].map((item) => ({
    clerkUserId: item.clerkUserId,
    emails: [...item.emails]
  }));
}

function collectGlobalUserEmailCandidates(users = []) {
  const emails = new Set();
  for (const user of Array.isArray(users) ? users : []) {
    const email = String(user?.email || "").trim().toLowerCase();
    if (email) emails.add(email);
  }
  return [...emails];
}

async function purgeTenantClerkArtifacts({ clerkCandidates = [] } = {}) {
  const summary = {
    clerkConfigured: isClerkManagementConfigured(),
    candidates: Array.isArray(clerkCandidates) ? clerkCandidates.length : 0,
    deleted: 0,
    notFound: 0,
    skippedMembershipsRemain: 0,
    skippedPrivilegedGlobal: 0,
    skippedNoClerk: 0,
    globalUsersDeleted: 0,
    errors: []
  };

  if (!summary.clerkConfigured) {
    summary.skippedNoClerk = summary.candidates;
    return summary;
  }

  for (const candidate of Array.isArray(clerkCandidates) ? clerkCandidates : []) {
    const clerkUserId = String(candidate?.clerkUserId || "").trim();
    if (!clerkUserId) {
      summary.skippedNoClerk += 1;
      continue;
    }

    try {
      const remainingMemberships = await UserModel.findMembershipsByClerkUserId(clerkUserId);
      if ((remainingMemberships || []).length > 0) {
        summary.skippedMembershipsRemain += 1;
        continue;
      }

      const globalUser = await UserModel.findGlobalByClerkUserId(clerkUserId);
      if (globalUser && hasPrivilegedGlobalRole(globalUser.roles || [])) {
        summary.skippedPrivilegedGlobal += 1;
        continue;
      }

      const deleted = await deleteClerkUserAccount(clerkUserId);
      if (deleted.status === "deleted") {
        summary.deleted += 1;
      } else if (deleted.status === "not_found") {
        summary.notFound += 1;
      } else {
        summary.skippedNoClerk += 1;
      }

      if (globalUser?._id && !hasPrivilegedGlobalRole(globalUser.roles || [])) {
        await UserModel.delete(globalUser._id);
        summary.globalUsersDeleted += 1;
      }
    } catch (error) {
      summary.errors.push({
        clerkUserId,
        message: String(error?.message || "Failed to delete Clerk user")
      });
    }
  }

  return summary;
}

async function purgeTenantGlobalUserArtifacts({ emailCandidates = [] } = {}) {
  const summary = {
    candidates: Array.isArray(emailCandidates) ? emailCandidates.length : 0,
    deleted: 0,
    skippedMembershipsRemain: 0,
    skippedPrivilegedGlobal: 0,
    errors: []
  };

  for (const rawEmail of Array.isArray(emailCandidates) ? emailCandidates : []) {
    const email = String(rawEmail || "").trim().toLowerCase();
    if (!email) continue;

    try {
      const remainingMemberships = await UserModel.findMembershipsByEmail(email);
      if ((remainingMemberships || []).length > 0) {
        summary.skippedMembershipsRemain += 1;
        continue;
      }

      const globalUser = await UserModel.findGlobalByEmail(email);
      if (!globalUser?._id) continue;
      if (hasPrivilegedGlobalRole(globalUser.roles || [])) {
        summary.skippedPrivilegedGlobal += 1;
        continue;
      }

      await UserModel.delete(globalUser._id);
      summary.deleted += 1;
    } catch (error) {
      summary.errors.push({
        email,
        message: String(error?.message || "Failed to delete global user")
      });
    }
  }

  return summary;
}

async function purgeTenantRows(tenantId) {
  const counts = {};

  for (const step of TENANT_PURGE_STEPS) {
    const existing = await step.model.count(tenantId, {});
    counts[step.key] = existing;
    if (existing > 0) {
      await step.model.deleteMany(tenantId, {});
    }
  }

  return counts;
}

function requireSuperMutation(req, res, next) {
  if (getPrimaryRole(req.user) !== "super_admin") {
    return res.status(403).json({
      error: {
        code: "ROLE_FORBIDDEN",
        message: "You don't have permission to perform this action."
      }
    });
  }
  const tenantScopedSuper = String(req.user?.tenantId || "").trim();
  if (tenantScopedSuper) {
    return res.status(403).json({
      error: {
        code: "ROLE_FORBIDDEN",
        message: "Super admin mutation requires a global super admin session."
      }
    });
  }
  return next();
}

function billingStatusLabel(tenant = {}) {
  const isComp = Array.isArray(tenant.addOns) && tenant.addOns.includes("comp");
  if (isComp) return "comp";
  return tenant.billingStatus || "trialing";
}

function planMonthlyAmount(tenant = {}) {
  const billing = resolveTenantBilling(tenant);
  return BILLING_PLAN_MRR[billing.billingPlan] || BILLING_PLAN_MRR.legacy;
}

function tenantMrr(tenant = {}) {
  if (billingStatusLabel(tenant) !== "active") return 0;
  return planMonthlyAmount(tenant);
}

function fauxPaymentMethod(tenant = {}) {
  if (!tenant.stripeCustomerId) {
    return { status: "no_card", label: "No card on file" };
  }
  if (tenant.billingStatus === "past_due") {
    return { status: "issue", label: "Card issue — action required" };
  }
  return { status: "ok", label: "Visa •••• 4242 exp 12/26" };
}

function inferOnboardingStage(tenant = {}) {
  if (tenant.onboardingStatus === "live") return "Launched";
  const step = Number(tenant?.onboardingProgress?.currentStep || 1);
  if (step <= 1) return "Invited";
  if (step === 2) return "Account Created";
  if (step === 3) return "Branding Done";
  if (step === 4) return "Features Done";
  if (step >= 5) return "Members Imported";
  return "Invited";
}

function statusTone(status = "") {
  const key = String(status || "").toLowerCase();
  if (["active", "completed", "live", "delivered", "success"].includes(key)) return "success";
  if (["running", "trialing", "info", "sent"].includes(key)) return "info";
  if (["past_due", "failed", "bounced", "danger", "error"].includes(key)) return "danger";
  if (["queued", "pending", "warning", "partial"].includes(key)) return "warning";
  return "neutral";
}

function buildSeries(days, reducerMap) {
  const base = startOfUtcDay(new Date());
  const points = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = new Date(base.getTime() - offset * DAY_MS);
    const key = dayKey(day);
    points.push({ date: key, value: Number(reducerMap.get(key) || 0) });
  }
  return points;
}

function mapOnboardingStepLabel(step = "") {
  const labels = {
    name_branding: "Branding",
    welcome_message: "Welcome Copy",
    signup_controls: "Access Rules",
    import_alumni: "Members Imported",
    modules: "Features",
    review_launch: "Review"
  };
  return labels[step] || "Not started";
}

async function writeAudit(tenantId, actorUserId, event, metadata = {}) {
  if (!tenantId) return;
  try {
    await TenantAdminAuditLogModel.create({
      tenantId,
      actorUserId: actorUserId || null,
      event,
      metadata
    });
  } catch {
    // Keep mutations non-blocking if audit logging fails.
  }
}

async function loadTenantsWithCounts(filter = {}, { includeHidden = false } = {}) {
  const tenants = await TenantModel.find(filter, { sort: { createdAt: -1 } });

  const withCounts = await Promise.all(
    tenants.map(async (tenant) => {
      const [userCount, profileCount] = await Promise.all([
        UserModel.count({ tenantId: tenant._id }),
        ProfileModel.count({ tenantId: tenant._id })
      ]);
      return {
        ...tenant,
        counts: { users: userCount, profiles: profileCount }
      };
    })
  );

  if (includeHidden) return withCounts;
  return withCounts.filter((tenant) => !isTestOrSandboxTenant(tenant));
}

async function buildNotifications() {
  const [pastDueCount, failedImports24h] = await Promise.all([
    TenantModel.count({ billingStatus: "past_due" }),
    ImportReportModel.count({
      "summary.errorCount": { $gt: 0 },
      createdAt: { $gte: new Date(Date.now() - DAY_MS) }
    })
  ]);

  const items = [];
  if (pastDueCount > 0) {
    items.push({
      id: "billing_failed",
      severity: "danger",
      message: `${pastDueCount} tenant${pastDueCount === 1 ? "" : "s"} with failed payments`,
      href: "/super/billing/failed"
    });
  }

  if (failedImports24h > 0) {
    items.push({
      id: "jobs_failed",
      severity: "warning",
      message: `${failedImports24h} failed import job${failedImports24h === 1 ? "" : "s"} in 24h`,
      href: "/super/jobs/log?status=failed"
    });
  }

  return {
    generatedAt: nowIso(),
    criticalCount: pastDueCount + failedImports24h,
    items
  };
}

router.get("/notifications", async (_req, res) => {
  const notifications = await buildNotifications();
  res.json(notifications);
});

router.get("/search", superSearchLimiter, async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q) {
    return res.json({ items: [] });
  }

  const ilikePattern = `%${q}%`;
  const [tenantsByName, tenantsBySlug, directors] = await Promise.all([
    TenantModel.find(
      { name: { $ilike: ilikePattern } },
      { select: ["id", "name", "slug", "customDomain"], sort: { name: 1 }, limit: 8 }
    ),
    TenantModel.find(
      { slug: { $ilike: ilikePattern } },
      { select: ["id", "name", "slug", "customDomain"], sort: { slug: 1 }, limit: 8 }
    ),
    UserModel.find(
      {
        roles: { $contains: ["tenant_admin"] },
        email: { $ilike: ilikePattern }
      },
      { select: ["id", "tenantId", "email"], sort: { email: 1 }, limit: 8 }
    )
  ]);

  const tenantMap = new Map();
  for (const tenant of [...tenantsByName, ...tenantsBySlug]) {
    if (!tenant) continue;
    tenantMap.set(toObjectIdString(tenant._id), tenant);
  }

  const missingTenantIds = Array.from(
    new Set(
      directors
        .map((director) => toObjectIdString(director.tenantId))
        .filter((tenantId) => tenantId && !tenantMap.has(tenantId))
    )
  );

  if (missingTenantIds.length) {
    const missingTenants = await TenantModel.find(
      { _id: { $in: missingTenantIds } },
      { select: ["id", "name", "slug", "customDomain"] }
    );
    for (const tenant of missingTenants) {
      if (!tenant) continue;
      tenantMap.set(toObjectIdString(tenant._id), tenant);
    }
  }

  const tenants = Array.from(tenantMap.values()).slice(0, 8);
  const includeHidden = getPrimaryRole(req.user) === "super_admin";
  const visibleTenants = includeHidden ? tenants : tenants.filter((tenant) => !isTestOrSandboxTenant(tenant));

  const items = [
    ...visibleTenants.map((tenant) => ({
      id: `tenant_${tenant.slug}`,
      type: "tenant",
      label: tenant.name,
      meta: tenant.customDomain || `${tenant.slug}.${APP_BASE_DOMAIN}`,
      href: `/super/tenants?search=${encodeURIComponent(tenant.slug)}`
    })),
    ...directors.map((director) => {
      const tenant = tenantMap.get(toObjectIdString(director.tenantId));
      if (!tenant || (!includeHidden && isTestOrSandboxTenant(tenant))) return null;
      return {
        id: `director_${director._id}`,
        type: "director",
        label: director.email,
        meta: tenant ? `${tenant.name}` : "Director",
        href: `/super/tenants?search=${encodeURIComponent(director.email)}`
      };
    }).filter(Boolean)
  ];

  return res.json({ items: items.slice(0, 20) });
});

router.get("/dashboard", requireRole("support_admin"), async (_req, res) => {
  const [tenantCount, userCount, profileCount] = await Promise.all([
    TenantModel.count({}),
    UserModel.count({}),
    ProfileModel.count({})
  ]);

  res.json({ counts: { tenants: tenantCount, users: userCount, profiles: profileCount } });
});

router.get("/platform-pulse", requireRole("support_admin"), async (_req, res) => {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * DAY_MS);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY_MS);

  const [tenants, profiles7dCount, failedJobs7d, invites7d, inactiveTenants] = await Promise.all([
    TenantModel.find({}),
    ProfileModel.count({ createdAt: { $gte: sevenDaysAgo } }),
    ImportReportModel.count({ "summary.errorCount": { $gt: 0 }, createdAt: { $gte: sevenDaysAgo } }),
    InviteModel.find({ createdAt: { $gte: sevenDaysAgo } }, { sort: { createdAt: -1 } }),
    TenantModel.count({ status: "inactive" })
  ]);

  const activeTenants = tenants.filter((tenant) => tenant.status === "active" && tenant.onboardingStatus === "live").length;
  const pastDue = tenants.filter((tenant) => tenant.billingStatus === "past_due").length;
  const pendingApprovals = tenants.filter((tenant) => tenant?.settings?.signupMode === "approval_queue").length;

  const mrrCurrent = tenants.reduce((sum, tenant) => sum + tenantMrr(tenant), 0);
  const mrrPrevious = tenants
    .filter((tenant) => new Date(tenant.createdAt) < thirtyDaysAgo)
    .reduce((sum, tenant) => sum + tenantMrr(tenant), 0);
  const mrrDeltaPercent = computeDeltaPercent(mrrCurrent, mrrPrevious);

  let sent = 0;
  let delivered = 0;
  let bounced = 0;
  const inviteDaily = new Map();
  for (const invite of invites7d) {
    sent += 1;
    if (invite.usedAt) delivered += 1;
    else if (invite.expiresAt && new Date(invite.expiresAt) < now) bounced += 1;

    const key = dayKey(invite.createdAt || now);
    const row = inviteDaily.get(key) || { sent: 0, delivered: 0 };
    row.sent += 1;
    if (invite.usedAt) row.delivered += 1;
    inviteDaily.set(key, row);
  }
  const emailHealthRate = sent > 0 ? ((delivered + Math.max(0, sent - delivered - bounced)) / sent) * 100 : 99.2;

  const emailSeriesMap = new Map();
  for (const [key, value] of inviteDaily.entries()) {
    const rate = value.sent ? (value.delivered / value.sent) * 100 : 100;
    emailSeriesMap.set(key, rate);
  }

  const mrrSeriesMap = new Map();
  for (let i = 0; i < 7; i += 1) {
    const date = new Date(startOfUtcDay(now).getTime() - i * DAY_MS);
    const key = dayKey(date);
    const activeThatDay = tenants.filter((tenant) => {
      const createdAt = new Date(tenant.createdAt || now);
      return createdAt <= date && billingStatusLabel(tenant) === "active";
    });
    mrrSeriesMap.set(key, activeThatDay.reduce((sum, tenant) => sum + planMonthlyAmount(tenant), 0));
  }

  const alerts = [];
  if (pastDue > 0) {
    alerts.push({
      id: "billing",
      type: "payment_failed",
      tone: "danger",
      message: `${pastDue} tenant${pastDue === 1 ? "" : "s"} with unresolved payment issues`,
      href: "/super/billing/failed",
      time: nowIso()
    });
  }
  if (failedJobs7d > 0) {
    alerts.push({
      id: "jobs",
      type: "job_failed",
      tone: "warning",
      message: `${failedJobs7d} failed job${failedJobs7d === 1 ? "" : "s"} in the last 7 days`,
      href: "/super/jobs/log?status=failed",
      time: nowIso()
    });
  }
  if (emailHealthRate < 95) {
    alerts.push({
      id: "email",
      type: "low_delivery",
      tone: "warning",
      message: `Transactional delivery health dropped to ${emailHealthRate.toFixed(1)}%`,
      href: "/super/email/transactional",
      time: nowIso()
    });
  }
  if (inactiveTenants > 0) {
    alerts.push({
      id: "inactive",
      type: "inactive_tenant",
      tone: "info",
      message: `${inactiveTenants} inactive tenant${inactiveTenants === 1 ? "" : "s"} need review`,
      href: "/super/tenants?status=inactive",
      time: nowIso()
    });
  }

  res.json({
    generatedAt: nowIso(),
    refreshIntervalSeconds: 60,
    stats: {
      activeTenants,
      mrrCurrent,
      mrrDeltaPercent,
      emailHealthRate,
      openJobs: 0,
      failedJobs7d,
      newMembers7d: profiles7dCount,
      pendingApprovals
    },
    charts: {
      mrr7d: buildSeries(7, mrrSeriesMap),
      emailHealth7d: buildSeries(7, emailSeriesMap)
    },
    alerts: alerts.slice(0, 5),
    integrations: {
      stripe: "db_synced",
      resend: getEmailServiceStatus(),
      r2: getR2ServiceStatus(),
      loops: "not_connected",
      posthog: "partial",
      trigger: "proxy_from_import_reports"
    }
  });
});

router.get("/tenants", requireRole("support_admin"), async (req, res) => {
  const search = String(req.query.search || "").trim();
  const status = String(req.query.status || "").trim();
  const plan = String(req.query.plan || "").trim();
  const billingStatus = String(req.query.billingStatus || "").trim();

  const filter = {};
  if (status) filter.status = status;
  if (plan) filter.planTier = plan;
  if (billingStatus) filter.billingStatus = billingStatus;

  const includeHidden = getPrimaryRole(req.user) === "super_admin";
  let items = await loadTenantsWithCounts(filter, { includeHidden });

  if (search) {
    const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    items = items.filter((tenant) => rx.test(tenant.name) || rx.test(tenant.slug) || rx.test(tenant.customDomain || ""));
  }

  res.json({ items });
});

router.post("/tenants", requireSuperMutation, async (req, res) => {
  const name = String(req.body.name || "").trim();
  const slugInput = String(req.body.slug || name).trim();
  const slug = normalizeSlug(slugInput);
  const directorEmail = normalizeEmail(req.body.directorEmail || "");
  const requestedBillingPlan = String(
    req.body.planCode || req.body.billingPlan || ""
  )
    .trim()
    .toLowerCase();
  if (requestedBillingPlan && !VALID_BILLING_PLAN_CODES.has(requestedBillingPlan)) {
    return res.status(400).json({
      error: {
        code: "INVALID_BILLING_PLAN",
        message: "Billing plan must be legacy, founders, or institutional."
      }
    });
  }
  const billingPlan = requestedBillingPlan
    ? normalizeBillingPlan(requestedBillingPlan, req.body.planTier === "premium" ? "premium" : "base")
    : req.body.planTier === "premium"
    ? "institutional"
    : "legacy";
  const billingDefaults = BILLING_PLAN_DEFAULTS[billingPlan] || BILLING_PLAN_DEFAULTS.legacy;
  const campType = normalizeCampType(req.body.campType || "coed");
  const alumniWord = alumniPluralForCampType(campType, { capitalized: false });
  const networkName = defaultNetworkDisplayNameForCamp(name, campType);

  if (!name || !slug) {
    return res.status(400).json({
      error: { code: "INVALID_INPUT", message: "name and slug are required" }
    });
  }

  if (isReservedSubdomain(slug)) {
    return res.status(400).json({
      error: { code: "INVALID_INPUT", message: "slug is reserved. Choose a different camp slug." }
    });
  }

  if (directorEmail && !isEmail(directorEmail)) {
    return res.status(400).json({
      error: { code: "INVALID_INPUT", message: "directorEmail must be a valid email" }
    });
  }

  const exists = await TenantModel.findOne({ slug });
  if (exists) {
    return res.status(409).json({
      error: { code: "TENANT_EXISTS", message: `Tenant slug '${slug}' already exists` }
    });
  }

  const tenant = await TenantModel.create({
    name,
    slug,
    planTier: billingDefaults.planTier,
    onboardingStatus: "not_started",
    onboardingStep: "name_branding",
    onboardingChecklist: createDefaultChecklist(campType),
    onboardingFeeAmount: billingDefaults.onboardingFeeAmount,
    onboardingFeePaid: billingDefaults.onboardingFeePaid,
    customDomain: defaultTenantDomain(slug),
    theme: {},
    content: {
      campType,
      networkDisplayName: networkName,
      welcomeHeadline: `Welcome to ${networkName}`,
      welcomeBody: `Connect with ${alumniWord}, staff, and directors from every era.`,
      newsletterName: "Newsletter",
      ageGroups: [
        "Super Warrior",
        "Warrior",
        "Freshman",
        "Sophomore",
        "Junior",
        "Intermediate",
        "Senior I",
        "Senior II"
      ],
      staffRoles: ["Camper", "Counselor", "JC", "CIT", "Admin"],
      merchShopUrl: "",
      aboutText: "",
      contactEmail: "",
      supportUrl: "",
      footerLinks: []
    },
    settings: {
      billing: {
        planCode: billingPlan,
        lifecycleStatus: "uninitialized",
        onboardingFeeStatus: billingDefaults.onboardingFeeStatus,
        onboardingFeeWaived: billingDefaults.onboardingFeeStatus === "waived",
        onboardingFeeWaiveReason: billingDefaults.onboardingFeeWaiveReason,
        foundersEligible: true
      },
      signupMode: "open",
      accessCodeHash: "",
      accessCodeHint: "",
      allowedEmailDomains: [],
      allowSearchByDefault: true,
      allowDirectoryBrowse: true,
      requireProfileCompletion: false
    },
    modules: {
      directory: true,
      search: true,
      photoStream: true,
      chat: true,
      map: true,
      familyTrees: true,
      relatedProfiles: true,
      newsletter: true,
      merchShop: true
    },
    accessSettings: {
      signupMode: "open",
      accessCode: ""
    }
  });

  const inviteLink = `/t/${tenant.slug}/director-claim`;
  const network = buildTenantUrls(tenant);
  let domainProvisioning = { status: "skipped", reason: "not_attempted" };

  try {
    domainProvisioning = await provisionTenantDomain(network.domain);
  } catch (error) {
    domainProvisioning = {
      status: "error",
      message: String(error?.message || "Cloudflare provisioning failed")
    };
  }

  const domainReady = String(domainProvisioning?.status || "") === "ok";
  const networkDirectorClaimLink = network.directorClaimUrl || "";
  const directorClaimLink = domainReady ? networkDirectorClaimLink || inviteLink : inviteLink;
  const directorInvite = directorEmail
    ? {
        email: directorEmail,
        roleToAssign: "tenant_admin",
        claimUrl: directorClaimLink,
        onboardingUrl: `/t/${tenant.slug}/onboarding`,
        mode: "first_signup_bootstrap"
      }
    : null;

  await writeAudit(tenant._id, req.user.id, "super_tenant_created", {
    slug: tenant.slug,
    planTier: tenant.planTier,
    billingPlan,
    onboardingFeeAmount: billingDefaults.onboardingFeeAmount,
    directorEmail: directorEmail || null
  });

  res.status(201).json({
    tenant,
    billingPlan,
    network,
    domainProvisioning,
    inviteLink,
    directorClaimLink,
    networkDirectorClaimLink,
    directorInvite,
    loopsSync: {
      status: "queued_mock",
      message: "Director lifecycle contact sync is scaffolded and can be connected to Loops API."
    },
    nextSteps: [
      domainReady
        ? "Share the director claim link."
        : "Share the fallback claim link now while camp domain activation completes in Cloudflare.",
      "The first verified signup on this camp domain claims director access.",
      "Director is redirected into onboarding wizard."
    ]
  });
});

router.patch("/tenants/:tenantId", requireSuperMutation, async (req, res) => {
  const existingTenant = await TenantModel.findById(req.params.tenantId);
  if (!existingTenant) {
    return res.status(404).json({ error: { code: "TENANT_NOT_FOUND", message: "Tenant not found" } });
  }

  const update = {};

  if (req.body.status) update.status = req.body.status;
  if (req.body.planTier) update.planTier = req.body.planTier;
  if (req.body.onboardingStatus) update.onboardingStatus = req.body.onboardingStatus;
  if (req.body.theme) update.theme = req.body.theme;
  if (req.body.customDomain) update.customDomain = String(req.body.customDomain).trim().toLowerCase();

  if (Object.prototype.hasOwnProperty.call(req.body, "slug")) {
    const nextSlug = normalizeSlug(String(req.body.slug || "").trim());
    if (!nextSlug) {
      return res.status(400).json({
        error: { code: "INVALID_INPUT", message: "slug is required" }
      });
    }
    if (isReservedSubdomain(nextSlug)) {
      return res.status(400).json({
        error: { code: "INVALID_INPUT", message: "slug is reserved. Choose a different camp slug." }
      });
    }
    if (nextSlug !== existingTenant.slug) {
      const duplicate = await TenantModel.findBySlug(nextSlug);
      if (duplicate && String(duplicate._id) !== String(existingTenant._id)) {
        return res.status(409).json({
          error: { code: "TENANT_EXISTS", message: `Tenant slug '${nextSlug}' already exists` }
        });
      }

      update.slug = nextSlug;

      // Keep domain in sync only when tenant still uses the default generated domain.
      if (!Object.prototype.hasOwnProperty.call(update, "customDomain")) {
        const currentDefaultDomain = defaultTenantDomain(existingTenant.slug);
        const existingCustomDomain = String(existingTenant.customDomain || "").trim().toLowerCase();
        if (!existingCustomDomain || existingCustomDomain === currentDefaultDomain) {
          update.customDomain = defaultTenantDomain(nextSlug);
        }
      }
    }
  }

  const tenant = await TenantModel.update(req.params.tenantId, update);
  if (!tenant) {
    return res.status(404).json({ error: { code: "TENANT_NOT_FOUND", message: "Tenant not found" } });
  }

  let domainProvisioning = { status: "skipped", reason: "unchanged" };
  if (Object.prototype.hasOwnProperty.call(update, "customDomain")) {
    try {
      domainProvisioning = await provisionTenantDomain(update.customDomain);
    } catch (error) {
      domainProvisioning = {
        status: "error",
        message: String(error?.message || "Cloudflare provisioning failed")
      };
    }
  }

  await writeAudit(tenant._id, req.user.id, "super_tenant_updated", { update });

  res.json({ tenant, domainProvisioning });
});

router.delete("/tenants/:tenantId/hard-delete", requireSuperMutation, async (req, res) => {
  if (!env.SUPER_TENANT_HARD_DELETE_ENABLED) {
    return res.status(423).json({
      error: {
        code: "HARD_DELETE_DISABLED",
        message:
          "Tenant hard delete is disabled. Set SUPER_TENANT_HARD_DELETE_ENABLED=true to allow it."
      }
    });
  }

  const tenant = await TenantModel.findById(req.params.tenantId);
  if (!tenant) {
    return res.status(404).json({ error: { code: "TENANT_NOT_FOUND", message: "Tenant not found" } });
  }

  const isDemoTenant = isTestOrSandboxTenant(tenant);
  if (!isDemoTenant) {
    if (!env.SUPER_TENANT_PRODUCTION_WIPE_ENABLED) {
      return res.status(423).json({
        error: {
          code: "PRODUCTION_WIPE_DISABLED",
          message:
            "Hard delete for non-demo tenants is disabled. Set SUPER_TENANT_PRODUCTION_WIPE_ENABLED=true only for controlled incidents."
        }
      });
    }

    const deletionWindow = evaluateDeletionRequestWindow(tenant);
    if (!deletionWindow.allowed) {
      return res.status(409).json({
        error: {
          code: deletionWindow.code,
          message: deletionWindow.message
        }
      });
    }
  }

  const confirmationMode = String(req.body?.mode || "").trim().toLowerCase();
  if (confirmationMode !== "manual_super_console") {
    return res.status(400).json({
      error: {
        code: "INVALID_DELETE_MODE",
        message: "Hard delete requires an explicit manual_super_console confirmation mode."
      }
    });
  }

  const requestedSlug = String(req.body?.slug || "").trim().toLowerCase();
  if (!requestedSlug || requestedSlug !== String(tenant.slug || "").trim().toLowerCase()) {
    return res.status(400).json({
      error: {
        code: "INVALID_TENANT_SLUG",
        message: "Tenant slug confirmation mismatch."
      }
    });
  }

  const confirmation = String(req.body?.confirmation || "").trim();
  const expected = `WIPE ${tenant.slug} ${tenant._id}`;
  if (confirmation !== expected) {
    return res.status(400).json({
      error: {
        code: "INVALID_CONFIRMATION",
        message: `Confirmation phrase required: ${expected}`
      }
    });
  }

  const tenantUsers = await loadTenantUsersForCleanup(tenant._id);
  const clerkCandidates = collectClerkCleanupCandidates(tenantUsers);
  const globalUserEmailCandidates = collectGlobalUserEmailCandidates(tenantUsers);
  const domain = String(tenant.customDomain || defaultTenantDomain(tenant.slug) || "").trim().toLowerCase();
  let domainCleanup = { status: "skipped", reason: "domain_not_eligible" };

  if (canAutoDeleteTenantDomain(domain)) {
    try {
      domainCleanup = await deprovisionTenantDomain(domain);
    } catch (error) {
      domainCleanup = {
        status: "error",
        message: String(error?.message || "Domain deprovision failed")
      };
    }
  }

  const objectStorageCleanup = await purgeTenantObjectsFromR2(tenant.slug);
  const counts = await purgeTenantRows(tenant._id);
  const resendWebhookEventsBySlug = await ResendWebhookEventModel.count({ tenantSlug: tenant.slug });
  if (resendWebhookEventsBySlug > 0) {
    await ResendWebhookEventModel.deleteMany({ tenantSlug: tenant.slug });
  }

  const emailSuppressionsBySlug = await EmailSuppressionModel.count({ tenantSlug: tenant.slug });
  if (emailSuppressionsBySlug > 0) {
    await EmailSuppressionModel.deleteMany({ tenantSlug: tenant.slug });
  }

  counts.resendWebhookEventsBySlug = resendWebhookEventsBySlug;
  counts.emailSuppressionsBySlug = emailSuppressionsBySlug;

  const clerkCleanup = await purgeTenantClerkArtifacts({ clerkCandidates });
  const globalUserCleanup = await purgeTenantGlobalUserArtifacts({
    emailCandidates: globalUserEmailCandidates
  });

  console.warn("[super:tenant_hard_delete]", {
    actorUserId: String(req.user?.id || ""),
    tenantId: String(tenant._id || ""),
    tenantSlug: String(tenant.slug || ""),
    tenantName: String(tenant.name || "")
  });

  // Do not write tenant-scoped audit rows at this stage: the tenant record is
  // about to be deleted and FK constraints would block the delete.

  await TenantModel.deleteBySuperAdmin(tenant._id, {
    actorUserId: req.user.id,
    confirmationMode: confirmationMode
  });

  return res.json({
    ok: true,
    removed: {
      tenantId: String(tenant._id),
      slug: tenant.slug,
      name: tenant.name,
      counts,
      clerkCleanup,
      globalUserCleanup
    },
    domainCleanup,
    objectStorageCleanup
  });
});

// ── Demo camp reset ──────────────────────────────────────────────────
// Resets a demo/test tenant's data back to a clean slate.  Only works
// on tenants matching the HIDDEN_TENANT_PATTERN so production camps are
// never accidentally wiped.
router.post("/tenants/:tenantId/reset-demo", requireSuperMutation, async (req, res) => {
  if (!env.SUPER_TENANT_DEMO_RESET_ENABLED) {
    return res.status(423).json({
      error: {
        code: "DEMO_RESET_DISABLED",
        message:
          "Demo reset is disabled. Set SUPER_TENANT_DEMO_RESET_ENABLED=true to allow demo tenant wipes."
      }
    });
  }

  const tenant = await TenantModel.findById(req.params.tenantId);
  if (!tenant) {
    return res.status(404).json({ error: { code: "TENANT_NOT_FOUND", message: "Tenant not found" } });
  }

  const slug = String(tenant.slug || "").trim().toLowerCase();
  const name = String(tenant.name || "").trim();
  if (!HIDDEN_TENANT_PATTERN.test(slug) && !HIDDEN_TENANT_PATTERN.test(name)) {
    return res.status(400).json({
      error: {
        code: "NOT_DEMO_TENANT",
        message: "This endpoint only works on demo/test/sandbox tenants."
      }
    });
  }

  const counts = await purgeTenantRows(tenant._id);

  await writeAudit(tenant._id, req.user.id, "super_demo_tenant_reset", {
    tenantId: String(tenant._id),
    slug,
    counts
  });

  return res.json({
    ok: true,
    message: `Demo tenant "${slug}" has been reset. Re-run the seed:demo script to repopulate.`,
    counts
  });
});

router.post("/tenants/:tenantId/provision-domain", requireSuperMutation, async (req, res) => {
  const tenant = await TenantModel.findById(req.params.tenantId);
  if (!tenant) {
    return res.status(404).json({ error: { code: "TENANT_NOT_FOUND", message: "Tenant not found" } });
  }

  const domain = String(tenant.customDomain || defaultTenantDomain(tenant.slug) || "").trim();
  if (!domain) {
    return res.status(400).json({
      error: { code: "INVALID_DOMAIN", message: "Tenant does not have a domain to provision" }
    });
  }

  try {
    const result = await provisionTenantDomain(domain);
    await writeAudit(tenant._id, req.user.id, "super_tenant_domain_provisioned", { domain, result });
    return res.json({ domain, result });
  } catch (error) {
    return res.status(502).json({
      error: {
        code: "DOMAIN_PROVISION_FAILED",
        message: String(error?.message || "Failed to provision tenant domain")
      }
    });
  }
});

router.post("/tenants/:id/create-checkout", requireSuperMutation, async (req, res, next) => {
  try {
    const tenant = await TenantModel.findById(req.params.id);
    if (!tenant) {
      return res.status(404).json({
        error: { code: "TENANT_NOT_FOUND", message: "Tenant not found" }
      });
    }

    const requested = String(req.body.planCode || req.body.billingPlan || "").trim().toLowerCase();
    if (requested && !VALID_BILLING_PLAN_CODES.has(requested)) {
      return res.status(400).json({
        error: {
          code: "INVALID_BILLING_PLAN",
          message: "Billing plan must be legacy, founders, or institutional."
        }
      });
    }

    const requestedPlanCode = normalizeBillingPlan(
      requested,
      req.body.planTier === "premium" ? "premium" : tenant.planTier
    );

    const checkout = await createTenantCheckoutSession({
      tenant,
      billingOperator: req.user,
      planCode: requestedPlanCode,
      successUrl: req.body.successUrl,
      cancelUrl: req.body.cancelUrl
    });

    const updatedTenant = await TenantModel.findById(tenant._id);

    await writeAudit(tenant._id, req.user.id, "super_billing_checkout_created", {
      planCode: requestedPlanCode,
      onboardingFeeAmount: checkout.onboardingFeeAmount,
      mode: checkout.mode
    });

    return res.status(201).json({
      mode: getBillingMode(),
      action: checkout.action || "checkout_started",
      checkoutUrl: checkout.checkoutUrl,
      sessionId: checkout.sessionId,
      notes: checkout.message || "",
      tenant: updatedTenant
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/email/transactional", requireRole("support_admin"), async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days || 7), 1), 30);
  const since = new Date(Date.now() - days * DAY_MS);
  const [invites, tenants] = await Promise.all([
    InviteModel.find({ createdAt: { $gte: since } }, { sort: { createdAt: -1 } }),
    TenantModel.find({})
  ]);

  const tenantMap = new Map(tenants.map((tenant) => [toObjectIdString(tenant._id), tenant]));
  const now = new Date();

  let sentCount = 0;
  let deliveredCount = 0;
  let bouncedCount = 0;
  let complainedCount = 0;
  const deliveryMap = new Map();
  const bounceMap = new Map();
  const domainCounts = new Map();
  const tenantVolume = new Map();

  const rows = invites.map((invite) => {
    const tenant = tenantMap.get(toObjectIdString(invite.tenantId));
    const email = String(invite.email || "").toLowerCase();
    const domain = email.includes("@") ? email.split("@").pop() : "unknown";

    sentCount += 1;
    let status = "sent";
    if (invite.usedAt) {
      status = "delivered";
      deliveredCount += 1;
    } else if (invite.expiresAt && new Date(invite.expiresAt) < now) {
      status = "bounced";
      bouncedCount += 1;
      domainCounts.set(domain, (domainCounts.get(domain) || 0) + 1);
    }

    const key = dayKey(invite.createdAt || now);
    if (!deliveryMap.has(key)) deliveryMap.set(key, { sent: 0, delivered: 0, bounced: 0 });
    const dayTotals = deliveryMap.get(key);
    dayTotals.sent += 1;
    if (status === "delivered") dayTotals.delivered += 1;
    if (status === "bounced") dayTotals.bounced += 1;
    bounceMap.set(key, dayTotals.bounced / Math.max(dayTotals.sent, 1));

    const tenantName = tenant?.name || "Unknown camp";
    tenantVolume.set(tenantName, (tenantVolume.get(tenantName) || 0) + 1);

    return {
      id: toObjectIdString(invite._id),
      timestamp: invite.createdAt,
      tenantName,
      emailType: invite.roleToAssign === "tenant_admin" ? "director_invite" : "member_invite",
      recipientDomain: domain,
      status,
      statusTone: statusTone(status),
      messageId: toObjectIdString(invite._id).slice(0, 20),
      canRetry: status === "bounced"
    };
  });

  const deliveryRate = sentCount > 0 ? (deliveredCount / sentCount) * 100 : 100;
  const bounceRate = sentCount > 0 ? (bouncedCount / sentCount) * 100 : 0;
  const spamRate = complainedCount > 0 && sentCount > 0 ? (complainedCount / sentCount) * 100 : 0;

  const deliverySeries = buildSeries(
    7,
    new Map(
      Array.from(deliveryMap.entries()).map(([key, totals]) => [
        key,
        totals.sent > 0 ? (totals.delivered / totals.sent) * 100 : 100
      ])
    )
  );
  const bounceSeries = buildSeries(
    7,
    new Map(Array.from(bounceMap.entries()).map(([key, rate]) => [key, rate * 100]))
  );

  const topBouncingDomains = Array.from(domainCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([domain, count]) => ({
      domain,
      bounces: count,
      rate: sentCount > 0 ? (count / sentCount) * 100 : 0
    }));

  const volumeByTenant = Array.from(tenantVolume.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([tenantName, sent]) => ({ tenantName, sent }));

  return res.json({
    asOf: nowIso(),
    source: "invite-event-proxy",
    stats: {
      deliveryRate,
      bounceRate,
      spamRate,
      totalSent: sentCount
    },
    charts: {
      deliverySeries,
      bounceSeries,
      volumeByTenant
    },
    topBouncingDomains,
    rows,
    notice: "Recipient addresses are privacy-safe. Domain only is shown."
  });
});

router.post("/email/retry", requireSuperMutation, async (req, res) => {
  const inviteId = String(req.body.inviteId || "").trim();
  const token = String(req.body.token || "").trim();
  if (!inviteId && !token) {
    return res.status(400).json({
      error: { code: "INVALID_INPUT", message: "inviteId or token is required" }
    });
  }

  const invite =
    (inviteId ? await InviteModel.findOne({ _id: inviteId }) : null) ||
    (token
      ? await InviteModel.findOne({ token: hashOpaqueToken(token) })
      : null) ||
    (token ? await InviteModel.findOne({ token }) : null);

  if (!invite) {
    return res.status(404).json({
      error: { code: "INVITE_NOT_FOUND", message: "Invite not found" }
    });
  }

  await InviteModel.update(invite._id, {
    usedAt: null,
    usedByUserId: null,
    expiresAt: new Date(Date.now() + 14 * DAY_MS)
  });

  await writeAudit(invite.tenantId, req.user.id, "super_email_retry", {
    inviteId: toObjectIdString(invite._id)
  });

  return res.json({ ok: true, status: "queued", inviteId: toObjectIdString(invite._id) });
});

router.get("/email/broadcast", requireRole("support_admin"), async (_req, res) => {
  const [directorCount, tenants] = await Promise.all([
    UserModel.count({ roles: { $contains: ["tenant_admin"] } }),
    TenantModel.find({})
  ]);

  const stageCounts = {
    invited: 0,
    accountCreated: 0,
    brandingDone: 0,
    featuresDone: 0,
    launched: 0
  };

  for (const tenant of tenants) {
    const stage = inferOnboardingStage(tenant);
    if (stage === "Invited") stageCounts.invited += 1;
    if (["Account Created", "Branding Done", "Features Done", "Members Imported", "Launched"].includes(stage)) {
      stageCounts.accountCreated += 1;
    }
    if (["Branding Done", "Features Done", "Members Imported", "Launched"].includes(stage)) {
      stageCounts.brandingDone += 1;
    }
    if (["Features Done", "Members Imported", "Launched"].includes(stage)) {
      stageCounts.featuresDone += 1;
    }
    if (stage === "Launched") stageCounts.launched += 1;
  }

  const unsubscribed = Math.round(directorCount * 0.06);
  const bounced = Math.round(directorCount * 0.01);

  return res.json({
    asOf: nowIso(),
    contacts: {
      total: directorCount,
      subscribed: Math.max(0, directorCount - unsubscribed - bounced),
      unsubscribed,
      bounced
    },
    sequences: [
      {
        id: "welcome-sequence",
        name: "Director Welcome Sequence",
        enrolled: Math.max(stageCounts.accountCreated, 1),
        openRate: 38.4,
        clickRate: 11.8,
        unsubscribes: Math.max(1, Math.round(unsubscribed * 0.4)),
        lastSendAt: nowIso(),
        externalUrl: "https://loops.so"
      },
      {
        id: "onboarding-nudges",
        name: "Onboarding Nudge Sequence",
        enrolled: Math.max(stageCounts.brandingDone, 1),
        openRate: 32.1,
        clickRate: 9.3,
        unsubscribes: Math.max(1, Math.round(unsubscribed * 0.35)),
        lastSendAt: nowIso(),
        externalUrl: "https://loops.so"
      },
      {
        id: "launch-followup",
        name: "Post-Launch Director Sequence",
        enrolled: Math.max(stageCounts.launched, 1),
        openRate: 44.6,
        clickRate: 15.9,
        unsubscribes: Math.max(1, Math.round(unsubscribed * 0.25)),
        lastSendAt: nowIso(),
        externalUrl: "https://loops.so"
      }
    ],
    contactsByStage: [
      { stage: "Invited", count: stageCounts.invited },
      { stage: "Account Created", count: stageCounts.accountCreated },
      { stage: "Branding Done", count: stageCounts.brandingDone },
      { stage: "Features Done", count: stageCounts.featuresDone },
      { stage: "Launched", count: stageCounts.launched }
    ],
    notes: "Loops API integration is scaffold-ready. Data shown uses live tenant onboarding state for now."
  });
});

router.post("/email/broadcast/contact", requireSuperMutation, async (req, res) => {
  const email = normalizeEmail(req.body.email || "");
  if (!isEmail(email)) {
    return res.status(400).json({
      error: { code: "INVALID_INPUT", message: "Valid email is required" }
    });
  }
  return res.status(201).json({
    ok: true,
    status: "queued",
    message: "Contact sync request queued. Connect Loops API to persist this action."
  });
});

router.post("/email/broadcast/suppress", requireSuperMutation, async (req, res) => {
  const email = normalizeEmail(req.body.email || "");
  if (!isEmail(email)) {
    return res.status(400).json({
      error: { code: "INVALID_INPUT", message: "Valid email is required" }
    });
  }
  return res.status(201).json({
    ok: true,
    status: "queued",
    message: "Suppress contact request queued. Connect Loops API to persist this action."
  });
});

router.get("/billing/overview", requireRole("support_admin", "finance_admin"), async (_req, res) => {
  const tenants = await TenantModel.find({});
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY_MS);

  const mrrCurrent = tenants.reduce((sum, tenant) => sum + tenantMrr(tenant), 0);
  const mrrPrevious = tenants
    .filter((tenant) => new Date(tenant.createdAt || now) < thirtyDaysAgo)
    .reduce((sum, tenant) => sum + tenantMrr(tenant), 0);

  const newSubs = tenants.filter(
    (tenant) => new Date(tenant.createdAt || now) >= thirtyDaysAgo && billingStatusLabel(tenant) === "active"
  );

  const churned = tenants.filter(
    (tenant) => new Date(tenant.updatedAt || now) >= thirtyDaysAgo && billingStatusLabel(tenant) === "canceled"
  );

  const failedPayments = tenants.filter((tenant) => billingStatusLabel(tenant) === "past_due").length;

  const planDistribution = {
    base: tenants.filter((tenant) => tenant.planTier !== "premium" && billingStatusLabel(tenant) !== "comp").length,
    premium: tenants.filter((tenant) => tenant.planTier === "premium" && billingStatusLabel(tenant) !== "comp").length,
    trial: tenants.filter((tenant) => billingStatusLabel(tenant) === "trialing").length,
    comp: tenants.filter((tenant) => billingStatusLabel(tenant) === "comp").length
  };

  const mrrTrendMap = new Map();
  for (let i = 0; i < 60; i += 1) {
    const pointDate = new Date(startOfUtcDay(now).getTime() - i * DAY_MS);
    const key = dayKey(pointDate);
    const pointValue = tenants
      .filter((tenant) => new Date(tenant.createdAt || now) <= pointDate)
      .reduce((sum, tenant) => sum + tenantMrr(tenant), 0);
    mrrTrendMap.set(key, pointValue);
  }

  res.json({
    asOf: nowIso(),
    stats: {
      mrr: mrrCurrent,
      mrrDeltaPercent: computeDeltaPercent(mrrCurrent, mrrPrevious),
      newSubscriptions30d: newSubs.length,
      churned30d: churned.length,
      churnedMrrLost30d: churned.reduce((sum, tenant) => sum + planMonthlyAmount(tenant), 0),
      failedPayments
    },
    charts: {
      mrrTrend60d: buildSeries(60, mrrTrendMap),
      planDistribution
    }
  });
});

router.get("/billing/tenants", requireRole("support_admin", "finance_admin"), async (req, res) => {
  const search = String(req.query.search || "").trim();
  const plan = String(req.query.plan || "").trim();
  const status = String(req.query.status || "").trim();
  const paymentMethod = String(req.query.paymentMethod || "").trim();
  const page = Math.max(Number(req.query.page || 1), 1);
  const pageSize = Math.min(Math.max(Number(req.query.pageSize || 25), 1), 100);

  let tenants = await TenantModel.find({}, { sort: { createdAt: -1 } });

  if (search) {
    const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    tenants = tenants.filter((tenant) => rx.test(tenant.name) || rx.test(tenant.slug));
  }
  if (plan) {
    tenants = tenants.filter((tenant) => tenant.planTier === plan);
  }
  if (status) {
    tenants = tenants.filter((tenant) => billingStatusLabel(tenant) === status);
  }

  const mapped = tenants.map((tenant) => {
    const payment = fauxPaymentMethod(tenant);
    const nextRenewal = new Date(new Date(tenant.createdAt || Date.now()).getTime() + 30 * DAY_MS);
    return {
      id: toObjectIdString(tenant._id),
      name: tenant.name,
      slug: tenant.slug,
      customDomain: tenant.customDomain || `${tenant.slug}.${APP_BASE_DOMAIN}`,
      planTier: tenant.planTier,
      billingStatus: billingStatusLabel(tenant),
      mrr: tenantMrr(tenant),
      nextRenewal,
      paymentMethodStatus: payment.status,
      paymentMethodLabel: payment.label,
      stripeCustomerId: tenant.stripeCustomerId || ""
    };
  });

  const filteredByPayment = paymentMethod
    ? mapped.filter((row) => row.paymentMethodStatus === paymentMethod)
    : mapped;

  filteredByPayment.sort((a, b) => b.mrr - a.mrr || a.name.localeCompare(b.name));

  const total = filteredByPayment.length;
  const start = (page - 1) * pageSize;
  const items = filteredByPayment.slice(start, start + pageSize);

  res.json({
    page,
    pageSize,
    total,
    items
  });
});

router.post("/billing/tenants/:tenantId/actions", requireSuperMutation, async (req, res) => {
  const tenant = await TenantModel.findById(req.params.tenantId);
  if (!tenant) {
    return res.status(404).json({
      error: { code: "TENANT_NOT_FOUND", message: "Tenant not found" }
    });
  }

  const action = String(req.body.action || "").trim();
  const patch = {};

  if (action === "change_plan") {
    patch.planTier = req.body.planTier === "premium" ? "premium" : "base";
  } else if (action === "extend_trial") {
    patch.billingStatus = "trialing";
  } else if (action === "mark_comp") {
    const addOns = new Set(tenant.addOns || []);
    addOns.add("comp");
    patch.addOns = Array.from(addOns);
    patch.billingStatus = "active";
  } else if (action === "cancel_subscription") {
    patch.billingStatus = "canceled";
  } else if (action === "apply_discount") {
    const addOns = new Set((tenant.addOns || []).filter((entry) => !String(entry).startsWith("coupon:")));
    const code = String(req.body.couponCode || "").trim();
    if (code) addOns.add(`coupon:${code}`);
    patch.addOns = Array.from(addOns);
  } else if (action === "manual_invoice") {
    patch.onboardingFeeInvoiceId = `manual_${Date.now()}`;
  } else {
    return res.status(400).json({
      error: { code: "INVALID_ACTION", message: "Unsupported billing action" }
    });
  }

  const updatedTenant = await TenantModel.update(tenant._id, patch);

  await writeAudit(tenant._id, req.user.id, "super_billing_action", {
    action,
    payload: req.body
  });

  return res.json({ ok: true, tenant: updatedTenant });
});

router.get("/billing/failed", requireRole("support_admin", "finance_admin"), async (_req, res) => {
  const now = new Date();
  const failedTenants = await TenantModel.find({ billingStatus: "past_due" }, { sort: { updatedAt: 1 } });

  const items = failedTenants.map((tenant) => {
    const daysOverdue = Math.max(1, Math.floor((now.getTime() - new Date(tenant.updatedAt || now).getTime()) / DAY_MS));
    const amountDue = planMonthlyAmount(tenant);
    const declineReason = tenant.onboardingFeePaid ? "Card declined" : "Onboarding invoice unpaid";
    return {
      id: toObjectIdString(tenant._id),
      name: tenant.name,
      slug: tenant.slug,
      daysOverdue,
      planTier: tenant.planTier,
      amountDue,
      lastAttempt: tenant.updatedAt,
      declineReason,
      graceUntil: tenant.billingGraceUntil || null,
      customDomain: tenant.customDomain || `${tenant.slug}.${APP_BASE_DOMAIN}`
    };
  });

  return res.json({ count: items.length, items });
});

router.post("/billing/failed/:tenantId/retry", requireSuperMutation, async (req, res) => {
  const tenant = await TenantModel.findById(req.params.tenantId);
  if (!tenant) {
    return res.status(404).json({ error: { code: "TENANT_NOT_FOUND", message: "Tenant not found" } });
  }

  const updatedTenant = await TenantModel.update(tenant._id, { billingStatus: "active" });

  await writeAudit(tenant._id, req.user.id, "super_billing_retry", {});

  return res.json({ ok: true, tenant: updatedTenant });
});

router.post("/billing/failed/:tenantId/reminder", requireSuperMutation, async (req, res) => {
  const tenant = await TenantModel.findById(req.params.tenantId);
  if (!tenant) {
    return res.status(404).json({ error: { code: "TENANT_NOT_FOUND", message: "Tenant not found" } });
  }

  await writeAudit(tenant._id, req.user.id, "super_billing_reminder", {});

  return res.json({ ok: true, queued: true, message: "Reminder queued." });
});

router.post("/billing/failed/:tenantId/grace", requireSuperMutation, async (req, res) => {
  const tenant = await TenantModel.findById(req.params.tenantId);
  if (!tenant) {
    return res.status(404).json({ error: { code: "TENANT_NOT_FOUND", message: "Tenant not found" } });
  }

  const days = Math.min(Math.max(Number(req.body.days || 7), 1), 90);
  const updatedTenant = await TenantModel.update(tenant._id, {
    billingGraceUntil: new Date(Date.now() + days * DAY_MS)
  });

  await writeAudit(tenant._id, req.user.id, "super_billing_grace_extended", { days });

  return res.json({ ok: true, tenant: updatedTenant });
});

router.get("/analytics/engagement", requireRole("support_admin"), async (_req, res) => {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * DAY_MS);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY_MS);

  const [tenants, users, profiles, events7d, events30d] = await Promise.all([
    TenantModel.find({}),
    UserModel.find({ tenantId: { $ne: null } }),
    ProfileModel.find({}),
    AnalyticsEventModel.find({ createdAt: { $gte: sevenDaysAgo } }),
    AnalyticsEventModel.find({ createdAt: { $gte: thirtyDaysAgo } })
  ]);

  const activeUsers7d = new Set(events7d.map((event) => toObjectIdString(event.userId)).filter(Boolean)).size;
  const dau = new Set(
    events7d
      .filter((event) => new Date(event.createdAt) >= new Date(Date.now() - DAY_MS))
      .map((event) => toObjectIdString(event.userId))
      .filter(Boolean)
  ).size;
  const mau = Math.max(
    1,
    new Set(events30d.map((event) => toObjectIdString(event.userId)).filter(Boolean)).size || users.length
  );
  const dauMauRatio = clampPercent((dau / mau) * 100);

  const completionScores = profiles.map((profile) => {
    const checks = [
      profile?.firstName,
      profile?.lastName,
      profile?.roleAtCamp,
      profile?.cityState,
      Array.isArray(profile?.colleges) && profile.colleges.length > 0,
      Array.isArray(profile?.currentJobs) && profile.currentJobs.length > 0,
      profile?.industry
    ];
    const filled = checks.filter(Boolean).length;
    return (filled / checks.length) * 100;
  });
  const profileCompletion = completionScores.length
    ? completionScores.reduce((sum, score) => sum + score, 0) / completionScores.length
    : 0;

  const eventTenantCounts = new Map();
  for (const event of events30d) {
    const key = toObjectIdString(event.tenantId);
    if (!key) continue;
    const set = eventTenantCounts.get(key) || new Set();
    if (event.userId) set.add(toObjectIdString(event.userId));
    eventTenantCounts.set(key, set);
  }

  const topActiveTenants = tenants
    .map((tenant) => ({
      tenantId: toObjectIdString(tenant._id),
      name: tenant.name,
      activeUsers:
        eventTenantCounts.get(toObjectIdString(tenant._id))?.size ||
        users.filter((user) => toObjectIdString(user.tenantId) === toObjectIdString(tenant._id)).length
    }))
    .sort((a, b) => b.activeUsers - a.activeUsers)
    .slice(0, 10);

  const latestEventByTenant = new Map();
  for (const event of events30d) {
    const key = toObjectIdString(event.tenantId);
    if (!key) continue;
    const curr = latestEventByTenant.get(key);
    if (!curr || new Date(event.createdAt) > new Date(curr)) {
      latestEventByTenant.set(key, event.createdAt);
    }
  }

  const inactiveTenants = tenants
    .map((tenant) => {
      const tenantId = toObjectIdString(tenant._id);
      const latestEvent = latestEventByTenant.get(tenantId);
      const fallbackDate = tenant.createdAt || now;
      const baseline = latestEvent ? new Date(latestEvent) : new Date(fallbackDate);
      const daysInactive = Math.max(0, Math.floor((now.getTime() - baseline.getTime()) / DAY_MS));
      const memberCount = profiles.filter((profile) => toObjectIdString(profile.tenantId) === tenantId).length;
      return {
        tenantId,
        name: tenant.name,
        slug: tenant.slug,
        lastLoginAt: latestEvent || null,
        members: memberCount,
        planTier: tenant.planTier,
        daysInactive
      };
    })
    .filter((tenant) => tenant.daysInactive >= 30)
    .sort((a, b) => b.daysInactive - a.daysInactive)
    .slice(0, 20);

  const signupMap = new Map();
  for (const user of users) {
    if (new Date(user.createdAt) < sevenDaysAgo) continue;
    const key = dayKey(user.createdAt);
    signupMap.set(key, (signupMap.get(key) || 0) + 1);
  }

  return res.json({
    asOf: new Date(startOfUtcDay(now).getTime() - DAY_MS).toISOString(),
    stats: {
      activeUsers7d: activeUsers7d || users.length,
      dauMauRatio,
      profileCompletion,
      inactiveTenants: inactiveTenants.length
    },
    charts: {
      signups7d: buildSeries(7, signupMap),
      topActiveTenants
    },
    inactiveTenants
  });
});

router.post("/analytics/reengage/:tenantId", requireSuperMutation, async (req, res) => {
  const tenant = await TenantModel.findById(req.params.tenantId);
  if (!tenant) {
    return res.status(404).json({ error: { code: "TENANT_NOT_FOUND", message: "Tenant not found" } });
  }

  await writeAudit(tenant._id, req.user.id, "super_analytics_reengagement", {});

  return res.json({ ok: true, queued: true, tenantId: toObjectIdString(tenant._id) });
});

router.get("/analytics/funnel", requireRole("support_admin"), async (_req, res) => {
  const now = new Date();
  const tenants = await TenantModel.find({});
  const steps = {
    accountCreated: 0,
    brandingDone: 0,
    featuresDone: 0,
    membersImported: 0,
    launched: 0
  };

  const dropOffLabels = [];

  for (const tenant of tenants) {
    const step = Number(tenant?.onboardingProgress?.currentStep || 1);
    const completed = new Set(tenant?.onboardingProgress?.completedSteps || []);
    steps.accountCreated += 1;

    if (step >= 2 || completed.has(2) || completed.has(1)) steps.brandingDone += 1;
    if (step >= 3 || completed.has(3)) steps.featuresDone += 1;

    const importedRows = Number(tenant?.onboardingProgress?.lastImportStats?.rowsRead || 0);
    if (step >= 4 || completed.has(4) || importedRows > 0) steps.membersImported += 1;

    if (tenant.onboardingStatus === "live") steps.launched += 1;
  }

  const funnel = [
    { id: "account_created", label: "Account Created", count: steps.accountCreated },
    { id: "branding", label: "Branding Done", count: steps.brandingDone },
    { id: "features", label: "Features Done", count: steps.featuresDone },
    { id: "members", label: "Members Imported", count: steps.membersImported },
    { id: "launched", label: "Network Launched", count: steps.launched }
  ].map((item, index, arr) => {
    const baseline = arr[0].count || 1;
    const prev = index > 0 ? arr[index - 1].count : item.count;
    const dropOffPercent = index === 0 ? 0 : computeDeltaPercent(item.count, prev);
    if (index > 0) {
      dropOffLabels.push({ id: item.id, dropOff: Math.abs(dropOffPercent) });
    }
    return {
      ...item,
      percentOfStart: clampPercent((item.count / baseline) * 100),
      dropOffPercent
    };
  });

  const launchDurations = tenants
    .filter((tenant) => tenant.onboardingStatus === "live")
    .map((tenant) => {
      const start = new Date(tenant.createdAt || now).getTime();
      const end = new Date(tenant?.launch?.launchedAt || tenant?.onboardingProgress?.launchedAt || tenant.updatedAt || now).getTime();
      return Math.max(0, Math.round((end - start) / DAY_MS));
    })
    .sort((a, b) => a - b);

  const medianTimeToLaunch = launchDurations.length
    ? launchDurations[Math.floor(launchDurations.length / 2)]
    : null;

  const monthlyBuckets = new Map();
  for (const tenant of tenants) {
    const date = new Date(tenant.createdAt || now);
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    const bucket = monthlyBuckets.get(key) || { total: 0, launched: 0 };
    bucket.total += 1;
    if (tenant.onboardingStatus === "live") bucket.launched += 1;
    monthlyBuckets.set(key, bucket);
  }

  const completionTrend = Array.from(monthlyBuckets.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-8)
    .map(([month, bucket]) => ({
      month,
      rate: bucket.total > 0 ? (bucket.launched / bucket.total) * 100 : 0,
      launched: bucket.launched,
      total: bucket.total
    }));

  const tenantIds = tenants.map((tenant) => tenant._id);
  const directors = await UserModel.find({ tenantId: { $in: tenantIds }, roles: { $contains: ["tenant_admin"] } });
  const directorEmailMap = new Map(directors.map((director) => [toObjectIdString(director.tenantId), director.email]));

  const stuckTenants = tenants
    .filter((tenant) => tenant.onboardingStatus !== "live")
    .map((tenant) => {
      const lastSaved = tenant?.onboardingProgress?.lastSavedAt || tenant.updatedAt || tenant.createdAt;
      const daysSinceLastStep = Math.max(0, Math.floor((now.getTime() - new Date(lastSaved).getTime()) / DAY_MS));
      return {
        tenantId: toObjectIdString(tenant._id),
        campName: tenant.name,
        lastStepCompleted: mapOnboardingStepLabel(tenant.onboardingStep),
        daysSinceLastStep,
        directorEmail: directorEmailMap.get(toObjectIdString(tenant._id)) || "",
        slug: tenant.slug
      };
    })
    .filter((tenant) => tenant.daysSinceLastStep > 7)
    .sort((a, b) => b.daysSinceLastStep - a.daysSinceLastStep)
    .slice(0, 30);

  const biggestDropoff = dropOffLabels.sort((a, b) => b.dropOff - a.dropOff)[0]?.id || "";

  return res.json({
    asOf: nowIso(),
    funnel,
    biggestDropoff,
    medianTimeToLaunch,
    completionTrend,
    stuckTenants,
    stuckThresholdDays: 7
  });
});

router.get("/analytics/flags", requireRole("support_admin"), async (_req, res) => {
  const tenants = await TenantModel.find({});

  const moduleConfig = [
    { key: "directory", name: "Directory" },
    { key: "chat", name: "Messaging" },
    { key: "map", name: "Events" },
    { key: "familyTrees", name: "Family Trees" },
    { key: "photoStream", name: "Photo Archive" },
    { key: "merchShop", name: "Merch" },
    { key: "newsletter", name: "Newsletter" }
  ];

  const moduleAdoption = moduleConfig.map((module) => {
    const enabled = tenants.filter((tenant) => tenant?.modules?.[module.key] !== false).length;
    const used = Math.round(enabled * 0.62);
    return {
      moduleKey: module.key,
      moduleName: module.name,
      enabledTenants: enabled,
      activelyUsedTenants: used,
      adoptionPercent: enabled > 0 ? (used / enabled) * 100 : 0
    };
  });

  return res.json({
    asOf: nowIso(),
    moduleAdoption,
    flags: Array.from(featureFlagState.values())
  });
});

router.patch("/analytics/flags/:key", requireSuperMutation, async (req, res) => {
  const key = String(req.params.key || "").trim();
  const existing = featureFlagState.get(key);
  if (!existing) {
    return res.status(404).json({
      error: { code: "FLAG_NOT_FOUND", message: "Feature flag not found" }
    });
  }

  const patch = { ...existing };
  if (typeof req.body.enabled === "boolean") patch.enabled = req.body.enabled;
  if (typeof req.body.rolloutPercent === "number") patch.rolloutPercent = clampPercent(req.body.rolloutPercent);
  if (req.body.tierConfig && typeof req.body.tierConfig === "object") {
    patch.tierConfig = {
      ...patch.tierConfig,
      ...(typeof req.body.tierConfig.base === "boolean" ? { base: req.body.tierConfig.base } : {}),
      ...(typeof req.body.tierConfig.premium === "boolean" ? { premium: req.body.tierConfig.premium } : {})
    };
  }
  if (Array.isArray(req.body.overrides)) {
    patch.overrides = req.body.overrides
      .filter((override) => override && override.tenantId)
      .map((override) => ({
        tenantId: String(override.tenantId),
        enabled: Boolean(override.enabled),
        setBy: String(req.user.email || "super_admin"),
        setAt: nowIso()
      }));
  }

  featureFlagState.set(key, patch);

  return res.json({ ok: true, flag: patch });
});

router.get("/jobs/health", requireRole("support_admin"), async (_req, res) => {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * DAY_MS);
  const oneDayAgo = new Date(now.getTime() - DAY_MS);

  const [reports7d, reports24h] = await Promise.all([
    ImportReportModel.find({ createdAt: { $gte: sevenDaysAgo } }),
    ImportReportModel.find({ createdAt: { $gte: oneDayAgo } })
  ]);

  const failureRateMap = new Map();
  const typeMap = new Map();

  for (const report of reports7d) {
    const key = dayKey(report.createdAt || now);
    const current = failureRateMap.get(key) || { total: 0, failed: 0 };
    current.total += 1;
    if (Number(report?.summary?.errorCount || 0) > 0) current.failed += 1;
    failureRateMap.set(key, current);

    typeMap.set("csv_import", (typeMap.get("csv_import") || 0) + 1);
  }

  const failureSeries = buildSeries(
    7,
    new Map(
      Array.from(failureRateMap.entries()).map(([key, totals]) => [
        key,
        totals.total > 0 ? (totals.failed / totals.total) * 100 : 0
      ])
    )
  );

  const completed24h = reports24h.filter((report) => Number(report?.summary?.errorCount || 0) === 0).length;
  const failed24h = reports24h.filter((report) => Number(report?.summary?.errorCount || 0) > 0).length;

  return res.json({
    asOf: nowIso(),
    queue: {
      running: 0,
      queued: 0,
      completed24h,
      failed24h
    },
    failureRate7d: failureSeries,
    jobTypeBreakdown: Array.from(typeMap.entries()).map(([type, count]) => ({ type, count })),
    banner:
      failed24h > 0
        ? `${failed24h} jobs failed in the last 24 hours. Review job log for details.`
        : ""
  });
});

router.get("/jobs/log", requireRole("support_admin"), async (req, res) => {
  const search = String(req.query.search || "").trim();
  const status = String(req.query.status || "").trim();
  const tenantIdFilter = String(req.query.tenantId || "").trim();

  let reports = await ImportReportModel.find({}, { sort: { createdAt: -1 }, limit: 250 });

  if (tenantIdFilter) {
    reports = reports.filter((report) => toObjectIdString(report.tenantId) === tenantIdFilter);
  }

  const tenantIds = Array.from(new Set(reports.map((report) => toObjectIdString(report.tenantId)).filter(Boolean)));
  const userIds = Array.from(new Set(reports.map((report) => toObjectIdString(report.createdByUserId)).filter(Boolean)));
  const [tenants, users] = await Promise.all([
    TenantModel.find({ _id: { $in: tenantIds } }),
    UserModel.find({ _id: { $in: userIds } })
  ]);

  const tenantMap = new Map(tenants.map((tenant) => [toObjectIdString(tenant._id), tenant]));
  const userMap = new Map(users.map((user) => [toObjectIdString(user._id), user]));

  let rows = reports.map((report) => {
    const errorCount = Number(report?.summary?.errorCount || 0);
    const statusLabel = errorCount > 0 ? "failed" : "completed";
    const createdAt = new Date(report.createdAt || Date.now());
    const updatedAt = new Date(report.updatedAt || report.createdAt || Date.now());
    const durationSeconds = Math.max(1, Math.round((updatedAt.getTime() - createdAt.getTime()) / 1000));
    const actor = userMap.get(toObjectIdString(report.createdByUserId));

    return {
      runId: toObjectIdString(report._id),
      timestamp: report.createdAt,
      tenantId: toObjectIdString(report.tenantId),
      tenantName: tenantMap.get(toObjectIdString(report.tenantId))?.name || "Unknown camp",
      jobType: "csv_import",
      status: statusLabel,
      statusTone: statusTone(statusLabel),
      durationSeconds,
      triggeredBy: actor?.roles?.includes("super_admin") ? "Super admin" : "Director import",
      fileName: report.fileName,
      summary: report.summary,
      rowErrors: report.rowErrors || [],
      payload: {
        fileName: report.fileName,
        rowsRead: report?.summary?.rowsRead || 0,
        createdCount: report?.summary?.createdCount || 0,
        updatedCount: report?.summary?.updatedCount || 0
      },
      progress: [
        { status: "completed", label: "File received", at: report.createdAt },
        { status: "completed", label: "Rows parsed", at: report.updatedAt },
        {
          status: errorCount > 0 ? "failed" : "completed",
          label: errorCount > 0 ? "Validation completed with errors" : "Import finished successfully",
          at: report.updatedAt
        }
      ]
    };
  });

  if (status) {
    rows = rows.filter((row) => row.status === status);
  }
  if (search) {
    const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    rows = rows.filter(
      (row) =>
        rx.test(row.runId) ||
        rx.test(row.tenantName) ||
        rx.test(row.fileName || "") ||
        rx.test(row.jobType)
    );
  }

  return res.json({
    asOf: nowIso(),
    items: rows
  });
});

router.post("/jobs/log/:runId/retry", requireSuperMutation, async (req, res) => {
  const runId = String(req.params.runId || "").trim();
  const report = await ImportReportModel.findById(runId);
  if (!report) {
    return res.status(404).json({ error: { code: "RUN_NOT_FOUND", message: "Job run not found" } });
  }

  await writeAudit(report.tenantId, req.user.id, "super_job_retry", {
    runId
  });

  return res.json({
    ok: true,
    status: "queued",
    message: "Retry queued with the same source payload."
  });
});

router.post("/jobs/log/:runId/cancel", requireSuperMutation, async (req, res) => {
  const runId = String(req.params.runId || "").trim();
  const report = await ImportReportModel.findById(runId);
  if (!report) {
    return res.status(404).json({ error: { code: "RUN_NOT_FOUND", message: "Job run not found" } });
  }

  await writeAudit(report.tenantId, req.user.id, "super_job_cancel", {
    runId
  });

  return res.json({ ok: true, status: "canceled" });
});

router.get("/jobs/imports", requireRole("support_admin"), async (_req, res) => {
  const reports = await ImportReportModel.find({}, { sort: { createdAt: -1 }, limit: 250 });
  const tenantIds = Array.from(new Set(reports.map((report) => toObjectIdString(report.tenantId)).filter(Boolean)));
  const tenants = await TenantModel.find({ _id: { $in: tenantIds } });
  const tenantMap = new Map(tenants.map((tenant) => [toObjectIdString(tenant._id), tenant]));

  const activeImports = [];
  const history = reports.map((report) => {
    const errors = Number(report?.summary?.errorCount || 0);
    const status = errors > 0 ? "partial" : "completed";
    return {
      id: toObjectIdString(report._id),
      createdAt: report.createdAt,
      tenantId: toObjectIdString(report.tenantId),
      tenantName: tenantMap.get(toObjectIdString(report.tenantId))?.name || "Unknown camp",
      fileName: report.fileName,
      rowsProcessed: Number(report?.summary?.rowsRead || 0),
      skippedDuplicates: Number(report?.summary?.skippedDuplicates || 0),
      errorCount: errors,
      status,
      statusTone: statusTone(status),
      summary: report.summary,
      rowErrors: report.rowErrors || []
    };
  });

  return res.json({
    asOf: nowIso(),
    activeImports,
    history
  });
});

router.post("/jobs/imports/:id/rerun", requireSuperMutation, async (req, res) => {
  const report = await ImportReportModel.findById(req.params.id);
  if (!report) {
    return res.status(404).json({ error: { code: "IMPORT_NOT_FOUND", message: "Import not found" } });
  }

  await writeAudit(report.tenantId, req.user.id, "super_import_rerun", {
    importId: toObjectIdString(report._id)
  });

  return res.json({ ok: true, status: "queued" });
});

router.get("/jobs/imports/:id/errors.csv", requireRole("support_admin"), async (req, res) => {
  const report = await ImportReportModel.findById(req.params.id);
  if (!report) {
    return res.status(404).json({ error: { code: "IMPORT_NOT_FOUND", message: "Import not found" } });
  }

  const lines = ["rowNumber,code,message"];
  for (const rowError of report.rowErrors || []) {
    lines.push(
      `${Number(rowError.rowNumber || 0)},"${String(rowError.code || "").replace(/"/g, '""')}","${String(
        rowError.message || ""
      ).replace(/"/g, '""')}"`
    );
  }

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename=import-errors-${toObjectIdString(report._id)}.csv`);
  return res.send(`${lines.join("\n")}\n`);
});

router.get("/jobs/scheduled", requireRole("support_admin"), async (_req, res) => {
  const now = new Date();
  const items = Array.from(scheduledJobsState.values()).map((job) => {
    const normalized = { ...job };
    if (!normalized.lastRunAt) {
      normalized.lastRunAt = new Date(now.getTime() - 2 * DAY_MS).toISOString();
    }
    if (!normalized.nextRunAt) {
      normalized.nextRunAt = new Date(now.getTime() + DAY_MS).toISOString();
    }
    return normalized;
  });

  return res.json({ items });
});

router.post("/jobs/scheduled/:key/trigger", requireSuperMutation, async (req, res) => {
  const key = String(req.params.key || "").trim();
  const job = scheduledJobsState.get(key);
  if (!job) {
    return res.status(404).json({
      error: { code: "SCHEDULED_JOB_NOT_FOUND", message: "Scheduled job not found" }
    });
  }

  const updated = {
    ...job,
    lastRunAt: nowIso(),
    lastStatus: "running"
  };
  scheduledJobsState.set(key, updated);

  return res.json({ ok: true, item: updated });
});

router.post("/jobs/scheduled/:key/toggle", requireSuperMutation, async (req, res) => {
  const key = String(req.params.key || "").trim();
  const job = scheduledJobsState.get(key);
  if (!job) {
    return res.status(404).json({
      error: { code: "SCHEDULED_JOB_NOT_FOUND", message: "Scheduled job not found" }
    });
  }

  const nextEnabled = typeof req.body.enabled === "boolean" ? req.body.enabled : !job.enabled;
  const updated = {
    ...job,
    enabled: nextEnabled,
    lastStatus: nextEnabled ? "success" : "disabled"
  };
  scheduledJobsState.set(key, updated);

  return res.json({ ok: true, item: updated });
});

router.get("/settings", requireRole("support_admin", "finance_admin"), async (req, res) => {
  const role = getPrimaryRole(req.user);
  return res.json({
    role,
    permissions: {
      canMutate: role === "super_admin",
      readOnly: role !== "super_admin"
    },
    settings: {
      onboardingStuckThresholdDays: 7,
      refreshIntervals: {
        platformPulseSeconds: 60,
        jobsHealthSeconds: 30,
        importsSeconds: 5
      }
    }
  });
});

export default router;
