# Supabase Connection Status

Last verified: 2026-07-24

## Connected project

- Organization: PondBridge
- Project: PondBridge
- Region: `us-west-2`
- PostgreSQL: 17.6
- Health: active and healthy
- The API and web environment files both reference the same project exposed by
  the connected Supabase plugin.
- API startup now compares the project reference in `SUPABASE_URL` with direct
  and pooler-style `SUPABASE_DB_URL` values and refuses mismatched wiring.
- Additive schemas now explicitly grant table access to `service_role` and
  revoke `anon`/`authenticated` table privileges. This accounts for Supabase's
  April 2026 Data API exposure change and the server-only PondBridge design.

## Safety classification

Treat this project as production/shared until the owner explicitly says
otherwise. The read-only audit found 11 PondBridge tenants, 1,425 users, 1,421
profiles, and 75 public tables. Several public tables belong to another
application, so future PondBridge migrations must not be rehearsed directly
here.

On 2026-07-24, after a clean isolated rehearsal and a verified encrypted
rollback checkpoint, the eight reviewed additive PondBridge migrations were
applied in order to support the production application release. No tenant
feature cohort or identity backfill was enabled.

## Schema findings

- Every public table currently has RLS enabled.
- The inspected PondBridge tables have forced RLS and at least two policies.
- No `SECURITY DEFINER` function exists in the public schema.
- The nine rollout-gated PondBridge tables are installed:
  `platform_admin_audit_logs`, `feature_rollouts`, `ai_generations`,
  `email_preferences`, `alumni_contacts`, `identities`,
  `tenant_memberships`, `member_blocks`, and `content_reports`.
- Supabase migration history contains the eight reviewed additive migrations in
  the same order used by the isolated rehearsal.
- PondBridge function search paths are pinned; server-only functions reject
  `anon` and `authenticated` execution.
- All 36 inspected PondBridge tables have RLS/policies, service-role access, and
  no browser-role table grants. The production database preflight reports no
  missing tables, indexes, function hardening, or table-privilege issues.
- The advisor also reports 21 permissive authenticated policies on non-PondBridge
  tables, `pg_trgm` installed in `public`, and leaked-password protection not
  enabled. Supabase email signup is enabled and one Supabase Auth user exists,
  which makes ownership review of those 21 tables a real security gate. These
  shared-project findings must not be changed as part of a PondBridge-only
  rollout without confirming ownership and the other application's access
  model.
- Clean PondBridge environments now install `pg_trgm` into Supabase's
  `extensions` schema. The shared production extension is intentionally not
  moved until ownership and dependent objects are reviewed.
- The reviewed performance migration added the missing PondBridge foreign-key
  indexes. Unused-index suggestions remain intentionally deferred until a
  representative traffic window exists.

## Recommended staging path

The current Supabase free tier does not permit a second hosted project, so the
isolated local Supabase stack remains the mandatory migration and fresh-camp
rehearsal target. Create a dedicated hosted `PondBridge Staging` project when
the account tier allows it; until then, do not use the shared production project
for destructive tests, synthetic seeds, or first-run provider experiments.

Do not put the service-role key or database password in browser-prefixed
variables. PondBridge currently performs Supabase operations exclusively in the
API runtime, so the web application does not require Supabase environment
variables.
