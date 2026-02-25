import { Client } from "pg";
import { env } from "../config/env.js";
import { getSupabaseAdmin } from "./supabaseAdmin.js";

const TABLES_FOR_CLEANUP = [
  "messages",
  "forum_posts",
  "email_broadcasts",
  "photos",
  "newsletters",
  "family_trees",
  "analytics_events",
  "import_reports",
  "tenant_admin_audit_logs",
  "resume_parse_results",
  "activity_items",
  "magic_link_tokens",
  "access_requests",
  "invites",
  "conversations",
  "forums",
  "profiles",
  "users",
  "tenants"
];

const DEFAULT_TEST_DB_MARKERS = ["localhost", "127.0.0.1", "test"];

function parseMarkers(raw = "") {
  const markers = String(raw || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return markers.length ? markers : DEFAULT_TEST_DB_MARKERS;
}

function looksLikeSafeTestDatabase(markers = DEFAULT_TEST_DB_MARKERS) {
  const haystack = [
    String(env.SUPABASE_URL || "").toLowerCase(),
    String(env.SUPABASE_DB_URL || "").toLowerCase()
  ]
    .filter(Boolean)
    .join(" ");

  if (!haystack) return false;
  return markers.some((marker) => haystack.includes(marker));
}

function assertDestructiveResetAllowed() {
  const isTestEnv = String(process.env.NODE_ENV || "").toLowerCase() === "test";
  const explicitOptIn = ["1", "true", "yes", "on"].includes(
    String(process.env.PONDBRIDGE_ALLOW_DB_RESET || "")
      .trim()
      .toLowerCase()
  );
  const markerGuardDisabled = ["1", "true", "yes", "on"].includes(
    String(process.env.PONDBRIDGE_DISABLE_DB_MARKER_GUARD || "")
      .trim()
      .toLowerCase()
  );
  const markers = parseMarkers(process.env.PONDBRIDGE_TEST_DB_MARKERS || "");
  const safeByMarker = markerGuardDisabled || looksLikeSafeTestDatabase(markers);

  if (!isTestEnv || !explicitOptIn || !safeByMarker) {
    throw new Error(
      "Refusing destructive database reset. Require NODE_ENV=test, PONDBRIDGE_ALLOW_DB_RESET=1, and a non-production database marker match."
    );
  }
}

function needsSsl(connectionString = "") {
  return !/localhost|127\.0\.0\.1/i.test(String(connectionString || ""));
}

async function truncateViaDirectSql() {
  if (!env.SUPABASE_DB_URL) return false;

  const client = new Client({
    connectionString: env.SUPABASE_DB_URL,
    ssl: needsSsl(env.SUPABASE_DB_URL) ? { rejectUnauthorized: false } : undefined
  });

  await client.connect();
  try {
    const { rows } = await client.query(
      `
        select tablename
        from pg_tables
        where schemaname = 'public'
          and tablename = any($1::text[])
      `,
      [TABLES_FOR_CLEANUP]
    );

    const presentTables = rows.map((row) => row.tablename).filter(Boolean);
    if (presentTables.length === 0) return true;

    const quoted = presentTables.map((name) => `public."${name}"`).join(", ");
    await client.query(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`);
    return true;
  } finally {
    await client.end();
  }
}

function isMissingTableError(error) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("does not exist") || message.includes("relation");
}

async function truncateViaSupabaseApi() {
  const sb = getSupabaseAdmin();

  for (const table of TABLES_FOR_CLEANUP) {
    const { error } = await sb.from(table).delete().not("id", "is", null);
    if (error && !isMissingTableError(error)) {
      throw error;
    }
  }
}

export async function clearAllDocuments() {
  assertDestructiveResetAllowed();

  try {
    const usedSql = await truncateViaDirectSql();
    if (usedSql) return;
  } catch {
    // Fall through to API-based cleanup.
  }

  await truncateViaSupabaseApi();
}
