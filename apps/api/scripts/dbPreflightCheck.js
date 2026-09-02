import { Client } from "pg";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../src/config/env.js";

const __filename = fileURLToPath(import.meta.url);

const OUTPUT_JSON = process.argv.includes("--json");

const REQUIRED_TABLES = [
  "tenants",
  "users",
  "profiles",
  "invites",
  "access_requests",
  "magic_link_tokens",
  "conversations",
  "messages",
  "forums",
  "forum_posts",
  "photos",
  "newsletters",
  "email_broadcasts",
  "family_trees",
  "analytics_events",
  "import_reports",
  "tenant_admin_audit_logs",
  "platform_admin_audit_logs",
  "feature_rollouts",
  "ai_generations",
  "email_preferences",
  "alumni_contacts",
  "identities",
  "tenant_memberships",
  "member_blocks",
  "content_reports",
  "resume_parse_results",
  "activity_items",
  "mobile_notifications",
  "mobile_notification_devices",
  "mobile_notification_preferences",
  "mobile_notification_templates",
  "mobile_notification_schedules",
  "resend_webhook_events",
  "stripe_webhook_events",
  "email_suppressions",
  "outreach_accounts",
  "outreach_contacts",
  "outreach_interactions",
  "outreach_conversations",
  "outreach_messages"
];

const REQUIRED_INDEXES = [
  "idx_tenants_slug",
  "idx_users_tenant",
  "idx_profiles_tenant",
  "idx_invites_tenant",
  "idx_access_requests_tenant",
  "idx_messages_tenant_convo",
  "idx_import_reports_tenant",
  "idx_audit_logs_tenant",
  "idx_platform_audit_logs_created",
  "idx_feature_rollouts_state",
  "idx_ai_generations_tenant_feature",
  "idx_email_preferences_tenant_email_topic",
  "idx_alumni_contacts_tenant_email",
  "idx_identities_primary_email_unique",
  "idx_tenant_memberships_identity",
  "idx_member_blocks_tenant_blocker",
  "idx_content_reports_tenant_status",
  "idx_content_reports_active_dedup",
  "idx_mobile_notifications_user_inbox",
  "idx_mobile_notification_devices_user",
  "idx_stripe_webhook_events_status",
  "idx_resend_webhook_events_tenant",
  "idx_messages_conversation_fk",
  "idx_forum_posts_forum_fk",
  "idx_event_rsvps_profile_fk",
  "idx_event_rsvps_user_fk",
  "idx_event_messages_event_fk",
  "idx_mobile_notifications_user_fk",
  "idx_mobile_notification_devices_user_fk",
  "idx_mobile_notification_preferences_user_fk",
  "idx_outreach_accounts_stage",
  "idx_outreach_contacts_account",
  "idx_outreach_interactions_account_occurred",
  "idx_outreach_conversations_operator",
  "idx_outreach_messages_conversation"
];

const EXPECTED_FUNCTIONS = [
  { signature: "public.lower_immutable(text)", required: true, serverOnly: false },
  { signature: "public.join_text_array_immutable(text[],text)", required: true, serverOnly: false },
  { signature: "public.enforce_single_tenant_membership()", required: true, serverOnly: true },
  { signature: "public.enforce_profile_user_tenant_consistency()", required: true, serverOnly: true },
  { signature: "public.search_profiles(text,text,text,text,text,integer)", required: true, serverOnly: true },
  { signature: "public.top_search_terms(text,timestamp with time zone,integer)", required: true, serverOnly: true },
  { signature: "public.distinct_active_user_ids(text,text[],timestamp with time zone)", required: true, serverOnly: true },
  { signature: "public.trigger_set_updated_at()", required: true, serverOnly: true },
  { signature: "public.jwt_tenant_id()", required: true, serverOnly: false },
  { signature: "public.jwt_roles()", required: true, serverOnly: false },
  { signature: "public.jwt_has_role(text)", required: true, serverOnly: false },
  { signature: "public.ai_usage_summary(text,text,timestamp with time zone)", required: false, serverOnly: true },
  { signature: "public.enforce_member_block_tenant_consistency()", required: false, serverOnly: true },
  { signature: "public.enforce_content_report_tenant_consistency()", required: false, serverOnly: true }
];

const ADDITIVE_MIGRATIONS = [
  {
    id: "platform_audit",
    command: "npm --workspace @pondbridge/api run supabase:apply-platform-audit",
    acknowledgement: "apply-platform-audit-staging",
    tables: ["platform_admin_audit_logs"],
    indexes: ["idx_platform_audit_logs_created"]
  },
  {
    id: "rollout_control",
    command: "npm --workspace @pondbridge/api run supabase:apply-rollout-control",
    acknowledgement: "apply-rollout-control-staging",
    tables: ["feature_rollouts"],
    indexes: ["idx_feature_rollouts_state"]
  },
  {
    id: "communications_system",
    command: "npm --workspace @pondbridge/api run supabase:apply-communications-system",
    acknowledgement: "apply-communications-system-staging",
    tables: ["ai_generations", "email_preferences", "alumni_contacts"],
    indexes: [
      "idx_ai_generations_tenant_feature",
      "idx_email_preferences_tenant_email_topic",
      "idx_alumni_contacts_tenant_email"
    ]
  },
  {
    id: "multi_camp_identity",
    command: "npm --workspace @pondbridge/api run supabase:apply-multi-camp-identity",
    acknowledgement: "apply-multi-camp-identity-staging",
    tables: ["identities", "tenant_memberships"],
    indexes: ["idx_identities_primary_email_unique", "idx_tenant_memberships_identity"]
  },
  {
    id: "member_safety",
    command: "npm --workspace @pondbridge/api run supabase:apply-member-safety",
    acknowledgement: "apply-member-safety-staging",
    tables: ["member_blocks", "content_reports"],
    indexes: [
      "idx_member_blocks_tenant_blocker",
      "idx_content_reports_tenant_status",
      "idx_content_reports_active_dedup"
    ]
  },
  {
    id: "outreach_workspace",
    command: "npm --workspace @pondbridge/api run supabase:apply-outreach-workspace",
    acknowledgement: "apply-outreach-workspace-staging",
    tables: [
      "outreach_accounts",
      "outreach_contacts",
      "outreach_interactions",
      "outreach_conversations",
      "outreach_messages"
    ],
    indexes: [
      "idx_outreach_accounts_stage",
      "idx_outreach_contacts_account",
      "idx_outreach_interactions_account_occurred",
      "idx_outreach_conversations_operator",
      "idx_outreach_messages_conversation"
    ]
  },
  {
    id: "database_performance_hardening",
    command: "npm --workspace @pondbridge/api run supabase:apply-database-performance-hardening",
    acknowledgement: "apply-database-performance-hardening-staging",
    tables: [],
    indexes: [
      "idx_messages_conversation_fk",
      "idx_forum_posts_forum_fk",
      "idx_event_rsvps_profile_fk",
      "idx_event_rsvps_user_fk",
      "idx_event_messages_event_fk",
      "idx_mobile_notifications_user_fk",
      "idx_mobile_notification_devices_user_fk",
      "idx_mobile_notification_preferences_user_fk"
    ]
  }
];

export function buildMigrationPlan(missingTables = [], missingIndexes = [], databaseSecurityIssues = []) {
  const tableSet = new Set(missingTables);
  const indexSet = new Set(missingIndexes);
  const additiveTables = new Set(ADDITIVE_MIGRATIONS.flatMap((migration) => migration.tables));
  const additiveIndexes = new Set(ADDITIVE_MIGRATIONS.flatMap((migration) => migration.indexes));
  const baseMissingTables = missingTables.filter((table) => !additiveTables.has(table));
  const baseMissingIndexes = missingIndexes.filter((indexName) => !additiveIndexes.has(indexName));
  const plan = [];

  if (baseMissingTables.length || baseMissingIndexes.length) {
    plan.push({
      id: "native_schema",
      command: "npm --workspace @pondbridge/api run supabase:apply-schema",
      acknowledgement: null,
      missingTables: baseMissingTables,
      missingIndexes: baseMissingIndexes
    });
  }

  ADDITIVE_MIGRATIONS.forEach((migration) => {
    const affectedTables = migration.tables.filter((table) => tableSet.has(table));
    const affectedIndexes = migration.indexes.filter((indexName) => indexSet.has(indexName));
    if (!affectedTables.length && !affectedIndexes.length) return;
    plan.push({
      id: migration.id,
      command: migration.command,
      acknowledgement: migration.acknowledgement,
      missingTables: affectedTables,
      missingIndexes: affectedIndexes
    });
  });

  if (databaseSecurityIssues.length) {
    plan.push({
      id: "database_security_hardening",
      command: "npm --workspace @pondbridge/api run supabase:apply-database-security-hardening",
      acknowledgement: "apply-database-security-hardening-staging",
      issues: databaseSecurityIssues
    });
  }

  return plan;
}

function shouldUseSsl(connectionString = "") {
  return !/localhost|127\.0\.0\.1/i.test(String(connectionString || ""));
}

function summarizeRls(rows = []) {
  return rows.reduce(
    (acc, row) => {
      if (!row.rlsEnabled) acc.missingRls += 1;
      if (row.rlsEnabled && row.policyCount <= 0) acc.missingPolicy += 1;
      if (row.rlsEnabled && row.policyCount > 0) acc.covered += 1;
      return acc;
    },
    { covered: 0, missingRls: 0, missingPolicy: 0 }
  );
}

async function run() {
  const connectionString = String(env.SUPABASE_DB_URL || "").trim();
  if (!connectionString) {
    throw new Error("SUPABASE_DB_URL is required.");
  }

  const client = new Client({
    connectionString,
    ssl: shouldUseSsl(connectionString) ? { rejectUnauthorized: false } : undefined
  });

  await client.connect();
  try {
    const [
      tablesResult,
      indexesResult,
      rlsResult,
      policyResult,
      functionsResult,
      migrationHistoryPresenceResult
    ] = await Promise.all([
      client.query(
        `
          select tablename
          from pg_tables
          where schemaname = 'public'
        `
      ),
      client.query(
        `
          select indexname
          from pg_indexes
          where schemaname = 'public'
        `
      ),
      client.query(
        `
          select
            cls.relname as table_name,
            cls.relrowsecurity as rls_enabled,
            has_table_privilege(
              'service_role', cls.oid, 'SELECT,INSERT,UPDATE,DELETE'
            ) as service_role_granted,
            has_table_privilege(
              'anon', cls.oid, 'SELECT,INSERT,UPDATE,DELETE'
            ) as anon_granted,
            has_table_privilege(
              'authenticated', cls.oid, 'SELECT,INSERT,UPDATE,DELETE'
            ) as authenticated_granted
          from pg_class cls
          join pg_namespace ns on ns.oid = cls.relnamespace
          where ns.nspname = 'public'
            and cls.relkind = 'r'
        `
      ),
      client.query(
        `
          select
            tablename as table_name,
            count(*)::int as policy_count
          from pg_policies
          where schemaname = 'public'
          group by tablename
        `
      ),
      client.query(
        `
          with expected(signature) as (
            select unnest($1::text[])
          ), resolved as (
            select signature, to_regprocedure(signature) as function_oid
            from expected
          )
          select
            signature,
            function_oid is not null as function_present,
            coalesce(proc.prosecdef, false) as security_definer,
            coalesce(exists (
              select 1
              from unnest(coalesce(proc.proconfig, '{}'::text[])) setting
              where setting like 'search_path=%'
            ), false) as fixed_search_path,
            case when function_oid is null then false
              else has_function_privilege('anon', function_oid, 'EXECUTE')
            end as anon_can_execute,
            case when function_oid is null then false
              else has_function_privilege('authenticated', function_oid, 'EXECUTE')
            end as authenticated_can_execute
          from resolved
          left join pg_proc proc on proc.oid = function_oid
          order by signature
        `,
        [EXPECTED_FUNCTIONS.map((item) => item.signature)]
      ),
      client.query(
        `
          select to_regclass('supabase_migrations.schema_migrations') is not null
            as history_table_present
        `
      )
    ]);
    const migrationHistoryPresent = Boolean(
      migrationHistoryPresenceResult.rows[0]?.history_table_present
    );
    const migrationHistoryCount = migrationHistoryPresent
      ? Number((await client.query(
        "select count(*)::int as migration_count from supabase_migrations.schema_migrations"
      )).rows[0]?.migration_count || 0)
      : 0;

    const presentTables = new Set(tablesResult.rows.map((row) => String(row.tablename || "")));
    const presentIndexes = new Set(indexesResult.rows.map((row) => String(row.indexname || "")));
    const policyCounts = new Map(
      policyResult.rows.map((row) => [String(row.table_name || ""), Number(row.policy_count || 0)])
    );

    const missingTables = REQUIRED_TABLES.filter((table) => !presentTables.has(table));
    const missingIndexes = REQUIRED_INDEXES.filter((indexName) => !presentIndexes.has(indexName));
    const rlsRows = rlsResult.rows
      .map((row) => {
        const tableName = String(row.table_name || "");
        const rlsEnabled = Boolean(row.rls_enabled);
        const policyCount = policyCounts.get(tableName) || 0;
        return {
          table: tableName,
          rlsEnabled,
          policyCount,
          serviceRoleGranted: Boolean(row.service_role_granted),
          anonGranted: Boolean(row.anon_granted),
          authenticatedGranted: Boolean(row.authenticated_granted)
        };
      })
      .filter((row) => REQUIRED_TABLES.includes(row.table));
    const rlsSummary = summarizeRls(rlsRows);
    const expectedFunctionMap = new Map(EXPECTED_FUNCTIONS.map((item) => [item.signature, item]));
    const functionRows = functionsResult.rows.map((row) => {
      const signature = String(row.signature || "");
      const expected = expectedFunctionMap.get(signature) || {};
      return {
        signature,
        required: Boolean(expected.required),
        serverOnly: Boolean(expected.serverOnly),
        present: Boolean(row.function_present),
        fixedSearchPath: Boolean(row.fixed_search_path),
        securityDefiner: Boolean(row.security_definer),
        anonCanExecute: Boolean(row.anon_can_execute),
        authenticatedCanExecute: Boolean(row.authenticated_can_execute)
      };
    });
    const functionSecurityIssues = functionRows.flatMap((row) => {
      const issues = [];
      if (row.required && !row.present) issues.push(`${row.signature}:missing`);
      if (row.present && !row.fixedSearchPath) issues.push(`${row.signature}:mutable_search_path`);
      if (row.present && row.securityDefiner) issues.push(`${row.signature}:security_definer`);
      if (row.present && row.serverOnly && row.anonCanExecute) {
        issues.push(`${row.signature}:anon_execute`);
      }
      if (row.present && row.serverOnly && row.authenticatedCanExecute) {
        issues.push(`${row.signature}:authenticated_execute`);
      }
      return issues;
    });
    const tablePrivilegeIssues = rlsRows.flatMap((row) => {
      const issues = [];
      if (!row.serviceRoleGranted) issues.push(`${row.table}:missing_service_role_grant`);
      if (row.anonGranted) issues.push(`${row.table}:anon_table_grant`);
      if (row.authenticatedGranted) issues.push(`${row.table}:authenticated_table_grant`);
      return issues;
    });
    const databaseSecurityIssues = [...functionSecurityIssues, ...tablePrivilegeIssues];

    const report = {
      generatedAt: new Date().toISOString(),
      migrationHistory: {
        ok: migrationHistoryCount > 0,
        tablePresent: migrationHistoryPresent,
        count: migrationHistoryCount
      },
      missingTables,
      missingIndexes,
      migrationPlan: buildMigrationPlan(missingTables, missingIndexes, databaseSecurityIssues),
      rls: {
        covered: rlsSummary.covered,
        missingRls: rlsSummary.missingRls,
        missingPolicy: rlsSummary.missingPolicy
      },
      rlsRows,
      functionSecurity: {
        ok: functionSecurityIssues.length === 0,
        issues: functionSecurityIssues,
        rows: functionRows
      },
      tablePrivileges: {
        ok: tablePrivilegeIssues.length === 0,
        issues: tablePrivilegeIssues
      }
    };

    if (OUTPUT_JSON) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      console.log(`[db:preflight] generatedAt=${report.generatedAt}`);
      console.log(
        `[db:preflight] migrationHistory ok=${report.migrationHistory.ok} count=${report.migrationHistory.count}`
      );
      console.log(`[db:preflight] missingTables=${missingTables.length} missingIndexes=${missingIndexes.length}`);
      console.log(
        `[db:preflight] rls covered=${report.rls.covered} missingRls=${report.rls.missingRls} missingPolicy=${report.rls.missingPolicy}`
      );
      console.log(
        `[db:preflight] functionSecurity ok=${report.functionSecurity.ok} issues=${report.functionSecurity.issues.length}`
      );
      console.log(
        `[db:preflight] tablePrivileges ok=${report.tablePrivileges.ok} issues=${report.tablePrivileges.issues.length}`
      );
      if (missingTables.length) console.log(`[db:preflight] missing tables: ${missingTables.join(", ")}`);
      if (missingIndexes.length) console.log(`[db:preflight] missing indexes: ${missingIndexes.join(", ")}`);
      report.migrationPlan.forEach((migration) => {
        const acknowledgement = migration.acknowledgement
          ? ` PONDBRIDGE_SCHEMA_APPLY_ACK=${migration.acknowledgement}`
          : "";
        console.log(`[db:preflight] next:${migration.id}${acknowledgement} ${migration.command}`);
      });
    }

    if (
      missingTables.length ||
      missingIndexes.length ||
      report.rls.missingRls > 0 ||
      report.rls.missingPolicy > 0 ||
      report.functionSecurity.issues.length > 0 ||
      report.tablePrivileges.issues.length > 0 ||
      !report.migrationHistory.ok
    ) {
      process.exitCode = 1;
    }
  } finally {
    await client.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  run().catch((error) => {
    console.error("[db:preflight] failed:", error?.message || error);
    process.exit(1);
  });
}
