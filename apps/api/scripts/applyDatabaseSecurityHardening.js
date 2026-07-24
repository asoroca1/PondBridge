import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { Client } from "pg";
import { assertReviewedMigrationTarget } from "./applyPlatformAuditSchema.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env") });

export function assertDatabaseSecurityHardeningTarget(options = {}) {
  return assertReviewedMigrationTarget({
    ...options,
    requiredAcknowledgement: "apply-database-security-hardening-staging"
  });
}

async function verifyDatabaseSecurityHardening(client) {
  const result = await client.query(`
    with expected(signature, required, server_only) as (
      values
        ('public.lower_immutable(text)', true, false),
        ('public.join_text_array_immutable(text[],text)', true, false),
        ('public.enforce_single_tenant_membership()', true, true),
        ('public.enforce_profile_user_tenant_consistency()', true, true),
        ('public.search_profiles(text,text,text,text,text,integer)', true, true),
        ('public.top_search_terms(text,timestamp with time zone,integer)', true, true),
        ('public.distinct_active_user_ids(text,text[],timestamp with time zone)', true, true),
        ('public.trigger_set_updated_at()', true, true),
        ('public.jwt_tenant_id()', true, false),
        ('public.jwt_roles()', true, false),
        ('public.jwt_has_role(text)', true, false),
        ('public.ai_usage_summary(text,text,timestamp with time zone)', false, true),
        ('public.enforce_member_block_tenant_consistency()', false, true),
        ('public.enforce_content_report_tenant_consistency()', false, true)
    ), expected_tables(table_name) as (
      values
        ('tenants'), ('users'), ('profiles'), ('invites'), ('access_requests'),
        ('magic_link_tokens'), ('conversations'), ('messages'), ('forums'),
        ('forum_posts'), ('photos'), ('newsletters'), ('events'), ('event_rsvps'),
        ('event_messages'), ('email_broadcasts'), ('family_trees'),
        ('analytics_events'), ('import_reports'), ('tenant_admin_audit_logs'),
        ('resume_parse_results'), ('city_geo'), ('activity_items'),
        ('mobile_notifications'), ('mobile_notification_devices'),
        ('mobile_notification_preferences'), ('mobile_notification_templates'),
        ('mobile_notification_schedules'), ('resend_webhook_events'),
        ('stripe_webhook_events'), ('email_suppressions'),
        ('platform_admin_audit_logs'), ('feature_rollouts'), ('ai_generations'),
        ('email_preferences'), ('alumni_contacts'), ('identities'),
        ('tenant_memberships'), ('member_blocks'), ('content_reports')
    ), present_tables as (
      select table_name, to_regclass(format('public.%I', table_name)) as table_oid
      from expected_tables
    ), resolved as (
      select
        expected.*,
        to_regprocedure(signature) as function_oid
      from expected
    ), inspected as (
      select
        resolved.*,
        proc.prosecdef,
        exists (
          select 1 from unnest(coalesce(proc.proconfig, '{}'::text[])) setting
          where setting like 'search_path=%'
        ) as fixed_search_path,
        case when resolved.function_oid is null then false
          else has_function_privilege('anon', resolved.function_oid, 'EXECUTE')
        end as anon_can_execute,
        case when resolved.function_oid is null then false
          else has_function_privilege('authenticated', resolved.function_oid, 'EXECUTE')
        end as authenticated_can_execute
      from resolved
      left join pg_proc proc on proc.oid = resolved.function_oid
    )
    select
      bool_and(function_oid is not null) filter (where required) as required_functions_present,
      bool_and(fixed_search_path) filter (where function_oid is not null) as all_present_functions_pinned,
      bool_and(not coalesce(prosecdef, false)) filter (where function_oid is not null)
        as no_security_definer_functions,
      bool_and(not anon_can_execute) filter (where server_only and function_oid is not null)
        as server_functions_hidden_from_anon,
      bool_and(not authenticated_can_execute) filter (where server_only and function_oid is not null)
        as server_functions_hidden_from_authenticated,
      (
        select bool_and(has_table_privilege(
          'service_role', table_oid, 'SELECT,INSERT,UPDATE,DELETE'
        ))
        from present_tables
        where table_oid is not null
      ) as service_role_table_access_present,
      (
        select bool_and(
          not has_table_privilege('anon', table_oid, 'SELECT,INSERT,UPDATE,DELETE')
          and not has_table_privilege(
            'authenticated', table_oid, 'SELECT,INSERT,UPDATE,DELETE'
          )
        )
        from present_tables
        where table_oid is not null
      ) as browser_table_access_revoked
    from inspected
  `);
  const evidence = result.rows[0] || {};
  if (Object.values(evidence).some((value) => value !== true)) {
    throw new Error("Database function security verification failed after migration.");
  }
  return evidence;
}

async function run() {
  const connectionString = String(process.env.SUPABASE_DB_URL || "").trim();
  const target = assertDatabaseSecurityHardeningTarget({
    targetEnvironment: process.env.PONDBRIDGE_TARGET_ENV,
    acknowledgement: process.env.PONDBRIDGE_SCHEMA_APPLY_ACK,
    connectionString
  });
  const sql = await fs.readFile(
    path.resolve(__dirname, "./database_security_hardening_schema.sql"),
    "utf8"
  );
  const client = new Client({
    connectionString,
    ssl: target.isLocal ? undefined : { rejectUnauthorized: false }
  });

  await client.connect();
  try {
    await client.query(sql);
    const evidence = await verifyDatabaseSecurityHardening(client);
    console.log(JSON.stringify({
      ok: true,
      targetEnvironment: target.target,
      migration: "database_security_hardening_schema",
      evidence
    }, null, 2));
  } finally {
    await client.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  run().catch((error) => {
    console.error(`[database-security-hardening] ${error.message}`);
    process.exitCode = 1;
  });
}
