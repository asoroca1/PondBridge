import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { Client } from "pg";
import { assertReviewedMigrationTarget } from "./applyPlatformAuditSchema.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env") });

export function assertOutreachWorkspaceMigrationTarget(options = {}) {
  return assertReviewedMigrationTarget({
    ...options,
    requiredAcknowledgement: "apply-outreach-workspace-staging",
  });
}

async function verifyOutreachWorkspaceSchema(client) {
  const tables = [
    "outreach_accounts",
    "outreach_contacts",
    "outreach_interactions",
    "outreach_conversations",
    "outreach_messages",
  ];
  const result = await client.query(
    `
      select
        count(*) filter (where c.oid is not null)::int as table_count,
        count(*) filter (where c.relrowsecurity)::int as rls_count,
        count(*) filter (where p.policyname is not null)::int as policy_count
      from unnest($1::text[]) as requested(table_name)
      left join pg_class c on c.oid = to_regclass('public.' || requested.table_name)
      left join pg_policies p
        on p.schemaname = 'public'
       and p.tablename = requested.table_name
       and p.policyname = requested.table_name || '_service_role_all'
    `,
    [tables]
  );
  const evidence = result.rows[0] || {};
  if (
    Number(evidence.table_count) !== tables.length ||
    Number(evidence.rls_count) !== tables.length ||
    Number(evidence.policy_count) !== tables.length
  ) {
    throw new Error("Outreach workspace schema verification failed after migration.");
  }
  return evidence;
}

async function run() {
  const connectionString = String(process.env.SUPABASE_DB_URL || "").trim();
  const target = assertOutreachWorkspaceMigrationTarget({
    targetEnvironment: process.env.PONDBRIDGE_TARGET_ENV,
    acknowledgement: process.env.PONDBRIDGE_SCHEMA_APPLY_ACK,
    connectionString,
  });
  const sql = await fs.readFile(
    path.resolve(
      __dirname,
      "../../../supabase/migrations/20260814090000_add_outreach_workspace.sql"
    ),
    "utf8"
  );
  const client = new Client({
    connectionString,
    ssl: target.isLocal ? undefined : { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    await client.query(sql);
    const evidence = await verifyOutreachWorkspaceSchema(client);
    console.log(
      JSON.stringify(
        {
          ok: true,
          targetEnvironment: target.target,
          migration: "outreach_workspace",
          evidence,
        },
        null,
        2
      )
    );
  } finally {
    await client.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  run().catch((error) => {
    console.error(`[outreach-workspace-schema] ${error.message}`);
    process.exitCode = 1;
  });
}
