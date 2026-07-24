# ADR 0001: Multi-camp identities and tenant memberships

- Status: Pilot dual-write and authorization cutover implemented; staging validation not executed
- Date: 2026-07-14
- Owners: PondBridge engineering and security

## Context

The current `users` row combines a human identity, tenant membership, roles, and
authentication binding. The database trigger `enforce_single_tenant_membership`
rejects a second active membership with the same email or Clerk user ID. Clerk
public metadata also stores one `tenantId`, tenant-scope enforcement treats that
claim as exclusive, and socket authentication falls back to a single membership.

Fall rollout makes overlapping camp communities likely. Disabling only the
database trigger would create inconsistent authorization, stale token claims,
ambiguous sockets, and unsafe account deletion.

## Decision

Separate global authentication identity from tenant membership:

1. `identities` owns the Clerk user ID, normalized verified emails, account
   lifecycle, and platform-level roles.
2. `tenant_memberships` owns `tenant_id`, `identity_id`, tenant roles, status,
   join method, and timestamps. Its unique key is `(tenant_id, identity_id)`.
3. `profiles` references `tenant_membership_id`, keeping camp-specific profile
   fields isolated even when the same person belongs to several camps.
4. Every tenant request resolves the tenant from the trusted host/path and then
   authorizes the authenticated identity against that tenant's membership. A
   client-supplied camp name or stale Clerk `tenantId` claim is never authority.
5. Clerk metadata may contain non-authoritative navigation hints, but the
   database membership is the authorization source of truth.
6. Socket connections must include a tenant slug/ID and resolve the matching
   membership before joining tenant rooms.
7. Removing one membership deletes only that camp's profile and tenant data.
   Deleting the global identity or Clerk account requires either no remaining
   memberships or an explicit all-camps account-deletion flow.

## Migration sequence

1. Add `identities` and `tenant_memberships` without changing reads.
2. Backfill identities by Clerk user ID first, then verified normalized email;
   generate a collision report for manual review instead of auto-merging
   uncertain matches.
3. Backfill one membership per current tenant-scoped user and add dual-write.
4. Add target/control tests for same identity in two camps, different roles,
   inactive membership, profile isolation, socket isolation, and single-camp
   deletion.
5. Switch route authorization and socket resolution to membership lookup behind
   a server-evaluated rollout flag for internal/test camps.
6. Switch profile foreign keys and account-deletion semantics.
7. Validate counts and tenant isolation, then remove the single-tenant trigger
   and legacy claim enforcement.
8. Expand by tenant cohort with a kill switch; remove legacy columns only after
   a full rollback window.

## Implementation checkpoint (2026-07-16)

- Additive `identities` and `tenant_memberships` schemas are prepared with
  service-role-only RLS and a nullable profile membership link.
- The backfill is dry-run by default, hashes collision subjects, refuses
  ambiguous email/Clerk merges, and requires a staging acknowledgement to
  write.
- `multi_camp_identity_v1` is registered in the durable rollout control plane.
- New membership joins dual-write global identities and camp memberships when
  the additive schema is present. Identity collisions fail closed.
- Target camps use membership-backed HTTP and socket authorization, roles, and
  inactive-membership enforcement; non-target controls keep legacy reads.
- The database single-camp guard allows compatibility rows only for a target
  tenant while its durable flag is live and its kill switch is off.
- Camp profiles store the membership link. Removing one camp membership or
  wiping a tenant preserves a global identity that still has another membership
  or platform role.
- Staging schema apply/backfill and the complete target/control rehearsal remain
  required before any camp is enabled.

## Required invariants

- A membership lookup always includes both authenticated identity ID and tenant
  ID.
- Roles are membership-scoped; platform roles never imply camp membership.
- Email changes do not silently merge identities.
- No profile, message, media, or audit query can cross a tenant boundary.
- Revoking one camp membership leaves other camps usable.
- Rollback can return reads to legacy `users` rows while dual-write remains on.

## Rollback

Before the final legacy-column removal, disable the new membership-read flag and
continue reading the existing tenant-scoped `users` rows. Dual-written records
remain available for correction and replay. Do not drop the current trigger until
all target/control authorization, socket, and deletion tests pass in production-like
staging.
