import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { Client } from "pg";
import { assertReviewedMigrationTarget } from "./applyPlatformAuditSchema.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env") });

export function assertMemberSafetyMigrationTarget(options = {}) {
  return assertReviewedMigrationTarget({
    ...options,
    requiredAcknowledgement: "apply-member-safety-staging"
  });
}

async function verifyMemberSafetySchema(client) {
  const result = await client.query(`
    select
      to_regclass('public.member_blocks') is not null as blocks_table_present,
      to_regclass('public.content_reports') is not null as reports_table_present,
      exists (
        select 1 from pg_indexes
        where schemaname = 'public'
          and indexname = 'idx_member_blocks_tenant_blocker'
      ) as blocks_index_present,
      exists (
        select 1 from pg_indexes
        where schemaname = 'public'
          and indexname = 'idx_content_reports_tenant_status'
      ) as reports_status_index_present,
      exists (
        select 1 from pg_indexes
        where schemaname = 'public'
          and indexname = 'idx_content_reports_active_dedup'
      ) as reports_dedup_index_present,
      exists (
        select 1 from pg_trigger
        where tgname = 'trigger_enforce_member_block_tenant_consistency'
          and not tgisinternal
      ) as blocks_tenant_trigger_present,
      exists (
        select 1 from pg_trigger
        where tgname = 'trigger_enforce_content_report_tenant_consistency'
          and not tgisinternal
      ) as reports_tenant_trigger_present,
      exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'member_blocks'
          and policyname = 'member_blocks_service_role_all'
      ) as blocks_policy_present,
      exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'content_reports'
          and policyname = 'content_reports_service_role_all'
      ) as reports_policy_present,
      coalesce((
        select relrowsecurity from pg_class
        where oid = to_regclass('public.member_blocks')
      ), false) as blocks_rls_enabled,
      coalesce((
        select relrowsecurity from pg_class
        where oid = to_regclass('public.content_reports')
      ), false) as reports_rls_enabled,
      has_table_privilege(
        'service_role', 'public.member_blocks', 'SELECT,INSERT,UPDATE,DELETE'
      ) and has_table_privilege(
        'service_role', 'public.content_reports', 'SELECT,INSERT,UPDATE,DELETE'
      ) as service_role_granted,
      not has_table_privilege(
        'anon', 'public.member_blocks', 'SELECT,INSERT,UPDATE,DELETE'
      ) and not has_table_privilege(
        'authenticated', 'public.member_blocks', 'SELECT,INSERT,UPDATE,DELETE'
      ) and not has_table_privilege(
        'anon', 'public.content_reports', 'SELECT,INSERT,UPDATE,DELETE'
      ) and not has_table_privilege(
        'authenticated', 'public.content_reports', 'SELECT,INSERT,UPDATE,DELETE'
      ) as browser_roles_revoked
  `);
  const evidence = result.rows[0] || {};
  if (Object.values(evidence).some((value) => value !== true)) {
    throw new Error("Member safety schema verification failed after migration.");
  }
  return evidence;
}

async function run() {
  const connectionString = String(process.env.SUPABASE_DB_URL || "").trim();
  const target = assertMemberSafetyMigrationTarget({
    targetEnvironment: process.env.PONDBRIDGE_TARGET_ENV,
    acknowledgement: process.env.PONDBRIDGE_SCHEMA_APPLY_ACK,
    connectionString
  });
  const sql = await fs.readFile(path.resolve(__dirname, "./member_safety_schema.sql"), "utf8");
  const client = new Client({
    connectionString,
    ssl: target.isLocal ? undefined : { rejectUnauthorized: false }
  });

  await client.connect();
  try {
    await client.query(sql);
    const evidence = await verifyMemberSafetySchema(client);
    console.log(JSON.stringify({
      ok: true,
      targetEnvironment: target.target,
      migration: "member_safety_schema",
      evidence
    }, null, 2));
  } finally {
    await client.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  run().catch((error) => {
    console.error(`[member-safety-schema] ${error.message}`);
    process.exitCode = 1;
  });
}
