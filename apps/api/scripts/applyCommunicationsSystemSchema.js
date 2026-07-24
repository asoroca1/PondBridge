import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { Client } from "pg";
import { assertReviewedMigrationTarget } from "./applyPlatformAuditSchema.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env") });

export function assertCommunicationsMigrationTarget(options = {}) {
  return assertReviewedMigrationTarget({
    ...options,
    requiredAcknowledgement: "apply-communications-system-staging"
  });
}

async function verifyCommunicationsSchema(client) {
  const result = await client.query(`
    select
      to_regclass('public.ai_generations') is not null as ai_table_present,
      to_regclass('public.email_preferences') is not null as preferences_table_present,
      to_regclass('public.alumni_contacts') is not null as alumni_contacts_table_present,
      exists (
        select 1 from pg_indexes
        where schemaname = 'public'
          and indexname = 'idx_ai_generations_tenant_feature'
      ) as ai_index_present,
      exists (
        select 1 from pg_indexes
        where schemaname = 'public'
          and indexname = 'idx_email_preferences_tenant_email_topic'
      ) as preferences_index_present,
      exists (
        select 1 from pg_indexes
        where schemaname = 'public'
          and indexname = 'idx_alumni_contacts_tenant_email'
      ) as alumni_contacts_index_present,
      exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'ai_generations'
          and policyname = 'ai_generations_service_role_all'
      ) as ai_policy_present,
      exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'email_preferences'
          and policyname = 'email_preferences_service_role_all'
      ) as preferences_policy_present,
      exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'alumni_contacts'
          and policyname = 'alumni_contacts_service_role_all'
      ) as alumni_contacts_policy_present,
      exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'email_broadcasts'
          and column_name = 'preheader'
      ) as preheader_present,
      to_regprocedure('public.ai_usage_summary(text,text,timestamp with time zone)') is not null
        as usage_function_present,
      has_table_privilege(
        'service_role', 'public.ai_generations', 'SELECT,INSERT,UPDATE,DELETE'
      ) and has_table_privilege(
        'service_role', 'public.email_preferences', 'SELECT,INSERT,UPDATE,DELETE'
      ) and has_table_privilege(
        'service_role', 'public.alumni_contacts', 'SELECT,INSERT,UPDATE,DELETE'
      ) as service_role_granted,
      not has_table_privilege(
        'anon', 'public.ai_generations', 'SELECT,INSERT,UPDATE,DELETE'
      ) and not has_table_privilege(
        'authenticated', 'public.ai_generations', 'SELECT,INSERT,UPDATE,DELETE'
      ) and not has_table_privilege(
        'anon', 'public.email_preferences', 'SELECT,INSERT,UPDATE,DELETE'
      ) and not has_table_privilege(
        'authenticated', 'public.email_preferences', 'SELECT,INSERT,UPDATE,DELETE'
      ) and not has_table_privilege(
        'anon', 'public.alumni_contacts', 'SELECT,INSERT,UPDATE,DELETE'
      ) and not has_table_privilege(
        'authenticated', 'public.alumni_contacts', 'SELECT,INSERT,UPDATE,DELETE'
      ) as browser_roles_revoked
  `);
  const evidence = result.rows[0] || {};
  if (Object.values(evidence).some((value) => value !== true)) {
    throw new Error("Communications system schema verification failed after migration.");
  }
  return evidence;
}

async function run() {
  const connectionString = String(process.env.SUPABASE_DB_URL || "").trim();
  const target = assertCommunicationsMigrationTarget({
    targetEnvironment: process.env.PONDBRIDGE_TARGET_ENV,
    acknowledgement: process.env.PONDBRIDGE_SCHEMA_APPLY_ACK,
    connectionString
  });
  const sql = await fs.readFile(
    path.resolve(__dirname, "./communications_system_schema.sql"),
    "utf8"
  );
  const client = new Client({
    connectionString,
    ssl: target.isLocal ? undefined : { rejectUnauthorized: false }
  });

  await client.connect();
  try {
    await client.query(sql);
    const evidence = await verifyCommunicationsSchema(client);
    console.log(JSON.stringify({
      ok: true,
      targetEnvironment: target.target,
      migration: "communications_system_schema",
      evidence
    }, null, 2));
  } finally {
    await client.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  run().catch((error) => {
    console.error(`[communications-system-schema] ${error.message}`);
    process.exitCode = 1;
  });
}
