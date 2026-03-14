import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import crypto from "node:crypto";
import dotenv from "dotenv";
import { createClerkClient } from "@clerk/backend";
import { getSupabaseAdmin } from "../src/db/supabaseAdmin.js";
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
  AnalyticsEventModel,
  ImportReportModel,
  TenantAdminAuditLogModel,
  ResumeParseResultModel,
  ActivityItemModel,
  ResendWebhookEventModel,
  StripeWebhookEventModel,
  EmailSuppressionModel
} from "../src/db/models/index.js";
import { env } from "../src/config/env.js";
import { composeCityState } from "../src/utils/location.js";
import { generateObjectId, isValidObjectId } from "../src/utils/objectId.js";
import { uploadBufferToR2 } from "../src/services/objectStorage.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(apiRoot, "..", "..");

export const CEDAR_SLUG = "cedar";
export const LEGACY_ROOT =
  process.env.CEDAR_LEGACY_ROOT || "/Users/asoroca/Desktop/camp-cedar-alumni-network";
export const LEGACY_BACKEND_DIR = path.join(LEGACY_ROOT, "camp-cedar-alumni-network-backend");
export const LEGACY_FRONTEND_DIR = path.join(LEGACY_ROOT, "camp-cedar-alumni-network-frontend");
export const MIGRATION_ROOT = path.join(repoRoot, "migration");
export const EXISTING_BACKUP_DIR = path.join(MIGRATION_ROOT, "cedar-existing-backup");
export const MAPPING_DIR = path.join(MIGRATION_ROOT, "cedar-mapping-files");
export const EXISTING_ARCHIVE_MANIFEST = path.join(EXISTING_BACKUP_DIR, "cedar-archive-manifest.json");
export const NEW_TENANT_MANIFEST = path.join(MAPPING_DIR, "cedar-new-tenant-manifest.json");
export const LEGACY_AUDIT_JSON = path.join(MAPPING_DIR, "legacy-cedar-audit.json");
export const IMPORT_SUMMARY_JSON = path.join(MAPPING_DIR, "cedar-import-summary.json");

export const CEDAR_TABLES = [
  { key: "users", table: "users", model: UserModel, filter: (query, tenantId) => query.eq("tenant_id", tenantId) },
  { key: "profiles", table: "profiles", model: ProfileModel, filter: (query, tenantId) => query.eq("tenant_id", tenantId) },
  { key: "invites", table: "invites", model: InviteModel, filter: (query, tenantId) => query.eq("tenant_id", tenantId) },
  {
    key: "access_requests",
    table: "access_requests",
    model: AccessRequestModel,
    filter: (query, tenantId) => query.eq("tenant_id", tenantId)
  },
  {
    key: "magic_link_tokens",
    table: "magic_link_tokens",
    model: MagicLinkTokenModel,
    filter: (query, tenantId) => query.eq("tenant_id", tenantId)
  },
  {
    key: "conversations",
    table: "conversations",
    model: ConversationModel,
    filter: (query, tenantId) => query.eq("tenant_id", tenantId)
  },
  { key: "messages", table: "messages", model: MessageModel, filter: (query, tenantId) => query.eq("tenant_id", tenantId) },
  { key: "forums", table: "forums", model: ForumModel, filter: (query, tenantId) => query.eq("tenant_id", tenantId) },
  {
    key: "forum_posts",
    table: "forum_posts",
    model: ForumPostModel,
    filter: (query, tenantId) => query.eq("tenant_id", tenantId)
  },
  { key: "photos", table: "photos", model: PhotoModel, filter: (query, tenantId) => query.eq("tenant_id", tenantId) },
  {
    key: "newsletters",
    table: "newsletters",
    model: NewsletterModel,
    filter: (query, tenantId) => query.eq("tenant_id", tenantId)
  },
  {
    key: "email_broadcasts",
    table: "email_broadcasts",
    model: EmailBroadcastModel,
    filter: (query, tenantId) => query.eq("tenant_id", tenantId)
  },
  {
    key: "family_trees",
    table: "family_trees",
    model: FamilyTreeModel,
    filter: (query, tenantId) => query.eq("tenant_id", tenantId)
  },
  {
    key: "analytics_events",
    table: "analytics_events",
    model: AnalyticsEventModel,
    filter: (query, tenantId) => query.eq("tenant_id", tenantId)
  },
  {
    key: "import_reports",
    table: "import_reports",
    model: ImportReportModel,
    filter: (query, tenantId) => query.eq("tenant_id", tenantId)
  },
  {
    key: "tenant_admin_audit_logs",
    table: "tenant_admin_audit_logs",
    model: TenantAdminAuditLogModel,
    filter: (query, tenantId) => query.eq("tenant_id", tenantId)
  },
  {
    key: "resume_parse_results",
    table: "resume_parse_results",
    model: ResumeParseResultModel,
    filter: (query, tenantId) => query.eq("tenant_id", tenantId)
  },
  {
    key: "activity_items",
    table: "activity_items",
    model: ActivityItemModel,
    filter: (query, tenantId) => query.eq("tenant_id", tenantId)
  },
  {
    key: "resend_webhook_events",
    table: "resend_webhook_events",
    model: ResendWebhookEventModel,
    filter: (query, tenantId, tenantSlug) => query.or(`tenant_id.eq.${tenantId},tenant_slug.eq.${tenantSlug}`)
  },
  {
    key: "stripe_webhook_events",
    table: "stripe_webhook_events",
    model: StripeWebhookEventModel,
    filter: (query, tenantId) => query.eq("tenant_id", tenantId)
  },
  {
    key: "email_suppressions",
    table: "email_suppressions",
    model: EmailSuppressionModel,
    filter: (query, tenantId, tenantSlug) => query.or(`tenant_id.eq.${tenantId},tenant_slug.eq.${tenantSlug}`)
  }
];

export function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function stableJson(value) {
  return JSON.stringify(value, null, 2);
}

export function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${stableJson(value)}\n`, "utf8");
}

export function writeMarkdown(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content.endsWith("\n") ? content : `${content}\n`, "utf8");
}

export function readJsonIfExists(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function hashValue(value = "") {
  return crypto.createHash("sha1").update(String(value || "")).digest("hex");
}

export function isoNow() {
  return new Date().toISOString();
}

export function timestampSlugSuffix(date = new Date()) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  const second = String(date.getUTCSeconds()).padStart(2, "0");
  return `${year}${month}${day}-${hour}${minute}${second}`;
}

export function normalizeEmail(value = "") {
  return String(value || "").trim().toLowerCase();
}

export function normalizeRoleLabels(value = []) {
  const ordered = [];
  const seen = new Set();
  for (const item of Array.isArray(value) ? value : []) {
    const role = String(item || "").trim();
    const key = role.toLowerCase();
    if (!role || seen.has(key)) continue;
    seen.add(key);
    ordered.push(role);
  }
  return ordered;
}

export function makeLegacyRequire() {
  return createRequire(path.join(LEGACY_BACKEND_DIR, "package.json"));
}

export function loadLegacyEnv() {
  const envPath = path.join(LEGACY_BACKEND_DIR, ".env");
  if (!fs.existsSync(envPath)) {
    throw new Error(`Legacy backend env file not found at ${envPath}`);
  }
  return dotenv.parse(fs.readFileSync(envPath, "utf8"));
}

export async function withLegacyDb(run) {
  const legacyRequire = makeLegacyRequire();
  const mongoose = legacyRequire("mongoose");
  const legacyEnv = loadLegacyEnv();
  const uri = legacyEnv.MONGODB_URI || legacyEnv.MONGO_URI;
  if (!uri) throw new Error("Legacy Mongo URI not configured.");

  await mongoose.connect(uri);
  try {
    return await run({ mongoose, db: mongoose.connection.db, legacyEnv });
  } finally {
    await mongoose.disconnect();
  }
}

export async function fetchAllRowsForTable({ table, tenantId, tenantSlug = "" }) {
  const spec = CEDAR_TABLES.find((item) => item.table === table || item.key === table);
  if (!spec) throw new Error(`Unknown Cedar table: ${table}`);
  const pageSize = 1000;
  const allRows = [];
  for (let page = 0; page < 500; page += 1) {
    let query = getSupabaseAdmin().from(spec.table).select("*").range(page * pageSize, (page + 1) * pageSize - 1);
    query = spec.filter(query, tenantId, tenantSlug);
    const { data, error } = await query;
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    allRows.push(...rows);
    if (rows.length < pageSize) break;
  }
  return allRows;
}

export async function countRowsForTable({ table, tenantId, tenantSlug = "" }) {
  const spec = CEDAR_TABLES.find((item) => item.table === table || item.key === table);
  if (!spec) throw new Error(`Unknown Cedar table: ${table}`);
  let query = getSupabaseAdmin().from(spec.table).select("id", { count: "exact", head: true });
  query = spec.filter(query, tenantId, tenantSlug);
  const { count, error } = await query;
  if (error) throw error;
  return Number(count || 0);
}

export async function findTenantBySlug(slug = CEDAR_SLUG) {
  return TenantModel.findBySlug(String(slug || "").trim().toLowerCase());
}

export async function fetchTenantInventory() {
  const { data, error } = await getSupabaseAdmin()
    .from("tenants")
    .select("id,slug,name,status,created_at,updated_at")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function exportTenantBackup({ tenant, outputDir }) {
  ensureDir(outputDir);
  const summary = {
    tenant: {
      id: String(tenant?._id || tenant?.id || ""),
      slug: String(tenant?.slug || ""),
      name: String(tenant?.name || ""),
      status: String(tenant?.status || "")
    },
    exportedAt: isoNow(),
    tables: {}
  };

  writeJson(path.join(outputDir, "tenant.json"), tenant);

  for (const spec of CEDAR_TABLES) {
    const rows = await fetchAllRowsForTable({
      table: spec.table,
      tenantId: String(tenant._id || tenant.id),
      tenantSlug: String(tenant.slug || "")
    });
    writeJson(path.join(outputDir, `${spec.table}.json`), rows);
    summary.tables[spec.table] = { count: rows.length, file: `${spec.table}.json` };
  }

  const nonTargetTenants = (await fetchTenantInventory()).filter(
    (row) => String(row.id || "") !== String(tenant._id || tenant.id || "")
  );
  writeJson(path.join(outputDir, "non_cedar_tenants.json"), nonTargetTenants);
  summary.nonCedarTenantCount = nonTargetTenants.length;

  return summary;
}

export function legacyRoleSummary(user = {}) {
  return normalizeRoleLabels(user?.roles || []);
}

export function legacyRoleAtCamp(user = {}) {
  return legacyRoleSummary(user).join(", ");
}

export function legacyUserNeedsTenantAdmin(user = {}) {
  const email = normalizeEmail(user?.email || "");
  return email === "aden@sorocafamily.com";
}

export function buildProfileSocials(user = {}) {
  const roleLabels = legacyRoleSummary(user);
  const education = Array.isArray(user?.education) ? user.education : [];
  const majors = [...new Set(education.map((row) => String(row?.major || "").trim()).filter(Boolean))];
  const socials = user?.social && typeof user.social === "object" ? user.social : {};
  const legalAcceptance =
    user?.legalAcceptance && typeof user.legalAcceptance === "object" ? user.legalAcceptance : {};
  return {
    linkedin: String(socials.linkedin || "").trim(),
    instagram: String(socials.instagram || "").trim(),
    facebook: String(socials.facebook || "").trim(),
    nickname: String(user?.nickname || "").trim(),
    campNickname: String(user?.nickname || "").trim(),
    camperYears: {
      firstYear: String(user?.camperYears?.firstYear || "").trim(),
      firstGroup: String(user?.camperYears?.firstGroup || "").trim(),
      lastYear: String(user?.camperYears?.lastYear || "").trim(),
      lastGroup: String(user?.camperYears?.lastGroup || "").trim()
    },
    roles: roleLabels,
    collegeMajors: majors,
    educationMajors: majors,
    legalAgreement: {
      accepted: Boolean(legalAcceptance.accepted),
      acceptedAt: legalAcceptance.acceptedAt ? new Date(legalAcceptance.acceptedAt).toISOString() : null,
      termsVersion: String(legalAcceptance.version || "").trim()
    }
  };
}

export function mapLegacyUserToProfile(user = {}) {
  const education = Array.isArray(user?.education) ? user.education : [];
  const currentJobs = Array.isArray(user?.currentJobs) ? user.currentJobs : [];
  const pastJobs = Array.isArray(user?.pastJobs) ? user.pastJobs : [];
  const emails = [normalizeEmail(user?.email || "")].filter(Boolean);
  const phones = [String(user?.phone || "").trim()].filter(Boolean);
  const cityState = composeCityState({
    city: String(user?.city || "").trim(),
    state: String(user?.state || "").trim().toUpperCase(),
    country: String(user?.country || "").trim()
  });

  return {
    firstName: String(user?.firstName || "").trim(),
    lastName: String(user?.lastName || "").trim(),
    emails,
    phones,
    cityState,
    roleAtCamp: legacyRoleAtCamp(user),
    highSchool: String(user?.highSchool || "").trim(),
    colleges: [...new Set(education.map((row) => String(row?.college || "").trim()).filter(Boolean))],
    collegeYears: [...new Set(education.map((row) => String(row?.year || "").trim()).filter(Boolean))],
    currentJobs: currentJobs.map((job) => ({
      role: String(job?.role || "").trim(),
      company: String(job?.company || "").trim(),
      years: String(job?.years || "").trim()
    })),
    pastJobs: pastJobs.map((job) => ({
      role: String(job?.role || "").trim(),
      company: String(job?.company || "").trim(),
      years: String(job?.years || "").trim()
    })),
    industry: String(user?.industry || "").trim(),
    socials: buildProfileSocials(user),
    avatarUrl: String(user?.uploads?.photoUrl || "").trim(),
    bio: "",
    status: "active",
    flaggedReason: ""
  };
}

export function encodeR2Pointer({ key = "", objectUrl = "" } = {}) {
  return Buffer.from(
    JSON.stringify({
      key: String(key || "").trim(),
      objectUrl: String(objectUrl || "").trim()
    }),
    "utf8"
  );
}

export async function fetchBuffer(url, { timeoutMs = 20_000 } = {}) {
  const normalized = String(url || "").trim();
  if (!normalized) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(normalized, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Download failed (${response.status}) for ${normalized}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } finally {
    clearTimeout(timer);
  }
}

export async function migrateRemoteAssetToR2({
  sourceUrl = "",
  tenantSlug = CEDAR_SLUG,
  prefix = "uploads",
  fileName = "file",
  fileType = "",
  objectProxyBaseUrl = "",
  maxBytes
} = {}) {
  const normalized = String(sourceUrl || "").trim();
  if (!normalized) {
    return { sourceUrl: normalized, status: "skipped", objectUrl: "", key: "", contentType: "", size: 0 };
  }
  const body = await fetchBuffer(normalized);
  const uploaded = await uploadBufferToR2({
    tenantSlug,
    prefix,
    fileName,
    fileType,
    body,
    objectProxyBaseUrl,
    ...(maxBytes ? { maxBytes } : {})
  });
  return {
    sourceUrl: normalized,
    status: "uploaded",
    ...uploaded
  };
}

export function buildTenantObjectProxyBaseUrl(slug = CEDAR_SLUG) {
  const origin = String(env.FRONTEND_ORIGIN || "").trim().replace(/\/+$/, "");
  if (!origin) return "";
  return `${origin}/api/t/${slug}/objects`;
}

export function clerkClientOrNull() {
  if (!env.CLERK_SECRET_KEY) return null;
  return createClerkClient({ secretKey: env.CLERK_SECRET_KEY });
}

export async function listExistingClerkUsersByEmails(clerkClient, emails = []) {
  if (!clerkClient) return [];
  const normalized = [...new Set(emails.map((email) => normalizeEmail(email)).filter(Boolean))];
  if (normalized.length === 0) return [];
  const pages = [];
  for (let index = 0; index < normalized.length; index += 100) {
    const chunk = normalized.slice(index, index + 100);
    const response = await clerkClient.users.getUserList({
      emailAddress: chunk,
      limit: chunk.length
    });
    pages.push(...(response?.data || []));
  }
  return pages;
}

export async function getLegacyAuditSnapshot() {
  return withLegacyDb(async ({ db }) => {
    const [users, photos, newsletters, forums, forumPosts, conversations, messages, familyTrees, activities, photoComments, prelaunchSignups] =
      await Promise.all([
        db.collection("users").find({}).toArray(),
        db.collection("photos").find({}).toArray(),
        db.collection("newsletters").find({}).toArray(),
        db.collection("forums").find({}).toArray(),
        db.collection("forumposts").find({}).toArray(),
        db.collection("conversations").find({}).toArray(),
        db.collection("messages").find({}).toArray(),
        db.collection("familytrees").find({}).toArray(),
        db.collection("activities").find({}).toArray(),
        db.collection("photocomments").find({}).toArray(),
        db.collection("prelaunchsignups").find({}).toArray()
      ]);

    const duplicatePrelaunchEmails = new Map();
    for (const row of prelaunchSignups) {
      const email = normalizeEmail(row?.email || "");
      if (!email) continue;
      duplicatePrelaunchEmails.set(email, Number(duplicatePrelaunchEmails.get(email) || 0) + 1);
    }

    return {
      users,
      photos,
      newsletters,
      forums,
      forumPosts,
      conversations,
      messages,
      familyTrees,
      activities,
      photoComments,
      prelaunchSignups,
      stats: {
        users: users.length,
        photos: photos.length,
        newsletters: newsletters.length,
        forums: forums.length,
        forumPosts: forumPosts.length,
        conversations: conversations.length,
        messages: messages.length,
        familyTrees: familyTrees.length,
        activities: activities.length,
        photoComments: photoComments.length,
        prelaunchSignups: prelaunchSignups.length,
        duplicatePrelaunchEmailGroups: [...duplicatePrelaunchEmails.values()].filter((count) => count > 1).length
      }
    };
  });
}

export async function assertNoIdConflicts({
  userIds = [],
  profileIds = [],
  contentIds = []
} = {}) {
  const conflicts = {
    users: [],
    profiles: [],
    content: []
  };
  const checkIds = async (table, ids) => {
    const unique = [...new Set((ids || []).map((value) => String(value || "").trim()).filter(Boolean))];
    if (unique.length === 0) return [];
    const found = [];
    for (let index = 0; index < unique.length; index += 100) {
      const chunk = unique.slice(index, index + 100);
      const { data, error } = await getSupabaseAdmin().from(table).select("id").in("id", chunk);
      if (error) throw error;
      found.push(...(data || []).map((row) => String(row.id || "")));
    }
    return found;
  };

  conflicts.users = await checkIds("users", userIds);
  conflicts.profiles = await checkIds("profiles", profileIds);
  conflicts.content = await checkIds("photos", contentIds);
  return conflicts;
}

export function buildArchivedTenantPatch(tenant = {}, { suffix = timestampSlugSuffix() } = {}) {
  const baseName = String(tenant?.name || "Camp Cedar").trim();
  return {
    slug: `${CEDAR_SLUG}-archived-${suffix}`.slice(0, 80),
    name: `${baseName} (Archived ${suffix})`,
    status: "inactive",
    customDomain: ""
  };
}

export async function createOrUpdateTenant(tenantId, payload) {
  return TenantModel.create({
    id: tenantId,
    ...payload
  });
}

export function parseApplyFlag(argv = process.argv.slice(2)) {
  return argv.includes("--apply");
}

export function summarizeCountsObject(input = {}) {
  return Object.fromEntries(
    Object.entries(input || {})
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([key, value]) => [key, Number(value || 0)])
  );
}

export function basenameFromUrl(url = "", fallback = "file") {
  const raw = String(url || "").trim().split("?")[0].split("#")[0];
  const base = raw.split("/").pop() || "";
  return base || fallback;
}

export function ensureHexObjectId(value, fallbackPrefix = "migrated") {
  const normalized = String(value || "").trim();
  if (isValidObjectId(normalized)) return normalized;
  const hex = crypto.createHash("md5").update(`${fallbackPrefix}:${normalized}`).digest("hex");
  return hex.slice(0, 24);
}
