import { Router } from "express";
import crypto from "crypto";
import multer from "multer";
import PDFDocument from "pdfkit";
import { stringify } from "csv-stringify/sync";
import { parse as parseCsv } from "csv-parse/sync";
import { listFeaturesForPlan, hasFeature } from "@pondbridge/shared";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireRole } from "../middleware/requireRole.js";
import { requireTenant } from "../middleware/tenantContext.js";
import { requireFeature } from "../middleware/requireFeature.js";
import {
  ProfileModel,
  TenantModel,
  UserModel,
  InviteModel,
  AccessRequestModel,
  AnalyticsEventModel,
  EmailBroadcastModel,
  ImportReportModel
} from "../db/models/index.js";
import { runTenantCsvImport, findImportReportForTenant } from "../services/csvImport.js";
import { env } from "../config/env.js";
import { sendInviteEmail, sendTransactionalEmail } from "../services/email.js";
import { getTenantAnalyticsSnapshot } from "../services/analytics.js";
import {
  buildSettingsStorePayload,
  resolveDraft,
  resolveTheme,
  resolveContent,
  resolveModules,
  normalizeSignupMode,
  resolveSettings
} from "../services/onboarding.js";
import { createBillingPortalUrl, getBillingMode } from "../services/billing.js";
import { hashPassword } from "../utils/auth.js";

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

function toBoolean(value) {
  if (typeof value === "boolean") return value;
  return String(value || "").trim().toLowerCase() === "true";
}

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

function generateToken(length = 24) {
  return crypto.randomBytes(length).toString("base64url");
}

function parseEmailsFromText(text = "") {
  return String(text || "")
    .split(/[\n,;]+/g)
    .map((entry) => normalizeEmail(entry))
    .filter(Boolean);
}

function parseEmailsFromCsv(csvBuffer) {
  if (!csvBuffer) return [];
  const csvText = Buffer.isBuffer(csvBuffer) ? csvBuffer.toString("utf8") : String(csvBuffer);
  const rows = parseCsv(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
    relax_column_count: true
  });

  const emails = [];
  for (const row of rows) {
    const fromEmailHeader = normalizeEmail(
      row.email || row.Email || row["Email Address"] || row["email address"]
    );
    if (fromEmailHeader) {
      emails.push(fromEmailHeader);
      continue;
    }

    for (const value of Object.values(row || {})) {
      const candidate = normalizeEmail(value);
      if (candidate && isEmail(candidate)) {
        emails.push(candidate);
        break;
      }
    }
  }

  return emails;
}

const DAY_MS = 24 * 60 * 60 * 1000;
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
    description: "External camp merch storefront.",
    requiredFeature: "tenantBrandingAdvanced"
  }
];

function escapeRegex(value = "") {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toObjectIdString(value) {
  return value ? String(value) : "";
}

function toIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function completionScore(profile = {}) {
  const checks = [
    Boolean(profile?.firstName),
    Boolean(profile?.lastName),
    Array.isArray(profile?.emails) && profile.emails.some(Boolean),
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

function mapMemberRow(profile = {}, user = null) {
  const score = completionScore(profile);
  const email = profile?.emails?.find(Boolean) || user?.email || "";
  return {
    id: toObjectIdString(profile._id),
    userId: toObjectIdString(profile.userId),
    firstName: profile.firstName || "",
    lastName: profile.lastName || "",
    fullName: `${profile.firstName || ""} ${profile.lastName || ""}`.trim(),
    email,
    avatarUrl: profile.avatarUrl || "",
    role: normalizeRoleLabel(profile.roleAtCamp || ""),
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

router.use(requireAuth, requireTenant, requireRole("tenant_admin"));

router.get("/dashboard", async (req, res, next) => {
  try {
    const tenantId = req.tenant._id;
    const sevenDaysAgo = new Date(Date.now() - 7 * DAY_MS);
    const thirtyDaysAgo = new Date(Date.now() - 30 * DAY_MS);
    const settings = resolveSettings(req.tenant);

    const [activeMembers, newThisWeek, pendingApprovals, profiles, lastBroadcast, activity] =
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
        buildRecentActivity(tenantId)
      ]);

    const completionAverage = profiles.length
      ? Math.round(
          profiles.reduce((sum, profile) => sum + completionScore(profile), 0) / profiles.length
        )
      : 0;

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
            select: ["_id", "email", "status", "lastLoginAt"]
          })
        : [];
      const usersById = new Map(users.map((item) => [toObjectIdString(item._id), item]));
      const mapped = allProfiles.map((profile) =>
        mapMemberRow(profile, usersById.get(toObjectIdString(profile.userId)) || null)
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
          select: ["_id", "email", "status", "lastLoginAt"]
        })
      : [];
    const usersById = new Map(users.map((item) => [toObjectIdString(item._id), item]));
    let rows = profiles.map((profile) =>
      mapMemberRow(profile, usersById.get(toObjectIdString(profile.userId)) || null)
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
      patch[key] = String(incoming[key] || "").trim();
    }
  };

  assignString("firstName");
  assignString("lastName");
  assignString("cityState");
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
  return res.json({
    ok: true,
    member: mapMemberRow(updated, user)
  });
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
    return res.json({ ok: true, action, affected: profiles.length });
  }

  if (action === "flag") {
    const reason = String(req.body?.reason || "").trim();
    await ProfileModel.updateMany(
      req.tenant._id,
      { _id: { $in: ids } },
      { status: "flagged", flaggedReason: reason }
    );
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

  const actorReplyTo = normalizeEmail(req.user.email || "");
  await sendTransactionalEmail({
    to: email,
    subject: `You're approved for ${req.tenant.name}`,
    text: `Your request to join ${req.tenant.name} was approved. You can now log in to your network.`,
    ...(isEmail(actorReplyTo) ? { replyTo: actorReplyTo } : {})
  }).catch(() => {});

  return res.json({
    ok: true,
    requestId: toObjectIdString(request._id),
    member: mapMemberRow(profile, user)
  });
});

router.post("/members/approvals/:requestId/deny", async (req, res) => {
  const requestId = String(req.params.requestId || "").trim();
  const reason = String(req.body?.reason || "").trim();

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

  if (isEmail(request.email)) {
    const message = reason
      ? `Reason: ${reason}\n\nYou can reach out to the camp director for details.`
      : "You can reach out to the camp director for details.";
    const actorReplyTo = normalizeEmail(req.user.email || "");
    await sendTransactionalEmail({
      to: request.email,
      subject: `Update on your ${req.tenant.name} request`,
      text: `Your request to join ${req.tenant.name} was not approved.\n\n${message}`,
      ...(isEmail(actorReplyTo) ? { replyTo: actorReplyTo } : {})
    }).catch(() => {});
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
  const subject = String(req.body?.subject || "").trim();
  const body = String(req.body?.body || "").trim();
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

router.post("/email/send", async (req, res) => {
  const subject = String(req.body?.subject || "").trim();
  const body = String(req.body?.body || "").trim();
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
    const to = recipients[0];
    const bcc = recipients.slice(1);
    await sendTransactionalEmail({
      to,
      subject,
      text: body,
      ...(bcc.length > 0 ? { bcc: bcc.join(",") } : {}),
      ...(isEmail(actorReplyTo) ? { replyTo: actorReplyTo } : {})
    }).catch(async () => {
      await EmailBroadcastModel.update(broadcast._id, { status: "failed" });
    });
  }

  const fresh = await EmailBroadcastModel.findOne(req.tenant._id, { _id: broadcast._id });
  return res.status(201).json({ ok: true, item: serializeEmailBroadcast(fresh) });
});

router.get("/analytics/network", async (req, res, next) => {
  try {
    const tenantId = req.tenant._id;
    const snapshot = await getTenantAnalyticsSnapshot({ tenantId });
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY_MS);
    const sevenDaysAgo = new Date(now.getTime() - 7 * DAY_MS);

    const [events30d, users, profiles, broadcasts] = await Promise.all([
      AnalyticsEventModel.find(tenantId, { createdAt: { $gte: thirtyDaysAgo } }, {
        select: ["userId", "eventType", "createdAt", "metadata"]
      }),
      UserModel.find(tenantId, {}, {
        select: ["_id", "email", "lastLoginAt"]
      }),
      ProfileModel.find(tenantId, { status: { $ne: "removed" } }, {
        select: ["_id", "userId", "firstName", "lastName", "roleAtCamp", "createdAt"]
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
          role: profile.roleAtCamp || "Member",
          logins: count,
          completionScore: completionScore(profile),
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
      newsletterName: String(incomingNames.newsletter || "").trim() || "Newsletter"
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

  const memberCount = await ProfileModel.count(req.tenant._id, { status: { $ne: "removed" } });
  const planLimit = req.tenant.planTier === "premium" ? null : 5000;
  const usagePct = planLimit ? Math.round((memberCount / Math.max(planLimit, 1)) * 100) : null;

  return res.json({
    tenant: {
      id: toObjectIdString(req.tenant._id),
      slug: req.tenant.slug,
      name: req.tenant.name,
      planTier: req.tenant.planTier,
      billingStatus: req.tenant.billingStatus,
      onboardingFeeAmount: Number(req.tenant.onboardingFeeAmount || 0),
      onboardingFeePaid: Boolean(req.tenant.onboardingFeePaid),
      onboardingFeeInvoiceId: req.tenant.onboardingFeeInvoiceId || "",
      billingDetails: req.tenant.billingDetails || {}
    },
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

router.get("/settings", async (req, res) => {
  const [admins, pendingAdminInvites] = await Promise.all([
    UserModel.find(req.tenant._id, { roles: { $contains: ["tenant_admin"] } }, {
      select: ["_id", "email", "roles", "createdAt"],
      sort: { createdAt: 1 }
    }),
    InviteModel.find(req.tenant._id, {
      roleToAssign: "tenant_admin",
      usedAt: null,
      expiresAt: { $gt: new Date() }
    }, {
      select: ["_id", "email", "createdAt", "expiresAt"],
      sort: { createdAt: -1 }
    })
  ]);

  const draft = resolveDraft(req.tenant);
  const content = draft.content;
  const theme = draft.theme;
  const settings = draft.settings;

  return res.json({
    tenant: {
      id: toObjectIdString(req.tenant._id),
      slug: req.tenant.slug,
      name: req.tenant.name,
      status: req.tenant.status,
      onboardingStatus: req.tenant.onboardingStatus,
      planTier: req.tenant.planTier
    },
    identity: {
      networkName: content.networkDisplayName,
      tagline: content.welcomeHeadline,
      aboutText: content.aboutText,
      contactEmail: content.contactEmail,
      websiteUrl: content.supportUrl
    },
    branding: {
      logoUrl: theme.logoUrl,
      heroImageUrl: theme.heroImageUrl,
      brandPrimary: theme.brandPrimary
    },
    access: {
      signupMode: settings.signupMode,
      accessCodeHint: settings.accessCodeHint || "",
      hasAccessCode: Boolean(settings.hasAccessCode),
      allowedEmailDomains: settings.allowedEmailDomains || [],
      requireProfileCompletion: Boolean(settings.requireProfileCompletion)
    },
    admins: admins.map((item, index) => ({
      id: toObjectIdString(item._id),
      email: item.email,
      role: index === 0 ? "Director" : "Admin",
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
  const content = resolveContent(req.tenant);
  const draft = resolveDraft(req.tenant);
  const next = {
    networkDisplayName: String(req.body?.networkName ?? (content.networkDisplayName || "")).trim(),
    welcomeHeadline: String(req.body?.tagline ?? (content.welcomeHeadline || "")).trim(),
    aboutText: String(req.body?.aboutText ?? (content.aboutText || "")).trim(),
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
  const theme = resolveTheme(req.tenant);
  const draft = resolveDraft(req.tenant);
  const next = {
    brandPrimary: String(req.body?.brandPrimary ?? (theme.brandPrimary || "")).trim(),
    logoUrl: String(req.body?.logoUrl ?? (theme.logoUrl || "")).trim(),
    heroImageUrl: String(req.body?.heroImageUrl ?? (theme.heroImageUrl || "")).trim()
  };

  const currentTheme = req.tenant.theme || {};
  const tenant = await TenantModel.update(req.tenant._id, {
    theme: {
      ...currentTheme,
      brandPrimary: next.brandPrimary || theme.brandPrimary,
      logoUrl: next.logoUrl,
      heroImageUrl: next.heroImageUrl
    },
    onboardingDraft: {
      ...draft,
      theme: { ...draft.theme, ...next },
      updatedAt: new Date(),
      updatedByUserId: req.user.id
    }
  });

  return res.json({ ok: true, branding: resolveDraft(tenant).theme });
});

router.patch("/settings/access", async (req, res) => {
  const signupMode = normalizeSignupMode(req.body?.signupMode || "open");
  let settings;
  try {
    settings = await buildSettingsStorePayload(
      {
        ...resolveSettings(req.tenant),
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
  const draft = resolveDraft(req.tenant);

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

  return res.json({ ok: true, access: resolveDraft(tenant).settings });
});

router.get("/settings/admins", async (req, res) => {
  const [admins, pending] = await Promise.all([
    UserModel.find(req.tenant._id, { roles: { $contains: ["tenant_admin"] } }, {
      select: ["_id", "email", "createdAt"],
      sort: { createdAt: 1 }
    }),
    InviteModel.find(req.tenant._id, {
      roleToAssign: "tenant_admin",
      usedAt: null,
      expiresAt: { $gt: new Date() }
    }, {
      select: ["_id", "email", "createdAt", "expiresAt"],
      sort: { createdAt: -1 }
    })
  ]);

  return res.json({
    admins: admins.map((item, index) => ({
      id: toObjectIdString(item._id),
      email: item.email,
      role: index === 0 ? "Director" : "Admin",
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

router.post("/settings/admins/invite", async (req, res) => {
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
    return res.status(201).json({ ok: true, promotedExistingUser: true });
  }

  const expiresInDays = toBoundedInt(req.body?.expiresInDays, {
    min: 1,
    max: 30,
    fallback: env.INVITE_EXPIRES_DAYS
  });
  const expiresAt = new Date(Date.now() + expiresInDays * DAY_MS);
  const token = generateToken(24);

  const invite = await InviteModel.create({
    tenantId: req.tenant._id,
    email,
    token,
    expiresAt,
    usedAt: null,
    roleToAssign: "tenant_admin",
    createdByUserId: req.user.id
  });

  await sendInviteEmail({
    tenant: req.tenant,
    email,
    token: invite.token,
    roleToAssign: "tenant_admin",
    expiresAt: invite.expiresAt
  }).catch(() => {});

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
    select: ["_id"]
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

  return res.json({
    ok: true,
    status: tenant.status
  });
});

router.post("/settings/delete-request", async (req, res) => {
  const note = String(req.body?.note || "").trim();
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

router.post("/invites/send", inviteUpload.single("file"), async (req, res, next) => {
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
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

    const inputEmails = [
      ...parseEmailsFromText(req.body.emails || ""),
      ...parseEmailsFromCsv(req.file?.buffer || null)
    ];
    const uniqueEmails = [...new Set(inputEmails.filter((email) => isEmail(email)))];

    if (uniqueEmails.length === 0) {
      return res.status(400).json({
        error: {
          code: "EMAILS_REQUIRED",
          message: "Provide at least one valid email in text or CSV."
        }
      });
    }

    let createdCount = 0;
    let sentCount = 0;
    const skipped = [];

    for (const email of uniqueEmails) {
      const existingUser = await UserModel.findOne(req.tenant._id, { email });
      if (existingUser) {
        skipped.push({ email, reason: "USER_EXISTS" });
        continue;
      }

      const token = generateToken(24);
      const invite = await InviteModel.create({
        tenantId: req.tenant._id,
        email,
        token,
        expiresAt,
        usedAt: null,
        roleToAssign,
        createdByUserId: req.user.id
      });
      createdCount += 1;

      try {
        await sendInviteEmail({
          tenant: req.tenant,
          email,
          token: invite.token,
          roleToAssign,
          expiresAt: invite.expiresAt
        });
        sentCount += 1;
      } catch (error) {
        skipped.push({ email, reason: `EMAIL_SEND_FAILED: ${error.message}` });
      }
    }

    return res.status(201).json({
      ok: true,
      createdCount,
      sentCount,
      skipped
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/import-csv", csvUpload.single("file"), async (req, res, next) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({
        error: {
          code: "CSV_REQUIRED",
          message: "Upload CSV file under field name 'file'."
        }
      });
    }

    const enableFuzzyMatch = toBoolean(req.body?.enableFuzzyMatch);
    const fuzzyDistance = toBoundedInt(req.body?.fuzzyDistance, {
      min: 0,
      max: 4,
      fallback: 1
    });

    const report = await runTenantCsvImport({
      tenantId: req.tenant._id,
      userId: req.user.id,
      fileName: req.file.originalname || "import.csv",
      csvBuffer: req.file.buffer,
      options: { enableFuzzyMatch, fuzzyDistance }
    });

    return res.status(201).json({
      ok: true,
      report: {
        reportId: report.reportId,
        acceptedColumns: report.acceptedColumns,
        rowsRead: report.rowsRead,
        createdCount: report.createdCount,
        updatedCount: report.updatedCount,
        skippedDuplicates: report.skippedDuplicates,
        errorCount: report.errors.length,
        errors: report.errors,
        hasFailureCsv: Boolean(report.failureCsv),
        failureCsvDownloadPath: report.failureCsv
          ? `/api/t/${req.tenant.slug}/admin/imports/${report.reportId}/failures.csv`
          : ""
      }
    });
  } catch (error) {
    if (error?.code === "CSV_INVALID_FORMAT") {
      return res.status(400).json({
        error: {
          code: "CSV_INVALID_FORMAT",
          message: error.message
        }
      });
    }

    return next(error);
  }
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

router.delete("/profiles/:profileId", async (req, res) => {
  const profile = await ProfileModel.findOne(req.tenant._id, {
    _id: req.params.profileId
  });

  if (!profile) {
    return res.status(404).json({
      error: { code: "PROFILE_NOT_FOUND", message: "Profile not found" }
    });
  }

  await ProfileModel.delete(profile._id);
  if (profile.userId) {
    const user = await UserModel.findOne(req.tenant._id, { _id: profile.userId });
    if (user) await UserModel.delete(user._id);
  }

  return res.json({ ok: true, deletedProfileId: req.params.profileId });
});

router.get("/export/csv", async (req, res) => {
  const profiles = await ProfileModel.find(req.tenant._id, {}, {
    sort: { lastName: 1, firstName: 1 }
  });

  const records = profiles.map((profile) => ({
    firstName: profile.firstName,
    lastName: profile.lastName,
    email: profile.emails?.[0] || "",
    phone: profile.phones?.[0] || "",
    cityState: profile.cityState || "",
    roleAtCamp: profile.roleAtCamp || "",
    industry: profile.industry || ""
  }));

  const csv = stringify(records, { header: true });

  res.setHeader("Content-Type", "text/csv");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${req.tenant.slug}-directory-export.csv"`
  );
  return res.send(csv);
});

router.get("/export/pdf", requireFeature("pdfExport"), async (req, res) => {
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
  const theme = req.body.theme || {};

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
