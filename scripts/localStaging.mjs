#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), "..");
const supabaseCli = path.join(repoRoot, "node_modules", ".bin", "supabase");
const cliWorkdir = path.join(os.homedir(), ".cache", "pondbridge-local-staging");
const cliSupabaseDir = path.join(cliWorkdir, "supabase");
const localNetwork = "supabase_network_pondbridge-local-staging";
const preferredNodeBin = "/opt/homebrew/opt/node@22/bin";
const bundledDockerCli = "/Applications/Docker.app/Contents/Resources/bin/docker";
const preferredDockerBin = path.dirname(bundledDockerCli);
const colimaCli = "/opt/homebrew/opt/colima/bin/colima";
const colimaSocket = path.join(os.homedir(), ".colima", "pondbridge", "docker.sock");
const command = String(process.argv[2] || "status").trim().toLowerCase();
const commandArgs = process.argv.slice(3);

const EXPECTED_MIGRATIONS = [
  "pondbridge_native_baseline",
  "pondbridge_platform_audit",
  "pondbridge_rollout_control",
  "pondbridge_communications_system",
  "pondbridge_multi_camp_identity",
  "pondbridge_member_safety",
  "pondbridge_database_performance_hardening",
  "pondbridge_database_security_hardening",
  "add_registered_member_seminars"
];

const EXPECTED_TABLES = [
  "tenants",
  "users",
  "profiles",
  "invites",
  "alumni_contacts",
  "access_requests",
  "magic_link_tokens",
  "conversations",
  "messages",
  "forums",
  "forum_posts",
  "photos",
  "newsletters",
  "events",
  "event_rsvps",
  "event_messages",
  "event_meeting_details",
  "event_join_access_logs",
  "ai_generations",
  "email_broadcasts",
  "email_preferences",
  "family_trees",
  "analytics_events",
  "import_reports",
  "tenant_admin_audit_logs",
  "platform_admin_audit_logs",
  "feature_rollouts",
  "identities",
  "tenant_memberships",
  "member_blocks",
  "content_reports",
  "resume_parse_results",
  "city_geo",
  "activity_items",
  "mobile_notifications",
  "mobile_notification_devices",
  "mobile_notification_preferences",
  "mobile_notification_templates",
  "mobile_notification_schedules",
  "resend_webhook_events",
  "stripe_webhook_events",
  "email_suppressions"
];

const safeChildPath = [
  fs.existsSync(preferredNodeBin) ? preferredNodeBin : "",
  fs.existsSync(preferredDockerBin) ? preferredDockerBin : "",
  process.env.PATH || ""
].filter(Boolean).join(":");
const dockerPathLookup = spawnSync("sh", ["-lc", "command -v docker"], {
  encoding: "utf8",
  stdio: "pipe"
});
const dockerCli = String(dockerPathLookup.stdout || "").trim() ||
  (fs.existsSync(bundledDockerCli) ? bundledDockerCli : "");

function getDockerRuntimeEnv() {
  return fs.existsSync(colimaSocket)
    ? { DOCKER_HOST: `unix://${colimaSocket}` }
    : {};
}

function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: options.cwd || repoRoot,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
    env: {
      ...process.env,
      PATH: safeChildPath,
      ...getDockerRuntimeEnv(),
      ...(options.env || {})
    }
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const details = options.capture
      ? String(result.stderr || result.stdout || "").trim()
      : "See the command output above.";
    throw new Error(`${path.basename(executable)} failed: ${details}`);
  }
  return String(result.stdout || "");
}

function runIsolated(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: options.cwd || repoRoot,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
    env: options.env || {}
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const details = options.capture
      ? String(result.stderr || result.stdout || "").trim()
      : "See the command output above.";
    throw new Error(`${path.basename(executable)} failed: ${details}`);
  }
  return String(result.stdout || "");
}

function assertCliInstalled() {
  if (!fs.existsSync(supabaseCli)) {
    throw new Error("Supabase CLI is missing. Run npm install from the repository root.");
  }
}

function isCanonicalMigrationFilename(name = "") {
  return /^\d{14}_[a-z0-9_]+\.sql$/.test(String(name || ""));
}

function assertLocalSqlReadable() {
  const sqlDir = path.join(repoRoot, "supabase", "migrations");
  const sqlFiles = fs.readdirSync(sqlDir).filter(isCanonicalMigrationFilename);
  for (const name of sqlFiles) {
    const sql = fs.readFileSync(path.join(sqlDir, name), "utf8");
    if (!sql.trim()) throw new Error(`Local migration is empty: ${name}`);
  }
  const seed = fs.readFileSync(path.join(repoRoot, "supabase", "seed.sql"), "utf8");
  if (!seed.trim()) throw new Error("Local staging seed is empty.");
}

function collectTreeFiles(rootDir, output) {
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
      } else if (entry.isFile()) {
        output.push(fullPath);
      }
    }
  };
  visit(rootDir);
}

async function hydrateApplicationSources() {
  const roots = [
    path.join(repoRoot, "apps", "api", "src"),
    path.join(repoRoot, "apps", "api", "scripts"),
    path.join(repoRoot, "apps", "api", "tests"),
    path.join(repoRoot, "apps", "web", "src"),
    path.join(repoRoot, "apps", "web", "public")
  ];
  const files = [];
  for (const root of roots) {
    if (fs.existsSync(root)) collectTreeFiles(root, files);
  }
  for (const file of [
    path.join(repoRoot, "apps", "web", "index.html"),
    path.join(repoRoot, "apps", "web", "vite.config.js")
  ]) {
    files.push(file);
  }
  for (let index = 0; index < files.length; index += 16) {
    await Promise.all(files.slice(index, index + 16).map((file) => fs.promises.readFile(file)));
  }
  console.log(`[local-staging] Hydrated ${files.length} application files before launch.`);
}

function ensureCliWorkdir() {
  fs.mkdirSync(cliWorkdir, { recursive: true });
  try {
    if (fs.lstatSync(cliSupabaseDir).isSymbolicLink()) {
      fs.rmSync(cliSupabaseDir, { recursive: true, force: true });
    }
  } catch {
    // The materialized directory does not exist yet.
  }
  fs.mkdirSync(cliSupabaseDir, { recursive: true });
  fs.copyFileSync(
    path.join(repoRoot, "supabase", "config.toml"),
    path.join(cliSupabaseDir, "config.toml")
  );
  fs.copyFileSync(
    path.join(repoRoot, "supabase", "seed.sql"),
    path.join(cliSupabaseDir, "seed.sql")
  );
  const sourceMigrations = path.join(repoRoot, "supabase", "migrations");
  const cachedMigrations = path.join(cliSupabaseDir, "migrations");
  fs.rmSync(cachedMigrations, { recursive: true, force: true });
  fs.mkdirSync(cachedMigrations, { recursive: true });
  const canonicalMigrations = fs
    .readdirSync(sourceMigrations)
    .filter(isCanonicalMigrationFilename)
    .sort();
  for (const migrationName of canonicalMigrations) {
    fs.copyFileSync(
      path.join(sourceMigrations, migrationName),
      path.join(cachedMigrations, migrationName)
    );
  }
}

function runSupabase(args, options = {}) {
  ensureCliWorkdir();
  return run(supabaseCli, [...args, "--workdir", cliWorkdir], {
    ...options,
    cwd: cliWorkdir
  });
}

function dockerIsReady() {
  if (!dockerCli) return false;
  const result = spawnSync(dockerCli, ["info", "--format", "{{.ServerVersion}}"], {
    encoding: "utf8",
    stdio: "pipe",
    env: { ...process.env, PATH: safeChildPath, ...getDockerRuntimeEnv() }
  });
  return result.status === 0;
}

function assertDockerReady() {
  if (!dockerCli) {
    throw new Error("Docker CLI is missing. Install the Docker CLI before starting local staging.");
  }
  if (!dockerIsReady() && fs.existsSync(colimaCli)) {
    run(colimaCli, [
      "start",
      "pondbridge",
      "--cpus",
      "4",
      "--memory",
      "4",
      "--disk",
      "30",
      "--runtime",
      "docker",
      "--vm-type",
      "vz",
      "--vz-rosetta=false"
    ], { env: { DOCKER_HOST: "" } });
  }
  if (!dockerIsReady()) {
    throw new Error(
      "The PondBridge local container runtime could not start. Run `colima status pondbridge` for details."
    );
  }
}

function ensureLocalNetwork() {
  const inspect = spawnSync(dockerCli, ["network", "inspect", localNetwork], {
    stdio: "ignore",
    env: { ...process.env, PATH: safeChildPath, ...getDockerRuntimeEnv() }
  });
  if (inspect.status === 0) return;
  run(dockerCli, [
    "network",
    "create",
    "-o",
    "com.docker.network.bridge.host_binding_ipv4=127.0.0.1",
    localNetwork
  ], { capture: true });
}

function startStack() {
  assertCliInstalled();
  assertDockerReady();
  assertLocalSqlReadable();
  ensureLocalNetwork();
  console.log("[local-staging] Starting local Supabase services...");
  runSupabase([
    "start",
    "--exclude",
    "logflare,vector,imgproxy,edge-runtime"
  ], { capture: true });
}

function parseEnvOutput(output = "") {
  const values = {};
  for (const line of String(output).split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

function getLocalStatus() {
  assertCliInstalled();
  const values = parseEnvOutput(runSupabase(["status", "-o", "env"], { capture: true }));
  const normalized = {
    apiUrl: values.API_URL || values.SUPABASE_URL || "",
    dbUrl: values.DB_URL || values.POSTGRES_URL || "",
    studioUrl: values.STUDIO_URL || "http://127.0.0.1:54323",
    inbucketUrl: values.INBUCKET_URL || "http://127.0.0.1:54324",
    anonKey: values.ANON_KEY || values.PUBLISHABLE_KEY || "",
    serviceRoleKey: values.SERVICE_ROLE_KEY || values.SECRET_KEY || ""
  };
  if (!normalized.apiUrl || !normalized.dbUrl || !normalized.serviceRoleKey) {
    throw new Error("Local Supabase status is incomplete. Run npm run staging:local:start first.");
  }
  return normalized;
}

function buildSafeApplicationEnv(status) {
  return {
    PATH: safeChildPath,
    NODE_ENV: "development",
    PORT: "4000",
    AUTH_PROVIDER: "legacy",
    AUTH_TOKEN_MODE: "hybrid",
    JWT_SECRET: "pondbridge-local-staging-jwt-only",
    EMAIL_PREFERENCE_TOKEN_SECRET: "pondbridge-local-staging-email-only",
    BCRYPT_ROUNDS: "10",
    SUPABASE_URL: status.apiUrl,
    SUPABASE_SERVICE_ROLE_KEY: status.serviceRoleKey,
    SUPABASE_DB_URL: status.dbUrl,
    PONDBRIDGE_TARGET_ENV: "local",
    PONDBRIDGE_LOCAL_STAGING: "1",
    PONDBRIDGE_ALLOW_DB_RESET: "0",
    PONDBRIDGE_TEST_RESET_ACK: "0",
    APP_BASE_DOMAIN: "localhost",
    TENANT_HOST_SUFFIXES: "localhost",
    FRONTEND_ORIGIN: "http://127.0.0.1:5174",
    FRONTEND_ORIGINS:
      "http://localhost:5174,http://127.0.0.1:5174,http://cedar.localhost:5174,http://pine-control.localhost:5174,http://fresh-camp.localhost:5174",
    PUBLIC_API_ORIGIN: "http://127.0.0.1:4000",
    CUSTOM_DOMAIN_ALLOWLIST: "",
    FEATURE_FLAGS: "{}",
    OPENAI_API_KEY: "",
    SUPER_COPILOT_ENABLED: "false",
    AI_SEARCH_MONTHLY_BUDGET_USD: "0",
    PROFILE_IMPORT_MONTHLY_BUDGET_USD: "0",
    EMAIL_AGENT_MONTHLY_BUDGET_USD: "0",
    BILLING_MODE: "mock",
    DIRECTOR_WIZARD_REQUIRE_BILLING: "false",
    ALLOW_MOCK_BILLING_IN_PRODUCTION: "false",
    STRIPE_SECRET_KEY: "",
    STRIPE_WEBHOOK_SECRET: "",
    STRIPE_PRICE_LEGACY_ANNUAL: "",
    STRIPE_PRICE_FOUNDERS_ANNUAL: "",
    STRIPE_PRICE_INSTITUTIONAL_ANNUAL: "",
    STRIPE_PRICE_TEST_ANNUAL: "",
    STRIPE_PRICE_LEGACY_ONBOARDING: "",
    STRIPE_PRICE_INSTITUTIONAL_ONBOARDING: "",
    EMAIL_MODE: "mock",
    EMAIL_FROM: "PondBridge Local Staging <no-reply@pondbridge.example.test>",
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
    FCM_ANDROID_APP_ID: "com.pondbridge.android",
    SUPER_TENANT_HARD_DELETE_ENABLED: "false",
    SUPER_TENANT_PRODUCTION_WIPE_ENABLED: "false",
    SUPER_TENANT_DEMO_RESET_ENABLED: "false",
    ALLOW_PUBLIC_AUTO_BOOTSTRAP_FIRST_TENANT: "false",
    ALLOW_EMPTY_PRODUCTION_TENANTS: "false",
    PRODUCTION_MIN_TENANTS: "3",
    VITE_API_BASE: "http://127.0.0.1:4000",
    VITE_NATIVE_API_BASE: "http://127.0.0.1:4000",
    VITE_APP_BASE_DOMAIN: "localhost",
    VITE_AUTH_PROVIDER: "legacy",
    VITE_CLERK_PUBLISHABLE_KEY: "",
    VITE_FORCE_LOGOUT_ON_TAB_CLOSE: "true",
    VITE_SUPABASE_URL: status.apiUrl,
    VITE_SUPABASE_ANON_KEY: status.anonKey,
    CLERK_SECRET_KEY: "",
    CLERK_WEBHOOK_SIGNING_SECRET: "",
    CLERK_AUTHORIZED_PARTIES: "",
    CLERK_JWT_AUDIENCE: "",
    CLERK_REQUIRE_TENANT_CLAIM: "false",
    CLERK_SUPER_ADMIN_EMAILS: "",
    CLERK_SUPER_ADMIN_USER_IDS: "",
    CLERK_BOOTSTRAP_FIRST_SUPER_ADMIN: "false"
  };
}

function buildIsolatedChildEnv(status) {
  const inheritedSystemEnv = {};
  for (const key of [
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "TERM",
    "COLORTERM",
    "NO_COLOR",
    "FORCE_COLOR"
  ]) {
    if (process.env[key] !== undefined) inheritedSystemEnv[key] = process.env[key];
  }
  return {
    ...inheritedSystemEnv,
    ...buildSafeApplicationEnv(status)
  };
}

async function expectSqlState(client, name, query, expectedState) {
  await client.query("BEGIN");
  try {
    await client.query(query);
    throw new Error(`${name} unexpectedly succeeded.`);
  } catch (error) {
    if (String(error?.code || "") !== expectedState) {
      throw new Error(`${name} failed with ${error?.code || "unknown"}, expected ${expectedState}.`);
    }
  } finally {
    await client.query("ROLLBACK");
  }
}

async function expectSqlSuccessRolledBack(client, name, queries = []) {
  await client.query("BEGIN");
  try {
    for (const query of queries) await client.query(query);
  } catch (error) {
    throw new Error(`${name} failed with ${error?.code || "unknown"}: ${error?.message || error}`);
  } finally {
    await client.query("ROLLBACK");
  }
}

async function verifyStack() {
  const [{ createClient }, { Client }] = await Promise.all([
    import("@supabase/supabase-js"),
    import("pg")
  ]);
  const status = getLocalStatus();
  const client = new Client({ connectionString: status.dbUrl });
  const checks = [];
  const check = (name, condition, details = "") => {
    if (!condition) throw new Error(`${name} failed${details ? `: ${details}` : ""}`);
    checks.push(name);
  };

  await client.connect();
  try {
    const migrations = await client.query(
      "select name from supabase_migrations.schema_migrations order by version"
    );
    check(
      "ordered migration history",
      JSON.stringify(migrations.rows.map((row) => row.name)) === JSON.stringify(EXPECTED_MIGRATIONS),
      JSON.stringify(migrations.rows)
    );

    const tables = await client.query(`
      select
        c.relname as table_name,
        c.relrowsecurity as rls_enabled,
        c.relforcerowsecurity as rls_forced,
        has_table_privilege('anon', c.oid, 'SELECT')
          or has_table_privilege('anon', c.oid, 'INSERT')
          or has_table_privilege('anon', c.oid, 'UPDATE')
          or has_table_privilege('anon', c.oid, 'DELETE') as anon_has_crud,
        has_table_privilege('authenticated', c.oid, 'SELECT')
          or has_table_privilege('authenticated', c.oid, 'INSERT')
          or has_table_privilege('authenticated', c.oid, 'UPDATE')
          or has_table_privilege('authenticated', c.oid, 'DELETE') as authenticated_has_crud,
        has_table_privilege('service_role', c.oid, 'SELECT')
          and has_table_privilege('service_role', c.oid, 'INSERT')
          and has_table_privilege('service_role', c.oid, 'UPDATE')
          and has_table_privilege('service_role', c.oid, 'DELETE') as service_role_has_crud,
        (
          select count(*)::int
          from pg_policies p
          where p.schemaname = 'public'
            and p.tablename = c.relname
            and 'service_role' = any(p.roles)
        ) as service_role_policy_count
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind = 'r'
        and c.relname = any($1::text[])
      order by c.relname
    `, [EXPECTED_TABLES]);
    check("all PondBridge tables exist", tables.rows.length === EXPECTED_TABLES.length, `${tables.rows.length}/${EXPECTED_TABLES.length}`);
    check("RLS enabled and forced", tables.rows.every((row) => row.rls_enabled && row.rls_forced));
    check("browser table roles closed", tables.rows.every((row) => !row.anon_has_crud && !row.authenticated_has_crud));
    check("service role CRUD explicit", tables.rows.every((row) => row.service_role_has_crud));
    check("service role policies present", tables.rows.every((row) => Number(row.service_role_policy_count) > 0));

    const functions = await client.query(`
      select
        count(*) filter (where p.prosecdef)::int as security_definer_count,
        count(*) filter (
          where not exists (
            select 1 from unnest(coalesce(p.proconfig, array[]::text[])) setting
            where setting like 'search_path=%'
          )
        )::int as unpinned_search_path_count
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
    `);
    check("no public security-definer functions", Number(functions.rows[0].security_definer_count) === 0);
    check("all public functions pin search_path", Number(functions.rows[0].unpinned_search_path_count) === 0, JSON.stringify(functions.rows[0]));

    const tenantSummary = await client.query(`
      select id, slug, onboarding_status, settings, notification_prefs
      from public.tenants
      order by id
    `);
    check("three synthetic tenants seeded", tenantSummary.rows.length === 3);
    check("target tenant seeded", tenantSummary.rows.some((row) => row.id === 'tenant_local_cedar' && row.slug === 'cedar'));
    check("control tenant seeded", tenantSummary.rows.some((row) => row.id === 'tenant_local_control' && row.slug === 'pine-control'));
    check("fresh-camp rehearsal seeded", tenantSummary.rows.some((row) => row.id === 'tenant_local_fresh' && row.onboarding_status === 'not_started'));
    check("all tenant data marked synthetic", tenantSummary.rows.every((row) => row.settings?.synthetic === true));
    check("push disabled for every tenant", tenantSummary.rows.every((row) => row.notification_prefs?.pushEnabled !== true));
    check("provider safety defaults present", tenantSummary.rows.every((row) => row.settings?.providerSafety?.outboundEmail === 'mock' && row.settings?.providerSafety?.push === 'disabled' && row.settings?.providerSafety?.ai === 'disabled' && row.settings?.providerSafety?.billing === 'mock'));

    const rolloutSummary = await client.query(`
      select feature_key, state, kill_switch, tenant_ids, excluded_tenant_ids
      from public.feature_rollouts
      order by feature_key
    `);
    check("four durable rollout controls seeded", rolloutSummary.rows.length === 4);
    check("rollouts fail closed", rolloutSummary.rows.every((row) => row.state === 'disabled' && row.kill_switch === true));
    check("target/control cohorts use stable IDs", rolloutSummary.rows.every((row) => row.tenant_ids.includes('tenant_local_cedar') && row.excluded_tenant_ids.includes('tenant_local_control')));

    const syntheticEmails = await client.query(`
      select
        (select count(*)::int from public.users where email not like '%.example.test') as unsafe_users,
        (select count(*)::int from public.alumni_contacts where email not like '%.example.test') as unsafe_contacts,
        (select count(*)::int from public.mobile_notification_devices) as device_count,
        (select count(*)::int from public.mobile_notification_preferences where push_enabled) as push_enabled_count
    `);
    check("only reserved synthetic email addresses", Number(syntheticEmails.rows[0].unsafe_users) === 0 && Number(syntheticEmails.rows[0].unsafe_contacts) === 0, JSON.stringify(syntheticEmails.rows[0]));
    check("no push devices seeded", Number(syntheticEmails.rows[0].device_count) === 0);
    check("user push preferences disabled", Number(syntheticEmails.rows[0].push_enabled_count) === 0);

    const productionShapedIds = await client.query(`
      select
        (select count(*)::int from public.users where tenant_id is not null and id !~ '^[0-9a-f]{24}$') as users,
        (select count(*)::int from public.profiles where id !~ '^[0-9a-f]{24}$') as profiles,
        (select count(*)::int from public.conversations where id !~ '^[0-9a-f]{24}$') as conversations,
        (select count(*)::int from public.messages where id !~ '^[0-9a-f]{24}$') as messages,
        (select count(*)::int from public.forums where id !~ '^[0-9a-f]{24}$') as forums,
        (select count(*)::int from public.forum_posts where id !~ '^[0-9a-f]{24}$') as forum_posts,
        (select count(*)::int from public.events where id !~ '^[0-9a-f]{24}$') as events
    `);
    check(
      "member-facing seed IDs production-shaped",
      Object.values(productionShapedIds.rows[0]).every((value) => Number(value) === 0),
      JSON.stringify(productionShapedIds.rows[0])
    );

    const localSuperAdmin = await client.query(`
      select tenant_id, roles, status
      from public.users
      where id = 'user_local_superadmin'
    `);
    check(
      "local super-admin role intact",
      localSuperAdmin.rows.length === 1 &&
        localSuperAdmin.rows[0].tenant_id === null &&
        localSuperAdmin.rows[0].status === "active" &&
        localSuperAdmin.rows[0].roles.includes("super_admin")
    );

    await expectSqlState(
      client,
      "cross-tenant profile write",
      `insert into public.profiles (id, tenant_id, user_id, first_name, last_name)
       values ('profile_cross_tenant_probe', 'tenant_local_control', '000000000000000000000102', 'Cross', 'Tenant')`,
      "23514"
    );
    checks.push("cross-tenant profile write rejected");

    await expectSqlState(
      client,
      "duplicate active identity across tenants",
      `insert into public.users (id, tenant_id, email, password_hash, roles)
       values ('user_cross_tenant_probe', 'tenant_local_control', 'alex.rivera@cedar.example.test', 'not-a-login', array['user'])`,
      "23514"
    );
    checks.push("duplicate active identity across tenants rejected");

    const enableMultiCampPilot = `
      update public.feature_rollouts
      set state = 'pilot',
          kill_switch = false,
          tenant_ids = array['tenant_local_cedar'],
          excluded_tenant_ids = array['tenant_local_control']
      where feature_key = 'multi_camp_identity_v1'
    `;
    await expectSqlSuccessRolledBack(client, "multi-camp target identity", [
      enableMultiCampPilot,
      `insert into public.users (id, tenant_id, email, password_hash, roles)
       values ('user_multi_source_probe', 'tenant_local_control', 'rollout.target@pondbridge.example.test', 'not-a-login', array['user'])`,
      `insert into public.users (id, tenant_id, email, password_hash, roles)
       values ('user_multi_target_probe', 'tenant_local_cedar', 'rollout.target@pondbridge.example.test', 'not-a-login', array['user'])`
    ]);
    checks.push("multi-camp target cohort enabled");

    await expectSqlState(
      client,
      "multi-camp control identity",
      `${enableMultiCampPilot};
       insert into public.users (id, tenant_id, email, password_hash, roles)
       values ('user_multi_control_source_probe', 'tenant_local_cedar', 'rollout.control@pondbridge.example.test', 'not-a-login', array['user']);
       insert into public.users (id, tenant_id, email, password_hash, roles)
       values ('user_multi_control_probe', 'tenant_local_control', 'rollout.control@pondbridge.example.test', 'not-a-login', array['user'])`,
      "23514"
    );
    checks.push("multi-camp control cohort unchanged");

    await expectSqlState(
      client,
      "multi-camp kill switch",
      `${enableMultiCampPilot};
       update public.feature_rollouts
       set kill_switch = true
       where feature_key = 'multi_camp_identity_v1';
       insert into public.users (id, tenant_id, email, password_hash, roles)
       values ('user_multi_kill_source_probe', 'tenant_local_control', 'rollout.kill@pondbridge.example.test', 'not-a-login', array['user']);
       insert into public.users (id, tenant_id, email, password_hash, roles)
       values ('user_multi_kill_target_probe', 'tenant_local_cedar', 'rollout.kill@pondbridge.example.test', 'not-a-login', array['user'])`,
      "23514"
    );
    checks.push("multi-camp kill switch enforced");
  } finally {
    await client.end();
  }

  const serviceClient = createClient(status.apiUrl, status.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const serviceRead = await serviceClient.from("tenants").select("id", { count: "exact" });
  check("service-role Data API read", !serviceRead.error && Number(serviceRead.count) === 3, serviceRead.error?.message || "");

  if (status.anonKey) {
    const anonClient = createClient(status.apiUrl, status.anonKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    const anonRead = await anonClient.from("tenants").select("id").limit(1);
    check("anonymous Data API blocked", Boolean(anonRead.error));
  }

  console.log("\nPondBridge local staging verification passed:");
  for (const item of checks) console.log(`  ✓ ${item}`);
  console.log(`\nStudio: ${status.studioUrl}`);
  console.log(`Local email inbox: ${status.inbucketUrl}`);
}

async function runCommand() {
  if (command === "start") {
    startStack();
    const status = getLocalStatus();
    console.log(`\nPondBridge local staging is running.`);
    console.log(`Studio: ${status.studioUrl}`);
    console.log(`Local email inbox: ${status.inbucketUrl}`);
    return;
  }

  if (command === "reset") {
    startStack();
    runSupabase(["db", "reset", "--local"]);
    await verifyStack();
    return;
  }

  if (command === "verify") {
    await verifyStack();
    return;
  }

  if (command === "rehearse") {
    await hydrateApplicationSources();
    startStack();
    const status = getLocalStatus();
    const rehearsalEnv = {
      ...buildIsolatedChildEnv(status),
      PONDBRIDGE_TARGET_ENV: "local",
      PONDBRIDGE_FRESH_CAMP_REHEARSAL_ACK: "run-fresh-camp-rehearsal-staging"
    };
    console.log("[local-staging] Running full synthetic fresh-camp rehearsal...");
    try {
      runIsolated(process.execPath, ["scripts/devProvisionTestCampFlow.js"], {
        cwd: path.join(repoRoot, "apps", "api"),
        env: rehearsalEnv
      });
    } finally {
      console.log("[local-staging] Restoring the canonical three-camp baseline...");
      runSupabase(["db", "reset", "--local"]);
    }
    await verifyStack();
    console.log("[local-staging] Fresh-camp rehearsal passed and the clean baseline was restored.");
    return;
  }

  if (command === "test") {
    await hydrateApplicationSources();
    startStack();
    const status = getLocalStatus();
    const testEnv = {
      ...buildIsolatedChildEnv(status),
      NODE_ENV: "test",
      NODE_OPTIONS: "--experimental-vm-modules",
      PONDBRIDGE_ALLOW_DB_RESET: "1",
      PONDBRIDGE_TEST_RESET_ACK: "1",
      PONDBRIDGE_CONFIRM_WIPE_EXISTING_TENANTS: "1"
    };
    console.log("[local-staging] Running the complete database-backed API suite...");
    try {
      runIsolated(
        path.join(repoRoot, "node_modules", ".bin", "jest"),
        ["--config", "jest.config.cjs", "--runInBand", ...commandArgs],
        {
          cwd: path.join(repoRoot, "apps", "api"),
          env: testEnv
        }
      );
    } finally {
      console.log("[local-staging] Restoring the canonical three-camp baseline...");
      runSupabase(["db", "reset", "--local"]);
    }
    await verifyStack();
    console.log("[local-staging] Database-backed API suite passed and the clean baseline was restored.");
    return;
  }

  if (command === "stop") {
    assertCliInstalled();
    runSupabase(["stop"]);
    return;
  }

  if (command === "dev") {
    await hydrateApplicationSources();
    startStack();
    const status = getLocalStatus();
    const childEnv = buildIsolatedChildEnv(status);
    const devProcesses = [
      {
        executable: process.execPath,
        args: ["src/server.js"],
        cwd: path.join(repoRoot, "apps", "api")
      },
      {
        executable: path.join(repoRoot, "apps", "web", "node_modules", ".bin", "vite"),
        args: ["--port", "5174"],
        cwd: path.join(repoRoot, "apps", "web")
      }
    ];
    const children = devProcesses.map(({ executable, args, cwd }) =>
      spawn(executable, args, {
        cwd,
        stdio: "inherit",
        env: childEnv
      })
    );
    for (const signal of ["SIGINT", "SIGTERM"]) {
      process.on(signal, () => children.forEach((child) => child.kill(signal)));
    }
    const exitCode = await Promise.race(children.map((child) =>
      new Promise((resolve) => {
        child.on("exit", resolve);
        child.on("error", (error) => {
          console.error(`[local-staging] Failed to start app process: ${error.message}`);
          resolve(1);
        });
      })
    ));
    children.forEach((child) => {
      if (!child.killed) child.kill("SIGTERM");
    });
    process.exitCode = Number(exitCode || 0);
    return;
  }

  if (command === "status") {
    const status = getLocalStatus();
    console.log("PondBridge local staging is running.");
    console.log(`API: ${status.apiUrl}`);
    console.log(`Studio: ${status.studioUrl}`);
    console.log(`Local email inbox: ${status.inbucketUrl}`);
    return;
  }

  throw new Error("Usage: node scripts/localStaging.mjs <start|reset|verify|rehearse|test|dev|status|stop>");
}

runCommand().catch((error) => {
  console.error(`\n[local-staging] ${error?.message || error}`);
  process.exitCode = 1;
});
