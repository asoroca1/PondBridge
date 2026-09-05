#!/usr/bin/env node

/**
 * Hosted staging environment driver.
 *
 * Sibling to scripts/localStaging.mjs. Where localStaging.mjs runs a throwaway
 * Supabase stack in Docker, this drives the persistent hosted staging project so
 * migrations can be rehearsed against real Supabase (PostgREST, Auth, Storage,
 * the same Postgres build) before they touch production.
 *
 * The schema is applied by `supabase db push`, which replays supabase/migrations
 * verbatim and records them in supabase_migrations.schema_migrations. Nothing here
 * hand-writes DDL, so staging and production stay provably in step.
 *
 *   node scripts/remoteStaging.mjs setup    # link + push + seed + verify
 *   node scripts/remoteStaging.mjs push     # migrations only
 *   node scripts/remoteStaging.mjs verify   # assert schema parity expectations
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), "..");
const supabaseCli = path.join(repoRoot, "node_modules", ".bin", "supabase");
const migrationsDir = path.join(repoRoot, "supabase", "migrations");
const seedFile = path.join(repoRoot, "supabase", "seed.sql");

// Hardcoded so a typo in the environment can never point this at production.
const STAGING_REF = "pvmabzjotcpvdpffsrgp";
const PRODUCTION_REF = "wkyjhmggkujsepafbplv";

const command = String(process.argv[2] || "status").trim().toLowerCase();

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

function ok(message) {
  console.log(`✔ ${message}`);
}

function projectRef() {
  const ref = String(process.env.STAGING_SUPABASE_PROJECT_REF || STAGING_REF).trim();
  if (ref === PRODUCTION_REF) {
    fail(
      "STAGING_SUPABASE_PROJECT_REF points at the PRODUCTION project " +
        `(${PRODUCTION_REF}). Refusing to run. Production DDL goes through the ` +
        "Supabase migration API, never through this script."
    );
  }
  if (!/^[a-z]{20}$/.test(ref)) {
    fail(`STAGING_SUPABASE_PROJECT_REF does not look like a project ref: ${ref}`);
  }
  return ref;
}

function dbPassword() {
  const password = String(process.env.STAGING_SUPABASE_DB_PASSWORD || "").trim();
  if (!password) {
    fail(
      "STAGING_SUPABASE_DB_PASSWORD is not set.\n\n" +
        "  Set it once in the dashboard, then export it locally:\n" +
        `    https://supabase.com/dashboard/project/${projectRef()}/settings/database\n` +
        "    -> Database password -> Reset database password\n\n" +
        "    export STAGING_SUPABASE_DB_PASSWORD='...'\n\n" +
        "  Do not commit it. .env.staging is gitignored."
    );
  }
  return password;
}

function runCli(args, { password, quiet = false } = {}) {
  if (!fs.existsSync(supabaseCli)) {
    fail(`Supabase CLI not found at ${supabaseCli}. Run: npm install`);
  }
  const env = { ...process.env };
  if (password) env.SUPABASE_DB_PASSWORD = password;

  // The CLI auto-loads a .env from its working directory. The repo-root .env holds
  // live Stripe, Cloudflare, Clerk and R2 credentials that a staging push has no
  // business reading -- and a syntax error in it (an unterminated quote broke this
  // on 2026-09-04) fails the push outright. Run from a scratch cwd with no .env and
  // point the CLI at the project explicitly.
  const result = spawnSync(supabaseCli, [...args, "--workdir", repoRoot], {
    cwd: os.tmpdir(),
    stdio: quiet ? ["ignore", "pipe", "pipe"] : "inherit",
    env
  });
  if (result.error) fail(`Failed to run supabase CLI: ${result.error.message}`);
  return result;
}

function requireLogin() {
  const result = runCli(["projects", "list"], { quiet: true });
  if (result.status !== 0) {
    fail(
      "Supabase CLI is not authenticated.\n\n" +
        "  Run this once (opens a browser):\n" +
        `    ${path.relative(process.cwd(), supabaseCli)} login\n\n` +
        "  Or export a personal access token as SUPABASE_ACCESS_TOKEN."
    );
  }
}

function localMigrationNames() {
  if (!fs.existsSync(migrationsDir)) return [];
  return fs
    .readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => name.replace(/^\d+_/, "").replace(/\.sql$/, ""));
}

function cmdStatus() {
  const ref = projectRef();
  console.log(`Staging project ref : ${ref}`);
  console.log(`Staging API URL     : https://${ref}.supabase.co`);
  console.log(`Production ref      : ${PRODUCTION_REF} (never written by this script)`);
  console.log(`Local migrations    : ${localMigrationNames().length}`);
  console.log(
    `DB password         : ${process.env.STAGING_SUPABASE_DB_PASSWORD ? "set" : "NOT set"}`
  );
}

function cmdLink() {
  requireLogin();
  const ref = projectRef();
  const result = runCli(["link", "--project-ref", ref], { password: dbPassword() });
  if (result.status !== 0) fail("supabase link failed.");
  ok(`Linked to staging project ${ref}`);
}

function cmdPush() {
  const result = runCli(["db", "push", "--include-all"], { password: dbPassword() });
  if (result.status !== 0) fail("supabase db push failed.");
  ok("Migrations applied to staging");
}

function cmdSeed() {
  if (!fs.existsSync(seedFile)) fail(`Seed file not found: ${seedFile}`);
  const ref = projectRef();
  // `db query -f` on CLI 2.109.x. There is no `db execute` subcommand; flags must
  // follow the subcommand, not `db`.
  const result = runCli(
    ["db", "query", "--linked", "--file", seedFile],
    { password: dbPassword(), quiet: true }
  );
  const output = String(result.stdout || "") + String(result.stderr || "");
  if (result.status !== 0) {
    // seed.sql is not idempotent: it plain-INSERTs its demo tenants. Re-running it
    // on an already-seeded database is a no-op worth reporting, not a failure.
    if (/duplicate key value violates unique constraint/i.test(output)) {
      console.log("• Staging is already seeded, leaving existing data alone.");
      console.log("  To rebuild it from scratch, drop the rows first -- seed.sql only inserts.");
      return;
    }
    console.error(output);
    fail(
      "Seeding failed. As a fallback you can run:\n" +
        `  ${path.relative(process.cwd(), supabaseCli)} db query --linked -f supabase/seed.sql`
    );
  }
  ok(`Seeded staging project ${ref} from supabase/seed.sql`);
}

function cmdVerify() {
  const expected = localMigrationNames();
  const result = runCli(["migration", "list", "--linked"], {
    password: dbPassword(),
    quiet: true
  });
  const output = String(result.stdout || "") + String(result.stderr || "");
  if (result.status !== 0) {
    console.error(output);
    fail("supabase migration list failed.");
  }
  const missing = expected.filter((name) => !output.includes(name));
  console.log(output.trim());
  if (missing.length) {
    fail(`Staging is missing ${missing.length} migration(s):\n  - ${missing.join("\n  - ")}`);
  }
  ok(`All ${expected.length} local migrations are applied on staging`);
}

function cmdSetup() {
  cmdLink();
  cmdPush();
  cmdSeed();
  cmdVerify();
  console.log("\nStaging is ready.");
  console.log(`  SUPABASE_URL=https://${projectRef()}.supabase.co`);
}

const commands = {
  status: cmdStatus,
  link: cmdLink,
  push: cmdPush,
  seed: cmdSeed,
  verify: cmdVerify,
  setup: cmdSetup
};

const handler = commands[command];
if (!handler) {
  fail(`Unknown command "${command}". Expected one of: ${Object.keys(commands).join(", ")}`);
}
handler();
