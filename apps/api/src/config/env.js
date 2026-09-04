import dotenv from "dotenv";
import { assertMatchingSupabaseProject } from "../utils/supabaseConfig.js";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoLocalEnvPath = path.resolve(__dirname, "../../../../.env.local");
const repoEnvPath = path.resolve(__dirname, "../../../../.env");
const apiEnvPath = path.resolve(__dirname, "../../.env");
const isTestEnv = String(process.env.NODE_ENV || "").toLowerCase() === "test";
const isLocalStaging = String(process.env.PONDBRIDGE_LOCAL_STAGING || "") === "1";

// For local/dev/runtime we support an ignored shared root .env.local for
// developer secrets, with the existing shared root .env as a fallback.
// Tests and isolated local staging skip it so behavior stays deterministic and
// host/provider credentials cannot leak into the synthetic environment.
if (!isTestEnv && !isLocalStaging) {
  dotenv.config({ path: repoLocalEnvPath, override: false });
  dotenv.config({ path: repoEnvPath, override: false });
}
if (!isLocalStaging) {
  dotenv.config({ path: apiEnvPath, override: false });
}

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBoundedInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
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

function defaultEmailFromForDomain(baseDomain = "") {
  const domain = String(baseDomain || "")
    .trim()
    .toLowerCase();
  const hasPublicSuffix = /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain);
  const isLocalDomain =
    domain === "localhost" || domain.endsWith(".localhost") || domain.endsWith(".local");

  if (domain && hasPublicSuffix && !isLocalDomain) {
    return `no-reply@${domain}`;
  }
  return "no-reply@pondbridge.local";
}

function assertValidChoice(name, value, allowedValues) {
  if (!allowedValues.includes(value)) {
    throw new Error(`${name} must be one of: ${allowedValues.join(", ")}.`);
  }
}

const frontendOrigin =
  normalizeOrigin(process.env.FRONTEND_ORIGIN || "http://localhost:5173") ||
  "http://localhost:5173";
const publicApiOrigin =
  normalizeOrigin(
    process.env.PUBLIC_API_ORIGIN ||
      `http://localhost:${toNumber(process.env.PORT, 4000)}`
  ) || `http://localhost:${toNumber(process.env.PORT, 4000)}`;
const extraOrigins = toCsvList(process.env.FRONTEND_ORIGINS || "").map(normalizeOrigin);
const resendApiBaseUrl = normalizeUrl(
  process.env.RESEND_API_BASE_URL || "https://api.resend.com",
  "https://api.resend.com"
);
const appBaseDomain =
  String(process.env.APP_BASE_DOMAIN || "pondbridgealumni.com")
    .trim()
    .toLowerCase() || "pondbridgealumni.com";
const tenantHostSuffixes = dedupe(
  [appBaseDomain, ...toCsvList(process.env.TENANT_HOST_SUFFIXES || "")]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean)
);
const cloudflareWebProxied =
  process.env.CLOUDFLARE_WEB_PROXIED ?? process.env.CLOUDFLARE_PROXIED ?? "true";
const cloudflareAccountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
const r2BucketName = String(
  process.env.R2_BUCKET_NAME ||
    process.env.R2_BUCKET ||
    process.env.CLOUDFLARE_R2_BUCKET_NAME ||
    process.env.CLOUDFLARE_R2_BUCKET ||
    ""
).trim();
const r2AccessKeyId = String(
  process.env.R2_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY || process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || ""
).trim();
const r2SecretAccessKey = String(
  process.env.R2_SECRET_ACCESS_KEY ||
    process.env.R2_SECRET_KEY ||
    process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY ||
    ""
).trim();
const r2Endpoint = normalizeUrl(
  process.env.R2_ENDPOINT ||
    (cloudflareAccountId ? `https://${cloudflareAccountId}.r2.cloudflarestorage.com` : ""),
  ""
);
const r2PublicBaseUrl = normalizeUrl(
  process.env.R2_PUBLIC_BASE_URL ||
    process.env.R2_PUBLIC_URL ||
    process.env.CLOUDFLARE_R2_PUBLIC_BASE_URL ||
    "",
  ""
);
const defaultEmailFrom = defaultEmailFromForDomain(appBaseDomain);

export const env = {
  NODE_ENV: process.env.NODE_ENV || "development",
  AUTH_PROVIDER: String(process.env.AUTH_PROVIDER || "legacy").trim().toLowerCase(),
  HYBRID_ALLOW_LEGACY_TOKENS: toBoolean(process.env.HYBRID_ALLOW_LEGACY_TOKENS, true),
  DB_PROVIDER: "supabase",
  PORT: toNumber(process.env.PORT, 4000),
  API_JSON_LIMIT: String(process.env.API_JSON_LIMIT || "15mb").trim() || "15mb",
  SUPABASE_URL: process.env.SUPABASE_URL || "",
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  SUPABASE_DB_URL: process.env.SUPABASE_DB_URL || "",
  JWT_SECRET: process.env.JWT_SECRET || "",
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || "7d",
  BCRYPT_ROUNDS: toNumber(process.env.BCRYPT_ROUNDS, 12),
  FRONTEND_ORIGIN: frontendOrigin,
  PUBLIC_API_ORIGIN: publicApiOrigin,
  FRONTEND_ORIGINS: dedupe([
    frontendOrigin,
    normalizeOrigin("https://localhost"),
    normalizeOrigin("http://localhost"),
    normalizeOrigin("capacitor://localhost"),
    normalizeOrigin("ionic://localhost"),
    normalizeOrigin("http://localhost:5173"),
    normalizeOrigin("http://127.0.0.1:5173"),
    normalizeOrigin("http://localhost:5174"),
    normalizeOrigin("http://127.0.0.1:5174"),
    ...extraOrigins
  ]),
  APP_BASE_DOMAIN: appBaseDomain,
  TENANT_HOST_SUFFIXES: tenantHostSuffixes,
  CORS_ALLOW_SUBDOMAIN_ORIGINS: toBoolean(process.env.CORS_ALLOW_SUBDOMAIN_ORIGINS, true),
  CUSTOM_DOMAIN_ALLOWLIST: dedupe(toCsvList(process.env.CUSTOM_DOMAIN_ALLOWLIST || "")),
  TRUST_PROXY_HOPS: toNumber(process.env.TRUST_PROXY_HOPS, 1),
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
  OPENAI_DIRECTOR_COPILOT_MODEL:
    String(process.env.OPENAI_DIRECTOR_COPILOT_MODEL || "gpt-5.6-luna").trim() ||
    "gpt-5.6-luna",
  OPENAI_DIRECTOR_COPILOT_MAX_OUTPUT_TOKENS: toBoundedInt(
    process.env.OPENAI_DIRECTOR_COPILOT_MAX_OUTPUT_TOKENS,
    900,
    200,
    2400
  ),
  OPENAI_DIRECTOR_COPILOT_TIMEOUT_MS: toBoundedInt(
    process.env.OPENAI_DIRECTOR_COPILOT_TIMEOUT_MS,
    30000,
    5000,
    60000
  ),
  OPENAI_EMAIL_AGENT_MODEL:
    String(process.env.OPENAI_EMAIL_AGENT_MODEL || "gpt-5.6-luna").trim() ||
    "gpt-5.6-luna",
  OPENAI_EMAIL_AGENT_MAX_OUTPUT_TOKENS: toBoundedInt(
    process.env.OPENAI_EMAIL_AGENT_MAX_OUTPUT_TOKENS,
    1800,
    500,
    4000
  ),
  OPENAI_EMAIL_AGENT_TIMEOUT_MS: toBoundedInt(
    process.env.OPENAI_EMAIL_AGENT_TIMEOUT_MS,
    30000,
    5000,
    60000
  ),
  OPENAI_SEARCH_MODEL:
    String(process.env.OPENAI_SEARCH_MODEL || "gpt-5.6-luna").trim() ||
    "gpt-5.6-luna",
  OPENAI_SEARCH_MAX_OUTPUT_TOKENS: toBoundedInt(
    process.env.OPENAI_SEARCH_MAX_OUTPUT_TOKENS,
    500,
    200,
    1200
  ),
  OPENAI_SEARCH_TIMEOUT_MS: toBoundedInt(
    process.env.OPENAI_SEARCH_TIMEOUT_MS,
    20000,
    5000,
    60000
  ),
  AI_SEARCH_MONTHLY_BUDGET_USD: Math.max(
    0,
    toNumber(process.env.AI_SEARCH_MONTHLY_BUDGET_USD, 15)
  ),
  OPENAI_PROFILE_IMPORT_MODEL:
    String(process.env.OPENAI_PROFILE_IMPORT_MODEL || "gpt-5.6-luna").trim() ||
    "gpt-5.6-luna",
  OPENAI_PROFILE_IMPORT_MAX_OUTPUT_TOKENS: toBoundedInt(
    process.env.OPENAI_PROFILE_IMPORT_MAX_OUTPUT_TOKENS,
    1600,
    500,
    4000
  ),
  OPENAI_PROFILE_IMPORT_TIMEOUT_MS: toBoundedInt(
    process.env.OPENAI_PROFILE_IMPORT_TIMEOUT_MS,
    30000,
    5000,
    60000
  ),
  PROFILE_IMPORT_MONTHLY_BUDGET_USD: Math.max(
    0,
    toNumber(process.env.PROFILE_IMPORT_MONTHLY_BUDGET_USD, 15)
  ),
  EMAIL_AGENT_MONTHLY_BUDGET_USD: Math.max(
    0,
    toNumber(process.env.EMAIL_AGENT_MONTHLY_BUDGET_USD, 25)
  ),
  SUPER_COPILOT_ENABLED: toBoolean(process.env.SUPER_COPILOT_ENABLED, false),
  OPENAI_SUPER_COPILOT_MODEL:
    String(process.env.OPENAI_SUPER_COPILOT_MODEL || "gpt-5.6-terra").trim() ||
    "gpt-5.6-terra",
  OPENAI_SUPER_COPILOT_MAX_OUTPUT_TOKENS: toBoundedInt(
    process.env.OPENAI_SUPER_COPILOT_MAX_OUTPUT_TOKENS,
    1100,
    300,
    3000
  ),
  OPENAI_SUPER_COPILOT_TIMEOUT_MS: toBoundedInt(
    process.env.OPENAI_SUPER_COPILOT_TIMEOUT_MS,
    30000,
    5000,
    60000
  ),
  OUTREACH_AGENT_ENABLED: toBoolean(process.env.OUTREACH_AGENT_ENABLED, false),
  OUTREACH_WEB_RESEARCH_ENABLED: toBoolean(
    process.env.OUTREACH_WEB_RESEARCH_ENABLED,
    false
  ),
  OPENAI_OUTREACH_MODEL:
    String(process.env.OPENAI_OUTREACH_MODEL || "gpt-5.6-terra").trim() ||
    "gpt-5.6-terra",
  OPENAI_OUTREACH_MAX_OUTPUT_TOKENS: toBoundedInt(
    process.env.OPENAI_OUTREACH_MAX_OUTPUT_TOKENS,
    1600,
    400,
    4000
  ),
  OPENAI_OUTREACH_TIMEOUT_MS: toBoundedInt(
    process.env.OPENAI_OUTREACH_TIMEOUT_MS,
    35000,
    5000,
    60000
  ),
  BILLING_MODE: process.env.BILLING_MODE || "auto",
  DIRECTOR_WIZARD_REQUIRE_BILLING: toBoolean(
    process.env.DIRECTOR_WIZARD_REQUIRE_BILLING,
    false
  ),
  ALLOW_MOCK_BILLING_IN_PRODUCTION: toBoolean(
    process.env.ALLOW_MOCK_BILLING_IN_PRODUCTION,
    false
  ),
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || "",
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || "",
  // Safe to hand to the browser: embedded Checkout mounts Stripe's own iframe
  // with it, so the payment form never leaves the onboarding wizard.
  STRIPE_PUBLISHABLE_KEY: process.env.STRIPE_PUBLISHABLE_KEY || "",
  // PondBridge sells a single plan: Flagship, $1,200/year.
  STRIPE_PRICE_FLAGSHIP_ANNUAL: process.env.STRIPE_PRICE_FLAGSHIP_ANNUAL || "",
  STRIPE_PRICE_TEST_ANNUAL: process.env.STRIPE_PRICE_TEST_ANNUAL || "",
  STRIPE_SUCCESS_URL: process.env.STRIPE_SUCCESS_URL || "",
  STRIPE_CANCEL_URL: process.env.STRIPE_CANCEL_URL || "",
  STRIPE_BILLING_PORTAL_RETURN_URL: process.env.STRIPE_BILLING_PORTAL_RETURN_URL || "",
  STRIPE_CURRENCY: process.env.STRIPE_CURRENCY || "usd",
  MOCK_BILLING_BASE_URL:
    process.env.MOCK_BILLING_BASE_URL || "https://mock-billing.pondbridge.local",
  EMAIL_MODE: String(process.env.EMAIL_MODE || "mock").trim().toLowerCase(),
  EMAIL_FROM: String(process.env.EMAIL_FROM || defaultEmailFrom).trim(),
  RESEND_API_KEY: process.env.RESEND_API_KEY || "",
  RESEND_API_BASE_URL: resendApiBaseUrl,
  RESEND_WEBHOOK_SECRET: String(process.env.RESEND_WEBHOOK_SECRET || "").trim(),
  RESEND_WEBHOOK_TOLERANCE_SECONDS: toBoundedInt(
    process.env.RESEND_WEBHOOK_TOLERANCE_SECONDS,
    300,
    30,
    3600
  ),
  RESEND_USER_AGENT: String(process.env.RESEND_USER_AGENT || "pondbridge-api/1.0").trim(),
  RESEND_REQUEST_TIMEOUT_MS: toBoundedInt(process.env.RESEND_REQUEST_TIMEOUT_MS, 12000, 1000, 60000),
  RESEND_MAX_RETRIES: toBoundedInt(process.env.RESEND_MAX_RETRIES, 2, 0, 5),
  RESEND_RETRY_BASE_DELAY_MS: toBoundedInt(process.env.RESEND_RETRY_BASE_DELAY_MS, 300, 0, 10000),
  RESEND_BATCH_ENABLED: toBoolean(process.env.RESEND_BATCH_ENABLED, true),
  EMAIL_SUPPRESSION_ENABLED: toBoolean(process.env.EMAIL_SUPPRESSION_ENABLED, true),
  EMAIL_PREFERENCE_TOKEN_SECRET:
    String(process.env.EMAIL_PREFERENCE_TOKEN_SECRET || process.env.JWT_SECRET || "").trim(),
  EMAIL_BROADCAST_BATCH_SIZE: toBoundedInt(process.env.EMAIL_BROADCAST_BATCH_SIZE, 40, 1, 200),
  EMAIL_BROADCAST_MAX_RECIPIENTS: toBoundedInt(process.env.EMAIL_BROADCAST_MAX_RECIPIENTS, 500, 1, 5000),
  CLOUDFLARE_ACCOUNT_ID: cloudflareAccountId,
  CLOUDFLARE_API_TOKEN: String(process.env.CLOUDFLARE_API_TOKEN || "").trim(),
  CLOUDFLARE_ZONE_ID: String(process.env.CLOUDFLARE_ZONE_ID || "").trim(),
  // Stream is billed separately from the rest of the Cloudflare account, so it
  // takes its own token: an operator can grant Stream:Edit to a narrow token
  // without widening the one that edits DNS and Pages.
  CLOUDFLARE_STREAM_API_TOKEN: String(
    process.env.CLOUDFLARE_STREAM_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN || ""
  ).trim(),
  CLOUDFLARE_STREAM_WEBHOOK_SECRET: String(
    process.env.CLOUDFLARE_STREAM_WEBHOOK_SECRET || ""
  ).trim(),
  // Playback lives on a per-account subdomain that the Stream API reports back
  // with the first video. Pinning it here saves a lookup on cold start.
  CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN: String(
    process.env.CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN || ""
  ).trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, ""),
  CLOUDFLARE_PAGES_PROJECT_NAME: String(process.env.CLOUDFLARE_PAGES_PROJECT_NAME || "").trim(),
  CLOUDFLARE_WEB_CNAME_TARGET: String(process.env.CLOUDFLARE_WEB_CNAME_TARGET || "").trim(),
  CLOUDFLARE_WEB_PROXIED: String(cloudflareWebProxied),
  CLOUDFLARE_TTL: process.env.CLOUDFLARE_TTL || "1",
  CLOUDFLARE_DOMAIN_READY_TIMEOUT_MS: toBoundedInt(
    process.env.CLOUDFLARE_DOMAIN_READY_TIMEOUT_MS,
    25000,
    0,
    180000
  ),
  CLOUDFLARE_DOMAIN_READY_POLL_MS: toBoundedInt(
    process.env.CLOUDFLARE_DOMAIN_READY_POLL_MS,
    1200,
    250,
    10000
  ),
  SUPER_TENANT_HARD_DELETE_ENABLED: toBoolean(process.env.SUPER_TENANT_HARD_DELETE_ENABLED, false),
  SUPER_TENANT_PRODUCTION_WIPE_ENABLED: toBoolean(
    process.env.SUPER_TENANT_PRODUCTION_WIPE_ENABLED,
    false
  ),
  SUPER_TENANT_DEMO_RESET_ENABLED: toBoolean(process.env.SUPER_TENANT_DEMO_RESET_ENABLED, false),
  SUPER_TENANT_DELETION_GRACE_HOURS: toBoundedInt(
    process.env.SUPER_TENANT_DELETION_GRACE_HOURS,
    24,
    1,
    720
  ),
  R2_BUCKET_NAME: r2BucketName,
  R2_ACCESS_KEY_ID: r2AccessKeyId,
  R2_SECRET_ACCESS_KEY: r2SecretAccessKey,
  R2_REGION: String(process.env.R2_REGION || "auto").trim() || "auto",
  R2_ENDPOINT: r2Endpoint,
  R2_PUBLIC_BASE_URL: r2PublicBaseUrl,
  R2_MAX_UPLOAD_BYTES: toBoundedInt(process.env.R2_MAX_UPLOAD_BYTES, 20 * 1024 * 1024, 1024, 1024 * 1024 * 1024),
  R2_PRESIGN_EXPIRES_SECONDS: toBoundedInt(process.env.R2_PRESIGN_EXPIRES_SECONDS, 900, 60, 3600),
  R2_DEFAULT_CACHE_CONTROL: String(process.env.R2_DEFAULT_CACHE_CONTROL || "public, max-age=31536000, immutable").trim(),
  APNS_KEY_ID: String(process.env.APNS_KEY_ID || "").trim(),
  APNS_TEAM_ID: String(process.env.APNS_TEAM_ID || "").trim(),
  APNS_BUNDLE_ID: String(process.env.APNS_BUNDLE_ID || "com.pondbridge.ios").trim(),
  APNS_PRIVATE_KEY: String(process.env.APNS_PRIVATE_KEY || "").trim(),
  APNS_USE_SANDBOX: toBoolean(
    process.env.APNS_USE_SANDBOX,
    String(process.env.NODE_ENV || "").trim().toLowerCase() !== "production"
  ),
  FCM_PROJECT_ID: String(process.env.FCM_PROJECT_ID || "").trim(),
  FCM_CLIENT_EMAIL: String(process.env.FCM_CLIENT_EMAIL || "").trim(),
  FCM_PRIVATE_KEY: String(process.env.FCM_PRIVATE_KEY || "").trim(),
  FCM_ANDROID_APP_ID: String(process.env.FCM_ANDROID_APP_ID || "com.pondbridge.android").trim(),
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
  AUTH_COOKIE_MAX_AGE_SECONDS: toNumber(process.env.AUTH_COOKIE_MAX_AGE_SECONDS, 60 * 60 * 24 * 7),
  CLERK_SECRET_KEY: String(process.env.CLERK_SECRET_KEY || "").trim(),
  CLERK_WEBHOOK_SIGNING_SECRET: String(process.env.CLERK_WEBHOOK_SIGNING_SECRET || "").trim(),
  CLERK_AUTHORIZED_PARTIES: dedupe(toCsvList(process.env.CLERK_AUTHORIZED_PARTIES || "")),
  CLERK_JWT_AUDIENCE: String(process.env.CLERK_JWT_AUDIENCE || "").trim(),
  CLERK_REQUIRE_TENANT_CLAIM: toBoolean(process.env.CLERK_REQUIRE_TENANT_CLAIM, false),
  CLERK_SUPER_ADMIN_EMAILS: dedupe(
    toCsvList(process.env.CLERK_SUPER_ADMIN_EMAILS || "").map((email) =>
      String(email || "").trim().toLowerCase()
    )
  ),
  CLERK_SUPER_ADMIN_USER_IDS: dedupe(toCsvList(process.env.CLERK_SUPER_ADMIN_USER_IDS || "")),
  CLERK_BOOTSTRAP_FIRST_SUPER_ADMIN: toBoolean(process.env.CLERK_BOOTSTRAP_FIRST_SUPER_ADMIN, true),
  ALLOW_PUBLIC_AUTO_BOOTSTRAP_FIRST_TENANT: toBoolean(
    process.env.ALLOW_PUBLIC_AUTO_BOOTSTRAP_FIRST_TENANT,
    false
  ),
  ALLOW_EMPTY_PRODUCTION_TENANTS: toBoolean(process.env.ALLOW_EMPTY_PRODUCTION_TENANTS, false),
  PRODUCTION_MIN_TENANTS: Math.max(0, toBoundedInt(process.env.PRODUCTION_MIN_TENANTS, 1, 0, 100000))
};

assertValidChoice("NODE_ENV", env.NODE_ENV, [
  "development",
  "test",
  "production"
]);
assertValidChoice("AUTH_PROVIDER", env.AUTH_PROVIDER, ["legacy", "hybrid", "clerk"]);
assertValidChoice("EMAIL_MODE", env.EMAIL_MODE, ["mock", "smtp", "resend"]);
assertValidChoice("AUTH_TOKEN_MODE", env.AUTH_TOKEN_MODE, ["bearer", "cookie", "hybrid"]);
assertValidChoice("AUTH_COOKIE_SAMESITE", env.AUTH_COOKIE_SAMESITE, ["lax", "strict", "none"]);

if (["legacy", "hybrid"].includes(env.AUTH_PROVIDER) && !env.JWT_SECRET) {
  throw new Error("Missing JWT_SECRET in apps/api/.env for legacy/hybrid auth mode.");
}

if (["clerk", "hybrid"].includes(env.AUTH_PROVIDER) && !env.CLERK_SECRET_KEY) {
  throw new Error("Missing CLERK_SECRET_KEY in apps/api/.env for clerk/hybrid auth mode.");
}

if (!env.SUPABASE_URL) {
  throw new Error("Missing SUPABASE_URL in apps/api/.env");
}

if (!env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY in apps/api/.env");
}

assertMatchingSupabaseProject({
  apiUrl: env.SUPABASE_URL,
  databaseUrl: env.SUPABASE_DB_URL
});

// Production safety: refuse to start if the database URL points to localhost.
if (env.NODE_ENV === "production" && env.SUPABASE_DB_URL) {
  const lowerDbUrl = env.SUPABASE_DB_URL.toLowerCase();
  if (lowerDbUrl.includes("localhost") || lowerDbUrl.includes("127.0.0.1")) {
    throw new Error(
      "FATAL: Production server configured with a localhost database URL. " +
        "Set SUPABASE_DB_URL to the production Supabase connection string."
    );
  }
}

// Test safety: refuse to run tests with DB reset flags against a remote database.
if (env.NODE_ENV === "test") {
  const lowerDbUrl = String(env.SUPABASE_DB_URL || "").toLowerCase();
  const lowerApiUrl = String(env.SUPABASE_URL || "").toLowerCase();
  const haystack = `${lowerDbUrl} ${lowerApiUrl}`.trim();
  const isLocalDb =
    haystack.includes("localhost") ||
    haystack.includes("127.0.0.1") ||
    haystack.includes("host.docker.internal");
  const resetEnabled = toBoolean(process.env.PONDBRIDGE_ALLOW_DB_RESET, false);
  if (resetEnabled && !isLocalDb) {
    throw new Error(
      "FATAL: Test suite has PONDBRIDGE_ALLOW_DB_RESET=1 but SUPABASE_DB_URL points to a " +
        "remote database. Tests with database reset enabled must ONLY run against a local " +
        "database (localhost / 127.0.0.1 / host.docker.internal). Either point SUPABASE_DB_URL " +
        "and SUPABASE_URL to a local database or remove PONDBRIDGE_ALLOW_DB_RESET from your test command."
    );
  }
}
