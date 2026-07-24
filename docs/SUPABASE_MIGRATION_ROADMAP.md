# Supabase Migration Status

Last reviewed: 2026-07-14

The runtime migration is complete: PondBridge uses native relational tables in
Supabase PostgreSQL through `apps/api/src/db/models/*`.

The historical `pb_mongo_mirror` document table and Mongo-compatible model layer
are not the target runtime and must not be introduced into new code. Any remaining
legacy utilities exist only for controlled migration/compatibility work and
should be removed after their data-retention window closes.

## Current governance

1. Define relational changes in `apps/api/scripts/native_schema.sql`.
2. Rehearse them against staging with a backup and rollback plan.
3. Run `db:preflight`, `domains:audit` when domain constraints are involved,
   `supabase:apply-schema`, and `rls:audit`.
4. Keep API model column mappings aligned with the schema.
5. Require `tenant_id` scope in application queries and authenticated RLS
   policies in the database.
6. Do not run seed/reset utilities against production.

The planned identity-membership normalization is documented separately in
`docs/adr/0001-multi-camp-identity-memberships.md`.
