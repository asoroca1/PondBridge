# DB Governance and Preflight

The reproducible local source of truth is `supabase/migrations/`, verified by:

```bash
npm run staging:local:reset
npm run staging:local:verify
```

See [`LOCAL_STAGING.md`](./LOCAL_STAGING.md) for the target/control seed and
provider-safety contract.

## Required checks before deploy
1. Run `npm run db:preflight` and review its ordered `migrationPlan`.
2. Apply only the listed base/additive migrations against reviewed staging.
3. Run `npm run db:preflight` again and require an empty migration plan.
4. Run `npm --workspace @pondbridge/api run rls:audit`.
5. Require an authoritative Supabase migration history in staging. Do not
   promote direct, untracked SQL changes into production.

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
- Required database functions present, pinned to explicit schema search paths,
  free of `SECURITY DEFINER`, and not executable by browser roles when they are
  server-only RPCs or trigger helpers.
- Explicit service-role table grants and no `anon`/`authenticated` table grants
  for the server-only PondBridge Data API contract.
- Non-empty Supabase migration history, with the reviewed staging sequence used
  as the production promotion source.

Additive migration installers intentionally reject production and unlabeled
remote targets. Each requires its feature-specific staging acknowledgement;
the preflight output prints that acknowledgement beside the matching command.

Apply foreign-key performance indexes and then function hardening after the
feature schemas:

```bash
export PONDBRIDGE_TARGET_ENV=staging
export PONDBRIDGE_SCHEMA_APPLY_ACK=apply-database-performance-hardening-staging
npm --workspace @pondbridge/api run supabase:apply-database-performance-hardening
export PONDBRIDGE_SCHEMA_APPLY_ACK=apply-database-security-hardening-staging
npm --workspace @pondbridge/api run supabase:apply-database-security-hardening
npm --workspace @pondbridge/api run db:preflight -- --json
```

The connected-project read-only evidence and shared-project cautions are tracked
in `docs/SUPABASE_CONNECTION_STATUS.md`.
