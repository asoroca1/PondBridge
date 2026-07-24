import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { Client } from "pg";
import { assertReviewedMigrationTarget } from "./applyPlatformAuditSchema.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env") });

async function run() {
  const connectionString = String(process.env.SUPABASE_DB_URL || "").trim();
  const target = assertReviewedMigrationTarget({
    targetEnvironment: process.env.PONDBRIDGE_TARGET_ENV,
    acknowledgement: process.env.PONDBRIDGE_SCHEMA_APPLY_ACK,
    connectionString,
    requiredAcknowledgement: "apply-multi-camp-identity-staging"
  });
  const sql = await fs.readFile(path.resolve(__dirname, "./multi_camp_identity_schema.sql"), "utf8");
  const client = new Client({
    connectionString,
    ssl: target.isLocal ? undefined : { rejectUnauthorized: false }
  });

  await client.connect();
  try {
    await client.query(sql);
    const result = await client.query(`
      select
        to_regclass('public.identities') is not null as identities_present,
        to_regclass('public.tenant_memberships') is not null as memberships_present,
        exists (
          select 1 from information_schema.columns
          where table_schema = 'public'
            and table_name = 'profiles'
            and column_name = 'tenant_membership_id'
        ) as profile_link_present,
        exists (
          select 1 from pg_trigger
          where tgname = 'trigger_enforce_single_tenant_membership'
            and not tgisinternal
        ) as rollout_guard_trigger_present,
        exists (
          select 1 from pg_proc
          where proname = 'enforce_single_tenant_membership'
            and pg_get_functiondef(oid) like '%multi_camp_identity_v1%'
        ) as rollout_guard_function_present,
        exists (
          select 1 from pg_indexes
          where schemaname = 'public'
            and indexname = 'idx_identities_primary_email_unique'
        ) as identities_index_present,
        exists (
          select 1 from pg_indexes
          where schemaname = 'public'
            and indexname = 'idx_tenant_memberships_identity'
        ) as memberships_index_present,
        exists (
          select 1 from pg_policies
          where schemaname = 'public'
            and tablename = 'identities'
            and policyname = 'identities_service_role_all'
        ) as identities_policy_present,
        exists (
          select 1 from pg_policies
          where schemaname = 'public'
            and tablename = 'tenant_memberships'
            and policyname = 'tenant_memberships_service_role_all'
        ) as memberships_policy_present,
        coalesce((
          select relrowsecurity from pg_class
          where oid = to_regclass('public.identities')
        ), false) as identities_rls_enabled,
        coalesce((
          select relrowsecurity from pg_class
          where oid = to_regclass('public.tenant_memberships')
        ), false) as memberships_rls_enabled,
        has_table_privilege(
          'service_role', 'public.identities', 'SELECT,INSERT,UPDATE,DELETE'
        ) and has_table_privilege(
          'service_role', 'public.tenant_memberships', 'SELECT,INSERT,UPDATE,DELETE'
        ) as service_role_granted,
        not has_table_privilege(
          'anon', 'public.identities', 'SELECT,INSERT,UPDATE,DELETE'
        ) and not has_table_privilege(
          'authenticated', 'public.identities', 'SELECT,INSERT,UPDATE,DELETE'
        ) and not has_table_privilege(
          'anon', 'public.tenant_memberships', 'SELECT,INSERT,UPDATE,DELETE'
        ) and not has_table_privilege(
          'authenticated', 'public.tenant_memberships', 'SELECT,INSERT,UPDATE,DELETE'
        ) as browser_roles_revoked
    `);
    const evidence = result.rows[0] || {};
    if (Object.values(evidence).some((value) => value !== true)) {
      throw new Error("Multi-camp identity schema verification failed after migration.");
    }
    console.log(JSON.stringify({
      ok: true,
      targetEnvironment: target.target,
      migration: "multi_camp_identity_schema",
      evidence
    }, null, 2));
  } finally {
    await client.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  run().catch((error) => {
    console.error(`[multi-camp-identity-schema] ${error.message}`);
    process.exitCode = 1;
  });
}
