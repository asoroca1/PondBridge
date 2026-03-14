# Validation Report

- Validation timestamp: 2026-03-14T00:34:47.171Z
- Cedar tenant present: yes
- Cedar tenant ID: `5f87cef25f677d340dca6426`
- Archived seeded Cedar slug: `cedar-archived-20260313-205245`
- Non-Cedar tenants preserved: yes
- Orphaned Cedar profiles: 0
- Duplicate Cedar emails: 0
- Aden assigned as tenant admin with Clerk linkage: yes

## Cedar record counts

- `users`: 282
- `profiles`: 282
- `conversations`: 12
- `messages`: 15
- `forums`: 27
- `forum_posts`: 1
- `photos`: 18
- `newsletters`: 12
- `family_trees`: 1
- `activity_items`: 338

## Archived seeded Cedar counts

- `users`: 3
- `profiles`: 3
- `invites`: 0
- `access_requests`: 0
- `magic_link_tokens`: 0
- `conversations`: 0
- `messages`: 0
- `forums`: 0
- `forum_posts`: 0
- `photos`: 0
- `newsletters`: 0
- `email_broadcasts`: 0
- `family_trees`: 0
- `analytics_events`: 2
- `import_reports`: 0
- `tenant_admin_audit_logs`: 0
- `resume_parse_results`: 0
- `activity_items`: 0
- `resend_webhook_events`: 0
- `stripe_webhook_events`: 0
- `email_suppressions`: 0

## Source comparisons

- `users`: legacy 282, imported 282
- `profiles`: legacy 282, imported 282
- `activities`: legacy 338, imported 338
- `forums`: legacy 26, imported 27
- `forumPosts`: legacy 1, imported 1
- `conversations`: legacy 15, imported 12
- `messages`: legacy 21, imported 15
- `photos`: legacy 18, imported 18
- `newsletters`: legacy 12, imported 12
- `familyTrees`: legacy 1, imported 1

## Notes

- The original seeded Cedar tenant was archived instead of hard-deleted.
- Prelaunch signup rows from the legacy system were intentionally preserved in audit artifacts only, because there is no like-for-like PondBridge tenant table for those records.
- Migration exceptions:
  - Conversations imported 12 of 15; unresolved legacy participant references were skipped instead of creating orphaned tenant data.
  - Forums imported 27 of 26; one placeholder forum was created to retain a legacy forum post whose source forum row was missing.
  - Messages imported 15 of 21; messages whose senders were missing from legacy users were skipped.
  - Newsletter 68ab90a2478e6ac348241ab3 kept its legacy PDF payload because the remote file exceeded the 100 MB import safety limit.
- Validation details JSON: `migration/cedar-mapping-files/cedar-validation-summary.json`
