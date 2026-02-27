import crypto from "crypto";
import {
  HeadBucketCommand,
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../config/env.js";

let r2Client = null;

const EXTENSION_CONTENT_TYPES = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  txt: "text/plain",
  csv: "text/csv",
  json: "application/json",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm"
};

function trimTrailingSlashes(value = "") {
  return String(value || "").replace(/\/+$/, "");
}

function normalizeSegment(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeFileName(fileName = "file") {
  const raw = String(fileName || "file").trim() || "file";
  const cleaned = raw
    .replace(/[\/\\]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned || "file";
}

function splitNameAndExtension(fileName = "") {
  const safe = normalizeFileName(fileName);
  const idx = safe.lastIndexOf(".");
  if (idx <= 0 || idx === safe.length - 1) return { baseName: safe, extension: "" };
  return {
    baseName: safe.slice(0, idx),
    extension: safe.slice(idx + 1).toLowerCase()
  };
}

function inferContentType({ fileType = "", fileName = "" }) {
  const normalizedFileType = String(fileType || "").trim().toLowerCase();
  if (/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(normalizedFileType)) {
    return normalizedFileType;
  }

  const { extension } = splitNameAndExtension(fileName);
  return EXTENSION_CONTENT_TYPES[extension] || "application/octet-stream";
}

function inferExtensionFromContentType(contentType = "") {
  const normalized = String(contentType || "").trim().toLowerCase();
  const match = Object.entries(EXTENSION_CONTENT_TYPES).find(([, value]) => value === normalized);
  return match ? match[0] : "";
}

function joinObjectUrl(baseUrl, objectKey) {
  const safeBase = trimTrailingSlashes(baseUrl);
  if (!safeBase) return "";
  const encodedPath = String(objectKey || "")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${safeBase}/${encodedPath}`;
}

function buildTenantObjectProxyUrl(baseUrl = "", objectKey = "") {
  const safeBase = trimTrailingSlashes(baseUrl);
  if (!safeBase) return "";
  const safeKey = String(objectKey || "").trim();
  if (!safeKey) return "";
  return `${safeBase}?key=${encodeURIComponent(safeKey)}`;
}

function resolveObjectUrl({ objectKey = "", publicBaseUrl = "", objectProxyBaseUrl = "" } = {}) {
  const direct = joinObjectUrl(publicBaseUrl, objectKey);
  if (direct) return direct;
  return buildTenantObjectProxyUrl(objectProxyBaseUrl, objectKey);
}

function createStorageError(message, code = "STORAGE_ERROR", statusCode = 500, details = null) {
  const error = new Error(String(message || "Storage operation failed."));
  error.code = code;
  error.statusCode = statusCode;
  if (details) error.details = details;
  return error;
}

function normalizeFileSizeBytes(value) {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw createStorageError("fileSize must be a positive number.", "INVALID_UPLOAD_SIZE", 400);
  }
  return Math.trunc(parsed);
}

function normalizeMaxBytes(value, fallback = env.R2_MAX_UPLOAD_BYTES) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return Math.max(1024, Number(fallback) || 20 * 1024 * 1024);
  return Math.max(1024, Math.trunc(parsed));
}

function assertUploadSizeWithinLimit(fileSizeBytes, maxBytes) {
  const requestedSize = normalizeFileSizeBytes(fileSizeBytes);
  const limit = normalizeMaxBytes(maxBytes);
  if (requestedSize > 0 && requestedSize > limit) {
    throw createStorageError(
      `File is too large. Maximum allowed size is ${limit} bytes.`,
      "FILE_TOO_LARGE",
      413,
      { requested: requestedSize, maxBytes: limit }
    );
  }
  return { requestedSize, limit };
}

function assertAllowedContentType(contentType, allowedContentTypes = []) {
  const allowList = Array.isArray(allowedContentTypes)
    ? [...new Set(allowedContentTypes.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean))]
    : [];
  if (allowList.length === 0) return;
  if (allowList.includes(String(contentType || "").trim().toLowerCase())) return;
  throw createStorageError(
    `Unsupported file type: ${contentType || "unknown"}.`,
    "UNSUPPORTED_FILE_TYPE",
    400,
    { contentType, allowedContentTypes: allowList }
  );
}

function resolveDefaultCacheControl(cacheControl) {
  const candidate = String(cacheControl || env.R2_DEFAULT_CACHE_CONTROL || "").trim();
  return candidate || "";
}

export function getR2ServiceStatus() {
  const missing = [];
  if (!env.R2_BUCKET_NAME) missing.push("R2_BUCKET_NAME");
  if (!env.R2_ACCESS_KEY_ID) missing.push("R2_ACCESS_KEY_ID");
  if (!env.R2_SECRET_ACCESS_KEY) missing.push("R2_SECRET_ACCESS_KEY");
  if (!env.R2_ENDPOINT) missing.push("R2_ENDPOINT");
  return {
    configured: missing.length === 0,
    missing,
    bucketName: env.R2_BUCKET_NAME || "",
    endpoint: env.R2_ENDPOINT || "",
    publicBaseUrl: env.R2_PUBLIC_BASE_URL || "",
    hasPublicBaseUrl: Boolean(String(env.R2_PUBLIC_BASE_URL || "").trim())
  };
}

function ensureR2Configured() {
  const status = getR2ServiceStatus();
  const missing = status.missing || [];

  if (missing.length > 0) {
    throw createStorageError(
      `Missing R2 configuration: ${missing.join(", ")}.`,
      "R2_NOT_CONFIGURED",
      503,
      { missing }
    );
  }
}

function getR2Client() {
  ensureR2Configured();
  if (r2Client) return r2Client;

  r2Client = new S3Client({
    region: env.R2_REGION || "auto",
    endpoint: env.R2_ENDPOINT,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY
    }
  });

  return r2Client;
}

function buildObjectKey({ tenantSlug, prefix, fileName, contentType }) {
  const safeTenant = normalizeSegment(tenantSlug) || "tenant";
  const safePrefix = String(prefix || "uploads")
    .split("/")
    .map((segment) => normalizeSegment(segment))
    .filter(Boolean)
    .join("/");

  const { extension: sourceExtension } = splitNameAndExtension(fileName);
  const extension = sourceExtension || inferExtensionFromContentType(contentType);
  const randomToken = crypto.randomBytes(8).toString("hex");
  const stamp = Date.now();
  const finalFileName = `${stamp}-${randomToken}${extension ? `.${extension}` : ""}`;

  if (!safePrefix) return `${safeTenant}/${finalFileName}`;
  return `${safeTenant}/${safePrefix}/${finalFileName}`;
}

export function isR2Configured() {
  return getR2ServiceStatus().configured;
}

export async function verifyR2Connectivity() {
  ensureR2Configured();
  try {
    await getR2Client().send(
      new HeadBucketCommand({
        Bucket: env.R2_BUCKET_NAME
      })
    );
    return { ok: true };
  } catch (error) {
    throw createStorageError(
      `R2 connectivity check failed: ${String(error?.message || "unknown error")}`,
      "R2_CONNECTIVITY_FAILED",
      503
    );
  }
}

function normalizeBody(body) {
  if (Buffer.isBuffer(body) || body instanceof Uint8Array || typeof body === "string") {
    return body;
  }

  if (body instanceof ArrayBuffer) {
    return Buffer.from(body);
  }

  if (ArrayBuffer.isView(body)) {
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  }

  return null;
}

function bodyByteLength(body) {
  if (typeof body === "string") return Buffer.byteLength(body);
  if (Buffer.isBuffer(body)) return body.length;
  if (body instanceof Uint8Array) return body.byteLength;
  return 0;
}

export async function uploadBufferToR2({
  tenantSlug,
  prefix = "uploads",
  fileName = "file",
  fileType = "",
  body,
  objectProxyBaseUrl = "",
  cacheControl = "",
  maxBytes = env.R2_MAX_UPLOAD_BYTES,
  allowedContentTypes = []
} = {}) {
  ensureR2Configured();

  const normalizedBody = normalizeBody(body);
  if (!normalizedBody || !bodyByteLength(normalizedBody)) {
    throw createStorageError("body is required for R2 uploads.", "INVALID_UPLOAD_BODY", 400);
  }

  const byteLength = bodyByteLength(normalizedBody);
  assertUploadSizeWithinLimit(byteLength, maxBytes);
  const contentType = inferContentType({ fileType, fileName });
  assertAllowedContentType(contentType, allowedContentTypes);
  const objectKey = buildObjectKey({ tenantSlug, prefix, fileName, contentType });
  const resolvedCacheControl = resolveDefaultCacheControl(cacheControl);
  const command = new PutObjectCommand({
    Bucket: env.R2_BUCKET_NAME,
    Key: objectKey,
    Body: normalizedBody,
    ContentType: contentType,
    ...(resolvedCacheControl ? { CacheControl: resolvedCacheControl } : {})
  });

  await getR2Client().send(command);

  return {
    objectUrl: resolveObjectUrl({
      objectKey,
      publicBaseUrl: env.R2_PUBLIC_BASE_URL,
      objectProxyBaseUrl
    }),
    key: objectKey,
    contentType,
    size: byteLength
  };
}

export async function createPresignedUpload({
  tenantSlug,
  prefix = "uploads",
  fileName = "file",
  fileType = "",
  fileSizeBytes = 0,
  objectProxyBaseUrl = "",
  maxBytes = env.R2_MAX_UPLOAD_BYTES,
  expiresInSeconds = env.R2_PRESIGN_EXPIRES_SECONDS || 900,
  cacheControl = "",
  allowedContentTypes = []
} = {}) {
  ensureR2Configured();

  const contentType = inferContentType({ fileType, fileName });
  assertAllowedContentType(contentType, allowedContentTypes);
  const { requestedSize } = assertUploadSizeWithinLimit(fileSizeBytes, maxBytes);
  const objectKey = buildObjectKey({ tenantSlug, prefix, fileName, contentType });
  const expiresIn = Math.min(3600, Math.max(60, Number(expiresInSeconds) || 900));
  const resolvedCacheControl = resolveDefaultCacheControl(cacheControl);

  const command = new PutObjectCommand({
    Bucket: env.R2_BUCKET_NAME,
    Key: objectKey,
    ContentType: contentType,
    ...(resolvedCacheControl ? { CacheControl: resolvedCacheControl } : {}),
    ...(requestedSize > 0 ? { ContentLength: requestedSize } : {})
  });

  const uploadUrl = await getSignedUrl(getR2Client(), command, { expiresIn });
  const objectUrl = resolveObjectUrl({
    objectKey,
    publicBaseUrl: env.R2_PUBLIC_BASE_URL,
    objectProxyBaseUrl
  });

  return {
    uploadUrl,
    objectUrl,
    key: objectKey,
    headers: {
      "Content-Type": contentType,
      ...(resolvedCacheControl ? { "Cache-Control": resolvedCacheControl } : {})
    }
  };
}

export async function createPresignedDownloadUrl({
  key = "",
  expiresInSeconds = env.R2_PRESIGN_EXPIRES_SECONDS || 900
} = {}) {
  ensureR2Configured();
  const safeKey = String(key || "").trim();
  if (!safeKey) {
    throw createStorageError("key is required for object download.", "INVALID_OBJECT_KEY", 400);
  }
  const expiresIn = Math.min(3600, Math.max(60, Number(expiresInSeconds) || 900));
  const command = new GetObjectCommand({
    Bucket: env.R2_BUCKET_NAME,
    Key: safeKey
  });
  const downloadUrl = await getSignedUrl(getR2Client(), command, { expiresIn });
  return { downloadUrl, key: safeKey, expiresIn };
}

export async function deleteObjectFromR2(key = "") {
  const safeKey = String(key || "").trim();
  if (!safeKey) {
    return { status: "skipped", reason: "missing_object_key" };
  }
  if (!isR2Configured()) {
    return { status: "skipped", reason: "r2_not_configured" };
  }

  await getR2Client().send(
    new DeleteObjectsCommand({
      Bucket: env.R2_BUCKET_NAME,
      Delete: {
        Objects: [{ Key: safeKey }],
        Quiet: true
      }
    })
  );

  return { status: "ok", key: safeKey };
}

export async function purgeTenantObjectsFromR2(tenantSlug = "") {
  const safeTenant = normalizeSegment(tenantSlug);
  if (!safeTenant) {
    return { status: "skipped", reason: "missing_tenant_slug", prefix: "", scanned: 0, deleted: 0 };
  }
  if (!isR2Configured()) {
    return { status: "skipped", reason: "r2_not_configured", prefix: `${safeTenant}/`, scanned: 0, deleted: 0 };
  }

  const bucket = env.R2_BUCKET_NAME;
  const prefix = `${safeTenant}/`;
  const client = getR2Client();
  let continuationToken = null;
  let scanned = 0;
  let deleted = 0;
  let batches = 0;

  do {
    const listed = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        MaxKeys: 1000,
        ...(continuationToken ? { ContinuationToken: continuationToken } : {})
      })
    );

    const keys = (listed?.Contents || [])
      .map((item) => String(item?.Key || "").trim())
      .filter(Boolean);
    scanned += keys.length;

    if (keys.length > 0) {
      const deletedChunk = await client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: {
            Objects: keys.map((key) => ({ Key: key })),
            Quiet: true
          }
        })
      );
      const errors = Array.isArray(deletedChunk?.Errors) ? deletedChunk.Errors.length : 0;
      deleted += Math.max(0, keys.length - errors);
      batches += 1;
    }

    continuationToken = listed?.IsTruncated ? listed?.NextContinuationToken || null : null;
  } while (continuationToken);

  return {
    status: "ok",
    prefix,
    scanned,
    deleted,
    batches
  };
}
