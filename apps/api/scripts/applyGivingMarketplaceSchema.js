import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { Client } from "pg";
import { assertReviewedMigrationTarget } from "./applyPlatformAuditSchema.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const MIGRATION_PATH = path.resolve(
  __dirname,
  "../../../supabase/migrations/20260828194440_add_giving_marketplace.sql"
);

const GIVING_TABLES = ["giving_causes", "giving_donations", "giving_cause_updates"];

export function assertGivingMarketplaceMigrationTarget(options = {}) {
  return assertReviewedMigrationTarget({
    ...options,
    requiredAcknowledgement: "apply-giving-marketplace-staging"
  });
}

async function verifyGivingMarketplaceSchema(client) {
  const result = await client.query(`
    select
      to_regclass('public.giving_causes') is not null as causes_table_present,
      to_regclass('public.giving_donations') is not null as donations_table_present,
      to_regclass('public.giving_cause_updates') is not null as updates_table_present,
      exists (
        select 1 from pg_indexes
        where schemaname = 'public'
          and indexname = 'idx_giving_causes_one_general_fund'
      ) as general_fund_uniqueness_present,
      exists (
        select 1 from pg_indexes
        where schemaname = 'public'
          and indexname = 'idx_giving_causes_tenant_status'
      ) as causes_status_index_present,
      exists (
        select 1 from pg_indexes
        where schemaname = 'public'
          and indexname = 'idx_giving_donations_tenant_cause'
      ) as donations_cause_index_present,
      exists (
        select 1 from pg_indexes
        where schemaname = 'public'
          and indexname = 'idx_giving_cause_updates_tenant_cause'
      ) as updates_cause_index_present,
      (
        select count(*) = 3 from pg_policies
        where schemaname = 'public'
          and tablename in ('giving_causes', 'giving_donations', 'giving_cause_updates')
          and policyname = tablename || '_service_role_all'
      ) as service_policies_present,
      (
        select bool_and(relrowsecurity and relforcerowsecurity)
        from pg_class
        where oid in (
          to_regclass('public.giving_causes'),
          to_regclass('public.giving_donations'),
          to_regclass('public.giving_cause_updates')
        )
      ) as rls_enabled_and_forced,
      has_table_privilege(
        'service_role', 'public.giving_causes', 'SELECT,INSERT,UPDATE,DELETE'
      ) and has_table_privilege(
        'service_role', 'public.giving_donations', 'SELECT,INSERT,UPDATE,DELETE'
      ) and has_table_privilege(
        'service_role', 'public.giving_cause_updates', 'SELECT,INSERT,UPDATE,DELETE'
      ) as service_role_granted,
      not has_table_privilege(
        'anon', 'public.giving_causes', 'SELECT,INSERT,UPDATE,DELETE'
      ) and not has_table_privilege(
        'authenticated', 'public.giving_causes', 'SELECT,INSERT,UPDATE,DELETE'
      ) and not has_table_privilege(
        'anon', 'public.giving_donations', 'SELECT,INSERT,UPDATE,DELETE'
      ) and not has_table_privilege(
        'authenticated', 'public.giving_donations', 'SELECT,INSERT,UPDATE,DELETE'
      ) and not has_table_privilege(
        'anon', 'public.giving_cause_updates', 'SELECT,INSERT,UPDATE,DELETE'
      ) and not has_table_privilege(
        'authenticated', 'public.giving_cause_updates', 'SELECT,INSERT,UPDATE,DELETE'
      ) as browser_roles_revoked
  `);
  const evidence = result.rows[0] || {};
  if (Object.values(evidence).some((value) => value !== true)) {
    throw new Error("Giving marketplace schema verification failed after migration.");
  }
  return evidence;
}

async function run() {
  const connectionString = String(process.env.SUPABASE_DB_URL || "").trim();
  const target = assertGivingMarketplaceMigrationTarget({
    targetEnvironment: process.env.PONDBRIDGE_TARGET_ENV,
    acknowledgement: process.env.PONDBRIDGE_SCHEMA_APPLY_ACK,
    connectionString
  });
  // Read the migration rather than keeping a second copy of the DDL in scripts/,
  // so this can never drift from what `supabase db push` applies.
  const sql = await fs.readFile(MIGRATION_PATH, "utf8");
  const client = new Client({
    connectionString,
    ssl: target.isLocal ? undefined : { rejectUnauthorized: false }
  });

  await client.connect();
  try {
    await client.query(sql);
    const evidence = await verifyGivingMarketplaceSchema(client);
    console.log(JSON.stringify({
      ok: true,
      targetEnvironment: target.target,
      migration: "add_giving_marketplace",
      tables: GIVING_TABLES,
      evidence
    }, null, 2));
  } finally {
    await client.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  run().catch((error) => {
    console.error(`[giving-marketplace-schema] ${error.message}`);
    process.exitCode = 1;
  });
}
