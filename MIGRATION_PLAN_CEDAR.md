# Camp Cedar Migration Plan

## Scope

- Target tenant to replace: `cedar`
- Current PondBridge Cedar tenant ID: `c674696ffa32fbc19bb1f311`
- Legacy source app root: `/Users/asoroca/Desktop/camp-cedar-alumni-network`
- Control tenants that must remain unchanged:
  - `demo-code-camp`
  - `demo-code-invalid`
  - `demow`
  - `demoa`
  - `test22`

## Architecture findings

- PondBridge is a Postgres/Supabase multi-tenant app with tenant scoping on `tenant_id`.
- Tenant resolution precedence is:
  1. `/api/t/:slug/*`
  2. `X-Tenant-Slug`
  3. host/domain mapping
  4. authenticated membership fallback for `/api/tenants/me/*`
- Cedar-scoped data lives in tenant-owned tables such as `users`, `profiles`, `forums`, `messages`, `photos`, `newsletters`, `family_trees`, `activity_items`, and related auth/admin tables.
- Clerk is the active auth provider in PondBridge (`AUTH_PROVIDER=clerk`).
- PondBridge enforces one active tenant membership per identity by email or `clerk_user_id`.

## Legacy findings that drive the plan

- Legacy Cedar is a single-tenant MERN app.
- Legacy auth uses bcrypt password hashes in MongoDB `users.passwordHash`.
- Legacy user emails are clean and unique across all 282 users.
- Only one legacy email already exists in PondBridge: `aden@sorocafamily.com`, and it exists only as a global `super_admin`, not as another tenant membership.

## Execution plan

1. Export the current PondBridge Cedar tenant and every Cedar-scoped table to `migration/cedar-existing-backup`.
2. Archive the seeded PondBridge Cedar tenant by renaming the slug and marking the tenant inactive instead of hard-deleting it.
3. Create a fresh `cedar` tenant with the same module/settings baseline and migrated Cedar branding assets.
4. Create or reuse Clerk users for legacy Cedar members using bcrypt digest import where possible.
5. Import legacy users and profiles into the new Cedar tenant.
6. Import Cedar content that has direct PondBridge equivalents:
   - activity feed
   - forums and forum posts
   - conversations and messages
   - photos and photo comments
   - newsletters
   - family trees
7. Assign Aden Soroca as the only Cedar `tenant_admin`, and explicitly mark the tenant’s director legal agreement as accepted by Aden.
8. Validate that:
   - the new `cedar` tenant exists
   - the archived seeded Cedar tenant is no longer the live `cedar`
   - other tenants are unchanged
   - Cedar user/profile counts match the legacy source
   - no Cedar orphaned profile rows exist

## Intentional non-migrations

- Legacy `prelaunchsignups` are preserved in audit artifacts only.
- Legacy `citygeos` and `customcities` are not imported because PondBridge treats location cache/support data separately from tenant alumni records.
- Legacy admin authorization is not inferred from the `roles` array because that app used environment-based `ADMIN_EMAILS` / `ADMIN_USER_IDS` for real admin access.

## Rollback

- Database rollback option 1: reactivate the archived Cedar tenant and restore the `cedar` slug.
- Database rollback option 2: replay JSON exports from `migration/cedar-existing-backup`.
- Auth rollback: imported Clerk users are mapped by email and external ID, so the Cedar app rows can be re-linked if the tenant import is replayed.
