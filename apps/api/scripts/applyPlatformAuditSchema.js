import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { Client } from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (String(process.env.PONDBRIDGE_LOCAL_STAGING || "") !== "1") {
  dotenv.config({ path: path.resolve(__dirname, "../.env") });
}

const ALLOWED_TARGETS = new Set(["local", "dev", "test", "staging", "preview"]);

export function assertReviewedMigrationTarget({
  targetEnvironment = "",
  acknowledgement = "",
  connectionString = "",
  requiredAcknowledgement = "apply-platform-audit-staging"
} = {}) {
  const target = String(targetEnvironment || "").trim().toLowerCase();
  const ack = String(acknowledgement || "").trim();
  const dbUrl = String(connectionString || "").trim();
  const isLocal = /localhost|127\.0\.0\.1|host\.docker\.internal/i.test(dbUrl);

  if (!dbUrl) throw new Error("SUPABASE_DB_URL is required.");
  if (!ALLOWED_TARGETS.has(target)) {
    throw new Error(
      "PONDBRIDGE_TARGET_ENV must explicitly be local, dev, test, staging, or preview. Production is intentionally rejected."
    );
  }
  if (!isLocal && ack !== requiredAcknowledgement) {
    throw new Error(
      `Set PONDBRIDGE_SCHEMA_APPLY_ACK=${requiredAcknowledgement} for a reviewed non-local staging migration.`
    );
  }
  return { target, isLocal };
}

export function assertPlatformAuditMigrationTarget(options = {}) {
  return assertReviewedMigrationTarget({
    ...options,
    requiredAcknowledgement: "apply-platform-audit-staging"
  });
}

async function verifyPlatformAuditSchema(client) {
  const result = await client.query(`
    select
      to_regclass('public.platform_admin_audit_logs') is not null as table_present,
      exists (
        select 1 from pg_indexes
        where schemaname = 'public'
          and indexname = 'idx_platform_audit_logs_created'
      ) as index_present,
      exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'platform_admin_audit_logs'
          and policyname = 'platform_admin_audit_logs_service_role_all'
      ) as service_policy_present,
      coalesce((
        select relrowsecurity
        from pg_class
        where oid = to_regclass('public.platform_admin_audit_logs')
      ), false) as rls_enabled,
      has_table_privilege(
        'service_role',
        'public.platform_admin_audit_logs',
        'SELECT,INSERT,UPDATE,DELETE'
      ) as service_role_granted,
      not has_table_privilege(
        'anon',
        'public.platform_admin_audit_logs',
        'SELECT,INSERT,UPDATE,DELETE'
      ) and not has_table_privilege(
        'authenticated',
        'public.platform_admin_audit_logs',
        'SELECT,INSERT,UPDATE,DELETE'
      ) as browser_roles_revoked
  `);
  const evidence = result.rows[0] || {};
  if (Object.values(evidence).some((value) => value !== true)) {
    throw new Error("Platform audit schema verification failed after migration.");
  }
  return evidence;
}

async function run() {
  const connectionString = String(process.env.SUPABASE_DB_URL || "").trim();
  const target = assertPlatformAuditMigrationTarget({
    targetEnvironment: process.env.PONDBRIDGE_TARGET_ENV,
    acknowledgement: process.env.PONDBRIDGE_SCHEMA_APPLY_ACK,
    connectionString
  });
  const sql = await fs.readFile(path.resolve(__dirname, "./platform_audit_schema.sql"), "utf8");
  const client = new Client({
    connectionString,
    ssl: target.isLocal ? undefined : { rejectUnauthorized: false }
  });

  await client.connect();
  try {
    await client.query(sql);
    const evidence = await verifyPlatformAuditSchema(client);
    console.log(JSON.stringify({
      ok: true,
      targetEnvironment: target.target,
      migration: "platform_audit_schema",
      evidence
    }, null, 2));
  } finally {
    await client.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  run().catch((error) => {
    console.error(`[platform-audit-schema] ${error.message}`);
    process.exitCode = 1;
  });
}
