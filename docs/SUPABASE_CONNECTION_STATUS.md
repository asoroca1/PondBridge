# Supabase Connection Status

Last verified: 2026-07-21

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
profiles, and 66 public tables. Several public tables belong to another
application, so PondBridge migrations must not be rehearsed directly here.

No schema or data mutation was performed during this audit.

## Schema findings

- Every public table currently has RLS enabled.
- The inspected PondBridge tables have forced RLS and at least two policies.
- No `SECURITY DEFINER` function exists in the public schema.
- Nine rollout-gated PondBridge tables are not installed:
  `platform_admin_audit_logs`, `feature_rollouts`, `ai_generations`,
  `email_preferences`, `alumni_contacts`, `identities`,
  `tenant_memberships`, `member_blocks`, and `content_reports`.
- The Supabase migration history is empty. Existing schema appears to have been
  applied through direct SQL/scripts, so the staging branch must establish an
  authoritative migration sequence before any production promotion.
- Supabase security advisors report mutable `search_path` on 12 functions,
  including PondBridge search, tenant, JWT, and trigger helpers. Local function
  definitions are now pinned, and a guarded staging-only hardening installer is
  available.
- Thirty-one currently installed PondBridge tables still grant DML privileges
  to the browser roles. RLS is enabled and the authenticated policies are
  tenant-claim scoped, so the observed state is not a cross-camp bypass; it is
  nevertheless broader than the server-only architecture. The guarded
  hardening migration revokes those privileges but has not been applied to the
  shared production project.
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
- Performance advisors found eight PondBridge foreign keys without a
  leading-column index. The baseline now includes those indexes and a guarded
  staging-only performance installer is available. Unused-index suggestions
  were intentionally not applied without a representative traffic window.

## Recommended staging path

Create a dedicated `PondBridge Staging` project in the PondBridge organization.
The connected Supabase account currently quotes a new project at `$0/month`.
As of the latest connected-account check, only the shared `PondBridge` project
exists; the staging project has not been created.
This is safer than a development branch because the existing project is shared
and has no migration history. A branch is available at `$0.01344/hour` but is a
fallback, not the recommendation. Use the staging project credentials only in
staging secrets, record the native baseline and subsequent reviewed migrations
through Supabase migration history, verify them, and run the fresh-camp
rehearsal there.

Do not put the service-role key or database password in browser-prefixed
variables. PondBridge currently performs Supabase operations exclusively in the
API runtime, so the web application does not require Supabase environment
variables.
