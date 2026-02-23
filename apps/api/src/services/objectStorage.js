import crypto from "crypto";
import { HeadBucketCommand, S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
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
  const encodedPath = String(objectKey || "")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${safeBase}/${encodedPath}`;
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
  if (!env.R2_PUBLIC_BASE_URL) missing.push("R2_PUBLIC_BASE_URL");
  return {
    configured: missing.length === 0,
    missing,
    bucketName: env.R2_BUCKET_NAME || "",
    endpoint: env.R2_ENDPOINT || "",
    publicBaseUrl: env.R2_PUBLIC_BASE_URL || ""
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
    objectUrl: joinObjectUrl(env.R2_PUBLIC_BASE_URL, objectKey),
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
  const objectUrl = joinObjectUrl(env.R2_PUBLIC_BASE_URL, objectKey);

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
