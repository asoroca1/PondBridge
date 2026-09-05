#!/usr/bin/env node

/**
 * Hosted staging environment driver.
 *
 * Sibling to scripts/localStaging.mjs. Where localStaging.mjs runs a throwaway
 * Supabase stack in Docker, this drives the persistent hosted staging project so
 * migrations can be rehearsed against real Supabase (PostgREST, Auth, Storage,
 * the same Postgres build) before they touch production.
 *
 * The schema is applied by `supabase db push`, which replays supabase/migrations
 * verbatim and records them in supabase_migrations.schema_migrations. Nothing here
 * hand-writes DDL, so staging and production stay provably in step.
 *
 *   node scripts/remoteStaging.mjs setup    # link + push + seed + verify
 *   node scripts/remoteStaging.mjs push     # migrations only
 *   node scripts/remoteStaging.mjs verify   # assert schema parity expectations
 */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), "..");
const supabaseCli = path.join(repoRoot, "node_modules", ".bin", "supabase");
const migrationsDir = path.join(repoRoot, "supabase", "migrations");
const seedFile = path.join(repoRoot, "supabase", "seed.sql");

// Hardcoded so a typo in the environment can never point this at production.
const STAGING_REF = "pvmabzjotcpvdpffsrgp";
// Publishable/anon key -- safe to commit, it is handed to every browser anyway.
const STAGING_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB2bWFiempvdGNwdmRwZmZzcmdwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg1NTYxNjMsImV4cCI6MjEwNDEzMjE2M30.OJ5PmwnbiEJBX8dGEIj_yN9S0ADPUPDzJ6xsUZlzkN8";
const PRODUCTION_REF = "wkyjhmggkujsepafbplv";

// Load .env.staging (gitignored) if present, so the DB password and service role key
// are pasted once instead of exported into every shell. Existing environment wins.
function loadStagingEnvFile() {
  const file = path.join(repoRoot, ".env.staging");
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const key = line.slice(0, line.indexOf("=")).trim();
    let value = line.slice(line.indexOf("=") + 1).trim();
    if (value.length > 1 && ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}
loadStagingEnvFile();

const command = String(process.argv[2] || "status").trim().toLowerCase();

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

function ok(message) {
  console.log(`✔ ${message}`);
}

function projectRef() {
  const ref = String(process.env.STAGING_SUPABASE_PROJECT_REF || STAGING_REF).trim();
  if (ref === PRODUCTION_REF) {
    fail(
      "STAGING_SUPABASE_PROJECT_REF points at the PRODUCTION project " +
        `(${PRODUCTION_REF}). Refusing to run. Production DDL goes through the ` +
        "Supabase migration API, never through this script."
    );
  }
  if (!/^[a-z]{20}$/.test(ref)) {
    fail(`STAGING_SUPABASE_PROJECT_REF does not look like a project ref: ${ref}`);
  }
  return ref;
}

function dbPassword() {
  const password = String(process.env.STAGING_SUPABASE_DB_PASSWORD || "").trim();
  if (!password) {
    fail(
      "STAGING_SUPABASE_DB_PASSWORD is not set.\n\n" +
        "  Set it once in the dashboard, then export it locally:\n" +
        `    https://supabase.com/dashboard/project/${projectRef()}/settings/database\n` +
        "    -> Database password -> Reset database password\n\n" +
        "    export STAGING_SUPABASE_DB_PASSWORD='...'\n\n" +
        "  Do not commit it. .env.staging is gitignored."
    );
  }
  return password;
}

function runCli(args, { password, quiet = false } = {}) {
  if (!fs.existsSync(supabaseCli)) {
    fail(`Supabase CLI not found at ${supabaseCli}. Run: npm install`);
  }
  const env = { ...process.env };
  if (password) env.SUPABASE_DB_PASSWORD = password;

  // The CLI auto-loads a .env from its working directory. The repo-root .env holds
  // live Stripe, Cloudflare, Clerk and R2 credentials that a staging push has no
  // business reading -- and a syntax error in it (an unterminated quote broke this
  // on 2026-09-04) fails the push outright. Run from a scratch cwd with no .env and
  // point the CLI at the project explicitly.
  const result = spawnSync(supabaseCli, [...args, "--workdir", repoRoot], {
    cwd: os.tmpdir(),
    stdio: quiet ? ["ignore", "pipe", "pipe"] : "inherit",
    env
  });
  if (result.error) fail(`Failed to run supabase CLI: ${result.error.message}`);
  return result;
}

function requireLogin() {
  const result = runCli(["projects", "list"], { quiet: true });
  if (result.status !== 0) {
    fail(
      "Supabase CLI is not authenticated.\n\n" +
        "  Run this once (opens a browser):\n" +
        `    ${path.relative(process.cwd(), supabaseCli)} login\n\n` +
        "  Or export a personal access token as SUPABASE_ACCESS_TOKEN."
    );
  }
}

function localMigrationNames() {
  if (!fs.existsSync(migrationsDir)) return [];
  return fs
    .readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => name.replace(/^\d+_/, "").replace(/\.sql$/, ""));
}

function cmdStatus() {
  const ref = projectRef();
  console.log(`Staging project ref : ${ref}`);
  console.log(`Staging API URL     : https://${ref}.supabase.co`);
  console.log(`Production ref      : ${PRODUCTION_REF} (never written by this script)`);
  console.log(`Local migrations    : ${localMigrationNames().length}`);
  console.log(
    `DB password         : ${process.env.STAGING_SUPABASE_DB_PASSWORD ? "set" : "NOT set"}`
  );
}

function cmdLink() {
  requireLogin();
  const ref = projectRef();
  const result = runCli(["link", "--project-ref", ref], { password: dbPassword() });
  if (result.status !== 0) fail("supabase link failed.");
  ok(`Linked to staging project ${ref}`);
}

function cmdPush() {
  const result = runCli(["db", "push", "--include-all"], { password: dbPassword() });
  if (result.status !== 0) fail("supabase db push failed.");
  ok("Migrations applied to staging");
}

function cmdSeed() {
  if (!fs.existsSync(seedFile)) fail(`Seed file not found: ${seedFile}`);
  const ref = projectRef();
  // `db query -f` on CLI 2.109.x. There is no `db execute` subcommand; flags must
  // follow the subcommand, not `db`.
  const result = runCli(
    ["db", "query", "--linked", "--file", seedFile],
    { password: dbPassword(), quiet: true }
  );
  const output = String(result.stdout || "") + String(result.stderr || "");
  if (result.status !== 0) {
    // seed.sql is not idempotent: it plain-INSERTs its demo tenants. Re-running it
    // on an already-seeded database is a no-op worth reporting, not a failure.
    if (/duplicate key value violates unique constraint/i.test(output)) {
      console.log("• Staging is already seeded, leaving existing data alone.");
      console.log("  To rebuild it from scratch, drop the rows first -- seed.sql only inserts.");
      return;
    }
    console.error(output);
    fail(
      "Seeding failed. As a fallback you can run:\n" +
        `  ${path.relative(process.cwd(), supabaseCli)} db query --linked -f supabase/seed.sql`
    );
  }
  ok(`Seeded staging project ${ref} from supabase/seed.sql`);
}

function cmdVerify() {
  const expected = localMigrationNames();
  const result = runCli(["migration", "list", "--linked"], {
    password: dbPassword(),
    quiet: true
  });
  const output = String(result.stdout || "") + String(result.stderr || "");
  if (result.status !== 0) {
    console.error(output);
    fail("supabase migration list failed.");
  }
  const missing = expected.filter((name) => !output.includes(name));
  console.log(output.trim());
  if (missing.length) {
    fail(`Staging is missing ${missing.length} migration(s):\n  - ${missing.join("\n  - ")}`);
  }
  ok(`All ${expected.length} local migrations are applied on staging`);
}

function cmdSetup() {
  cmdLink();
  cmdPush();
  cmdSeed();
  cmdVerify();
  console.log("\nStaging is ready.");
  console.log(`  SUPABASE_URL=https://${projectRef()}.supabase.co`);
}


function serviceRoleKey() {
  const key = String(process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!key) {
    fail(
      "STAGING_SUPABASE_SERVICE_ROLE_KEY is not set.\n\n" +
        "  Copy the staging project's service role (secret) key:\n" +
        `    https://supabase.com/dashboard/project/${projectRef()}/settings/api-keys\n\n` +
        "    export STAGING_SUPABASE_SERVICE_ROLE_KEY='...'\n\n" +
        "  It is a secret. Do not commit it; put it in .env.staging, which is gitignored."
    );
  }
  if (key.includes("wkyjhmggkujsepafbplv")) {
    fail("That is the PRODUCTION service role key. Refusing to run.");
  }
  return key;
}

// Mirrors buildSafeApplicationEnv() in localStaging.mjs: the child processes get an
// explicit env and inherit nothing from the host shell or the repo's .env files, so
// running against staging can never pick up a live Stripe/Resend/Clerk credential.
function buildStagingEnv() {
  const url = `https://${projectRef()}.supabase.co`;
  const origins = [
    "http://localhost:5174",
    "http://127.0.0.1:5174",
    "http://cedar.localhost:5174",
    "http://pine-control.localhost:5174",
    "http://fresh-camp.localhost:5174"
  ].join(",");
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    NODE_ENV: "development",
    PORT: "4000",
    AUTH_PROVIDER: "legacy",
    AUTH_TOKEN_MODE: "hybrid",
    AUTH_COOKIE_SAMESITE: "lax",
    JWT_SECRET: "pondbridge-remote-staging-jwt-only",
    EMAIL_PREFERENCE_TOKEN_SECRET: "pondbridge-remote-staging-email-only",
    BCRYPT_ROUNDS: "10",
    SUPABASE_URL: url,
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey(),
    PONDBRIDGE_TARGET_ENV: "staging",
    PONDBRIDGE_ALLOW_DB_RESET: "0",
    PONDBRIDGE_TEST_RESET_ACK: "0",
    APP_BASE_DOMAIN: "localhost",
    TENANT_HOST_SUFFIXES: "localhost",
    FRONTEND_ORIGIN: "http://127.0.0.1:5174",
    FRONTEND_ORIGINS: origins,
    PUBLIC_API_ORIGIN: "http://127.0.0.1:4000",
    CUSTOM_DOMAIN_ALLOWLIST: "",
    TRUST_PROXY_HOPS: "0",
    // Staging must not be able to reach any live provider.
    EMAIL_MODE: "mock",
    EMAIL_FROM: "PondBridge Staging <no-reply@pondbridge.example.test>",
    BILLING_MODE: "mock",
    ALLOW_MOCK_BILLING_IN_PRODUCTION: "false",
    DIRECTOR_WIZARD_REQUIRE_BILLING: "false",
    OPENAI_API_KEY: "",
    SUPER_COPILOT_ENABLED: "false",
    AI_SEARCH_MONTHLY_BUDGET_USD: "0",
    PROFILE_IMPORT_MONTHLY_BUDGET_USD: "0",
    EMAIL_AGENT_MONTHLY_BUDGET_USD: "0",
    STRIPE_SECRET_KEY: "",
    STRIPE_WEBHOOK_SECRET: "",
    STRIPE_PRICE_FLAGSHIP_ANNUAL: "",
    STRIPE_PRICE_TEST_ANNUAL: "",
    RESEND_API_KEY: "",
    RESEND_WEBHOOK_SECRET: "",
    SMTP_HOST: "",
    SMTP_USER: "",
    SMTP_PASS: "",
    CLOUDFLARE_ACCOUNT_ID: "",
    CLOUDFLARE_API_TOKEN: "",
    CLOUDFLARE_ZONE_ID: "",
    CLOUDFLARE_PAGES_PROJECT_NAME: "",
    CLOUDFLARE_WEB_CNAME_TARGET: "",
    R2_BUCKET_NAME: "",
    R2_ACCESS_KEY_ID: "",
    R2_SECRET_ACCESS_KEY: "",
    R2_ENDPOINT: "",
    R2_PUBLIC_BASE_URL: "",
    APNS_KEY_ID: "",
    APNS_TEAM_ID: "",
    APNS_PRIVATE_KEY: "",
    APNS_USE_SANDBOX: "true",
    FCM_PROJECT_ID: "",
    FCM_CLIENT_EMAIL: "",
    FCM_PRIVATE_KEY: "",
    SUPER_TENANT_HARD_DELETE_ENABLED: "false",
    SUPER_TENANT_PRODUCTION_WIPE_ENABLED: "false",
    SUPER_TENANT_DEMO_RESET_ENABLED: "false",
    ALLOW_PUBLIC_AUTO_BOOTSTRAP_FIRST_TENANT: "false",
    ALLOW_EMPTY_PRODUCTION_TENANTS: "false",
    PRODUCTION_MIN_TENANTS: "1",
    CLERK_SECRET_KEY: "",
    CLERK_WEBHOOK_SIGNING_SECRET: "",
    CLERK_AUTHORIZED_PARTIES: "",
    CLERK_JWT_AUDIENCE: "",
    CLERK_REQUIRE_TENANT_CLAIM: "false",
    CLERK_SUPER_ADMIN_EMAILS: "",
    CLERK_SUPER_ADMIN_USER_IDS: "",
    CLERK_BOOTSTRAP_FIRST_SUPER_ADMIN: "false",
    VITE_API_BASE: "http://127.0.0.1:4000",
    VITE_NATIVE_API_BASE: "http://127.0.0.1:4000",
    VITE_APP_BASE_DOMAIN: "localhost",
    VITE_AUTH_PROVIDER: "legacy",
    VITE_CLERK_PUBLISHABLE_KEY: "",
    VITE_AUTO_LOGOUT_MINUTES: "60",
    VITE_FORCE_LOGOUT_ON_TAB_CLOSE: "false",
    VITE_SUPABASE_URL: url,
    VITE_SUPABASE_ANON_KEY: STAGING_ANON_KEY
  };
}

function cmdDev() {
  const env = buildStagingEnv();
  console.log(`Running API + web against staging (${projectRef()})`);
  console.log("  api  http://127.0.0.1:4000");
  console.log("  web  http://127.0.0.1:5174\n");
  const children = [
    spawn("npm", ["--workspace", "@pondbridge/api", "run", "dev"], { cwd: repoRoot, stdio: "inherit", env }),
    spawn("npm", ["--workspace", "@pondbridge/web", "run", "dev", "--", "--host", "127.0.0.1", "--port", "5174", "--strictPort"],
      { cwd: repoRoot, stdio: "inherit", env })
  ];
  const stop = () => children.forEach((c) => { try { c.kill("SIGTERM"); } catch {} });
  process.on("SIGINT", () => { stop(); process.exit(0); });
  process.on("SIGTERM", () => { stop(); process.exit(0); });
  children.forEach((c) => c.on("exit", (code) => { if (code) { stop(); process.exit(code || 1); } }));
}


// API only. Used when the web dev server runs from the primary checkout but the API
// cannot boot there -- on the iCloud-synced Desktop path nodemon starves before it
// even spawns its child (measured 3 min elapsed / 0.27s CPU, nothing on port 4000).
// Running this from a local-disk clone with its own node_modules starts in seconds.
function cmdDevApi() {
  const env = buildStagingEnv();
  console.log(`API only, against staging (${projectRef()}) on http://127.0.0.1:4000`);
  // Run node directly rather than `npm run dev`. nodemon hangs here before it ever
  // spawns its child (measured 2026-09-04: 3.5 min elapsed, 0.29s CPU, no child
  // process, nothing on port 4000) even from a local-disk clone with no iCloud
  // involvement. Bypassing it loses auto-restart, which a review session does not need.
  const child = spawn(process.execPath, [path.join(repoRoot, "apps", "api", "src", "server.js")],
    { cwd: path.join(repoRoot, "apps", "api"), stdio: "inherit", env });
  const stop = () => { try { child.kill("SIGTERM"); } catch {} };
  process.on("SIGINT", () => { stop(); process.exit(0); });
  process.on("SIGTERM", () => { stop(); process.exit(0); });
  child.on("exit", (code) => process.exit(code || 0));
}

const commands = {
  status: cmdStatus,
  link: cmdLink,
  push: cmdPush,
  seed: cmdSeed,
  verify: cmdVerify,
  setup: cmdSetup,
  dev: cmdDev,
  "dev-api": cmdDevApi
};

const handler = commands[command];
if (!handler) {
  fail(`Unknown command "${command}". Expected one of: ${Object.keys(commands).join(", ")}`);
}
handler();
