import dotenv from "dotenv";

dotenv.config();

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBoolean(value, fallback = false) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return fallback;
  return ["1", "true", "yes", "on"].includes(normalized);
}

function toCsvList(value = "") {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function dedupe(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeOrigin(value = "") {
  try {
    return new URL(String(value)).origin;
  } catch {
    return "";
  }
}

function normalizeUrl(value = "", fallback = "") {
  try {
    const parsed = new URL(String(value));
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return fallback;
  }
}

function assertValidChoice(name, value, allowedValues) {
  if (!allowedValues.includes(value)) {
    throw new Error(`${name} must be one of: ${allowedValues.join(", ")}.`);
  }
}

const frontendOrigin =
  normalizeOrigin(process.env.FRONTEND_ORIGIN || "http://localhost:5173") ||
  "http://localhost:5173";
const extraOrigins = toCsvList(process.env.FRONTEND_ORIGINS || "").map(normalizeOrigin);
const resendApiBaseUrl = normalizeUrl(
  process.env.RESEND_API_BASE_URL || "https://api.resend.com",
  "https://api.resend.com"
);
const cloudflareAccountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
const r2Endpoint = normalizeUrl(
  process.env.R2_ENDPOINT ||
    (cloudflareAccountId ? `https://${cloudflareAccountId}.r2.cloudflarestorage.com` : ""),
  ""
);
const r2PublicBaseUrl = normalizeUrl(process.env.R2_PUBLIC_BASE_URL || "", "");

export const env = {
  NODE_ENV: process.env.NODE_ENV || "development",
  DB_PROVIDER: "supabase",
  PORT: toNumber(process.env.PORT, 4000),
  API_JSON_LIMIT: String(process.env.API_JSON_LIMIT || "15mb").trim() || "15mb",
  SUPABASE_URL: process.env.SUPABASE_URL || "",
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  SUPABASE_DB_URL: process.env.SUPABASE_DB_URL || "",
  SUPABASE_MIRROR_TABLE: String(process.env.SUPABASE_MIRROR_TABLE || "pb_mongo_mirror").trim(),
  JWT_SECRET: process.env.JWT_SECRET || "",
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || "7d",
  BCRYPT_ROUNDS: toNumber(process.env.BCRYPT_ROUNDS, 12),
  FRONTEND_ORIGIN: frontendOrigin,
  FRONTEND_ORIGINS: dedupe([
    frontendOrigin,
    normalizeOrigin("http://localhost:5173"),
    normalizeOrigin("http://127.0.0.1:5173"),
    normalizeOrigin("http://localhost:5174"),
    normalizeOrigin("http://127.0.0.1:5174"),
    ...extraOrigins
  ]),
  APP_BASE_DOMAIN: process.env.APP_BASE_DOMAIN || "pondbridgealumni.com",
  CORS_ALLOW_SUBDOMAIN_ORIGINS: toBoolean(process.env.CORS_ALLOW_SUBDOMAIN_ORIGINS, true),
  CUSTOM_DOMAIN_ALLOWLIST: dedupe(toCsvList(process.env.CUSTOM_DOMAIN_ALLOWLIST || "")),
  TRUST_PROXY_HOPS: toNumber(process.env.TRUST_PROXY_HOPS, 1),
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
  BILLING_MODE: process.env.BILLING_MODE || "auto",
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || "",
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || "",
  STRIPE_PRICE_BASE: process.env.STRIPE_PRICE_BASE || "",
  STRIPE_PRICE_PREMIUM: process.env.STRIPE_PRICE_PREMIUM || "",
  STRIPE_ONBOARDING_PRICE_BASE: process.env.STRIPE_ONBOARDING_PRICE_BASE || "",
  STRIPE_ONBOARDING_PRICE_PREMIUM: process.env.STRIPE_ONBOARDING_PRICE_PREMIUM || "",
  STRIPE_SUCCESS_URL: process.env.STRIPE_SUCCESS_URL || "",
  STRIPE_CANCEL_URL: process.env.STRIPE_CANCEL_URL || "",
  STRIPE_BILLING_PORTAL_RETURN_URL: process.env.STRIPE_BILLING_PORTAL_RETURN_URL || "",
  STRIPE_CURRENCY: process.env.STRIPE_CURRENCY || "usd",
  MOCK_BILLING_BASE_URL:
    process.env.MOCK_BILLING_BASE_URL || "https://mock-billing.pondbridge.local",
  EMAIL_MODE: String(process.env.EMAIL_MODE || "mock").trim().toLowerCase(),
  EMAIL_FROM: process.env.EMAIL_FROM || "no-reply@pondbridge.local",
  RESEND_API_KEY: process.env.RESEND_API_KEY || "",
  RESEND_API_BASE_URL: resendApiBaseUrl,
  CLOUDFLARE_ACCOUNT_ID: cloudflareAccountId,
  CLOUDFLARE_API_TOKEN: String(process.env.CLOUDFLARE_API_TOKEN || "").trim(),
  CLOUDFLARE_ZONE_ID: String(process.env.CLOUDFLARE_ZONE_ID || "").trim(),
  CLOUDFLARE_PAGES_PROJECT_NAME: String(process.env.CLOUDFLARE_PAGES_PROJECT_NAME || "").trim(),
  CLOUDFLARE_WEB_CNAME_TARGET: String(process.env.CLOUDFLARE_WEB_CNAME_TARGET || "").trim(),
  CLOUDFLARE_WEB_PROXIED: process.env.CLOUDFLARE_WEB_PROXIED || "true",
  CLOUDFLARE_TTL: process.env.CLOUDFLARE_TTL || "1",
  R2_BUCKET_NAME: String(process.env.R2_BUCKET_NAME || "").trim(),
  R2_ACCESS_KEY_ID: String(process.env.R2_ACCESS_KEY_ID || "").trim(),
  R2_SECRET_ACCESS_KEY: String(process.env.R2_SECRET_ACCESS_KEY || "").trim(),
  R2_REGION: String(process.env.R2_REGION || "auto").trim() || "auto",
  R2_ENDPOINT: r2Endpoint,
  R2_PUBLIC_BASE_URL: r2PublicBaseUrl,
  SMTP_HOST: process.env.SMTP_HOST || "",
  SMTP_PORT: toNumber(process.env.SMTP_PORT, 587),
  SMTP_SECURE: process.env.SMTP_SECURE || "false",
  SMTP_USER: process.env.SMTP_USER || "",
  SMTP_PASS: process.env.SMTP_PASS || "",
  INVITE_EXPIRES_DAYS: toNumber(process.env.INVITE_EXPIRES_DAYS, 7),
  MAGIC_LINK_EXPIRES_MINUTES: toNumber(process.env.MAGIC_LINK_EXPIRES_MINUTES, 20),
  AUTH_TOKEN_MODE: process.env.AUTH_TOKEN_MODE || "hybrid",
  AUTH_COOKIE_NAME: process.env.AUTH_COOKIE_NAME || "pondbridge_auth",
  AUTH_COOKIE_DOMAIN: process.env.AUTH_COOKIE_DOMAIN || "",
  AUTH_COOKIE_SAMESITE: process.env.AUTH_COOKIE_SAMESITE || "lax",
  AUTH_COOKIE_SECURE: toBoolean(
    process.env.AUTH_COOKIE_SECURE,
    (process.env.NODE_ENV || "development") === "production"
  ),
  AUTH_COOKIE_MAX_AGE_SECONDS: toNumber(process.env.AUTH_COOKIE_MAX_AGE_SECONDS, 60 * 60 * 24 * 7)
};

if (!env.JWT_SECRET) {
  throw new Error("Missing JWT_SECRET in apps/api/.env");
}

assertValidChoice("NODE_ENV", env.NODE_ENV, [
  "development",
  "test",
  "production"
]);
assertValidChoice("EMAIL_MODE", env.EMAIL_MODE, ["mock", "smtp", "resend"]);
assertValidChoice("AUTH_TOKEN_MODE", env.AUTH_TOKEN_MODE, ["bearer", "cookie", "hybrid"]);
assertValidChoice("AUTH_COOKIE_SAMESITE", env.AUTH_COOKIE_SAMESITE, ["lax", "strict", "none"]);

if (!env.SUPABASE_URL) {
  throw new Error("Missing SUPABASE_URL in apps/api/.env");
}

if (!env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY in apps/api/.env");
}
