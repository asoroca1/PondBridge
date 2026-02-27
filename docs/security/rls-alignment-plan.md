# RLS Alignment Plan

This platform currently uses service-role DB access for most API queries, so app-layer tenant checks are the primary safety boundary.  
This plan transitions user-scoped APIs toward enforceable Postgres RLS guarantees.

## Phase 1: Inventory and coverage baseline

1. Run `npm --workspace @pondbridge/api run rls:audit`.
2. Record tables with:
   - `missing_rls`
   - `missing_policy`
3. Classify each table as:
   - tenant-user-scoped (must enforce RLS)
   - platform-internal/service-only

## Phase 2: Tenant claim contract

1. Standardize auth claims consumed by DB policies:
   - tenant id claim
   - role claims
2. Ensure Clerk session tokens include required tenant claim for tenant-scoped requests.
3. Keep `CLERK_REQUIRE_TENANT_CLAIM=true` for production once rollout completes.

## Phase 3: Policy implementation

1. Create RLS policies for tenant-user-scoped tables (`profiles`, `users` memberships, `access_requests`, `invites`, etc.).
2. Add policy tests for:
   - same-tenant allow
   - cross-tenant deny
   - super-admin override behavior (if required)

## Phase 4: Client split and migration

1. Keep service-role client for platform-only operations.
2. Introduce user-scoped DB client for tenant-user API paths.
3. Migrate route families incrementally:
   - `/profiles`
   - `/search`
   - `/access`
   - `/admin` read paths first, then mutations

## Phase 5: Enforcement and monitoring

1. Block new tenant-user endpoints from using service-role client without explicit exception.
2. Add CI check requiring tenant-boundary tests for new routes.
3. Track cross-tenant deny events and auth claim mismatch events in logs.
