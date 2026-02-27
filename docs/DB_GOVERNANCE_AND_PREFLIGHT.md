# DB Governance and Preflight

## Required checks before deploy
1. `npm --workspace @pondbridge/api run supabase:apply-schema`
2. `npm run db:preflight`
3. `npm --workspace @pondbridge/api run rls:audit`

## Why
- Prevent schema/runtime drift (missing tables/indexes).
- Prevent hidden tenant-isolation drift (RLS disabled/missing policies).
- Keep billing/webhook and admin audit features operational across environments.

## CI expectations
- `db:preflight` and `rls:audit` are required quality gates.
- CI must run against a dedicated non-production DB with destructive reset guard markers configured.

## Runtime requirements validated by preflight
- Required tables (core tenant, auth, billing, import, audit, analytics, webhook).
- Required indexes for high-volume query paths and idempotent webhook processing.
- RLS enabled with policies for required tenant-bound tables.
