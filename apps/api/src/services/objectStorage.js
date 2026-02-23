import crypto from "crypto";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
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

function ensureR2Configured() {
  const missing = [];
  if (!env.R2_BUCKET_NAME) missing.push("R2_BUCKET_NAME");
  if (!env.R2_ACCESS_KEY_ID) missing.push("R2_ACCESS_KEY_ID");
  if (!env.R2_SECRET_ACCESS_KEY) missing.push("R2_SECRET_ACCESS_KEY");
  if (!env.R2_ENDPOINT) missing.push("R2_ENDPOINT");
  if (!env.R2_PUBLIC_BASE_URL) missing.push("R2_PUBLIC_BASE_URL");

  if (missing.length > 0) {
    const error = new Error(`Missing R2 configuration: ${missing.join(", ")}.`);
    error.code = "R2_NOT_CONFIGURED";
    error.statusCode = 503;
    throw error;
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

  const { baseName, extension: sourceExtension } = splitNameAndExtension(fileName);
  const extension = sourceExtension || inferExtensionFromContentType(contentType);
  const randomToken = crypto.randomBytes(8).toString("hex");
  const stamp = Date.now();
  const finalFileName = `${baseName || "file"}-${stamp}-${randomToken}${extension ? `.${extension}` : ""}`;

  if (!safePrefix) return `${safeTenant}/${finalFileName}`;
  return `${safeTenant}/${safePrefix}/${finalFileName}`;
}

export function isR2Configured() {
  return Boolean(
    env.R2_BUCKET_NAME &&
      env.R2_ACCESS_KEY_ID &&
      env.R2_SECRET_ACCESS_KEY &&
      env.R2_ENDPOINT &&
      env.R2_PUBLIC_BASE_URL
  );
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
  cacheControl = ""
} = {}) {
  ensureR2Configured();

  const normalizedBody = normalizeBody(body);
  if (!normalizedBody || !bodyByteLength(normalizedBody)) {
    const error = new Error("body is required for R2 uploads.");
    error.code = "INVALID_UPLOAD_BODY";
    error.statusCode = 400;
    throw error;
  }

  const contentType = inferContentType({ fileType, fileName });
  const objectKey = buildObjectKey({ tenantSlug, prefix, fileName, contentType });
  const command = new PutObjectCommand({
    Bucket: env.R2_BUCKET_NAME,
    Key: objectKey,
    Body: normalizedBody,
    ContentType: contentType,
    ...(cacheControl ? { CacheControl: String(cacheControl).trim() } : {})
  });

  await getR2Client().send(command);

  return {
    objectUrl: joinObjectUrl(env.R2_PUBLIC_BASE_URL, objectKey),
    key: objectKey,
    contentType,
    size: bodyByteLength(normalizedBody)
  };
}

export async function createPresignedUpload({
  tenantSlug,
  prefix = "uploads",
  fileName = "file",
  fileType = "",
  expiresInSeconds = 900
} = {}) {
  ensureR2Configured();

  const contentType = inferContentType({ fileType, fileName });
  const objectKey = buildObjectKey({ tenantSlug, prefix, fileName, contentType });
  const expiresIn = Math.min(3600, Math.max(60, Number(expiresInSeconds) || 900));

  const command = new PutObjectCommand({
    Bucket: env.R2_BUCKET_NAME,
    Key: objectKey,
    ContentType: contentType
  });

  const uploadUrl = await getSignedUrl(getR2Client(), command, { expiresIn });
  const objectUrl = joinObjectUrl(env.R2_PUBLIC_BASE_URL, objectKey);

  return {
    uploadUrl,
    objectUrl,
    key: objectKey,
    headers: {
      "Content-Type": contentType
    }
  };
}
