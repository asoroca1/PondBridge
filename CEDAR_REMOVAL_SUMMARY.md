# Cedar Removal Summary

- Strategy: archive, not hard delete.
- Dry run: no
- Original tenant ID: `c674696ffa32fbc19bb1f311`
- Original tenant slug: `cedar`
- Archived slug target: `cedar-archived-20260313-205245`
- User memberships set inactive: 3

## Why archive instead of delete

The existing PondBridge Cedar tenant only contained seeded/demo data. Archiving it with a new slug and inactive status preserves a rollback path, avoids the production hard-delete path, and frees the canonical `cedar` slug for the migrated replacement tenant.

## Database changes

- Updated the original Cedar tenant to an archived slug and inactive status.

- Set every user row attached to the archived Cedar tenant to `inactive` to avoid accidental cross-tenant identity conflicts later.

## Artifacts

- Backup exports: `migration/cedar-existing-backup/*`
- Archive manifest: `migration/cedar-existing-backup/cedar-archive-manifest.json`
