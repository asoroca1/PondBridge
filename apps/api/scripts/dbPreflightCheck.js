import { Client } from "pg";
import { env } from "../src/config/env.js";

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
  "resume_parse_results",
  "activity_items",
  "mobile_notifications",
  "mobile_notification_devices",
  "mobile_notification_preferences",
  "resend_webhook_events",
  "stripe_webhook_events",
  "email_suppressions"
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
  "idx_mobile_notifications_user_inbox",
  "idx_mobile_notification_devices_user",
  "idx_stripe_webhook_events_status",
  "idx_resend_webhook_events_tenant"
];

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
    const [tablesResult, indexesResult, rlsResult, policyResult] = await Promise.all([
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
            cls.relrowsecurity as rls_enabled
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
      )
    ]);

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
          policyCount
        };
      })
      .filter((row) => REQUIRED_TABLES.includes(row.table));
    const rlsSummary = summarizeRls(rlsRows);

    const report = {
      generatedAt: new Date().toISOString(),
      missingTables,
      missingIndexes,
      rls: {
        covered: rlsSummary.covered,
        missingRls: rlsSummary.missingRls,
        missingPolicy: rlsSummary.missingPolicy
      },
      rlsRows
    };

    if (OUTPUT_JSON) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      console.log(`[db:preflight] generatedAt=${report.generatedAt}`);
      console.log(`[db:preflight] missingTables=${missingTables.length} missingIndexes=${missingIndexes.length}`);
      console.log(
        `[db:preflight] rls covered=${report.rls.covered} missingRls=${report.rls.missingRls} missingPolicy=${report.rls.missingPolicy}`
      );
      if (missingTables.length) console.log(`[db:preflight] missing tables: ${missingTables.join(", ")}`);
      if (missingIndexes.length) console.log(`[db:preflight] missing indexes: ${missingIndexes.join(", ")}`);
    }

    if (missingTables.length || missingIndexes.length || report.rls.missingRls > 0 || report.rls.missingPolicy > 0) {
      process.exitCode = 1;
    }
  } finally {
    await client.end();
  }
}

run().catch((error) => {
  console.error("[db:preflight] failed:", error?.message || error);
  process.exit(1);
});
