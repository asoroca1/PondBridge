import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const { env } = await import("../src/config/env.js");
const { connectToDatabase } = await import("../src/db/connect.js");
const { isR2Configured, uploadBufferToR2 } = await import("../src/services/objectStorage.js");
const { Tenant } = await import("../src/models/Tenant.js");
const { Profile } = await import("../src/models/Profile.js");
const { AccessRequest } = await import("../src/models/AccessRequest.js");
const { Photo } = await import("../src/models/Photo.js");
const { Message } = await import("../src/models/Message.js");
const { Conversation } = await import("../src/models/Conversation.js");
const { ForumPost } = await import("../src/models/ForumPost.js");

const MODEL_JOBS = [
  {
    name: "Profile",
    model: Profile,
    tenantIdPath: "tenantId",
    fields: [{ path: "avatarUrl", prefix: "profiles/avatars", fileBase: "avatar" }]
  },
  {
    name: "AccessRequest",
    model: AccessRequest,
    tenantIdPath: "tenantId",
    fields: [{ path: "profilePayload.avatarUrl", prefix: "profiles/avatars", fileBase: "avatar" }]
  },
  {
    name: "Photo",
    model: Photo,
    tenantIdPath: "tenantId",
    fields: [
      { path: "imageUrl", prefix: "photos/images", fileBase: "photo" },
      { path: "thumbUrl", prefix: "photos/thumbs", fileBase: "thumb" }
    ]
  },
  {
    name: "Message",
    model: Message,
    tenantIdPath: "tenantId",
    fields: [
      {
        path: "media.url",
        keyPath: "media.key",
        prefix: "messages/media",
        fileBase: "message-attachment"
      }
    ]
  },
  {
    name: "Conversation",
    model: Conversation,
    tenantIdPath: "tenantId",
    fields: [
      {
        path: "lastMessage.media.url",
        keyPath: "lastMessage.media.key",
        prefix: "messages/media",
        fileBase: "message-preview"
      }
    ]
  },
  {
    name: "ForumPost",
    model: ForumPost,
    tenantIdPath: "tenantId",
    fields: [
      {
        path: "media.url",
        keyPath: "media.key",
        prefix: "forums/media",
        fileBase: "forum-attachment"
      }
    ]
  },
  {
    name: "Tenant",
    model: Tenant,
    tenantIdPath: "_id",
    fields: [
      { path: "theme.logoUrl", prefix: "branding/logos", fileBase: "logo" },
      { path: "theme.heroImageUrl", prefix: "branding/heroes", fileBase: "hero" },
      { path: "onboardingDraft.theme.logoUrl", prefix: "branding/logos", fileBase: "logo" },
      { path: "onboardingDraft.theme.heroImageUrl", prefix: "branding/heroes", fileBase: "hero" }
    ]
  }
];

const MIME_TO_EXTENSION = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "text/csv": "csv",
  "application/json": "json",
  "video/mp4": "mp4",
  "video/webm": "webm"
};

const LEGACY_PATH_MARKERS = [
  "/uploads/mock-public/",
  "/api/cedar-compat/uploads/mock-public/",
  "/cedar-compat/uploads/mock-public/"
];

const LEGACY_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "pondbridge.local"]);

function printUsage() {
  console.log(`
Usage:
  node scripts/migrateLegacyMediaToR2.js [--apply] [--tenant=<slug-or-id>] [--include-http]
                                         [--base-url=<url>] [--timeout-ms=<number>] [--limit=<number>]

Defaults:
  - Runs in dry-run mode unless --apply is provided.
  - Migrates legacy/mock/data URLs only.

Examples:
  node scripts/migrateLegacyMediaToR2.js
  node scripts/migrateLegacyMediaToR2.js --apply
  node scripts/migrateLegacyMediaToR2.js --apply --tenant=camp-cedar
  node scripts/migrateLegacyMediaToR2.js --apply --include-http
  node scripts/migrateLegacyMediaToR2.js --apply --base-url=https://api.yourdomain.com
`);
}

function parseArgs(argv = []) {
  const options = {
    apply: false,
    includeHttp: false,
    baseUrl: "",
    timeoutMs: 15000,
    tenant: "",
    limit: 0,
    verbose: false,
    help: false
  };

  for (const raw of argv) {
    const arg = String(raw || "").trim();
    if (!arg) continue;
    if (arg === "--apply") {
      options.apply = true;
      continue;
    }
    if (arg === "--include-http") {
      options.includeHttp = true;
      continue;
    }
    if (arg === "--verbose") {
      options.verbose = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg.startsWith("--base-url=")) {
      options.baseUrl = normalizeUrlBase(arg.slice("--base-url=".length));
      continue;
    }
    if (arg.startsWith("--tenant=")) {
      options.tenant = String(arg.slice("--tenant=".length) || "").trim();
      continue;
    }
    if (arg.startsWith("--timeout-ms=")) {
      const parsed = Number(arg.slice("--timeout-ms=".length));
      if (Number.isFinite(parsed) && parsed > 0) {
        options.timeoutMs = Math.min(120000, Math.max(1000, Math.floor(parsed)));
      }
      continue;
    }
    if (arg.startsWith("--limit=")) {
      const parsed = Number(arg.slice("--limit=".length));
      if (Number.isFinite(parsed) && parsed > 0) {
        options.limit = Math.floor(parsed);
      }
      continue;
    }
  }

  return options;
}

function normalizeUrlBase(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return new URL(raw).toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function hashValue(value = "") {
  return crypto.createHash("sha1").update(String(value || "")).digest("hex");
}

function pathParts(pathValue = "") {
  return String(pathValue || "")
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);
}

function getPathValue(root, targetPath) {
  const parts = pathParts(targetPath);
  if (!parts.length) return root;
  let cursor = root;
  for (const part of parts) {
    if (cursor === null || cursor === undefined) return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

function normalizeContentType(value = "") {
  return String(value || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
}

function asString(value) {
  if (value === undefined || value === null) return "";
  return String(value);
}

function trimHashAndQuery(value = "") {
  return String(value || "").split("#")[0].split("?")[0];
}

function sanitizeFileName(value = "") {
  const cleaned = String(value || "")
    .trim()
    .replace(/[\/\\]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned;
}

function extensionFromContentType(contentType = "") {
  return MIME_TO_EXTENSION[normalizeContentType(contentType)] || "";
}

function extractFileNameFromUrlLike(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";

  let pathname = "";
  try {
    pathname = new URL(raw).pathname || "";
  } catch {
    pathname = trimHashAndQuery(raw);
  }

  const segments = pathname.split("/").filter(Boolean);
  if (!segments.length) return "";

  const last = segments[segments.length - 1];
  let decoded = last;
  try {
    decoded = decodeURIComponent(last);
  } catch {
    decoded = last;
  }

  return sanitizeFileName(decoded);
}

function buildUploadFileName({ sourceUrl, fileBase, contentType }) {
  const fromSource = extractFileNameFromUrlLike(sourceUrl);
  if (fromSource && fromSource.includes(".")) return fromSource;

  const extension = extensionFromContentType(contentType);
  if (extension) return `${sanitizeFileName(fileBase) || "file"}.${extension}`;
  return sanitizeFileName(fileBase) || "file";
}

function isDataUrl(value = "") {
  return String(value || "").trim().toLowerCase().startsWith("data:");
}

function isHttpUrl(value = "") {
  return /^https?:\/\//i.test(String(value || "").trim());
}

function isLegacyUrl(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return false;
  const lower = raw.toLowerCase();

  if (LEGACY_PATH_MARKERS.some((marker) => lower.includes(marker))) {
    return true;
  }

  if (lower.startsWith("/api/cedar-compat/uploads/")) {
    return true;
  }

  if (isHttpUrl(raw)) {
    try {
      const parsed = new URL(raw);
      const host = parsed.hostname.toLowerCase();
      const pathName = parsed.pathname.toLowerCase();
      const isLegacyHost =
        LEGACY_HOSTS.has(host) ||
        [...LEGACY_HOSTS].some((candidate) => host.endsWith(`.${candidate}`));
      if (isLegacyHost && pathName.includes("/uploads/")) {
        return true;
      }
    } catch {
      return false;
    }
  }

  return false;
}

function isAlreadyR2Url(value = "", r2PublicBase = "") {
  const candidate = String(value || "").trim();
  const base = normalizeUrlBase(r2PublicBase);
  if (!candidate || !base) return false;
  const normalizedCandidate = candidate.replace(/\/+$/, "");
  return normalizedCandidate === base || normalizedCandidate.startsWith(`${base}/`);
}

function classifyCandidate(value = "", { includeHttp, r2PublicBase }) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (isAlreadyR2Url(raw, r2PublicBase)) return "";
  if (isDataUrl(raw)) return "data";
  if (isLegacyUrl(raw)) return "legacy";
  if (includeHttp && isHttpUrl(raw)) return "http";
  return "";
}

function parseDataUrl(value = "") {
  const raw = String(value || "").trim();
  if (!isDataUrl(raw)) {
    const error = new Error("Source is not a data URL.");
    error.code = "INVALID_DATA_URL";
    throw error;
  }

  const commaIndex = raw.indexOf(",");
  if (commaIndex <= 4) {
    const error = new Error("Malformed data URL.");
    error.code = "INVALID_DATA_URL";
    throw error;
  }

  const meta = raw.slice(5, commaIndex);
  const payload = raw.slice(commaIndex + 1);
  const metaTokens = meta.split(";").map((entry) => entry.trim()).filter(Boolean);

  let contentType = "application/octet-stream";
  if (metaTokens.length && !metaTokens[0].includes("=") && metaTokens[0] !== "base64") {
    contentType = metaTokens[0];
  }
  const isBase64Payload = metaTokens.includes("base64");

  try {
    const body = isBase64Payload
      ? Buffer.from(payload, "base64")
      : Buffer.from(decodeURIComponent(payload), "utf8");

    if (!body.length) {
      const error = new Error("Data URL payload is empty.");
      error.code = "EMPTY_SOURCE";
      throw error;
    }

    return {
      body,
      contentType: normalizeContentType(contentType)
    };
  } catch (error) {
    const wrapped = new Error(`Failed to decode data URL: ${error.message}`);
    wrapped.code = "INVALID_DATA_URL";
    throw wrapped;
  }
}

function resolveFetchUrl(sourceUrl = "", baseUrl = "") {
  const raw = String(sourceUrl || "").trim();
  if (!raw) {
    const error = new Error("Source URL is empty.");
    error.code = "INVALID_SOURCE_URL";
    throw error;
  }

  if (isHttpUrl(raw)) return raw;
  if (raw.startsWith("//")) return `https:${raw}`;

  if (!baseUrl) {
    const error = new Error(
      "Relative URL cannot be fetched without --base-url. Provide an API origin and rerun."
    );
    error.code = "RELATIVE_SOURCE_URL";
    throw error;
  }

  try {
    return new URL(raw, baseUrl).toString();
  } catch {
    const error = new Error(`Could not resolve source URL '${raw}' against base '${baseUrl}'.`);
    error.code = "INVALID_SOURCE_URL";
    throw error;
  }
}

async function fetchBinarySource(sourceUrl = "", { baseUrl = "", timeoutMs = 15000 } = {}) {
  const fetchUrl = resolveFetchUrl(sourceUrl, baseUrl);
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(fetchUrl, { signal: controller.signal, redirect: "follow" });
  } catch (error) {
    const wrapped = new Error(`Failed to fetch '${fetchUrl}': ${error.message}`);
    wrapped.code = error?.name === "AbortError" ? "FETCH_TIMEOUT" : "FETCH_FAILED";
    throw wrapped;
  } finally {
    clearTimeout(timeoutHandle);
  }

  if (!response.ok) {
    const error = new Error(`Fetch failed for '${fetchUrl}' with status ${response.status}.`);
    error.code = "FETCH_FAILED";
    throw error;
  }

  const arrayBuffer = await response.arrayBuffer();
  const body = Buffer.from(arrayBuffer);
  if (!body.length) {
    const error = new Error(`Fetched source '${fetchUrl}' is empty.`);
    error.code = "EMPTY_SOURCE";
    throw error;
  }

  return {
    body,
    contentType: normalizeContentType(response.headers.get("content-type") || ""),
    fetchUrl
  };
}

async function loadSourceBinary(sourceUrl = "", options = {}) {
  if (isDataUrl(sourceUrl)) {
    return {
      ...parseDataUrl(sourceUrl),
      fetchUrl: ""
    };
  }
  return fetchBinarySource(sourceUrl, options);
}

async function loadTenantMap(tenantFilter = "") {
  const tenants = await Tenant.find({}).select("_id slug").lean();
  const tenantMap = new Map();
  for (const tenant of tenants) {
    const id = asString(tenant?._id).trim();
    const slug = asString(tenant?.slug).trim();
    if (!id || !slug) continue;
    tenantMap.set(id, slug);
  }

  if (!tenantFilter) {
    return {
      tenantMap,
      allowedTenantIds: new Set(tenantMap.keys())
    };
  }

  const tokens = tenantFilter
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const matched = new Set();
  for (const token of tokens) {
    for (const [tenantId, slug] of tenantMap.entries()) {
      if (token === tenantId || token.toLowerCase() === slug.toLowerCase()) {
        matched.add(tenantId);
      }
    }
  }

  if (!matched.size) {
    throw new Error(`No tenants matched --tenant=${tenantFilter}`);
  }

  return {
    tenantMap,
    allowedTenantIds: matched
  };
}

function buildModelFilter(job, allowedTenantIds = new Set()) {
  const ids = [...allowedTenantIds];
  if (!ids.length) return {};

  if (job.tenantIdPath === "_id") {
    return { _id: { $in: ids } };
  }

  return { [job.tenantIdPath]: { $in: ids } };
}

function formatSummaryLine(label, value) {
  return `${label.padEnd(28, " ")} ${value}`;
}

function buildSelectFields(job) {
  const unique = new Set(["_id", job.tenantIdPath]);
  for (const field of job.fields) {
    unique.add(field.path);
    if (field.keyPath) unique.add(field.keyPath);
  }
  return [...unique].join(" ");
}

function collectFailure(failures, payload) {
  if (failures.length >= 40) return;
  failures.push(payload);
}

async function migrateOneCandidate({
  sourceUrl,
  sourceType,
  tenantSlug,
  fieldConfig,
  apply,
  baseUrl,
  timeoutMs,
  cache
}) {
  const key = `${tenantSlug}:${hashValue(sourceUrl)}`;
  if (cache.has(key)) {
    return cache.get(key);
  }

  try {
    const source = await loadSourceBinary(sourceUrl, { baseUrl, timeoutMs });
    const contentType = normalizeContentType(source.contentType || "");
    const fileName = buildUploadFileName({
      sourceUrl,
      fileBase: fieldConfig.fileBase,
      contentType
    });

    if (!apply) {
      const planned = {
        ok: true,
        dryRun: true,
        sourceType,
        bytes: source.body.length,
        contentType: contentType || "application/octet-stream"
      };
      cache.set(key, planned);
      return planned;
    }

    const uploaded = await uploadBufferToR2({
      tenantSlug,
      prefix: fieldConfig.prefix,
      fileName,
      fileType: contentType || "application/octet-stream",
      body: source.body
    });

    const migrated = {
      ok: true,
      sourceType,
      bytes: source.body.length,
      objectUrl: uploaded.objectUrl,
      key: uploaded.key
    };
    cache.set(key, migrated);
    return migrated;
  } catch (error) {
    const failed = {
      ok: false,
      code: String(error?.code || "MIGRATION_FAILED"),
      message: String(error?.message || "Unknown migration failure")
    };
    cache.set(key, failed);
    return failed;
  }
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  if (!isR2Configured()) {
    throw new Error(
      "R2 is not configured. Set R2_BUCKET_NAME, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT, and R2_PUBLIC_BASE_URL."
    );
  }

  await connectToDatabase();

  const tenantScope = await loadTenantMap(options.tenant);
  const tenantMap = tenantScope.tenantMap;
  const allowedTenantIds = tenantScope.allowedTenantIds;
  const failures = [];
  const cache = new Map();

  const stats = {
    scannedDocs: 0,
    scannedFields: 0,
    candidateFields: 0,
    plannedMigrations: 0,
    appliedMigrations: 0,
    updatedDocs: 0,
    skippedNoTenant: 0,
    skippedUnrecoverable: 0,
    modelUpdates: {}
  };

  for (const job of MODEL_JOBS) {
    const filter = buildModelFilter(job, allowedTenantIds);
    const select = buildSelectFields(job);
    let query = job.model.find(filter).select(select).lean();
    if (options.limit > 0) {
      query = query.limit(options.limit);
    }
    const docs = await query;

    console.log(`[migration] scanning ${job.name}: ${docs.length} records`);

    let updatedForModel = 0;
    let processed = 0;

    for (const doc of docs) {
      stats.scannedDocs += 1;
      processed += 1;

      if (options.verbose && processed % 200 === 0) {
        console.log(`[migration] ${job.name}: processed ${processed}/${docs.length}`);
      }

      const tenantIdValue = job.tenantIdPath === "_id" ? doc?._id : getPathValue(doc, job.tenantIdPath);
      const tenantId = asString(tenantIdValue).trim();
      const tenantSlug = tenantMap.get(tenantId);
      if (!tenantSlug) {
        stats.skippedNoTenant += job.fields.length;
        continue;
      }

      const setPatch = {};

      for (const fieldConfig of job.fields) {
        stats.scannedFields += 1;
        const currentValue = asString(getPathValue(doc, fieldConfig.path)).trim();
        if (!currentValue) continue;

        const sourceType = classifyCandidate(currentValue, {
          includeHttp: options.includeHttp,
          r2PublicBase: env.R2_PUBLIC_BASE_URL
        });
        if (!sourceType) continue;

        stats.candidateFields += 1;
        const migrated = await migrateOneCandidate({
          sourceUrl: currentValue,
          sourceType,
          tenantSlug,
          fieldConfig,
          apply: options.apply,
          baseUrl: options.baseUrl,
          timeoutMs: options.timeoutMs,
          cache
        });

        if (!migrated.ok) {
          stats.skippedUnrecoverable += 1;
          collectFailure(failures, {
            model: job.name,
            id: asString(doc?._id),
            field: fieldConfig.path,
            code: migrated.code,
            message: migrated.message,
            value: currentValue.slice(0, 140)
          });
          continue;
        }

        if (options.apply) {
          setPatch[fieldConfig.path] = migrated.objectUrl;
          if (fieldConfig.keyPath && migrated.key) {
            setPatch[fieldConfig.keyPath] = migrated.key;
          }
          stats.appliedMigrations += 1;
        } else {
          stats.plannedMigrations += 1;
        }
      }

      if (options.apply && Object.keys(setPatch).length > 0) {
        await job.model.updateOne({ _id: doc._id }, { $set: setPatch });
        stats.updatedDocs += 1;
        updatedForModel += 1;
      }
    }

    stats.modelUpdates[job.name] = updatedForModel;
  }

  console.log("");
  console.log(`[migration] mode: ${options.apply ? "APPLY" : "DRY RUN"}`);
  console.log(formatSummaryLine("Tenant scope:", allowedTenantIds.size));
  console.log(formatSummaryLine("Records scanned:", stats.scannedDocs));
  console.log(formatSummaryLine("Fields scanned:", stats.scannedFields));
  console.log(formatSummaryLine("Legacy candidates:", stats.candidateFields));
  console.log(formatSummaryLine("Planned migrations:", stats.plannedMigrations));
  console.log(formatSummaryLine("Applied migrations:", stats.appliedMigrations));
  console.log(formatSummaryLine("Updated records:", stats.updatedDocs));
  console.log(formatSummaryLine("Skipped no tenant:", stats.skippedNoTenant));
  console.log(formatSummaryLine("Skipped unrecoverable:", stats.skippedUnrecoverable));

  if (options.apply) {
    console.log("");
    console.log("[migration] updated records by model:");
    for (const [modelName, count] of Object.entries(stats.modelUpdates)) {
      console.log(`  ${modelName}: ${count}`);
    }
  } else {
    console.log("");
    console.log("[migration] dry run only. Re-run with --apply to persist URL rewrites.");
  }

  if (failures.length > 0) {
    console.log("");
    console.log("[migration] sample unrecoverable records:");
    for (const failure of failures) {
      console.log(
        `  ${failure.model}#${failure.id} ${failure.field} -> ${failure.code} (${failure.message}) [${failure.value}]`
      );
    }
    console.log("");
    console.log(
      "[migration] Tip: for relative URLs, rerun with --base-url=https://<your-api-origin> if those assets are still reachable there."
    );
  }
}

run().catch((error) => {
  console.error("[migration] failed", error);
  process.exit(1);
});
