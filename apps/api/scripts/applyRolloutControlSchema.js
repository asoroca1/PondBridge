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
    requiredAcknowledgement: "apply-rollout-control-staging"
  });
  const sql = await fs.readFile(path.resolve(__dirname, "./rollout_control_schema.sql"), "utf8");
  const client = new Client({
    connectionString,
    ssl: target.isLocal ? undefined : { rejectUnauthorized: false }
  });

  await client.connect();
  try {
    await client.query(sql);
    const result = await client.query(`
      select
        to_regclass('public.feature_rollouts') is not null as table_present,
        exists (
          select 1 from pg_indexes
          where schemaname = 'public' and indexname = 'idx_feature_rollouts_state'
        ) as index_present,
        exists (
          select 1 from pg_policies
          where schemaname = 'public'
            and tablename = 'feature_rollouts'
            and policyname = 'feature_rollouts_service_role_all'
        ) as service_policy_present,
        has_table_privilege(
          'service_role', 'public.feature_rollouts', 'SELECT,INSERT,UPDATE,DELETE'
        ) as service_role_granted,
        not has_table_privilege(
          'anon', 'public.feature_rollouts', 'SELECT,INSERT,UPDATE,DELETE'
        ) and not has_table_privilege(
          'authenticated', 'public.feature_rollouts', 'SELECT,INSERT,UPDATE,DELETE'
        ) as browser_roles_revoked
    `);
    const evidence = result.rows[0] || {};
    if (Object.values(evidence).some((value) => value !== true)) {
      throw new Error("Rollout control schema verification failed after migration.");
    }
    console.log(JSON.stringify({
      ok: true,
      targetEnvironment: target.target,
      migration: "rollout_control_schema",
      evidence
    }, null, 2));
  } finally {
    await client.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  run().catch((error) => {
    console.error(`[rollout-control-schema] ${error.message}`);
    process.exitCode = 1;
  });
}
