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
  ImportReportModel,
  AnalyticsEventModel,
  TenantAdminAuditLogModel,
  PlatformAdminAuditLogModel,
  ResendWebhookEventModel,
  EmailSuppressionModel,
  StripeWebhookEventModel,
  PlatformOperatingCostModel
} from "../db/models/index.js";
import {
  COST_BILLING_CYCLES,
  COST_CATEGORIES,
  COST_STATUSES,
  OperatingCostInputError,
  normalizeOperatingCostInput,
  serializeOperatingCost,
  summarizeOperatingCosts
} from "../services/operatingCosts.js";
import { createTenantCheckoutSession, getBillingMode } from "../services/billing.js";
import { normalizeBillingPlan, resolveTenantBilling } from "../services/billingState.js";
import { createDefaultChecklist } from "../services/onboarding.js";
import { deprovisionTenantDomain, provisionTenantDomain } from "../services/cloudflareDomains.js";
import { getEmailServiceStatus } from "../services/email.js";
import { getR2ServiceStatus, purgeTenantObjectsFromR2 } from "../services/objectStorage.js";
import {
  buildTenantUrls,
  defaultTenantDomain,
  isReservedSubdomain,
  isValidTenantDomain,
  normalizeTenantDomain
} from "../utils/domainProvisioning.js";
import { generateUniqueMobileAppCode } from "../utils/mobileAppCode.js";
import { env } from "../config/env.js";
import { deleteClerkUserAccount, isClerkManagementConfigured } from "../services/clerkIdentity.js";
import {
  buildModuleAdoption,
  buildResendDeliveryTelemetry
} from "../services/operationalTelemetry.js";
import {
  buildSuperSearchTenantItem,
  superSearchIncludesDirectors
} from "../services/superSearchPolicy.js";
import {
  getFeatureRollout,
  listFeatureRollouts,
  normalizeFeatureRolloutInput,
  saveFeatureRollout
} from "../services/featureRollouts.js";
import { purgeTenantRows } from "../services/tenantPurge.js";
import { loadCampCounts } from "../services/superCampCounts.js";
import {
  applyTenantKindFilter,
  isDemoTenant,
  normalizeTenantKindFilter,
  summarizeTenantKinds,
  tenantKind
} from "../services/superTenantKind.js";
import {
  buildSettingsWithCampProfile,
  hasCampProfilePatch,
  normalizeCampProfilePatch,
  readCampProfile,
  resolveDirectorClaimLinks
} from "../services/superCampProfile.js";

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
  flagship: 1200 / 12,
  test: 10 / 12
};
const BILLING_PLAN_LABELS = {
  flagship: "Flagship",
  test: "Internal Test"
};
const BILLING_PLAN_ANNUAL_AMOUNT = {
  flagship: 1200,
  test: 10
};
const VALID_BILLING_PLAN_CODES = new Set(["flagship", "test"]);
const BILLING_PLAN_DEFAULTS = {
  flagship: {
    planTier: "premium",
    onboardingFeeAmount: 0,
    onboardingFeePaid: true,
    onboardingFeeStatus: "waived",
    onboardingFeeWaiveReason: "plan_has_no_onboarding_fee"
  },
  test: {
    planTier: "premium",
    onboardingFeeAmount: 0,
    onboardingFeePaid: true,
    onboardingFeeStatus: "waived",
    onboardingFeeWaiveReason: "internal_test_plan"
  }
};
const APP_BASE_DOMAIN = String(env.APP_BASE_DOMAIN || "pondbridgealumni.com").trim().toLowerCase();
const PRIVILEGED_GLOBAL_ROLES = new Set(["super_admin", "support_admin", "finance_admin"]);
const HIDDEN_TENANT_PATTERN =
  /(^|[-_.\s])(test\d*|sandbox|qa|staging|dev|demo)([-_.\s]|$)/i;
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

// Same rule, now shared with the console's client/demo split.
const isTestOrSandboxTenant = isDemoTenant;

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

function tenantBillingPlanCode(tenant = {}) {
  return resolveTenantBilling(tenant).billingPlan;
}

function billingPlanLabel(planCode = "") {
  return BILLING_PLAN_LABELS[planCode] || BILLING_PLAN_LABELS.flagship;
}

function billingPlanAnnualAmount(planCode = "") {
  const amount = BILLING_PLAN_ANNUAL_AMOUNT[planCode];
  return amount === undefined ? BILLING_PLAN_ANNUAL_AMOUNT.flagship : amount;
}

function tenantBillingPlanSummary(tenant = {}) {
  const billingPlan = tenantBillingPlanCode(tenant);
  return {
    billingPlan,
    billingPlanLabel: billingPlanLabel(billingPlan),
    annualAmount: billingPlanAnnualAmount(billingPlan)
  };
}

// A plan filter only matches a plan PondBridge currently sells; anything else
// matches nothing rather than silently falling back to Flagship.
function requestedBillingPlanFilter(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "";
  return VALID_BILLING_PLAN_CODES.has(normalized) ? normalized : "__none__";
}

function planMonthlyAmount(tenant = {}) {
  return BILLING_PLAN_MRR[tenantBillingPlanCode(tenant)] || BILLING_PLAN_MRR.flagship;
}

/**
 * A stored plan code is an intention; a Stripe subscription is revenue. Demo
 * and seeded camps carry billingStatus "active" with nothing attached to
 * Stripe, and counting their plan price as MRR reports money nobody is paying.
 */
function hasLiveSubscription(tenant = {}) {
  return Boolean(String(tenant?.stripeSubscriptionId || "").trim());
}

function tenantMrr(tenant = {}) {
  if (billingStatusLabel(tenant) !== "active") return 0;
  if (!hasLiveSubscription(tenant)) return 0;
  return planMonthlyAmount(tenant);
}

function paymentMethodSummary(tenant = {}) {
  if (!tenant.stripeCustomerId) {
    return { status: "no_card", label: "No card on file" };
  }
  if (tenant.billingStatus === "past_due") {
    return { status: "issue", label: "Card issue — action required" };
  }
  return { status: "ok", label: "Managed in Stripe" };
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

function operationNotAvailable(res, capability, message) {
  return res.status(501).json({
    error: {
      code: "OPERATION_NOT_AVAILABLE",
      capability,
      message
    }
  });
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
    import_alumni: "First Invitations",
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
      const [campCounts, userCount] = await Promise.all([
        loadCampCounts(tenant._id),
        UserModel.count({ tenantId: tenant._id })
      ]);
      return {
        ...tenant,
        kind: tenantKind(tenant),
        isDemo: isDemoTenant(tenant),
        counts: { ...campCounts, users: userCount }
      };
    })
  );

  if (includeHidden) return withCounts;
  return withCounts.filter((tenant) => !isTestOrSandboxTenant(tenant));
}

async function buildNotifications() {
  const [pastDueCount, failedImports24h] = await Promise.all([
    TenantModel.count({ billingStatus: "past_due" }),
    ImportReportModel.acrossTenants().count({
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
  const role = getPrimaryRole(req.user);
  const directorSearch = superSearchIncludesDirectors(role)
    ? UserModel.acrossTenants().find(
        {
          roles: { $contains: ["tenant_admin"] },
          email: { $ilike: ilikePattern }
        },
        { select: ["id", "tenantId", "email"], sort: { email: 1 }, limit: 8 }
      )
    : Promise.resolve([]);
  const [tenantsByName, tenantsBySlug, directors] = await Promise.all([
    TenantModel.find(
      { name: { $ilike: ilikePattern } },
      { select: ["id", "name", "slug", "customDomain"], sort: { name: 1 }, limit: 8 }
    ),
    TenantModel.find(
      { slug: { $ilike: ilikePattern } },
      { select: ["id", "name", "slug", "customDomain"], sort: { slug: 1 }, limit: 8 }
    ),
    directorSearch
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
  const includeHidden = role === "super_admin";
  const visibleTenants = includeHidden ? tenants : tenants.filter((tenant) => !isTestOrSandboxTenant(tenant));

  const items = [
    ...visibleTenants.map((tenant) =>
      buildSuperSearchTenantItem(tenant, role, { appBaseDomain: APP_BASE_DOMAIN })
    ),
    ...directors.map((director) => {
      const tenant = tenantMap.get(toObjectIdString(director.tenantId));
      if (!tenant || (!includeHidden && isTestOrSandboxTenant(tenant))) return null;
      const tenantId = toObjectIdString(tenant._id);
      return {
        id: `director_${director._id}`,
        type: "director",
        label: director.email,
        meta: tenant ? `${tenant.name}` : "Director",
        href: tenantId
          ? `/super/tenants/${encodeURIComponent(tenantId)}`
          : `/super/tenants?search=${encodeURIComponent(director.email)}`
      };
    }).filter(Boolean)
  ];

  return res.json({ items: items.slice(0, 20) });
});

router.get("/dashboard", requireRole("support_admin"), async (_req, res) => {
  const tenants = await TenantModel.find(
    {},
    { select: ["id", "slug", "name", "status", "customDomain"] }
  );
  const kindSummary = summarizeTenantKinds(tenants);
  // Demo camps hold more than four times the profiles the real clients do, so
  // a platform total that mixes them in describes the sales demos, not the book
  // of business. Members and directors are counted across clients only.
  const clientIds = tenants
    .filter((tenant) => !isDemoTenant(tenant))
    .map((tenant) => toObjectIdString(tenant._id))
    .filter(Boolean);

  const [memberCount, directorCount, userCount, profileCount] = await Promise.all([
    clientIds.length
      ? ProfileModel.acrossTenants().count({ tenantId: { $in: clientIds }, status: "active" })
      : 0,
    clientIds.length
      ? UserModel.acrossTenants().count({
          tenantId: { $in: clientIds },
          roles: { $contains: ["tenant_admin"] }
        })
      : 0,
    UserModel.acrossTenants().count({}),
    ProfileModel.acrossTenants().count({})
  ]);

  res.json({
    counts: {
      tenants: kindSummary.total,
      clients: kindSummary.clients,
      demos: kindSummary.demos,
      members: memberCount,
      directors: directorCount,
      // Every user row owns a profile row, so these two are always the same
      // number, and both include demos. Kept for older callers; new surfaces
      // read clients/members/directors.
      users: userCount,
      profiles: profileCount
    }
  });
});

router.get("/platform-pulse", requireRole("support_admin"), async (_req, res) => {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * DAY_MS);

  const [tenants, profiles7dCount, failedJobs7d, emailEvents7d, inactiveTenants] = await Promise.all([
    TenantModel.find({}),
    ProfileModel.acrossTenants().count({ createdAt: { $gte: sevenDaysAgo } }),
    ImportReportModel.acrossTenants().count({ "summary.errorCount": { $gt: 0 }, createdAt: { $gte: sevenDaysAgo } }),
    ResendWebhookEventModel.acrossTenants().find(
      { occurredAt: { $gte: sevenDaysAgo } },
      { sort: { occurredAt: -1 }, limit: 5000 }
    ),
    TenantModel.count({ status: "inactive" })
  ]);

  const activeTenants = tenants.filter((tenant) => tenant.status === "active" && tenant.onboardingStatus === "live").length;
  const pastDue = tenants.filter((tenant) => tenant.billingStatus === "past_due").length;
  const pendingApprovals = tenants.filter((tenant) => tenant?.settings?.signupMode === "approval_queue").length;

  const mrrCurrent = tenants.reduce((sum, tenant) => sum + tenantMrr(tenant), 0);

  const emailTelemetry = buildResendDeliveryTelemetry({ events: emailEvents7d, tenants, now });
  const emailHealthRate = emailTelemetry.stats.deliveryRate;

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
  if (emailHealthRate != null && emailHealthRate < 95) {
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
      mrrDeltaPercent: null,
      emailHealthRate,
      openJobs: null,
      failedJobs7d,
      newMembers7d: profiles7dCount,
      pendingApprovals
    },
    charts: {
      mrr7d: [],
      emailHealth7d: emailTelemetry.charts.deliverySeries
    },
    billingTrendAvailable: false,
    alerts: alerts.slice(0, 5),
    integrations: {
      stripe: "db_synced",
      resend: getEmailServiceStatus(),
      r2: getR2ServiceStatus(),
      loops: "not_connected",
      posthog: "partial",
      trigger: "not_connected"
    }
  });
});

router.get("/tenants", requireRole("support_admin"), async (req, res) => {
  const search = String(req.query.search || "").trim();
  const status = String(req.query.status || "").trim();
  const plan = String(req.query.plan || "").trim();
  const billingStatus = String(req.query.billingStatus || "").trim();
  const kind = normalizeTenantKindFilter(req.query.kind);

  const filter = {};
  if (status) filter.status = status;
  if (billingStatus) filter.billingStatus = billingStatus;

  const includeHidden = getPrimaryRole(req.user) === "super_admin";
  let items = (await loadTenantsWithCounts(filter, { includeHidden })).map((tenant) => ({
    ...tenant,
    ...tenantBillingPlanSummary(tenant)
  }));

  // Counted before the kind filter, so the console can say how many demos it
  // is holding back rather than leaving them silently missing.
  const kindSummary = summarizeTenantKinds(items);
  items = applyTenantKindFilter(items, kind);

  const planFilter = requestedBillingPlanFilter(plan);
  if (planFilter) {
    items = items.filter((tenant) => tenant.billingPlan === planFilter);
  }

  if (search) {
    const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    items = items.filter((tenant) => rx.test(tenant.name) || rx.test(tenant.slug) || rx.test(tenant.customDomain || ""));
  }

  res.json({ items, kind, kindSummary });
});

// One camp's full client record. The tenants table answers "which camps exist";
// this answers "everything I need to look after this one client".
router.get("/tenants/:tenantId", requireRole("support_admin"), async (req, res) => {
  const tenant = await TenantModel.findById(req.params.tenantId);
  if (!tenant) {
    return res.status(404).json({ error: { code: "TENANT_NOT_FOUND", message: "Tenant not found" } });
  }

  const [campCounts, directors, activity] = await Promise.all([
    loadCampCounts(tenant._id),
    UserModel.find(
      { tenantId: tenant._id, roles: { $contains: ["tenant_admin"] } },
      { select: ["id", "email", "roles", "status", "lastLoginAt", "createdAt"], sort: { createdAt: 1 }, limit: 25 }
    ),
    TenantAdminAuditLogModel.find(
      { tenantId: tenant._id },
      { select: ["id", "event", "actorUserId", "metadata", "createdAt"], sort: { createdAt: -1 }, limit: 15 }
    )
  ]);

  const billing = resolveTenantBilling(tenant);
  const payment = paymentMethodSummary(tenant);
  const network = buildTenantUrls(tenant);
  const campProfile = readCampProfile(tenant);

  res.json({
    tenant: {
      ...tenant,
      ...tenantBillingPlanSummary(tenant),
      kind: tenantKind(tenant),
      isDemo: isDemoTenant(tenant),
      counts: { ...campCounts, directors: directors.length }
    },
    campProfile,
    directorClaim: resolveDirectorClaimLinks(tenant),
    network,
    domain: {
      host: network.domain,
      isDefault: network.domain === defaultTenantDomain(tenant.slug)
    },
    billing: {
      ...tenantBillingPlanSummary(tenant),
      status: billingStatusLabel(tenant),
      lifecycleStatus: billing.lifecycleStatus || "",
      currentPeriodEnd: billing.currentPeriodEnd || null,
      mrr: tenantMrr(tenant),
      paymentMethodStatus: payment.status,
      paymentMethodLabel: payment.label,
      stripeCustomerId: tenant.stripeCustomerId || "",
      onboardingFeeAmount: Number(tenant.onboardingFeeAmount || 0),
      onboardingFeePaid: Boolean(tenant.onboardingFeePaid)
    },
    onboarding: {
      status: tenant.onboardingStatus || "not_started",
      stage: inferOnboardingStage(tenant),
      step: tenant.onboardingStep || "",
      stepLabel: mapOnboardingStepLabel(tenant.onboardingStep),
      checklist: tenant.onboardingChecklist || null
    },
    directors: directors.map((director) => ({
      id: toObjectIdString(director._id),
      email: director.email,
      roles: director.roles || [],
      status: director.status || "",
      lastLoginAt: director.lastLoginAt || null,
      createdAt: director.createdAt || null
    })),
    activity: activity.map((entry) => ({
      id: toObjectIdString(entry._id),
      event: entry.event,
      actorUserId: entry.actorUserId ? toObjectIdString(entry.actorUserId) : "",
      createdAt: entry.createdAt || null
    }))
  });
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
        message: "Billing plan must be flagship or test."
      }
    });
  }
  const billingPlan = requestedBillingPlan
    ? normalizeBillingPlan(requestedBillingPlan)
    : "flagship";
  const billingDefaults = BILLING_PLAN_DEFAULTS[billingPlan] || BILLING_PLAN_DEFAULTS.flagship;
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

  // The findOne check above is not atomic: two creates for the same slug
  // can both pass it and the second then trips the unique index, which
  // would surface as a raw 500. Report it as the same conflict the
  // pre-check reports.
  let tenant;
  try {
    tenant = await TenantModel.create({
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
          onboardingFeeWaiveReason: billingDefaults.onboardingFeeWaiveReason
        },
        signupMode: "open",
        accessCodeHash: "",
        accessCodeHint: "",
        mobileAppCodeLookup: await generateUniqueMobileAppCode(),
        mobileAppCodeHint: `Generated (${new Date().toLocaleDateString("en-US")})`,
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
  } catch (createError) {
    if (String(createError?.code || "") === "23505") {
      return res.status(409).json({
        error: { code: "TENANT_EXISTS", message: `Tenant slug '${slug}' already exists` }
      });
    }
    throw createError;
  }

  const inviteLink = `/t/${tenant.slug}/director-claim`;
  const network = buildTenantUrls(tenant);
  let domainProvisioning = { status: "skipped", reason: "not_attempted" };

  try {
    // Registering the domain is quick; waiting for Cloudflare to mark it active
    // is not, and a new subdomain never activates inside that window. Blocking
    // the create response on it leaves the operator staring at an idle form.
    domainProvisioning = await provisionTenantDomain(network.domain, { waitForReadiness: false });
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

  // Store the claim link and director contact on the camp record itself, so the
  // camp profile can hand them back later without the operator keeping a copy.
  try {
    const settingsWithProfile = buildSettingsWithCampProfile(
      tenant,
      {
        directorEmail: directorEmail || "",
        directorClaimUrl: networkDirectorClaimLink,
        directorClaimPath: inviteLink
      },
      { createdByUserId: req.user.id, updatedByUserId: req.user.id }
    );
    const tenantWithProfile = await TenantModel.update(tenant._id, { settings: settingsWithProfile });
    if (tenantWithProfile) tenant = tenantWithProfile;
  } catch {
    // The claim link is derived from the camp domain, so the camp profile can
    // always recompute it. Never fail the create over this write — the operator
    // would retry and only collide on the now-taken slug.
  }

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
      status: "not_configured",
      message: "No director lifecycle contact sync was attempted. Configure and verify a provider integration before enabling this step."
    },
    nextSteps: [
      domainReady
        ? "Share the director claim link."
        : "Share the fallback claim link now while camp domain activation completes in Cloudflare.",
      "The first verified signup on this camp domain claims director access.",
      "Director is redirected into the resumable onboarding command center."
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
  if (Object.prototype.hasOwnProperty.call(req.body, "customDomain")) {
    const customDomain = normalizeTenantDomain(req.body.customDomain);
    if (!isValidTenantDomain(customDomain)) {
      return res.status(400).json({
        error: {
          code: "INVALID_CUSTOM_DOMAIN",
          message: "Custom domain must be a valid hostname, such as alumni.examplecamp.org."
        }
      });
    }
    update.customDomain = customDomain;
  }

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

  if (Object.prototype.hasOwnProperty.call(update, "customDomain")) {
    const duplicateDomainTenant = await TenantModel.findByDomain(update.customDomain);
    if (
      duplicateDomainTenant &&
      String(duplicateDomainTenant._id) !== String(existingTenant._id)
    ) {
      return res.status(409).json({
        error: {
          code: "CUSTOM_DOMAIN_IN_USE",
          message: `Custom domain '${update.customDomain}' is already assigned to another camp.`
        }
      });
    }
  }

  // The camp's client record (director contact, notes, captured claim link)
  // lives inside the settings JSON, so it is written as a whole merged object.
  const campProfilePatch = hasCampProfilePatch(req.body) ? normalizeCampProfilePatch(req.body) : null;
  if (campProfilePatch) {
    update.settings = buildSettingsWithCampProfile(existingTenant, campProfilePatch, {
      updatedByUserId: req.user.id
    });
  }

  let tenant = null;
  try {
    tenant = await TenantModel.update(req.params.tenantId, update);
  } catch (error) {
    if (String(error?.code || "") === "23505") {
      return res.status(409).json({
        error: {
          code: "TENANT_IDENTITY_CONFLICT",
          message: "That camp slug or custom domain is already in use."
        }
      });
    }
    throw error;
  }
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

  // Notes can run to thousands of characters; the audit records which profile
  // fields moved, not a copy of the whole settings blob on every edit.
  const { settings: _settings, ...auditableUpdate } = update;
  await writeAudit(tenant._id, req.user.id, "super_tenant_updated", {
    update: auditableUpdate,
    ...(campProfilePatch ? { campProfileFields: Object.keys(campProfilePatch) } : {})
  });

  res.json({ tenant, domainProvisioning, campProfile: readCampProfile(tenant) });
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
  const resendWebhookEventsBySlug = await ResendWebhookEventModel.acrossTenants().count({ tenantSlug: tenant.slug });
  if (resendWebhookEventsBySlug > 0) {
    await ResendWebhookEventModel.acrossTenants().deleteMany({ tenantSlug: tenant.slug });
  }

  const emailSuppressionsBySlug = await EmailSuppressionModel.acrossTenants().count({ tenantSlug: tenant.slug });
  if (emailSuppressionsBySlug > 0) {
    await EmailSuppressionModel.acrossTenants().deleteMany({ tenantSlug: tenant.slug });
  }

  // Stripe can deliver a webhook whose tenant is only known by slug, so those
  // receipts never get a tenant_id and survive the tenant-scoped purge above.
  const stripeWebhookEventsBySlug = await StripeWebhookEventModel.acrossTenants().count({ tenantSlug: tenant.slug });
  if (stripeWebhookEventsBySlug > 0) {
    await StripeWebhookEventModel.acrossTenants().deleteMany({ tenantSlug: tenant.slug });
  }

  counts.resendWebhookEventsBySlug = resendWebhookEventsBySlug;
  counts.emailSuppressionsBySlug = emailSuppressionsBySlug;
  counts.stripeWebhookEventsBySlug = stripeWebhookEventsBySlug;

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
          message: "Billing plan must be flagship or test."
        }
      });
    }

    // Falling back to normalizeBillingPlan("") here returned Flagship, so a
    // checkout started without an explicit plan billed $1,200 to a camp stored
    // on the $10 internal test tier. Match the tenant and admin routes instead.
    const requestedPlanCode = requested
      ? normalizeBillingPlan(requested, tenant.planTier)
      : resolveTenantBilling(tenant).billingPlan;

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
  const [events, tenants] = await Promise.all([
    ResendWebhookEventModel.acrossTenants().find(
      { occurredAt: { $gte: since } },
      { sort: { occurredAt: -1 }, limit: 5000 }
    ),
    TenantModel.find({})
  ]);

  return res.json(buildResendDeliveryTelemetry({ events, tenants }));
});

router.post("/email/retry", requireSuperMutation, async (_req, res) => {
  return operationNotAvailable(
    res,
    "transactional_email_retry",
    "Email retry is disabled until a provider-backed retry workflow can recreate the original message safely."
  );
});

router.get("/email/broadcast", requireRole("support_admin"), async (_req, res) => {
  const [directorCount, tenants, activeSuppressions] = await Promise.all([
    UserModel.acrossTenants().count({ roles: { $contains: ["tenant_admin"] } }),
    TenantModel.find({}),
    EmailSuppressionModel.acrossTenants().count({ status: "active" })
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

  return res.json({
    asOf: nowIso(),
    integrationConnected: false,
    contacts: {
      total: directorCount,
      source: "pondbridge_director_accounts",
      activeSuppressions
    },
    sequences: [],
    contactsByStage: [
      { stage: "Invited", count: stageCounts.invited },
      { stage: "Account Created", count: stageCounts.accountCreated },
      { stage: "Branding Done", count: stageCounts.brandingDone },
      { stage: "Features Done", count: stageCounts.featuresDone },
      { stage: "Launched", count: stageCounts.launched }
    ],
    notes:
      "Lifecycle-provider contact and sequence telemetry is not connected. Counts shown come only from PondBridge director accounts, onboarding state, and provider suppressions."
  });
});

router.post("/email/broadcast/contact", requireSuperMutation, async (req, res) => {
  const email = normalizeEmail(req.body.email || "");
  if (!isEmail(email)) {
    return res.status(400).json({
      error: { code: "INVALID_INPUT", message: "Valid email is required" }
    });
  }
  return operationNotAvailable(
    res,
    "lifecycle_contact_sync",
    "Contact sync is disabled until a lifecycle email provider is connected."
  );
});

router.post("/email/broadcast/suppress", requireSuperMutation, async (req, res) => {
  const email = normalizeEmail(req.body.email || "");
  if (!isEmail(email)) {
    return res.status(400).json({
      error: { code: "INVALID_INPUT", message: "Valid email is required" }
    });
  }
  return operationNotAvailable(
    res,
    "lifecycle_contact_suppression",
    "Lifecycle-provider suppression is disabled until that provider is connected. Resend bounce and complaint suppressions remain automatic."
  );
});

router.get("/billing/overview", requireRole("support_admin", "finance_admin"), async (_req, res) => {
  const tenants = await TenantModel.find({});
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY_MS);

  const mrrCurrent = tenants.reduce((sum, tenant) => sum + tenantMrr(tenant), 0);
  const newSubs = tenants.filter(
    (tenant) => {
      const billing = resolveTenantBilling(tenant);
      return billing.activatedAt && new Date(billing.activatedAt) >= thirtyDaysAgo;
    }
  );

  const churned = tenants.filter(
    (tenant) => {
      const billing = resolveTenantBilling(tenant);
      return billing.canceledAt && new Date(billing.canceledAt) >= thirtyDaysAgo;
    }
  );

  const failedPayments = tenants.filter((tenant) => billingStatusLabel(tenant) === "past_due").length;

  const planDistribution = {
    flagship: tenants.filter(
      (tenant) => tenantBillingPlanCode(tenant) === "flagship" && billingStatusLabel(tenant) !== "comp"
    ).length,
    test: tenants.filter(
      (tenant) => tenantBillingPlanCode(tenant) === "test" && billingStatusLabel(tenant) !== "comp"
    ).length,
    trial: tenants.filter((tenant) => billingStatusLabel(tenant) === "trialing").length,
    comp: tenants.filter((tenant) => billingStatusLabel(tenant) === "comp").length
  };

  res.json({
    asOf: nowIso(),
    source: "pondbridge_billing_state",
    trendAvailable: false,
    stats: {
      mrr: mrrCurrent,
      mrrDeltaPercent: null,
      newSubscriptions30d: newSubs.length,
      churned30d: churned.length,
      churnedMrrLost30d: churned.reduce(
        (sum, tenant) => sum + (hasLiveSubscription(tenant) ? planMonthlyAmount(tenant) : 0),
        0
      ),
      failedPayments
    },
    charts: {
      mrrTrend60d: [],
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
  const planFilter = requestedBillingPlanFilter(plan);
  if (planFilter) {
    tenants = tenants.filter((tenant) => tenantBillingPlanCode(tenant) === planFilter);
  }
  if (status) {
    tenants = tenants.filter((tenant) => billingStatusLabel(tenant) === status);
  }

  const mapped = tenants.map((tenant) => {
    const payment = paymentMethodSummary(tenant);
    const billing = resolveTenantBilling(tenant);
    return {
      id: toObjectIdString(tenant._id),
      name: tenant.name,
      slug: tenant.slug,
      customDomain: tenant.customDomain || `${tenant.slug}.${APP_BASE_DOMAIN}`,
      planTier: tenant.planTier,
      ...tenantBillingPlanSummary(tenant),
      billingStatus: billingStatusLabel(tenant),
      mrr: tenantMrr(tenant),
      nextRenewal: billing.currentPeriodEnd,
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

  return operationNotAvailable(
    res,
    "billing_account_mutation",
    "Plan, trial, discount, invoice, comp, and cancellation actions are disabled until they execute through Stripe and confirm the resulting state."
  );
});

router.get("/billing/failed", requireRole("support_admin", "finance_admin"), async (_req, res) => {
  const now = new Date();
  const failedTenants = await TenantModel.find({ billingStatus: "past_due" }, { sort: { updatedAt: 1 } });

  const items = failedTenants.map((tenant) => {
    const daysOverdue = Math.max(1, Math.floor((now.getTime() - new Date(tenant.updatedAt || now).getTime()) / DAY_MS));
    const planSummary = tenantBillingPlanSummary(tenant);
    // Every live plan bills annually, so the unpaid invoice is the annual amount.
    const amountDue = planSummary.annualAmount;
    const declineReason = tenant.onboardingFeePaid ? "Card declined" : "Onboarding invoice unpaid";
    return {
      id: toObjectIdString(tenant._id),
      name: tenant.name,
      slug: tenant.slug,
      daysOverdue,
      planTier: tenant.planTier,
      ...planSummary,
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

  return operationNotAvailable(
    res,
    "billing_payment_retry",
    "Payment retry is disabled until it invokes Stripe and confirms the resulting payment state."
  );
});

router.post("/billing/failed/:tenantId/reminder", requireSuperMutation, async (req, res) => {
  const tenant = await TenantModel.findById(req.params.tenantId);
  if (!tenant) {
    return res.status(404).json({ error: { code: "TENANT_NOT_FOUND", message: "Tenant not found" } });
  }

  return operationNotAvailable(
    res,
    "billing_payment_reminder",
    "Payment reminders are disabled until a provider-backed delivery workflow is connected."
  );
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

// --- Operational finances -------------------------------------------------
// What PondBridge itself pays to run: Supabase, Resend, domains, and so on.
// Hand-entered, because there is no single provider to sync from.

async function loadOperatingCosts() {
  const rows = await PlatformOperatingCostModel.find({}, { sort: { name: 1 } });
  return rows.map(serializeOperatingCost);
}

async function platformMrrCents() {
  const tenants = await TenantModel.find({});
  return Math.round(tenants.reduce((sum, tenant) => sum + tenantMrr(tenant), 0) * 100);
}

function operatingCostErrorResponse(res, error) {
  if (error instanceof OperatingCostInputError) {
    return res.status(400).json({
      error: {
        code: "OPERATING_COST_INVALID",
        message: error.message,
        details: { field: error.field }
      }
    });
  }
  return null;
}

router.get("/finance/costs", requireRole("support_admin", "finance_admin"), async (_req, res) => {
  const items = await loadOperatingCosts();
  const summary = summarizeOperatingCosts(items);
  const mrrCents = await platformMrrCents();

  res.json({
    asOf: nowIso(),
    items,
    summary,
    options: {
      categories: COST_CATEGORIES,
      billingCycles: COST_BILLING_CYCLES,
      statuses: COST_STATUSES
    },
    revenue: {
      mrrCents,
      // Only meaningful when costs and revenue are both in USD, which is what
      // Stripe bills in; a non-USD primary means the comparison is skipped.
      comparable: summary.primaryCurrency === "USD",
      netMonthlyCents: mrrCents - summary.monthlyCents
    }
  });
});

router.post("/finance/costs", requireSuperMutation, async (req, res, next) => {
  try {
    const normalized = normalizeOperatingCostInput(req.body || {});
    const created = await PlatformOperatingCostModel.create({
      ...normalized,
      createdByUserId: String(req.user?.id || "") || null,
      updatedByUserId: String(req.user?.id || "") || null
    });

    await PlatformAdminAuditLogModel.create({
      actorUserId: String(req.user?.id || "") || null,
      event: "operating_cost_created",
      metadata: {
        requestId: String(req.requestId || ""),
        costId: String(created?._id || ""),
        name: normalized.name,
        amountCents: normalized.amountCents,
        billingCycle: normalized.billingCycle
      }
    });

    return res.status(201).json({ ok: true, cost: serializeOperatingCost(created) });
  } catch (error) {
    return operatingCostErrorResponse(res, error) || next(error);
  }
});

router.patch("/finance/costs/:costId", requireSuperMutation, async (req, res, next) => {
  try {
    const existing = await PlatformOperatingCostModel.findById(req.params.costId);
    if (!existing) {
      return res.status(404).json({
        error: { code: "OPERATING_COST_NOT_FOUND", message: "That cost no longer exists." }
      });
    }

    const patch = normalizeOperatingCostInput(req.body || {}, { partial: true });
    const updated = await PlatformOperatingCostModel.update(existing._id, {
      ...patch,
      // `update` does not stamp updatedAt on its own.
      updatedAt: nowIso(),
      updatedByUserId: String(req.user?.id || "") || null
    });

    await PlatformAdminAuditLogModel.create({
      actorUserId: String(req.user?.id || "") || null,
      event: "operating_cost_updated",
      metadata: {
        requestId: String(req.requestId || ""),
        costId: String(existing._id || ""),
        changed: Object.keys(patch)
      }
    });

    return res.json({ ok: true, cost: serializeOperatingCost(updated) });
  } catch (error) {
    return operatingCostErrorResponse(res, error) || next(error);
  }
});

router.delete("/finance/costs/:costId", requireSuperMutation, async (req, res, next) => {
  try {
    const existing = await PlatformOperatingCostModel.findById(req.params.costId);
    if (!existing) {
      return res.status(404).json({
        error: { code: "OPERATING_COST_NOT_FOUND", message: "That cost no longer exists." }
      });
    }

    await PlatformOperatingCostModel.delete(existing._id);
    await PlatformAdminAuditLogModel.create({
      actorUserId: String(req.user?.id || "") || null,
      event: "operating_cost_deleted",
      metadata: {
        requestId: String(req.requestId || ""),
        costId: String(existing._id || ""),
        name: existing.name || ""
      }
    });

    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

router.get("/analytics/engagement", requireRole("support_admin"), async (_req, res) => {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * DAY_MS);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY_MS);

  const [tenants, users, profiles, events7d, events30d] = await Promise.all([
    TenantModel.find({}),
    UserModel.find({ tenantId: { $ne: null } }),
    ProfileModel.acrossTenants().find({}),
    AnalyticsEventModel.acrossTenants().find({ createdAt: { $gte: sevenDaysAgo } }),
    AnalyticsEventModel.acrossTenants().find({ createdAt: { $gte: thirtyDaysAgo } })
  ]);

  const activeUsers7d = new Set(events7d.map((event) => toObjectIdString(event.userId)).filter(Boolean)).size;
  const dau = new Set(
    events7d
      .filter((event) => new Date(event.createdAt) >= new Date(Date.now() - DAY_MS))
      .map((event) => toObjectIdString(event.userId))
      .filter(Boolean)
  ).size;
  const mau = new Set(events30d.map((event) => toObjectIdString(event.userId)).filter(Boolean)).size;
  const dauMauRatio = mau > 0 ? clampPercent((dau / mau) * 100) : null;

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
      activeUsers: eventTenantCounts.get(toObjectIdString(tenant._id))?.size || 0
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
        ...tenantBillingPlanSummary(tenant),
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
    asOf: nowIso(),
    measurementSource: "pondbridge_analytics_events",
    stats: {
      activeUsers7d,
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

  return operationNotAvailable(
    res,
    "tenant_reengagement_campaign",
    "Re-engagement campaigns are disabled until a previewable, provider-backed delivery workflow is connected."
  );
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
  const since = new Date(Date.now() - 30 * DAY_MS);
  const [tenants, analyticsEvents] = await Promise.all([
    TenantModel.find({}),
    AnalyticsEventModel.acrossTenants().find(
      { createdAt: { $gte: since } },
      { select: ["tenantId", "eventType"], limit: 10000 }
    )
  ]);

  const rolloutControl = await listFeatureRollouts();

  return res.json({
    asOf: nowIso(),
    moduleAdoption: buildModuleAdoption({ tenants, analyticsEvents }),
    flags: rolloutControl.items,
    tenants: tenants.map((tenant) => ({
      id: String(tenant._id || ""),
      slug: String(tenant.slug || ""),
      name: String(tenant.name || ""),
      status: String(tenant.status || "")
    })),
    controlAvailable: rolloutControl.controlAvailable,
    notice: rolloutControl.controlAvailable
      ? "Rollouts are enforced server-side by tenant ID. Keep the kill switch on until target and control checks pass."
      : "Rollout controls are locked until the feature_rollouts schema is applied. All supported features fail closed."
  });
});

router.patch("/analytics/flags/:key", requireSuperMutation, async (req, res, next) => {
  try {
    const featureKey = String(req.params.key || "").trim();
    const normalized = normalizeFeatureRolloutInput(req.body || {});
    const referencedTenantIds = [...new Set([
      ...normalized.tenantIds,
      ...normalized.excludedTenantIds
    ])];
    const tenants = referencedTenantIds.length
      ? await TenantModel.find({ _id: { $in: referencedTenantIds } }, { select: ["id", "slug", "name"] })
      : [];
    const knownTenantIds = new Set(tenants.map((tenant) => String(tenant._id || "")));
    const unknownTenantIds = referencedTenantIds.filter((tenantId) => !knownTenantIds.has(tenantId));
    if (unknownTenantIds.length) {
      return res.status(400).json({
        error: {
          code: "ROLLOUT_TENANT_NOT_FOUND",
          message: "One or more rollout tenant IDs do not exist.",
          details: { unknownTenantIds }
        }
      });
    }

    const current = await getFeatureRollout(featureKey);
    await PlatformAdminAuditLogModel.create({
      actorUserId: String(req.user?.id || "") || null,
      event: "feature_rollout_change_authorized",
      metadata: {
        requestId: String(req.requestId || ""),
        featureKey,
        previous: current.record
          ? {
              state: current.record.state,
              killSwitch: current.record.killSwitch,
              tenantIds: current.record.tenantIds || [],
              excludedTenantIds: current.record.excludedTenantIds || [],
              revision: current.record.revision
            }
          : null,
        proposed: normalized
      }
    });

    const result = await saveFeatureRollout(featureKey, normalized, req.user?.id);
    return res.json({
      ok: true,
      rollout: {
        featureKey: result.saved.featureKey,
        state: result.saved.state,
        killSwitch: result.saved.killSwitch,
        tenantIds: result.saved.tenantIds || [],
        excludedTenantIds: result.saved.excludedTenantIds || [],
        revision: result.saved.revision,
        updatedAt: result.saved.updatedAt
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/jobs/health", requireRole("support_admin"), async (_req, res) => {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * DAY_MS);
  const oneDayAgo = new Date(now.getTime() - DAY_MS);

  const [reports7d, reports24h] = await Promise.all([
    ImportReportModel.acrossTenants().find({ createdAt: { $gte: sevenDaysAgo } }),
    ImportReportModel.acrossTenants().find({ createdAt: { $gte: oneDayAgo } })
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
      connected: false,
      running: null,
      queued: null,
      completed24h,
      failed24h
    },
    failureRate7d: failureSeries,
    jobTypeBreakdown: Array.from(typeMap.entries()).map(([type, count]) => ({ type, count })),
    banner:
      failed24h > 0
        ? `${failed24h} jobs failed in the last 24 hours. Review job log for details.`
        : "Durable queue telemetry is not connected. Counts below are completed import reports only."
  });
});

router.get("/jobs/log", requireRole("support_admin"), async (req, res) => {
  const search = String(req.query.search || "").trim();
  const status = String(req.query.status || "").trim();
  const tenantIdFilter = String(req.query.tenantId || "").trim();

  let reports = await ImportReportModel.acrossTenants().find({}, { sort: { createdAt: -1 }, limit: 250 });

  if (tenantIdFilter) {
    reports = reports.filter((report) => toObjectIdString(report.tenantId) === tenantIdFilter);
  }

  const tenantIds = Array.from(new Set(reports.map((report) => toObjectIdString(report.tenantId)).filter(Boolean)));
  const userIds = Array.from(new Set(reports.map((report) => toObjectIdString(report.createdByUserId)).filter(Boolean)));
  const [tenants, users] = await Promise.all([
    TenantModel.find({ _id: { $in: tenantIds } }),
    UserModel.acrossTenants().find({ _id: { $in: userIds } })
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

  return operationNotAvailable(
    res,
    "job_retry",
    "Retry is disabled because the original import payload is not retained in a durable job queue."
  );
});

router.post("/jobs/log/:runId/cancel", requireSuperMutation, async (req, res) => {
  const runId = String(req.params.runId || "").trim();
  const report = await ImportReportModel.findById(runId);
  if (!report) {
    return res.status(404).json({ error: { code: "RUN_NOT_FOUND", message: "Job run not found" } });
  }

  return operationNotAvailable(
    res,
    "job_cancel",
    "Completed import reports cannot be canceled, and no active durable job is attached to this record."
  );
});

router.get("/jobs/imports", requireRole("support_admin"), async (_req, res) => {
  const reports = await ImportReportModel.acrossTenants().find({}, { sort: { createdAt: -1 }, limit: 250 });
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

  return operationNotAvailable(
    res,
    "import_rerun",
    "Import re-run is disabled because the source file is not retained in a durable, replayable job."
  );
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
  return res.json({
    items: [],
    controlAvailable: false,
    notice:
      "No durable scheduler registry is connected. Scheduled email delivery is managed separately through the email provider."
  });
});

router.post("/jobs/scheduled/:key/trigger", requireSuperMutation, async (_req, res) => {
  return operationNotAvailable(
    res,
    "scheduled_job_trigger",
    "Manual job triggering is disabled until a durable scheduler is connected."
  );
});

router.post("/jobs/scheduled/:key/toggle", requireSuperMutation, async (_req, res) => {
  return operationNotAvailable(
    res,
    "scheduled_job_toggle",
    "Scheduled job toggles are disabled until a durable scheduler is connected."
  );
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
