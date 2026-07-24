import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { Client } from "pg";
import { assertReviewedMigrationTarget } from "./applyPlatformAuditSchema.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const REQUIRED_INDEXES = [
  "idx_messages_conversation_fk",
  "idx_forum_posts_forum_fk",
  "idx_event_rsvps_profile_fk",
  "idx_event_rsvps_user_fk",
  "idx_event_messages_event_fk",
  "idx_mobile_notifications_user_fk",
  "idx_mobile_notification_devices_user_fk",
  "idx_mobile_notification_preferences_user_fk"
];

export function assertDatabasePerformanceHardeningTarget(options = {}) {
  return assertReviewedMigrationTarget({
    ...options,
    requiredAcknowledgement: "apply-database-performance-hardening-staging"
  });
}

async function verifyDatabasePerformanceHardening(client) {
  const result = await client.query(
    `
      select indexname
      from pg_indexes
      where schemaname = 'public'
        and indexname = any($1::text[])
    `,
    [REQUIRED_INDEXES]
  );
  const present = new Set(result.rows.map((row) => String(row.indexname || "")));
  const missing = REQUIRED_INDEXES.filter((indexName) => !present.has(indexName));
  if (missing.length) {
    throw new Error(`Database performance verification failed; missing: ${missing.join(", ")}`);
  }
  return { requiredIndexes: REQUIRED_INDEXES.length, verifiedIndexes: present.size };
}

async function run() {
  const connectionString = String(process.env.SUPABASE_DB_URL || "").trim();
  const target = assertDatabasePerformanceHardeningTarget({
    targetEnvironment: process.env.PONDBRIDGE_TARGET_ENV,
    acknowledgement: process.env.PONDBRIDGE_SCHEMA_APPLY_ACK,
    connectionString
  });
  const sql = await fs.readFile(
    path.resolve(__dirname, "./database_performance_hardening_schema.sql"),
    "utf8"
  );
  const client = new Client({
    connectionString,
    ssl: target.isLocal ? undefined : { rejectUnauthorized: false }
  });

  await client.connect();
  try {
    await client.query(sql);
    const evidence = await verifyDatabasePerformanceHardening(client);
    console.log(JSON.stringify({
      ok: true,
      targetEnvironment: target.target,
      migration: "database_performance_hardening_schema",
      evidence
    }, null, 2));
  } finally {
    await client.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  run().catch((error) => {
    console.error(`[database-performance-hardening] ${error.message}`);
    process.exitCode = 1;
  });
}
