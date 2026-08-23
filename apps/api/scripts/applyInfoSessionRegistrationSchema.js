import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { Client } from "pg";
import { assertReviewedMigrationTarget } from "./applyPlatformAuditSchema.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env") });

export function assertInfoSessionRegistrationMigrationTarget(options = {}) {
  return assertReviewedMigrationTarget({
    ...options,
    requiredAcknowledgement: "apply-info-session-registration-staging"
  });
}

async function verifyInfoSessionRegistrationSchema(client) {
  const result = await client.query(`
    select
      not exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'events'
          and column_name = 'starts_at'
          and is_nullable = 'NO'
      ) as starts_at_nullable,
      exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'event_rsvps'
          and column_name = 'registration_role'
      ) as registration_role_present,
      exists (
        select 1 from pg_constraint
        where conname = 'event_rsvps_registration_role_check'
      ) as registration_role_constraint_present,
      exists (
        select 1 from pg_indexes
        where schemaname = 'public'
          and indexname = 'idx_event_rsvps_event_role'
      ) as role_index_present,
      exists (
        select 1 from pg_indexes
        where schemaname = 'public'
          and indexname = 'idx_events_tenant_status_undated'
      ) as undated_index_present,
      not exists (
        select 1 from public.event_rsvps
        where registration_role not in ('attendee', 'presenter')
      ) as every_registration_role_valid
  `);
  const evidence = result.rows[0] || {};
  if (Object.values(evidence).some((value) => value !== true)) {
    throw new Error("Info session registration schema verification failed after migration.");
  }
  return evidence;
}

async function run() {
  const connectionString = String(process.env.SUPABASE_DB_URL || "").trim();
  const target = assertInfoSessionRegistrationMigrationTarget({
    targetEnvironment: process.env.PONDBRIDGE_TARGET_ENV,
    acknowledgement: process.env.PONDBRIDGE_SCHEMA_APPLY_ACK,
    connectionString
  });
  const sql = await fs.readFile(
    path.resolve(__dirname, "./info_session_registration_schema.sql"),
    "utf8"
  );
  const client = new Client({
    connectionString,
    ssl: target.isLocal ? undefined : { rejectUnauthorized: false }
  });

  await client.connect();
  try {
    await client.query(sql);
    const evidence = await verifyInfoSessionRegistrationSchema(client);
    console.log(JSON.stringify({
      ok: true,
      targetEnvironment: target.target,
      migration: "info_session_registration_schema",
      evidence
    }, null, 2));
  } finally {
    await client.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  run().catch((error) => {
    console.error(`[info-session-registration-schema] ${error.message}`);
    process.exitCode = 1;
  });
}
